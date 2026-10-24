# Changelog

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
