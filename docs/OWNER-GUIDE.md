# Marina POS: owner's guide

**The menu on the left has 9 entries:** Home, Billing, Sales, Customers, Products, Purchases, Cash,
Reports and Settings. Some have tabs at the top (for example **Products** has Products · Stock ·
Barcode labels · Categories & brands).

This guide is for the shop owner. It explains the daily routine and what to do when something goes
wrong. Marina POS runs on the shop laptop and works without internet.

## Every day

### Morning: open the day

1. Turn on the laptop. Marina POS opens by itself (full screen).
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

**Phones, watches and other items with a serial number / IMEI:** when you scan one, a box asks for
the IMEI. Scan the IMEI barcode on the box (or type it) and press Enter. The IMEI and the warranty
end date are printed on the receipt. Later, type the IMEI in **Sales → Bills** to find the bill and
see if the warranty is still valid. The same IMEI cannot be sold twice.

In the payment window: type the amount and press **Enter**; **F4** = exact cash. Press **C** for
cash, **K** for card, **B** for bank transfer or **A** for the customer's account (credit) first.
You can split a bill, for example part card and part cash.

Cashiers need your PIN for big discounts, price changes, voiding a bill, refunds, taking cash out,
opening the drawer and selling above a customer's credit limit. You can change these rules in
**Settings → Selling rules**.

### Evening: close the day

1. On **Home** press **Close the day** (or go to **Cash**).
2. Count the notes and coins and type how many of each. The screen shows if the drawer is
   **short** or **over**. Write a note if it is.
3. Press **Close the day and print**. The day report prints and a backup is made.

## Customers and credit

- **Customers → Add customer.** Give a **credit limit** to customers who may buy on account
  (0 = no credit). Choose **Wholesale** for customers who get wholesale prices.
- To sell on credit: **F3**, choose the customer, then **F4 → On account**.
- When they pay: **Customers →** open the customer **→ Receive payment**. Cash payments are added
  to the day's drawer.
- **Adjust balance** is for old amounts from your book before Marina POS.

## Returns

**Returns → New return**, scan the barcode on the receipt (or type the bill number), choose the
items and how many, and the reason. Tick **Damaged** if the item cannot be sold again (it is not
put back in stock). Choose how the money is given back.

## Stock and purchases

- **Products**: add and edit items, prices and barcodes. **Import** reads an Excel or CSV list.
  Set the **Warranty** (7 days … 3 years) and turn on **Serial number / IMEI** for phones and
  other items you want to track one by one.
- **Purchases → New purchase** when stock arrives. **Receive into stock** adds the items and
  updates the cost price. What you owe the supplier is shown under **Suppliers**.
- **Products → Stock**: items running low, the history of every item, and stock counts (adjustments).
- **Products → Barcode labels**: print sticker sheets for items without a barcode.

## Designing the receipt

**Settings → Receipt** shows the receipt on paper, filled in with your latest bill. Change it like
a picture in Canva:

- **Click** a piece to select it. A small toolbar appears next to it: move up, move down, copy, bin.
- **Drag** a piece up or down to move it. (Receipt printers print from top to bottom, so pieces
  go above or below each other.)
- **Double-click** a text to type on the paper. Enter finishes.
- **Add** pieces from the left: Text, Logo, Line, Space, Items, Total, Payment, Item count, You
  saved, Bill barcode, QR code. Click to add under the selected piece, or drag it onto the paper.
- On the right, change the selected piece: alignment, **bold**, **Big** letters, or insert
  fields from the bill (shop name, bill number, date, cashier, customer …). A line whose fields
  are empty (for example "Customer: …" when there is no customer) is left out.
- **Delete** removes the selected piece, **Ctrl + Z** undoes, **Ctrl + Y** redoes.
- **Start from** Classic, Compact or Minimal to begin again.
- With nothing selected, choose **copies** (1–3) and the **shop copy** with a signature line for
  credit sales.

Press **Test print**, then **Save**. New bills print like this.

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

Marina POS makes a backup **every night at 21:30** and **when you close the day**. They are kept in
`C:\MarinaPOS\backups` (the newest 30).

A backup on the same laptop does not help if the laptop is stolen or broken. Keep a copy elsewhere:

- **USB stick**: go to **Settings → Backups**, type a folder on the stick (for example `E:\MarinaBackups`) and
  press **Save**. Whenever the stick is plugged in, the newest backup is copied to it. Take the stick
  home once a week.
- **Google Drive** (optional): follow the steps on the **Settings → Backups** page once. Backups are uploaded
  whenever the laptop has internet.

Check **Settings → Backups** now and then: Home shows a red warning if there has been no
backup for more than a day and a half.

### Restoring a backup

Only do this if data was lost or damaged. **Backups →** choose the backup **→ Restore**, type
`RESTORE`. All data goes back to that time; sales made after it are replaced. Marina POS makes a
backup of the data as it is now first, so a restore can be undone. On a new laptop, install Marina
POS, then restore the newest backup from the USB stick (it is listed under "Backups on the USB
drive").

## Users and PINs

- **Settings → Users**: add a cashier with a PIN, and tick what they may do.
- Everyone can change their own password and PIN under their name (bottom left) **→ Change my
  password / Change my PIN**.
- **Settings → Selling rules → Lock the screen when nobody uses it for**: the till locks itself after a
  few minutes, so nobody can use your login while you are away.
- **Settings → Audit log** shows every important action and who did it, for example voids, price changes,
  refunds, logins and setting changes. Nobody can change or delete it.

## Leaving full screen

Your name (bottom left) **→ Exit full-screen POS**. A cashier needs your PIN. **Alt + F4** also works.
To open Marina POS again, double-click **Marina POS** on the desktop.

## When something goes wrong

| Problem                                 | What to do                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Marina POS does not open after starting | Wait one minute, then double-click **Marina POS** on the desktop                                                        |
| "The receipt printer did not answer"    | Check the printer is on and has paper. The receipt prints with the browser instead. **Settings → Printer → Test print** |
| The drawer does not open                | Check the drawer cable goes into the printer. **Settings → Printer → Open drawer** to test                              |
| The scanner types into the wrong place  | Press **F2** (search box) and scan again                                                                                |
| Forgot a PIN                            | The owner resets it under **Settings → Users**. The Super Admin can reset the owner's                                   |
| "The day is not open"                   | **Billing → Open the day**                                                                                              |

Logs for the person who set up the POS: `C:\MarinaPOS\logs`.

## Updating Marina POS

You get a new folder. Double-click **UPDATE.cmd** in it and choose **Yes**. It backs up all data
first, installs the new version and checks that it works. If anything goes wrong it puts the old
version back by itself, so the shop can keep selling.
