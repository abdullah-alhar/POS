# Changelog

## 1.2.0 (24 October 2026)

### New

- **New login screen**: the shop's name and the time on one side; tap your name and type your PIN
  (or use a username and password) on the other. Works on small screens too.
- **Choose who gets which notification**: Settings → Notifications sets each kind (out of stock,
  running low, voids, returns, price changes, the drawer, security …) to everyone who may see it,
  owners only, or off. Nobody is notified about their own actions.
- **Error codes**: every error shows a code and, for faults, a reference such as `Ref K7Q2MX`.
  The Super Admin finds it under Settings → Problems; a database that is not updated says so
  clearly (code `DB_OUTDATED`) instead of "Something went wrong".
- **New purchases start at the last cost** of each item.

### Changed

- **No more "Open the day"**: the day starts by itself with the first sale. Cash → Set the
  opening cash records change in the drawer.
- The **Stock** tab is gone: stock is counted and adjusted in Products (Stock, Stock count and
  Adjust). Old links open the products that are running low.
- **Super Admin work is hidden from the shop owner**: setting up the AI service and its keys, and
  the Problems page.
- The AI assistant only explains and opens what the person asking is allowed to use.
- Staff who cannot buy stock, edit products or see reports no longer receive cost prices.
- Reports no longer show a Tax column (only for old bills that had tax).
- A smaller AI button that covers less of the page; tabs and back links no longer share a line.
- `pnpm dev` updates the database before starting.

### Fixed

- Home could show "Something went wrong" after an update until the database was updated.
- The receipt logo would not move to the centre or right in Receipt Studio and Chrome printing.
- The Billing page could be opened by users who may not sell.
- Form labels are linked to their boxes (click a label to type; screen readers read them).
- The date on a new purchase was cut off.

## 1.1.0 (24 October 2026)

### New

- **AI assistant on every page**: the animated AI button (or Ctrl + J) opens a chat in any
  language, typed or spoken, with follow-up questions and advice. Answers come from the shop's
  own data, within each user's rights. It also works offline for the usual questions. Optional
  free AI: Groq (recommended), Gemini, OpenRouter, Mistral, Cerebras, GitHub Models, any
  OpenAI-compatible service, or Ollama on the laptop. Customer names are hidden from the AI.
- **Receipt Studio**: design the receipt like a photo editor: layers, drag and drop, styles,
  print conditions, a design check, history, compare, saved designs and an assistant. The logo
  can sit left, centre or right.
- **Settings redesigned**: grouped menu, an overview of every section, search, a save bar that
  stays in view, history with compare and undo, and copying settings to another shop.
- **Payment under the total**: Pay opens the payment in the bill panel; cash, card, bank or
  account, and card and cash together.
- **Change a price on the bill** by clicking it (a cashier still needs admin approval).
- **Products and stock together**: Edit and Stock buttons in the product list, Adjust on the
  product page. Variants are optional, and Duplicate copies a variant's prices.
- **Notifications**: a bell with stock alerts, a day left open, backups due and, for owners,
  voids, returns and other important actions.
- **What each user may see**: permissions grouped by area, including hiding the Sales page from
  staff (and showing it again).

### Changed

- Selling more than the stock is blocked (for everyone) unless the owner allows it in Settings →
  Billing.
- Closing the day asks only for the total cash in the drawer.
- The VAT / tax option and IMEI / serial numbers are removed.
- A bigger shop logo in the sidebar.

### Fixed

- The till seemed to freeze after a sale or after closing the day: Chrome's print window could
  get stuck (a grey screen with a thin white line). Printing now uses a properly sized frame,
  runs one at a time, and windows close before printing starts.
- An error on one page no longer stops the whole app (Try again on that page); the server keeps
  running if background work fails.
- The Look page scrolled the whole window.

### Updating

Run **UPDATE.cmd** from the new folder. The database is updated automatically (removing IMEI
numbers and tax, turning on the stock limit, adding notifications); a backup is made first.
