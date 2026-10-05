# Takeover audit and release evidence — 5 October 2026

## Findings addressed

- The uploaded archive held two different applications. The user selected the browser root; the prior Android/Supabase root is preserved on the archive branch.
- Cast-only input validators allowed malformed quantities/roles. Runtime schemas now bound inputs.
- Order lines, totals and stock were separate writes; tenant transactions now make changes atomic and serialize ticket assignment.
- Orders could oversell and silently clamp stock. Stock availability is checked before reservation.
- Retried orders, stock and shift actions could duplicate work. Persistent request receipts enforce matching payloads.
- Payment calculations relied on order creation time. Orders bind to cash shifts and record payment time; trading dates use Africa/Johannesburg.
- Cancellation during preparation lost inventory meaning; cancellation now permits only unpaid waiting orders and restores stock once.
- Active queues were truncated to 80. All active tickets are retained; recent completed history is bounded separately.
- Paired devices still needed an owner account and role labels could be forged. Invitation IDs/codes establish an HTTP-only device identity with assigned-role enforcement, expiry, attempts and revocation.
- PIN guesses were unrestricted. Persistent five-attempt lockout, 15-minute delay and reset/session revocation now apply.
- Kitchen payloads exposed line prices and drawer values. Those values and cashier identity are removed server-side.
- Browser-local orders/payments appeared synchronized without an authoritative offline transport. This simulation is removed; connectivity is required for financial writes.
- Setup created invented stock and a fake Hub device. Starting stock is zero and all devices represent actual pairing.
- Owner catalog editing, device revocation, reports, cash-up/stock history and printable receipts were incomplete. These workflows are implemented.
- Missing configuration could silently use an ephemeral production database. Production fails closed and sign-in advertises temporary unavailability.
- Builds ran database migrations implicitly. Migration execution is now separate from the build.

## Evidence

Seven focused tests use actual PGlite migrations and operational SQL with server-function transport/auth mocked. They cover zero-stock setup/roles/shift requirements, idempotent orders and overselling, cash payment/kitchen/collection/cash-up, cancellation restoration, kitchen redaction/cross-tenant/device binding, PIN lockout/reset, and inventory retry/rollback.

Typecheck, lint, build and actual browser verification are recorded in the release handoff after final execution. Browser QA creates only disposable local records. A local pass is not evidence of production persistence.

## Deployment blocker

Vercel's existing environment points to Supabase project `iwbbwcaylpulcpvbfkdx`. The connected Supabase account cannot access that project. Vercel has no DATABASE_URL for the browser app. No unrelated project is used as a substitute. Production operational acceptance is blocked pending a dedicated PostgreSQL connection and migration execution.

## Remaining capability boundaries

No LAN/Bluetooth/Wi-Fi Direct/offline financial authority, refunds, card settlement, tax invoices, multi-branch administration or password recovery email. Existing archived accounts/data are not automatically migrated. The new browser app's deployment must be distinguished from an accepted production trading trial.
