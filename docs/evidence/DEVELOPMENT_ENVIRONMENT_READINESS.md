# Development Environment Readiness Evidence

Date: 2026-08-11  
Branch: `phase-1/r002-migration-hardening`

## Reproducible runtime

| Check | Result | Evidence |
|---|---|---|
| Node.js | PASS | Repository and validation runtime use `v22.22.2`. |
| npm | PASS | Repository and validation runtime use `11.9.0`. |
| Clean dependency install | PASS | `npm run clean` followed by `npm ci` installed 321 packages from `package-lock.json`. |
| Frontend-only development server | PASS | `npm run dev` served `/` with HTTP 200 at `127.0.0.1:5173`. |
| Integrated development server | PASS | `npm run dev:server` served `/api/health`, `/`, and `/src/main.tsx` with HTTP 200 at port 3000. |
| Production build | PASS | Vite transformed 1,778 modules and esbuild emitted `dist/server.cjs`. |
| Production server | PASS | `npm start` served `/api/health` and `/` with HTTP 200 at port 3000. |
| TypeScript | PASS | `npm run lint` (`tsc --noEmit`) exited 0. |
| R002 repository gate | PASS | `npm run test:r002`: 25/25 checks passed. This is T1/T2 evidence only. |
| Complete application suite | BLOCKED | 28/30 tests passed; two CloudSyncAdapter tests failed as already audited. |

## Complete-suite failures preserved

1. `Phase 2 Sprint 3 - Synchronization Service > should queue and sync events when online`
   expected an empty outbox after remote delivery; one event remained.
2. `Phase 2 Sprint 3 - Synchronization Service > should drain queue upon reconnection`
   expected an empty outbox after reconnection; one event remained.

Both failures report: `No CloudSyncAdapter configured. Events will remain in
the outbox until a real adapter is provided.` No test was weakened and no mock
success path was added.

## Build warnings

- A core state module is both statically and dynamically imported, so the
  dynamic import does not split that module into a separate chunk.
- The main browser bundle is approximately 538 kB minified and exceeds Vite's
  500 kB advisory threshold.

These warnings do not prevent the server from starting, but remain performance
work rather than environment failures.

## Browser and role-interface inspection

The Cloud Browser supplied to this engineering session cannot route to the
execution container's local ports. The platform-local `terminal.local` route
was client-blocked, and the isolated container route returned connection
refused. Direct `file:` navigation is prohibited by the browser security
policy. Therefore no honest browser console/network inspection, role-surface
exercise, or screenshot was possible from this session.

The server was launched and inspected through real HTTP requests, not inferred
from a successful build. Owner, Manager, Cashier, and Kitchen browser acceptance
remains blocked until either:

1. the repository is run in a browser on an engineer's machine using the
   runbook; or
2. an explicitly authorized preview/deployment channel is supplied.

Genuine role acceptance additionally requires the isolated R001 Supabase
staging clone because Auth, PIN verification, and cloud restoration are not
meaningfully testable against placeholder configuration.

## Database safety

No Supabase project was connected, no migration was applied, no production
secret was requested, and no live database was changed during this work.
