<p align="center">
  <img src="assets/brand/logo.svg" alt="ShopPOS" width="320">
</p>

# ShopPOS

Offline point-of-sale system for small retail and wholesale shops, built to run on a single Windows
laptop. One program serves both the API and the web app; the shop only opens Chrome. The shop name,
logo and colour are set in **Settings → Look**.

| Part              | Tech                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `apps/web`        | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, TanStack Query, React Hook Form + Zod |
| `apps/api`        | NestJS 11, Prisma 7, PostgreSQL 17, JWT in httpOnly cookies                                  |
| `packages/shared` | Money maths, bill calculation, permissions and Zod schemas used by both sides                |

## Features

- Keyboard-first billing (F12 lists every key), barcode scanning, held bills, quotations, price check
- Retail and wholesale prices, line and bill discounts, admin approval for protected actions
- Stock, purchases, suppliers, returns, CSV/Excel product import, barcode label sheets
- Warranty on items, printed on the receipt with its end date
- Customers with credit, cash register (open/close day), expenses
- Reports, dashboard, audit log
- Receipt Studio: a full-screen receipt editor with layers, multi-select, styles, print-only-when
  conditions, a design check with one-click fixes, history, compare, saved designs and 58/80 mm
  preview; ESC/POS thermal printing with browser fallback
- Settings with search, a setup check, compare / undo of unsaved changes, history with undo, and
  copy to / from a file
- An AI assistant on every page (animated AI button, Ctrl+J): a chat in any language, typed or
  spoken, with follow-up questions and advice; sales, comparisons, best sellers, low stock,
  prices, balances, cash and how-to answers from the shop's own data, plus assistants in Settings
  and the Receipt Studio. Works offline for the usual questions, and can use a free AI (Groq,
  Gemini, OpenRouter, Mistral, Cerebras, GitHub Models, any OpenAI-compatible service, or Ollama on
  the laptop) with customer names hidden from it
- Backups to a local folder, USB stick and Google Drive
- Windows installer with self-rolling-back updates, HTTPS and kiosk mode

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and
[docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md) for the shop owner's manual.

## Development setup (macOS, Linux or Windows)

Needs **Node.js 22.12+**, **pnpm 10** and **Docker** (only for the development database).

```bash
corepack enable pnpm          # or: npm i -g pnpm@10
pnpm install                  # also generates the Prisma client
cp apps/api/.env.example apps/api/.env
pnpm db:up                    # PostgreSQL 17 in Docker (creates shoppos and shoppos_test)
pnpm db:migrate               # create the tables
pnpm db:seed                  # Super Admin + Admin, 62 sample products (143 variants)
pnpm dev                      # API on :3000, web app on http://localhost:5180
```

Accounts created by the seed (development passwords; change them for a real shop):

| Account     | Role        | Login                                                                        |
| ----------- | ----------- | ---------------------------------------------------------------------------- |
| Super Admin | Super Admin | username `superadmin` / `super123` (PIN `9999`), hidden from the login tiles |
| Shop Owner  | Admin       | tile + PIN `1234`, or `admin` / `admin123`                                   |

Cashiers are added from **Users**. Set real passwords when seeding with `SEED_SUPERADMIN_PASSWORD`,
`SEED_SUPERADMIN_PIN`, `SEED_ADMIN_PASSWORD` and `SEED_ADMIN_PIN`.

For a real shop, seed only the accounts and tax rates: `SEED_MODE=minimal pnpm db:seed`.

## Everyday commands

| Command           | What it does                                                     |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm dev`        | Run everything with live reload                                  |
| `pnpm test`       | Unit tests (shared) + API integration tests (real PostgreSQL)    |
| `pnpm lint`       | ESLint                                                           |
| `pnpm format`     | Prettier                                                         |
| `pnpm typecheck`  | TypeScript in every package                                      |
| `pnpm build`      | Production build (web app is copied into the API's static files) |
| `pnpm start`      | Run the production build: one app on `PORT` serving API + UI     |
| `pnpm db:migrate` | Create a new migration after editing `schema.prisma`             |

Integration tests use the separate `shoppos_test` database and empty it between tests, so they
never touch your development data.

## Project layout

```
apps/api/prisma/        schema.prisma, migrations
apps/api/src/modules/   auth, users, settings, audit, catalog, sales, printing, inventory, suppliers,
                        purchases, returns, customers, cash-register, expenses, reports, backups, system,
                        assistant
apps/api/src/cli/       migrate, seed, tls (HTTPS certificate), backup (used by update.ps1)
apps/api/test/          integration tests
apps/web/src/features/  billing, sales, returns, customers, cash, expenses, products, catalog, inventory,
                        purchases, labels, receipts, receipt-studio, assistant, dashboard, reports, audit,
                        backups, users, settings
apps/web/src/components ui (shadcn), brand (logo, startup animation) + shared app components
packages/shared/src/    money.ts, cart-calc.ts, barcode.ts, permissions.ts, receipt-layout.ts, receipt-tools.ts,
                        settings-tools.ts, assistant.ts, schemas/
deploy/windows/         install, update and uninstall scripts
scripts/                release build, dev database init
assets/brand/           logo source files (SVG)
docs/                   architecture notes, Windows test guide, owner guide
```

## Deployment (Windows)

```bash
pnpm release:win             # → release/shoppos-<version>/ and .zip (~12 MB)
pnpm release:win --offline   # also bundles Node.js, PostgreSQL and WinSW (~420 MB, no internet needed)
```

| On the shop laptop | What it does                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `INSTALL.cmd`      | Real shop: asks for the owner / Super Admin passwords and PINs, starts with no products       |
| `INSTALL-TEST.cmd` | Test copy with ~60 sample products and test passwords                                         |
| `UPDATE.cmd`       | Backs up, installs the new version, migrates, health-checks; rolls back by itself if it fails |
| `UNINSTALL.cmd`    | Removes services and shortcuts, keeps the data                                                |

The installer sets up PostgreSQL and the POS as Windows services, HTTPS at `https://pos.shop` with a
certificate authority trusted only on that laptop, and Chrome (or Edge) in full-screen kiosk mode at
every start. Step-by-step guide: [docs/WINDOWS-TEST.md](docs/WINDOWS-TEST.md).

### Releases

Set the version in the four `package.json` files, add it to [CHANGELOG.md](CHANGELOG.md), then
push a tag `v<version>` or publish a release with that tag on GitHub. The `Release` workflow
checks the code, runs the tests, builds both zips and attaches them to the GitHub release.

### Backups

`pg_dump` backups (custom format) go to `C:\ShopPOS\backups`: daily at the set time (21:30 by
default), when the day is closed, before every restore and before every update. The newest is copied
to a USB folder whenever the stick is plugged in, and optionally uploaded to the owner's Google Drive
(their own OAuth "Desktop app" client, `drive.file` scope, loopback sign-in). In development the tools
run inside the Docker container (`PG_DOCKER_CONTAINER=shoppos-db` in `apps/api/.env`).
