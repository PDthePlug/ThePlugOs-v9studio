# ThePlugOS Browser

Owner, manager, cashier and kitchen workspaces for a single-branch takeaway. The supplied browser application replaces the previous root by the user's selection. The native Android hub implementation remains on `archive/android-hub-2026-10-01`.

## Workspaces

| Role | Capabilities |
| --- | --- |
| Owner | Shop overview, team creation, PIN reset/suspension, device invitations/revocation, menu editing, sales/stock/cash-up reporting and CSV export |
| Manager | Opening float, physical cash-up, unpaid waiting-order cancellation, stock receipts/count/waste and operational reports |
| Cashier | Searchable menu, stock-aware basket, cash payments/change, collection, recent ticket history and printable cash receipts |
| Kitchen | Oldest-first queue, start cooking, mark ready, waiting times; financial fields stripped server-side |

## Architecture

React 19, TanStack Start, Tailwind and Better Auth. All operations persist in PostgreSQL and are scoped to the authenticated owner or paired device's tenant. PIN sessions last 12 hours. Device secrets use HTTP-only cookies, with hashes stored in the database. Tenant writes are serialized inside transactions. Orders, inventory changes and cash-shift commands support safe retries using request UUIDs.

The server reserves stock when an order is placed. Only an unpaid waiting order may be cancelled; cancellation restores stock once. Payment belongs to the order's cash shift. Collection requires payment and READY status. A manager cannot close a shift while any tickets are outstanding. Counts and waste require a reason. New products start at zero stock.

## Development and checks

Node 24. `npm ci`, then `npm run dev`. The local database is disposable PGlite with the same migration files. No sample sales or cash shifts are seeded. The setup menu starts at zero stock.

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

`npm test` exercises the real operational handlers and PGlite migrations; transport/auth middleware is mocked in that suite. `node scripts/qa-browser.mjs` drives real owner authentication, three independent device contexts, inventory, a cash sale, kitchen progression, collection, cash-up, reporting and desktop/mobile layouts. It is limited to localhost and creates disposable test records. Install Playwright Chromium (`npx playwright install chromium`) or supply `PLAYWRIGHT_EXECUTABLE_PATH`. The original scaffold-only tests are retained as `npm run test:template`; they are not product acceptance tests.

## Production configuration

Vercel project: `theplugos-v9studio`, production branch `main`.

Required server environment variables:

- `DATABASE_URL`: durable PostgreSQL connection, server only; database/schema dedicated to this browser application.
- `BETTER_AUTH_SECRET`: a strong stable random secret, server only.
- `BETTER_AUTH_URL`: `https://theplugos-v9studio.vercel.app`.

Optional `VITE_GROK_OAUTH_ENABLED=true` plus server `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET`, `GROK_AUTH_ISSUER` enable an explicitly configured broker. Email/password owner authentication works without broker credentials. Do not deploy preview secrets or `PLUGOS_PREVIEW` to production.

Apply migrations explicitly with `npm run db:migrate` against the dedicated target before opening owner access. Builds do not mutate databases. Production refuses the in-memory fallback. Owner sign-in displays an availability notice until the required configuration exists.

The archived Supabase schema and owner identities are a different system. These migration files must not be applied blindly to that schema. New owner accounts and operations need an explicit data migration if historical data is required.

## Operational limits

This release is an online browser application. It does not implement LAN, Bluetooth, Wi-Fi Direct or authoritative offline financial synchronization. A basket draft survives a page refresh in its station session; financial actions require a successful server response. It supports cash only, one branch per owner, no refunds or card processing, and no password recovery email service. Reports cover the latest 30 days; ticket history covers 7 days; stock history shows the latest 100 movements. Cash receipts are not tax invoices.

Recovery: redeploy the prior main revision and restore the archived root if reverting architectures. Never run a database reset as part of rollback. Keep production database backups outside this repository.
