# Phase 1 R002 Repository Evidence

- **Evidence date:** 2026-08-11
- **Candidate branch:** `phase-1/r002-migration-hardening`
- **Implementation commit:** `8c7b63776366b81d60fdffa29bd12a00f3b83786`
- **Canonical baseline:** `c010448690f7d4e77043b2034063da837a1650d4`
- **Canonical input archive SHA-256:**
  `529ca75388fda6d9c66ff6a6251eb7561cd2fca1f59a2c2af8ed6a8fdde1e4cc`
- **Live deployment status:** NOT APPROVED
- **Supabase resources changed:** None

## Outcome

The R002 migration candidate passed the complete T1/T2 repository gate. The
overall repository is **not mergeable or production-ready** because two known
CloudSyncAdapter tests remain failed outside the authorized Phase 1 boundary,
and R002 has not passed Supabase staging, backup/restore rehearsal, or live
acceptance.

No application source, R001 migration, production database, Supabase project,
or legacy runtime authority was changed in this phase.

## Integrity evidence

| Artifact | SHA-256 |
|---|---|
| `supabase/migrations/001_mvp_core.sql` | `7ed252f0c9c1f2de3a6630a01165c0a0e35c17f1a78d270842d837336e22d877` |
| `supabase/migrations/002_secure_identity_devices.sql` | `8a30f706542c3da16944cc84bc8d9ae775c3373d03c6eaf43842201c35df640e` |
| `supabase/preflight/002_secure_identity_devices_preflight.sql` | `86cfe09cb338d0ecd4db3b012ff4cea2dcd094b5f3611f23550862a81fc41f44` |
| `scripts/test-r002-migration.mjs` | `92edc80cf516baa46816c867d7dcc2940e6099330d11d2efd0380d728e7575d5` |
| `package-lock.json` | `e82c22f879051ff6bb16bfd7768caeea6a77b01a0ae96b032ffde3383ecf2665` |

The R001 checksum is identical to the canonical baseline. `git diff` reports
no change to `001_mvp_core.sql`.

## Execution environment

| Component | Version |
|---|---|
| Node.js | 24.14.0 |
| npm | 11.9.0 |
| PGlite | 0.5.4 |
| Isolated PostgreSQL engine | PostgreSQL 18.3, PGlite build |
| pgcrypto fixture schema | `extensions` (intentionally outside `public`) |

PGlite provides real PostgreSQL DDL, PL/pgSQL, row locks, role grants, RLS
metadata, persistence, and pgcrypto behavior for this repository gate. It does
not emulate the full Supabase platform; T3 staging remains mandatory.

## Command evidence

| Command | Result | Evidence |
|---|---:|---|
| `npm run test:r002` | PASS | 25/25 R002 checks passed |
| `npm test -- --reporter=verbose` | BLOCKED | 28 passed, 2 failed, 0 skipped; 13/14 test files passed |
| `npm run lint` | PASS | TypeScript `tsc --noEmit` exited 0 |
| `npm run build` | PASS | Vite client and esbuild server production bundles exited 0 |
| `git diff --check` | PASS | No whitespace errors |

The production build emitted existing advisory warnings for a mixed
static/dynamic import and a JavaScript chunk over 500 kB. Neither warning
failed the build; both remain future optimization work rather than R002
migration evidence.

## R002 executable checks

1. Unknown legacy credential format blocks R002 with a named error.
2. The blocked migration leaves the R001 credential and raw pairing schema
   unchanged.
3. R001 applies before R002 and pgcrypto resolves from `extensions`.
4. Valid bcrypt credentials move to isolated `staff_credentials`.
5. Legacy pairing codes are revoked and their raw column is removed.
6. Browser roles cannot read credential, session, pairing-hash, or throttle
   tables.
7. An authenticated owner can set an onboarding PIN through the granted RPC.
8. The explicit service-role grant reaches its administration path.
9. PIN verification runs server-side and rejects malformed input generically.
10. Five wrong PINs create a persistent five-minute lockout.
11. PIN lockout survives database close and reopen.
12. Manager login issues a high-entropy bearer while storing only bcrypt.
13. A manager cannot change OWNER credentials.
14. A manager cannot administer another branch.
15. Revoking a delegated session invalidates that bearer.
16. Active six-digit pairing codes cannot collide across tenants.
17. A manager creates a bcrypt-hashed, expiring pairing code.
18. Five wrong pairing attempts create persistent per-device lockout.
19. A pairing code is single-use and creates the exact business/branch binding.
20. Active bootstrap is branch-scoped and contains no credential material.
21. Manager device authority cannot cross a branch or business boundary.
22. Device revocation blocks status and bootstrap success immediately.
23. Security audit event IDs remain unique during a burst.
24. Intended anonymous RPC execution remains available without table reads.
25. The read-only preflight recognizes the completed R002 fixture and reports
    no unsafe legacy credential values.

## Full-suite failure analysis

| Test | Expected by test | Actual behavior | Architectural cause | Phase |
|---|---|---|---|---:|
| `Synchronization Service > should queue and sync events when online` | Outbox drains to zero | One event remains queued | No default `CloudSyncAdapter` is registered; `SyncService` now fails closed instead of reporting fake delivery | 5 |
| `Synchronization Service > should drain queue upon reconnection` | Reconnect drains outbox | One event remains queued | Reconnection retries, but there is still no remote adapter/receiver to accept the event | 5 |

These are the same 28/30 failures identified by the Backend Reality Audit.
Phase 1 did not weaken the assertions, inject a mock adapter, delete queued
events, or report false success. BR-069 remains `BLOCKED` until the Phase 5
cloud path is implemented and these tests are replaced with genuine delivery
evidence.

## Migration failures now detected before intervention

The candidate refuses to proceed when it finds:

- a missing canonical R001 table, column, private schema, role, or Auth helper;
- any named partial-R002 table, column, wrapper, or RPC;
- a staff, device, catalog, or pairing row whose branch belongs to another
  business;
- a nonempty legacy PIN value outside the accepted bcrypt contract;
- missing or undiscoverable pgcrypto support;
- an active pairing-code collision after bounded secure regeneration.

Unknown credential material is never guessed to be plaintext. The read-only
operator preflight reports counts and staff identifiers only, never hashes or
PINs.

## Repository-verified security properties

- Credential hashes, failed-attempt state, security-session hashes,
  pairing-code hashes, and pairing throttles are held in separately revoked
  tables.
- Every security function uses private, schema-qualified pgcrypto wrappers with
  an empty `SECURITY DEFINER` search path.
- Staff credential verification and both lockouts execute under database row
  locks.
- Manager session use revalidates staff status, role, business, and branch.
- PIN changes revoke the target's prior elevated sessions.
- Session logout has an explicit server-side revocation primitive.
- Pairing codes are globally collision-checked under a transaction advisory
  lock, expire, and can be consumed once.
- Security audit IDs use 128 bits of pgcrypto randomness.
- Function execution grants explicitly include only the intended browser and
  service roles; sensitive table reads remain revoked from browser roles.

## Remaining production blockers

| Priority | Blocker | Why Phase 1 cannot close it |
|:---:|---|---|
| P0 | R002 has no Supabase staging-clone evidence | PGlite cannot prove PostgREST, real Auth claims, provider extension permissions, or live RLS behavior |
| P0 | Device ID is still a caller-held bearer for status/bootstrap | Secure proof-of-possession and trusted-device credentials are Phase 3 |
| P0 | Anonymous PIN/pairing RPCs lack trusted-device and source-aware edge throttling | Per-record database lockout can be bypassed or abused for denial of service |
| P0 | Composite tenant constraints and complete RLS authority are unresolved | Phase 2 owns business/branch authorization and cross-tenant regression tests |
| P1 | Current application types/wiring do not prove R002 is the sole authority | Phase 2 must remove PIN from ordinary state and wire/restored sessions safely |
| P1 | Legacy pairing authority remains reachable | Phase 3 must quarantine and retire it after secure replacement acceptance |
| P1 | CloudSyncAdapter is not wired by default | Phase 5; two application tests remain failed |
| P1 | Order/order_items, realtime kitchen flow, inventory, and finance remain incomplete | Phases 4–7 |

Database pairing throttling is defense in depth only: a hostile caller can
rotate a self-asserted device ID. Database PIN lockout also creates a denial-of-
service surface until a trusted device boundary and edge rate limit exist.

## Required next gate

Do not apply R002 to production. A separately authorized T3/T4 rehearsal must:

1. restore a verified R001 backup into an isolated Supabase staging project;
2. run the read-only preflight and preserve its output;
3. apply this exact migration hash through the versioned migration mechanism;
4. execute every RPC through real `anon`, `authenticated`, and `service_role`
   PostgREST contexts;
5. prove direct hash reads are denied and manager boundaries hold across
   browsers/branches;
6. verify trusted-device and edge-throttling prerequisites remain blocked until
   their implementation phase;
7. rehearse snapshot restoration rather than an ad-hoc reverse migration.

Until that evidence exists, all R002 capabilities remain below classification
A and the candidate remains **NOT APPROVED FOR LIVE MIGRATION**.
