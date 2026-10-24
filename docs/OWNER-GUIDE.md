# ShopPOS: owner's guide

**The menu on the left has 9 entries:** Home, Billing, Sales, Customers, Products, Purchases, Cash,
Reports and Settings. Some have tabs at the top (for example **Products** has Products · Stock ·
Barcode labels · Categories & brands).

This guide is for the shop owner. It explains the daily routine and what to do when something goes
wrong. ShopPOS runs on the shop laptop and works without internet.

## Every day

### Morning: open the day

1. Turn on the laptop. ShopPOS opens by itself (full screen).
2. Tap your name and type your PIN.
3. Go to **Billing**. Press **Open the day** and type the cash that is in the drawer.

### Selling

Scan the item's barcode. It appears on the bill at once.

| Key                        | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| Type a name                | Search for an item that has no barcode, Enter to add             |
| `3*` then scan             | Adds 3 of the item                                               |
| `+` / `−`                  | One more / one less of the selected item                         |
| `5*` then Enter            | Set the selected item to 5 (or click the quantity and type it)   |
| `*`                        | Type the quantity of the selected item                           |
| ↑ ↓                        | Choose an item on the bill                                       |
| **Delete** / **Backspace** | Remove the selected item (press **Enter** to confirm)            |
| **Ctrl + D**               | Change quantity, price or discount of the item                   |
| **F3**                     | Choose the customer (needed for credit sales)                    |
| **F4**                     | Pay                                                              |
| **F6** / **F7**            | Hold a bill / bring a held bill back                             |
| **F8**                     | Discount on the whole bill                                       |
| **F9**                     | Retail / wholesale prices                                        |
| **F10**                    | Print the last receipt again                                     |
| **Ctrl + Q**               | Print the bill as a **quotation** (price offer); nothing is sold |
| **Ctrl + I**               | **Price check**: scan an item to see its prices and stock        |
| **Ctrl + L**               | **Lock** the screen; your PIN opens it again and the bill stays  |
| **Ctrl + K**               | Go to any page (type a few letters, Enter)                       |
| **F12**                    | The full list of keys                                            |

Every warning ("Remove this item?", "Start a new bill?" …) is answered with **Enter** (yes) or
**Esc** (no), so the mouse is never needed.

**Changing a price on the bill:** click the price of the item on the bill, type the new price and
press **Enter** (**Esc** keeps the old one). The line shows "Price changed"; a cashier needs your
PIN for it when paying. **Ctrl + D** also changes the price, quantity and discount together.

**Warranty:** items with a warranty show it on the bill, and the receipt prints the warranty end
date. Find the bill later in **Sales → Bills** by its number or the customer.

**Paying:** press **Pay** (**F4**): the payment opens right under the total. Type the amount and
press **Enter**; **F4** = exact cash; **Esc** goes back to the bill. Press **C** for cash, **K** for
card, **B** for bank transfer or **A** for the customer's account (credit) first. **Card and cash
together:** choose Card, type the card amount and press Enter; the rest is then asked as cash and
the change is shown.

**More than the stock:** nobody (also not an admin) can put more on the bill than is in stock:
scanning, `3*`, `+`, typed quantities and the line editor all stop at the stock, with a message
such as "Only 31 in stock". Add the stock first (**Purchases** or **Stock → Adjust**). Only if you
really want to sell without stock, turn on **Settings → Billing → Allow selling items with no
stock**: the bill then goes through with a warning and is written in the audit log.

Cashiers need your PIN for big discounts, price changes, voiding a bill, refunds, taking cash out,
opening the drawer and selling above a customer's credit limit. You can change these rules in
**Settings → Admin approval**.

### Evening: close the day

1. On **Home** press **Close the day** (or go to **Cash**).
2. Count the cash in the drawer and type the total in **Cash in the drawer**. The screen shows
   if the drawer is **short** or **over**. Write a note if it is.
3. Press **Close the day and print**. The day report prints and a backup is made.

## Notifications

The **bell** in the sidebar (on every page) shows what needs a look, with the number of new ones:
items out of stock or running low, a day left open from an earlier day, no backup for two days
and, for the owner, what others did that matters (voids, returns, sales without stock, price
changes, big discounts, the drawer opened, wrong passwords). New ones also pop up for a few
seconds. Click one to open the right page; opening the bell marks everything as read. Each
person only sees what they are allowed to see.

## Customers and credit

- **Customers → Add customer.** Give a **credit limit** to customers who may buy on account
  (0 = no credit). Choose **Wholesale** for customers who get wholesale prices.
- To sell on credit: **F3**, choose the customer, then **F4 → On account**.
- When they pay: **Customers →** open the customer **→ Receive payment**. Cash payments are added
  to the day's drawer.
- **Adjust balance** is for old amounts from your book before ShopPOS.

## Returns

**Returns → New return**, scan the barcode on the receipt (or type the bill number), choose the
items and how many, and the reason. Tick **Damaged** if the item cannot be sold again (it is not
put back in stock). Choose how the money is given back.

## Stock and purchases

- **Products**: add and edit items, prices and barcodes. Each product in the list has **Edit**
  and **Stock** (count it, or add / remove items) buttons; the product page also has **Adjust**
  next to each stock number, and its stock history underneath. **Import** reads an Excel or CSV
  list. Set the **Warranty** (7 days … 3 years); it is printed on the receipt with its end date.
- **Variants are optional.** A simple product has one line: price and stock. Press **Add a variant
  (colour, size …)** only when it comes in several; **Duplicate** on a line copies its prices to a
  new line, so you only type the name and stock.
- **Purchases → New purchase** when stock arrives. **Receive into stock** adds the items and
  updates the cost price. What you owe the supplier is shown under **Suppliers**.
- **Products → Stock**: items running low, the history of every item, and stock counts (adjustments).
- **Products → Barcode labels**: print sticker sheets for items without a barcode.

## Designing the receipt (Receipt Studio)

**Settings → Receipt → Open the Receipt Studio** opens the receipt full screen, filled in with your
latest bill. It works like a photo editor, but every button says what it does:

- **Left: Add and Layers.** Click a piece (Text, Two columns, Logo, Line, Space, Items, Total,
  Payment, Item count, You saved, Bill barcode, QR code, Signature) to add it under the selected
  piece, or drag it onto the paper. **Layers** lists every piece from top to bottom: the **eye**
  hides a piece (it stays in the design but is not printed), the **lock** stops it being changed
  by accident, drag a layer to move it, double-click to give it a name.
- **Middle: the paper.** Click a piece to select it; **Ctrl + click** or **Shift + click** selects
  more. Drag to move, double-click a text to type on the paper. **Zoom** with − and +.
  **80 mm / 58 mm** shows the receipt on either paper. **Printer view** shows exactly what the
  receipt printer prints. **Compare** puts the saved receipt next to yours, with changes outlined
  (green added, amber changed, blue moved, red removed).
- **Show with**: try the design on the latest bill, a sample, or the same bill paid by card, sold
  on credit (with the shop copy), as a quotation or a reprint. Type a bill number to use that bill.
- **Right: the selected piece.** Text: alignment, **bold**, underline, **white on black**, and
  sizes Normal, Tall, Wide and Big. Insert fields from the bill (shop name, bill number, date,
  time, cashier, customer, total, paid by, bill note …). A line whose fields are empty (for example
  "Customer: …" with no customer) is left out. **Print this piece when** prints a piece only on some
  bills, for example "Please pay within 30 days" only on credit sales.
- **Logo**: select it and choose **Position** left, centre or right (or tell the assistant "move
  the logo to the left"). Drag it, or the arrows in Layers, to move it up or down.
- **Assistant**: type what you want in plain words, for example "make the total big", "add
  WhatsApp 0771234567", "add "No returns after 7 days" at the bottom", "save paper", "use the
  modern design" or "check my receipt". Each answer can be undone with one click.
- **Check** looks for mistakes (no total, no bill number for returns, an empty QR code, text too
  long for big letters, two lines in a row …) and fixes most of them with one click.
- **History**: every change is a step; click one to go back to it. **Saved versions** keeps each
  saved receipt, to compare with now or bring back.
- **Designs**: start from Classic, Compact, Minimal, Modern or Tax invoice, or save your own
  designs by name (for example "Normal" and "Eid sale") and switch between them. **⋯** saves the
  design to a file or opens one, and has **Find and replace** (Ctrl + H) to change words
  everywhere at once, such as a new phone number.

Keys: **Ctrl + Z / Ctrl + Y** undo and redo, **Delete** removes, **Ctrl + D** duplicates,
**Ctrl + C / Ctrl + V** copy and paste pieces, **Alt + ↑ / ↓** moves, **Ctrl + E** hides, **/** asks
the assistant, **?** lists every key.

Press **Test print**, then **Save** (Ctrl + S). If the check found a real problem, you are asked
first. New bills print like this. Leaving with unsaved changes asks before throwing them away.

## Settings made easy

- The menu on the left is grouped: **Your shop** (details, receipt, printer), **Selling** (billing,
  admin approval), **App** (look, AI assistant) and **Tools** (history, copy settings). Bills
  carry no tax (the VAT option was removed).
- **Overview** (the first page of Settings) shows every section with how it is set now, lists
  anything worth fixing (each with a **Fix** button), and has the assistant: type "round bill
  totals to the nearest Rs 10", "cashiers can give up to 15% discount" or "lock the screen after 5
  minutes". It shows each change as _Now_ and _New_; nothing is saved until you press **Save these
  changes**.
- **Search** (top right) finds any setting by its name, for example "rounding" or "drawer".
- At the bottom of every page a bar says **All saved** or how many changes are **not saved**, and
  holds **Save**, **Compare** (what changed), **Undo** and **Defaults** (the values a new shop
  starts with). It stays in view while you scroll.
- **History** lists every saved change, who made it and when. **See change**, **Compare with now**,
  or **Undo** to bring the earlier settings back.
- **Copy settings** saves all settings to a file, or opens one (for example from your other shop).
  You see what is different and tick what to take over.

## The AI assistant (on every page)

Press the round, glowing **AI button** in the bottom-right corner of any page (in Billing it is at
the top right), **Ask AI** in the sidebar, or **Ctrl + J**. You can also type a question in
**Ctrl + K** and choose **Ask**. It is a chat:

- Type **or speak** (the microphone button), in **English, සිංහල, தமிழ் or any language**.
- Ask follow-up questions: "how are sales today?" and then "and yesterday?".
- Ask for several things or for advice: "sales this week and what is running low", "give me 3
  ideas to sell more this week".
- Every answer shows the numbers under it (tiles and tables) and buttons to open the right page.
  **Copy** and **Read aloud** are under each answer; **New chat** starts again.

Examples: "how are sales today?", "compare this month with last month", "best sellers this week",
"what is not selling?", "what is running low?", "price of USB cable", "who owes us money?", "how
much cash is in the drawer?", "how do I close the day?", "open reports", "round bill totals to the
nearest Rs 10" (you approve it before it is saved).

Without internet or without AI it still answers the usual questions (in English) by itself. It
only shows what the person may see: a cashier cannot see sales figures, profit or cost prices
unless you allow it.

## Free AI (optional)

**Settings → AI assistant** offers three choices:

- **Built-in only**: no internet needed. This is how a new shop starts.
- **Free online AI** (recommended): any question in any language, natural answers, advice and
  voice messages. Needs internet and a free key. Choose a service:
  - **Groq** (recommended: free, no card, very fast, also reads voice messages). Open
    **console.groq.com** on any computer or phone, sign in with Google or an email address, open
    **API Keys → Create API Key**, copy the key (it starts with `gsk_`).
  - **Google Gemini**: **aistudio.google.com → Get API key → Create API key** (free with a Google
    account; on the free plan Google may use what is sent to improve its products).
  - **OpenRouter** (free models, about 50 questions a day): **openrouter.ai → Keys**.
  - **Mistral** (free after phone verification): **console.mistral.ai → API Keys**.
  - **Cerebras**, **GitHub Models**, or **Other service** (any OpenAI-compatible service).

  Paste the key, press **Test the AI**, then **Save**. The key is stored encrypted on this computer
  and never shown again.

- **AI on this computer**: free and offline, but needs a laptop with 8 GB memory or more. Install
  **Ollama** from ollama.com, run `ollama pull qwen3.5:4b` in a Command Prompt (about 3.4 GB,
  once; on a slow laptop use `llama3.2:3b`), then **Test** and **Save**.

**Voice messages** are turned into text by Groq (any language) when a Groq key is saved. Without
it, Chrome and Edge can listen instead (choose English, සිංහල or தமிழ் next to the microphone).
Both need internet; typing always works.

### Your data and the AI

- Every number is worked out **on this computer** from your shop's data, and only what the person
  asking may see.
- **Let the AI explain the answers in its own words** (Settings → AI assistant → Privacy, on by
  default): the AI reads the results it explains (totals, item names) so it can chat naturally,
  give advice and answer in your language. **Customer names are replaced by codes** such as [C1]
  before anything is sent, and are put back on this computer; **phone numbers are never sent**.
  Switch it off and the AI only reads the question.
- Bills, passwords, backups and the key itself are never sent to the AI. The key only goes to its
  own service, over https.
- The Settings and Receipt Studio assistants send only the settings or the receipt design they
  change.
- The AI can only choose from the same safe actions as the screens, every answer is checked, and
  you approve setting changes before they are saved.

## Expenses

**Cash → Expenses → Add expense** for rent, electricity, salaries, tea and so on. Choose **Cash from the
drawer** if you took the money from the till, so the day's cash count stays right. Expenses are
taken off the profit in the reports.

## Dashboard and reports

- **Home**: big buttons for everyday jobs (New sale, Close the day, Return, Add product, Stock
  arrived, Reports), then today's sales and profit, a 30-day chart, items running low, and what customers
  owe.
- **Reports**: choose the dates at the top, then a tab: sales and profit (by day, week or month),
  best sellers, slow movers (in stock but not selling), stock value, cashiers and payment methods.
  **Excel** and **PDF** save the report as a file.

## Backups (important)

ShopPOS makes a backup **every night at 21:30** and **when you close the day**. They are kept in
`C:\ShopPOS\backups` (the newest 30).

A backup on the same laptop does not help if the laptop is stolen or broken. Keep a copy elsewhere:

- **USB stick**: go to **Settings → Backups**, type a folder on the stick (for example `E:\ShopPOSBackups`) and
  press **Save**. Whenever the stick is plugged in, the newest backup is copied to it. Take the stick
  home once a week.
- **Google Drive** (optional): follow the steps on the **Settings → Backups** page once. Backups are uploaded
  whenever the laptop has internet.

Check **Settings → Backups** now and then: Home shows a red warning if there has been no
backup for more than a day and a half.

### Restoring a backup

Only do this if data was lost or damaged. **Backups →** choose the backup **→ Restore**, type
`RESTORE`. All data goes back to that time; sales made after it are replaced. ShopPOS makes a
backup of the data as it is now first, so a restore can be undone. On a new laptop, install
ShopPOS, then restore the newest backup from the USB stick (it is listed under "Backups on the USB
drive").

## Users and PINs

- **Settings → Users**: add a cashier with a PIN, and tick what they may see and do, grouped as
  Selling, Products and stock, Customers, Money and Running the shop. Untick **See the Sales page
  (past bills)** to hide the Sales page from that person (they can still sell); tick it again to
  show it back.
- Everyone can change their own password and PIN under their name (bottom left) **→ Change my
  password / Change my PIN**.
- **Settings → Billing → Lock the screen when nobody uses it for**: the till locks itself after a
  few minutes, so nobody can use your login while you are away.
- **Settings → Audit log** shows every important action and who did it, for example voids, price changes,
  refunds, logins and setting changes. Nobody can change or delete it.

## Leaving full screen

Your name (bottom left) **→ Exit full-screen POS**. A cashier needs your PIN. **Alt + F4** also works.
To open ShopPOS again, double-click **ShopPOS** on the desktop.

## When something goes wrong

| Problem                                | What to do                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ShopPOS does not open after starting   | Wait one minute, then double-click **ShopPOS** on the desktop                                                           |
| "The receipt printer did not answer"   | Check the printer is on and has paper. The receipt prints with the browser instead. **Settings → Printer → Test print** |
| The drawer does not open               | Check the drawer cable goes into the printer. **Settings → Printer → Open drawer** to test                              |
| The scanner types into the wrong place | Press **F2** (search box) and scan again                                                                                |
| Forgot a PIN                           | The owner resets it under **Settings → Users**. The Super Admin can reset the owner's                                   |
| "The day is not open"                  | **Billing → Open the day**                                                                                              |

Logs for the person who set up the POS: `C:\ShopPOS\logs`.

## Updating ShopPOS

You get a new folder. Double-click **UPDATE.cmd** in it and choose **Yes**. It backs up all data
first, installs the new version and checks that it works. If anything goes wrong it puts the old
version back by itself, so the shop can keep selling.
