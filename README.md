# Marina POS

Offline point-of-sale system for a phone accessories shop (retail + wholesale), built to run on a
single Windows laptop. One program serves both the API and the web app; the owner only opens Chrome.

| Part              | Tech                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `apps/web`        | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, TanStack Query, React Hook Form + Zod |
| `apps/api`        | NestJS 11, Prisma 7, PostgreSQL 17, JWT in httpOnly cookies                                  |
| `packages/shared` | Money maths, bill calculation, permissions and Zod schemas used by both sides                |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the decisions agreed with the shop.

## Build status

| Phase | Scope                                                             | Status |
| ----- | ----------------------------------------------------------------- | ------ |
| 1     | Setup, database, auth, products                                   | Done   |
| 2     | Billing screen, payments, receipts (+ quick Windows test build)   | Done   |
| 3     | Stock, purchases, suppliers, returns, product import              | Done   |
| 4     | Customers, credit, cash register, expenses                        | Done   |
| 5     | Reports, dashboard, audit log, backups (local, USB, Google Drive) | Done   |
| 6     | Windows installer, updates, owner guide                           | Done   |

Version **1.0.0**: keyboard-first billing (F12 lists every key), warranty and IMEI tracking, a drag-and-drop receipt editor, quotations, price check, screen lock, and a simple 9-entry menu. The shop owner's manual is [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md).

## Development setup (macOS, Linux or Windows)

Needs **Node.js 22.12+**, **pnpm 10** and **Docker** (only for the development database).

```bash
corepack enable pnpm          # or: npm i -g pnpm@10
pnpm install                  # also generates the Prisma client
cp apps/api/.env.example apps/api/.env
pnpm db:up                    # PostgreSQL 17 in Docker (creates marina_pos and marina_pos_test)
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

Integration tests use the separate `marina_pos_test` database and empty it between tests, so they
never touch your development data.

## Project layout

```
apps/api/prisma/        schema.prisma, migrations, seed.ts
apps/api/src/modules/   auth, users, settings, audit, catalog, sales, printing, inventory, suppliers,
                        purchases, returns, customers, cash-register, expenses, reports, backups, system
apps/api/src/cli/       migrate, seed, tls (HTTPS certificate), backup (used by update.ps1)
apps/api/test/          integration tests
apps/web/src/features/  billing, sales, returns, customers, cash, expenses, products, stock, purchases,
                        labels, dashboard, reports, audit, backups, users, settings, account
apps/web/src/components ui (shadcn) + shared app components (PIN pad, money input, approval dialog)
packages/shared/src/    money.ts, cart-calc.ts, barcode.ts, permissions.ts, schemas/
deploy/windows/         install and update scripts (Phase 6)
docs/                   architecture notes and the owner guide
```

## Deployment (Windows)

```bash
pnpm release:win             # → release/marina-pos-<version>/ and .zip (~12 MB)
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

### Backups

`pg_dump` backups (custom format) go to `C:\MarinaPOS\backups`: daily at the set time (21:30 by
default), when the day is closed, before every restore and before every update. The newest is copied
to a USB folder whenever the stick is plugged in, and optionally uploaded to the owner's Google Drive
(their own OAuth "Desktop app" client, `drive.file` scope, loopback sign-in). In development the tools
run inside the Docker container (`PG_DOCKER_CONTAINER=marina-pos-db` in `apps/api/.env`).
