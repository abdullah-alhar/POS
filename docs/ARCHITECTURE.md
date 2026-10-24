# Architecture

## Defaults and decisions

| Topic        | Decision                                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop         | Small retail + wholesale shops. Name, logo and colour set in Settings.                                                                                                                                                                               |
| Currency     | LKR (Rs). Stored as integer cents; shown without cents in the UI and on receipts.                                                                                                                                                                    |
| Tax          | Prices include tax. Default rate 0%. VAT can be switched on in Settings (rates managed there).                                                                                                                                                       |
| Rounding     | Bill totals and percentage discounts round to the nearest whole rupee (`pos.roundingStep = 100`). The difference is stored as `Sale.roundingAdjustment`. Rounding applies to every payment method so the total shown always matches what is charged. |
| Bill numbers | `INV-YYYY-000001`, restarting every year. Gap-free (counter row locked inside the sale transaction).                                                                                                                                                 |
| Zero stock   | Selling is allowed with a warning, and each such sale is written to the audit log.                                                                                                                                                                   |
| Printer      | Generic ESC/POS 80 mm, browser printing fallback. Labels on A4 sticker sheets via the browser.                                                                                                                                                       |
| Receipts     | English only for now. Layout built from blocks so Sinhala/Tamil can later be printed as images.                                                                                                                                                      |
| Import       | CSV/Excel product import.                                                                                                                                                                                                                            |
| Backups      | Local folder + USB copy + optional Google Drive upload when online; must work fully offline.                                                                                                                                                         |

## How money is handled

- Every amount is an integer number of cents (`Int` columns). Percentages are basis points
  (`1250` = 12.5%). No floating-point maths touches money (`packages/shared/src/money.ts`).
- `calculateCart()` (`packages/shared/src/cart-calc.ts`) is the only bill calculation. The browser uses
  it to show totals; the server runs it again at checkout and rejects any difference.
- Order: line discount → bill discount (split across lines in proportion, largest-remainder, so every
  cent is accounted for and returns refund the exact share) → tax (extracted when prices include tax)
  → round the total.

## Integrity rules enforced by the database

Triggers (`prisma/migrations/*_protect_history`) block:

- `UPDATE` / `DELETE` on `AuditLog`, `StockMovement`, `CustomerLedger`, `Payment`
- `DELETE` on `Sale`, `SaleItem`, `SaleReturn`, `SaleReturnItem` (bills are voided, never deleted)

`ProductVariant.stockQty` is a cached number; `StockMovement` is the full history and is written in
the same transaction.

## Roles and branding

| Role        | Who            | Can do                                                                                                                                                                                          |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Super Admin | The app maker  | Everything, including **Branding** (app name, logo, colour, sidebar style, startup animation) to set the app up for each shop. Hidden from the login tiles and from the shop admin's user list. |
| Admin       | The shop owner | Everything except branding and system work (AI service keys, technical problems). Cannot see, edit or create Super Admin accounts.                                                              |
| Cashier     | Shop staff     | Only the permissions the admin ticks.                                                                                                                                                           |

Branding is a settings section protected by the Super Admin-only `branding.manage` permission. The web
app sets the `--brand` CSS variable from it; every accent (buttons, focus rings, highlights, sidebar
marker, startup animation) derives from that one colour. The last brand is cached in the browser so the
next start paints the right colour immediately. With no uploaded logo, the built-in ShopPOS
vector logo is used (`apps/web/src/components/brand/logo-paths.ts`).

`system.manage` (Super Admin only) guards the AI service setup (Settings → AI assistant, keys, test)
and **Settings → Problems**. The Ask assistant only plans steps and opens pages the asking user may
use (`ASK_PAGE_PERMISSION`), and the AI is told which rights the person has. Cost prices on
`GET /products/:id` are zeroed for users without `products.manage`, `purchases.manage` or
`reports.view`.

## Errors

Every API error has the shape `{ statusCode, code, message, fields?, details?, ref? }`. Server faults
(5xx) get a 6-character `ref`, are logged with it and kept in a ring buffer of 100 shown under
**Settings → Problems**. Database states have their own codes: `DB_OUTDATED` (a migration is missing:
run UPDATE.cmd / `pnpm db:deploy`), `DB_UNAVAILABLE` and `DB_TIMEOUT`. The web toast shows
`Code X · Ref Y`, so a reported problem can be found in the log.

## Notifications

Computed per user on request (no stored queue): stock alerts and events from the audit log, filtered
by `Settings → Notifications` (each type: everyone who may see it / owners only / off) and by the
permissions each type needs. A user never gets their own actions; "seen" is a timestamp per user.

Every user can upload a profile photo (cropped and shrunk to 256 px in the browser, stored as a small
data URL); admins can set photos for others. Photos are kept out of the audit log.

## Authentication and approvals

- Login by user tile + PIN, or username + password (the Super Admin always uses username + password). A JWT in an httpOnly, SameSite=Strict cookie,
  valid 12 hours and renewed while in use. The user is reloaded on every request, so disabling a user
  or changing a password (which bumps `tokenVersion`) logs them out at once.
- 5 wrong PINs/passwords lock that login for 5 minutes. Failed logins are audited.
- Passwords and PINs are hashed with Node's built-in scrypt (no native add-ons to compile on Windows).
- **Admin approval:** when a cashier does a protected action, the API answers `403 APPROVAL_REQUIRED`
  with the action name. The web app shows a PIN pad; an admin types their PIN (`POST /auth/approve`)
  and gets a 2-minute, single-use token for that one action. The original request is retried with the
  `x-approval-token` header. The audit log records both the cashier and the approving admin. Which
  actions need approval, and the cashier discount limit, are set in Settings → Admin approval.

## Billing speed

`GET /catalog/pos-index` returns every sellable variant (about 45 KB for 143 variants; cached with an ETag).
The billing screen keeps it in a `Map` keyed by barcode and SKU, so a scan is a sub-millisecond local
lookup. The server still checks prices and stock at checkout.

## Checkout

`POST /api/sales` is the only way a bill is saved. It:

1. Returns the existing bill if the same `clientId` was already saved (retries and double-clicks are safe).
2. Checks every item is still for sale and that the till used current prices (`PRICE_CHANGED` otherwise;
   the till refreshes its prices and the cashier checks the bill).
3. Recalculates the bill with `calculateCart()`; the total must equal the till's total.
4. Checks the payments (`summarizePayments()`): card/bank never more than the bill, change only from cash.
5. Asks for admin approval for price overrides and discounts above the cashier limit. Several approvals
   can be collected and sent together (`x-approval-token: t1,t2`); none is used up unless all are present.
6. In one transaction: opens the day if none is open (`openDayIfNeeded`, serialised with an advisory
   lock so two tills cannot open two days; the same happens for cash movements, cash customer
   payments, drawer expenses and cash refunds), takes the next `INV-YYYY-NNNNNN`, writes bill, items (with
   line numbers), payments, stock decrements with `StockMovement` rows, and the audit entries. Selling
   below zero stock is refused or allowed per settings; when allowed it is written to the audit log.

Voids put the stock back (`SALE_VOID` movements) and keep the bill, marked VOIDED with reason and approver.

## Receipts and printing

The server builds a receipt as printer-independent blocks (`ReceiptDoc`). The same blocks become:

- **ESC/POS bytes** (`apps/api/src/modules/printing/escpos.ts`) sent to a Windows printer through the
  spooler in RAW mode (a tiny C# helper compiled once by PowerShell, no native Node add-ons), to a
  network printer on port 9100, or to a file for testing. The drawer kick (`ESC p`) is sent with cash sales.
- **HTML** printed by Chrome when the printer mode is "browser", or automatically when the thermal
  printer fails. With Chrome's `--kiosk-printing` it prints without a dialog.

The logo is turned into a 1-bit raster in the browser (the printer cannot read PNG/SVG) and saved with
the printer settings. Other scripts (Sinhala/Tamil) can later be added the same way, as image blocks.

### Receipt Studio, design check and assistant

The receipt design (`receipt-layout.ts`) is a list of pieces. Every piece can also have a layer
name, `hidden`, `locked` and `when` (print only on some bills: credit, card, quotation …); all are
optional, so older designs stay valid. `receipt-builder.ts` fills the design in with a bill and
marks pieces that are hidden or whose condition does not hold as `skipped`, so the editor can show
them faded while printing leaves them out. `POST /printing/receipt-preview` takes a `scenario`
(the same bill paid by card, on credit, as a quotation, a reprint …), a `billNumber` and
`charsPerLine` (58 mm paper) and returns the pieces, the printer text and a paper estimate.

`receipt-tools.ts` has the pure helpers the editor uses: `checkReceipt` (problems with one-click
fixes), `diffLayouts` (added / removed / changed / moved pieces), `estimateBlocks` and
`savePaper`. `settings-tools.ts` compares settings in words (`diffSettings`), checks the setup
(`checkSettings`) and labels every setting. Settings history comes from the audit log
(`GET /settings/history`), whose summaries now say what changed.

The assistants (`assistant.ts` for the receipt and settings, `ask.ts` for Ask on every page)
turn plain requests into actions from a fixed list (`receiptActionSchema`, `ASSISTANT_SETTINGS`,
`askIntentSchema`). The built-in interpreters understand common requests (and small talk) with no
AI and no internet; the API tries them first (`modules/assistant`). Everything else goes to the AI
chosen in Settings → AI assistant (`AiService`): off, a free online service through one
OpenAI-compatible client (`openai-compat.ts`; presets for Groq, Gemini, OpenRouter, Mistral,
Cerebras and GitHub Models in `ai-providers.ts`), or Ollama in the shop (`ollama.ts`). Keys are
stored AES-256-GCM encrypted in their own `Setting` row (`ai-keys`), never returned to the browser
(only a hint) and audited without the value.

Ask is a conversation (`AskService`): the client sends the question and up to six earlier
questions. The AI first plans up to three skills (any language, follow-ups, advice); each skill
runs on the server against the database, within the user's permissions. When `ai.shareResults` is
on, a second AI call writes the reply in the user's language from those results: customer names
are replaced by codes (`[C1]`) before sending and restored afterwards, phone columns are dropped,
and at most 15 rows per table are sent. When it is off, the AI only ever sees the questions. AI
answers are JSON, validated with Zod; setting changes are shown for approval; at most 30 AI calls
run a minute; and when the AI is off, offline or fails, the built-in answer is returned (with the
reason in `aiProblem` where it matters) instead of an error. Voice messages are recorded in the
browser and transcribed by Groq's Whisper (`POST /assistant/voice`, size-limited), or by the
browser's own speech recognition when there is no Groq key. Plain-http AI addresses are allowed
only on this computer or a private network (`isLocalAiUrl`, `isSafeAiApiUrl`); redirects are
refused.
