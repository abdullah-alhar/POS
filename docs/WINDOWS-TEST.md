# ShopPOS: install and test on the Windows laptop

Version 1.0.0 is the complete POS: billing, stock, purchases, returns, customers and credit,
cash register, expenses, dashboard, reports, backups and the audit log.

There are three ways to start:

| You want to…                                         | Double-click       | Data                                                  |
| ---------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| **Try it** with ~60 sample products                  | `INSTALL-TEST.cmd` | test passwords (below)                                |
| **Set up the real shop** (empty, your own passwords) | `INSTALL.cmd`      | asks for the owner and Super Admin passwords and PINs |
| **Update** a laptop that already has ShopPOS         | `UPDATE.cmd`       | everything is kept; a backup is made first            |

A laptop that already has an older version (0.2–0.4): use **UPDATE.cmd**. Your test sales stay.

## What you need

- The shop laptop: **64-bit Windows 10 (1809 or newer) or Windows 11**, Intel/AMD (x64) or ARM64
  (ARM laptops need Windows 11). 32-bit Windows is not supported.
- **Google Chrome** installed
- The **receipt printer** connected by USB, with its Windows driver installed
  (it should appear in _Settings → Bluetooth & devices → Printers & scanners_)
- The **cash drawer** plugged into the printer (RJ11 cable) and the **barcode scanner** (USB)

There are two packages. Use the **offline** one if the laptop has no internet or a slow one:

| Package                     | Size         | Internet on the laptop                                            |
| --------------------------- | ------------ | ----------------------------------------------------------------- |
| `shoppos-1.0.0-offline.zip` | about 420 MB | **not needed**: Node.js, PostgreSQL and everything else is inside |
| `shoppos-1.0.0.zip`         | about 12 MB  | needed once: downloads Node.js (30 MB) and PostgreSQL (340 MB)    |

The installer always uses what is already there first: a Node.js 22 (or newer) or PostgreSQL 14
(or newer) already installed on the laptop is used instead of downloading.

## 1. Install

1. Unzip the package onto the laptop (right-click → _Extract All_), for example to the Desktop.
2. Double-click **INSTALL-TEST.cmd** (test) or **INSTALL.cmd** (real shop) and choose **Yes** when
   Windows asks for permission. INSTALL.cmd first asks you to choose the passwords and PINs; nothing
   is shown while you type, and each is asked twice.
3. The installer first checks the laptop and shows a list like this:

   ```
   [OK]   Windows  Microsoft Windows 11 Home (build 22631)
   [OK]   Processor  x64
   [OK]   Free disk space  180 GB on C:
   [!]    Node.js  not installed; it will be set up
   [!]    PostgreSQL  not installed; it will be set up
   [OK]   Google Chrome  found
   [OK]   Port 80  free
   [OK]   Internet  not needed (everything is in the vendor folder or already installed)
   ```

4. At the end you see **"ShopPOS is installed."** Double-click **ShopPOS** on the desktop.

**If something goes wrong** the window shows a red **ERROR** line with the reason and what to do.
Everything is also written to **`C:\ShopPOS\logs\install.log`**. Send that file.

**If a download fails** (antivirus, firewall or proxy can block PowerShell), the installer lists the
links. Download those files with Chrome, put them in the **`vendor`** folder next to `INSTALL.cmd`,
and run INSTALL.cmd again. Or simply use the offline package.

## 2. First look

| Check             | What should happen                                               |
| ----------------- | ---------------------------------------------------------------- |
| Startup animation | The ShopPOS bag logo draws itself, then the login screen appears |
| Login             | Tap **Shop Owner**, PIN **1234** (or the PIN you chose)          |
| Address           | The screen is full size, with no address bar (kiosk mode)        |

To leave full screen: user menu (bottom left) → **Exit full-screen POS** (a cashier needs the owner's
PIN), or press **Alt + F4**. To open it again, double-click **ShopPOS** on the desktop.

## 3. Set up the receipt printer

1. Go to **Settings → Printer**.
2. Choose **Receipt printer (USB)**.
3. Pick your printer from the list (press the refresh button if it is empty).
4. Press **Save**, then **Test print**.

| Check                  | What should happen                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Test receipt           | A receipt with the shop logo, "Printer test" and a barcode                              |
| Width                  | Lines fill the paper. If text wraps badly, set _Characters per line_ to **42** and save |
| Cut                    | The paper is cut (if your printer has a cutter)                                         |
| **Open drawer** button | The cash drawer opens                                                                   |

## 4. Make test sales

Go to **Billing** and sell: the day starts by itself with the first sale. (To start with change
in the drawer, **Cash → Set the opening cash**.)

| Try this                                                                                 | What should happen                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Scan a product barcode (print one from a product, or use one on the box if you added it) | Beep, the item appears at once                           |
| Type `anker`                                                                             | A list of matching items; press Enter to add the first   |
| Type `3*` then scan                                                                      | Adds 3 of that item                                      |
| Press **+** / **−**                                                                      | Changes the quantity of the selected line                |
| **Ctrl + D**                                                                             | Change quantity, price or discount of the selected line  |
| **F8**                                                                                   | Discount on the whole bill                               |
| **F9**                                                                                   | Switch Retail / Wholesale prices                         |
| **F4** then **Enter**                                                                    | Pay in cash. The receipt prints and **the drawer opens** |
| **F4**, press **K**, type part of the amount, Enter, then **F4**                         | Card + cash split payment                                |
| **F6** then **F7**                                                                       | Hold a bill, then bring it back                          |
| Press **F5** or close Chrome in the middle of a bill, then open it again                 | The bill is still there                                  |
| **F10**                                                                                  | Prints the last receipt again, marked REPRINT            |
| Give a 20% discount (above the 10% cashier limit) as a cashier                           | Asks for the owner's PIN at payment                      |

Add a cashier under **Users** to test PIN approvals (cashiers need an admin PIN for big
discounts, price changes and voids).

## 4a. Keyboard, warranty, prices and the receipt editor

| Try this                                                                      | What should happen                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Scan an item, type `5*` and press Enter                                       | The quantity becomes 5                                                |
| Press `*`, type 12, Enter / click the quantity and type                       | The quantity changes                                                  |
| Press **Backspace** (scan box empty), then **Enter**                          | "Remove this item?" → the item is removed                             |
| Scan a speaker or smart watch (sample data)                                   | The line shows "1 year" warranty                                      |
| Click the price on the bill, type a new one, Enter                            | The line shows "Price changed"; a cashier needs the admin PIN to pay  |
| Sell it, then open the bill in **Sales history**                              | It shows the warranty end date                                        |
| **Ctrl+Q** with items on the bill                                             | A QUOTATION prints; the bill stays on the screen                      |
| **Ctrl+I**, scan an item                                                      | Prices, stock and warranty, nothing added                             |
| **Ctrl+L**, then your PIN                                                     | Locked, then back with the same bill                                  |
| **Ctrl+K**, type `rep`, Enter                                                 | Opens Reports                                                         |
| **F12**                                                                       | The list of all keys                                                  |
| **Settings → Receipt**: add a title, a QR link, 2 copies, then **Print this** | The preview changes as you type; the printer prints it with a QR code |

## 4b. Customers, cash, reports and backups

| Try this                                                                         | What should happen                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Customers** → Add customer (give a credit limit, e.g. Rs 10,000)               | The customer is listed                                                    |
| Billing → **F3** → pick the customer → add items → **F4** → **On account** (A)   | The bill is saved; the customer now owes that amount                      |
| Customers → open the customer → **Receive payment**                              | What they owe goes down; a cash payment adds to today's drawer            |
| Pick a **wholesale** customer with F3                                            | Prices switch to wholesale                                                |
| **Expenses** → Add expense, paid from the drawer                                 | Listed; the cash register's "should be in the drawer" goes down           |
| **Cash register** → Cash out (as a cashier)                                      | Asks for the owner's PIN                                                  |
| **Cash register** → **Close the day**, count the notes                           | Shows short / over, prints the day report, and makes a backup             |
| **Dashboard** (first menu item)                                                  | Today's sales and profit, a 30-day chart, low stock warnings              |
| **Reports** → each tab → **Excel** and **PDF**                                   | The files download and open in Excel / a PDF reader                       |
| **Backups** → set the USB folder (e.g. `E:\ShopPOSBackups`), plug in a USB stick | **Back up now** → the backup shows ✓ USB and the file is on the stick     |
| **Backups** → Restore an older backup (type RESTORE)                             | The data goes back to that time; a "before restore" backup is made first  |
| **Audit log**                                                                    | Every sale, void, price change, login and setting change, with who did it |

## 5. Restart test

Restart the laptop. After Windows starts, ShopPOS should open by itself in Chrome
(it waits for the server, which can take up to a minute after a cold start).

## 6. Things to report back

- Did the receipt print correctly? Is the logo sharp? Was the width right?
- Did the drawer open after a **cash** sale (and not after a card sale)?
- Did the scanner add items without clicking into the box first?
- Did everything start by itself after a restart?
- How fast did scanning feel?
- Did the backup copy to the USB stick? Did the Excel and PDF reports open?

## Update to a newer version

Unzip the new package and double-click **UPDATE.cmd**. It backs up all data, installs the new
version, updates the database and checks that it starts. If anything fails it puts the old version
and the data back by itself. The log is `C:\ShopPOS\logs\update.log`.

## Remove the test install

Double-click **UNINSTALL.cmd** in the install folder. It removes the services and
shortcuts but keeps the data. To delete everything, run in an admin PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ShopPOS\uninstall.ps1 -RemoveData
```

## Where things are

| What                | Where                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| App, database, logs | `C:\ShopPOS`                                                                        |
| Server log          | `C:\ShopPOS\logs\ShopPOS.out.log` and `ShopPOS.err.log`                             |
| Windows services    | `ShopPOS` and `ShopPOS-DB` (in _Services_)                                          |
| Backups             | `C:\ShopPOS\backups` (and your USB folder / Google Drive if set up)                 |
| Test logins         | Shop Owner PIN `1234` / `admin` + `admin123`; Super Admin `superadmin` + `super123` |
| Real-shop logins    | `admin` and `superadmin` with the passwords chosen during INSTALL.cmd               |
