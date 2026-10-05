# Backend Reality Remediation Register

This register gives every capability from the 2026-08-11 Backend Reality
Matrix a permanent identifier. A finding cannot disappear because source code
was added; its state changes only when the evidence tier in
`docs/testing/R002_MIGRATION_ACCEPTANCE.md` or a later phase-specific contract
has passed.

## Status vocabulary

- `PROTECTED`: supplied R001 acceptance or executable evidence currently
  supports classification A; regression protection is required.
- `OPEN`: no authorized implementation is active.
- `IN_PROGRESS`: inside the currently authorized phase.
- `IMPLEMENTED`: code exists but repository verification is incomplete.
- `REPOSITORY_VERIFIED`: local/static/integration evidence passed.
- `STAGING_VERIFIED`: Supabase staging acceptance passed.
- `LIVE_ACCEPTED`: authorized live acceptance passed.
- `BLOCKED`: a named external or predecessor gate prevents progression.

## Capability register

| ID | Capability | Audit class | Target phase | Current status |
|---|---|:---:|---:|---|
| BR-001 | Supabase owner authentication | A | Regression | PROTECTED |
| BR-002 | Business creation | A | Regression | PROTECTED |
| BR-003 | Owner membership | A | Regression | PROTECTED |
| BR-004 | Branch persistence | A | Regression | PROTECTED |
| BR-005 | Staff master-data persistence | A | Regression | PROTECTED |
| BR-006 | Catalog master-data persistence | A | Regression | PROTECTED |
| BR-007 | Browser destruction and cloud restoration | A | Regression | PROTECTED |
| BR-008 | Kernel staff restoration | A | Regression | PROTECTED |
| BR-009 | Current onboarding completion gate | E | 2 | OPEN |
| BR-010 | Current PIN workspace entry | E | 2 | OPEN |
| BR-011 | Business-to-business tenant boundary | E | 2 | OPEN |
| BR-012 | Branch isolation | E | 2 | OPEN |
| BR-013 | Composite business/branch binding | E | 2 | OPEN |
| BR-014 | Multi-business user restoration | B | 2 | OPEN |
| BR-015 | Ordinary StaffMember state excludes PIN | B | 2 | OPEN |
| BR-016 | Isolated staff_credentials | B | 1 | REPOSITORY_VERIFIED |
| BR-017 | set_staff_pin | B | 1 | REPOSITORY_VERIFIED |
| BR-018 | Server-side PIN verification | B | 1 | REPOSITORY_VERIFIED |
| BR-019 | Persistent failed attempts/lockout | B | 1 | REPOSITORY_VERIFIED |
| BR-020 | Staff security sessions | E | 2 | REPOSITORY_VERIFIED |
| BR-021 | Delegated manager security authority | E | 2 | REPOSITORY_VERIFIED |
| BR-022 | Staff suspension/deletion | E | 2 | OPEN |
| BR-023 | Staff-session logout/revocation | D | 2 | REPOSITORY_VERIFIED |
| BR-024 | Secure pairing-code creation | B | 3 | REPOSITORY_VERIFIED |
| BR-025 | Hashed, expiring, single-use code storage | B | 3 | REPOSITORY_VERIFIED |
| BR-026 | pair_device_with_code enrollment | B | 3 | REPOSITORY_VERIFIED |
| BR-027 | Device identity | E | 3 | OPEN |
| BR-028 | Device trust | E | 3 | OPEN |
| BR-029 | Secure device bootstrap | E | 3 | OPEN |
| BR-030 | Device revocation | B | 3 | REPOSITORY_VERIFIED |
| BR-031 | Revocation propagation/reactivation | B | 3 | OPEN |
| BR-032 | Retirement of legacy pairing/device authority | E | 3 | OPEN |
| BR-033 | Cashier order creation | C | 4 | OPEN |
| BR-034 | Order-row Supabase persistence | B | 4 | OPEN |
| BR-035 | order_items persistence | E | 4 | OPEN |
| BR-036 | Kitchen ticket availability | C | 5 | OPEN |
| BR-037 | Kitchen status mutation | C | 5 | OPEN |
| BR-038 | Cashier receives status update | C | 5 | OPEN |
| BR-039 | Owner analytics from orders | C | 7 | OPEN |
| BR-040 | Physical Cashier A to cloud to Kitchen B | D | 5 | OPEN |
| BR-041 | App-level Supabase sync service | B | 5 | OPEN |
| BR-042 | BroadcastChannel data sync | C | 5 | OPEN |
| BR-043 | Supabase Realtime | B | 5 | OPEN |
| BR-044 | Kernel durable outbox | B | 5 | OPEN |
| BR-045 | Cloud-sync adapter interface/implementation | B | 5 | OPEN |
| BR-046 | Production cloud-adapter wiring | D | 5 | OPEN |
| BR-047 | Cloud sync/storage receiver endpoints | D | 5 | OPEN |
| BR-048 | Queued-event remote delivery | D | 5 | OPEN |
| BR-049 | Truthful sync-success reporting | E | 5 | OPEN |
| BR-050 | Reconnect behavior | E | 5 | OPEN |
| BR-051 | Cloud reconciliation | D | 5 | OPEN |
| BR-052 | Conflict resolution | D | 5 | OPEN |
| BR-053 | End-to-end idempotency | D | 5 | OPEN |
| BR-054 | Local persistence | B | 5 | OPEN |
| BR-055 | Offline UI continuity | C | 5 | OPEN |
| BR-056 | Full offline-first cycle | D | 5 | OPEN |
| BR-057 | Catalog stock in Supabase | B | 6 | OPEN |
| BR-058 | Sale stock deduction | C | 6 | OPEN |
| BR-059 | BOM/recipe deduction | C | 6 | OPEN |
| BR-060 | Void stock restoration | C | 6 | OPEN |
| BR-061 | Multi-device stock consistency | D | 6 | OPEN |
| BR-062 | Order total/VAT calculation | C | 7 | OPEN |
| BR-063 | Cash tendered/change | C | 7 | OPEN |
| BR-064 | Payment recording | E | 7 | OPEN |
| BR-065 | Void/refund financial reversal | E | 7 | OPEN |
| BR-066 | Ledger | D | 7 | OPEN |
| BR-067 | Shift/cashup | C | 7 | OPEN |
| BR-068 | Audit trail | B | 7 | OPEN |
| BR-069 | Existing automated test suite | B | Continuous | BLOCKED |
| BR-070 | Type-check and production build | A | Continuous | PROTECTED |

## Baseline distribution

| Class | Count | Percentage |
|---|---:|---:|
| A — Fully operational | 9 | 12.86% |
| B — Partially connected | 20 | 28.57% |
| C — Locally simulated | 13 | 18.57% |
| D — Missing | 11 | 15.71% |
| E — Unsafe for production | 17 | 24.29% |

The distribution is updated only after a phase gate closes. Phase 1 cannot
promote a capability to A because it does not include Supabase staging/live
acceptance.

## Phase 1 evidence note

`REPOSITORY_VERIFIED` on BR-016–BR-021, BR-023–BR-026, and BR-030 means only
that the isolated PostgreSQL migration/RPC primitive passed the T1/T2 gate. It
does not change the audit classification, prove current application wiring, or
authorize a Supabase migration. BR-027–BR-029 remain production blockers, so
the device primitives are not a secure end-to-end device trust system.

BR-069 is `BLOCKED`: the complete application suite still records 28/30 tests
passing. Both failures correctly expose the missing default CloudSyncAdapter
and remain assigned to Phase 5; Phase 1 did not alter those tests or the sync
architecture.
