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
| Admin       | The shop owner | Everything except branding. Cannot see, edit or create Super Admin accounts.                                                                                                                    |
| Cashier     | Shop staff     | Only the permissions the admin ticks.                                                                                                                                                           |

Branding is a settings section protected by the Super Admin-only `branding.manage` permission. The web
app sets the `--brand` CSS variable from it; every accent (buttons, focus rings, highlights, sidebar
marker, startup animation) derives from that one colour. The last brand is cached in the browser so the
next start paints the right colour immediately. With no uploaded logo, the built-in ShopPOS
vector logo is used (`apps/web/src/components/brand/logo-paths.ts`).

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
6. In one transaction: needs an open day, takes the next `INV-YYYY-NNNNNN`, writes bill, items (with
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

The assistant (`assistant.ts`) turns plain requests into actions from a fixed list
(`receiptActionSchema`, `ASSISTANT_SETTINGS`). The built-in interpreter understands common
requests without any AI. `POST /assistant/receipt` and `/assistant/settings` try it first; only
requests it does not understand go to a free local model through Ollama (`modules/assistant`),
when the shop turns it on in Settings → Assistant. The model answers with JSON constrained by a
schema (Ollama structured outputs), every action is validated with Zod, actions are applied by
the same code as manual edits, setting changes are shown for approval, the AI address must be on
this computer or the private network (`isLocalAiUrl`, redirects refused), one AI request runs at
a time and only the design and settings are sent, never bills or customers.

## Release and database updates

`pnpm release:win` bundles the server with esbuild into three files (`main.js`, `cli/migrate.js`,
`cli/seed.js`), so the shop laptop needs no `node_modules` and no Prisma CLI. `cli/migrate.js` applies
`prisma/migrations` itself, each migration in its own transaction, and records them in Prisma's own
`_prisma_migrations` table, so it stays compatible with `prisma migrate` during development.

## Running as one app

In production, NestJS serves `apps/web/dist` and the API under `/api`. Unknown paths return
`index.html` so browser refreshes work on any page.
