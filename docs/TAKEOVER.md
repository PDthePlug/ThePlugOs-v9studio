# Browser application takeover

Repository: PDthePlug/ThePlugOs-v9studio. Target: main and theplugos-v9studio.vercel.app.
The user selected the supplied ZIP's browser application as the root application. The prior Android hub implementation remains on archive/android-hub-2026-10-01 (ef14027).

## Architecture and contracts
React 19 / TanStack Start SSR; Better Auth owner accounts; PostgreSQL authoritative operational data. Each owner account owns one business/branch. Paired devices receive a secret HTTP-only cookie, constrained to their assigned role. Staff PIN sessions expire in twelve hours and bind to the device. Owner endpoints cannot be used by paired stations.

Writes serialize through the tenant's shop row inside a database transaction. Order creation reserves stock and assigns a unique ticket number; request UUIDs permit safe retries. Cash payment belongs to the order's shift; collection requires READY and PAID. Only waiting unpaid orders may be cancelled, restoring stock exactly once. Shift closure requires no outstanding orders. Inventory receipt, count and waste produce an audit record and permit safe retries.

Production requires a durable DATABASE_URL plus BETTER_AUTH_SECRET and BETTER_AUTH_URL. Development uses disposable PGlite with the same migrations. Schema changes are explicit, never a build side effect. Existing Android/Supabase tables are not migrated or reused implicitly.

## Scope
Owner: overview, team, PIN reset/suspension, device invitations/revocation, catalog and reports.
Manager: float, cash-up, exception handling, stock and history.
Cashier: searchable menu, basket, cash, collection and receipts.
Kitchen: oldest-first preparation queue with no financial data.

This browser application requires internet connectivity. LAN/Bluetooth/Wi-Fi Direct and offline financial authority belong to the archived native implementation and are not implemented here. No refunds, tax invoice engine, multiple branches or password recovery email service are included.
