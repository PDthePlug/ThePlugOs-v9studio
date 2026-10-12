# Release status and source-of-truth boundary

- **Status:** HOLD — implementation foundation, not production-ready
- **Release authority:** This document plus the accepted ADRs, ordered
  migrations, and environment-specific evidence records
- **Last reconciled source:** the native Cashier Hub authority foundation;
  source contracts for order/cash/inventory/kitchen/station workflows; R010
  terminal enrollment/revocation, R011 renewal, R012 native credential recovery,
  R013 schema hardening, ADR-007 modern Edge API-key resolution, ADR-008
  production migration-ledger safeguards, ADR-012/R022 role-experience
  restoration, ADR-013/R023 merchant operational surfaces, ADR-015/R024
  cross-device session conflict hardening, ADR-016/R025 terminal authority
  safe-stop/revalidation, ADR-019/R028/R029 owner control-plane and RLS
  hardening, ADR-020/R030 HOLD-safe staging backend rehearsal, and clean CI
  web/native Android package evidence
- **Production mutation authority:** narrowly authorized for the exact
  R001A→R012 controlled remediation sequence in
  `docs/evidence/CONTROLLED_PRODUCTION_REMEDIATION_2026-08-26.md`; that
  database sequence and the additive R013 hardening migration are recorded as
  completed, but product
  release authority remains withheld

## What is true today

The browser application is an owner-authenticated control plane. It can create
an R001 business foundation, read owner-scoped business/branch/order/stock
facts, administer customer-facing catalog metadata, and create credential-free
Cashier/Kitchen/Manager directory profiles under the source-defined owner RLS
boundary. It does not accept staff PINs, write physical stock quantities,
transition operational orders directly, create operational staff sessions, or
issue terminal commands.

The owner control plane is split into Overview, Orders, Menu, Stock, Finance,
Team & access, and Devices & settings. PASS 4 records responsive desktop/mobile
fixture evidence and a checksum-verifiable Android package for the same runtime
source. That evidence proves source/build/presentation behavior only; fixture
Auth, cloud data, and bridge responses are not live Supabase or hardware
acceptance.

Owner account signup is source-guarded: it is limited to an exact configured
owner-portal origin, separates confirmation from password recovery, and waits
for a confirmed email before the R001 foundation RPC. It is **not** live signup
evidence: the exact production Auth Site URL, redirect allow-list,
email-delivery, confirmation, leaked-password protection, and rate-limit state
have not been re-inspected and recorded as accepted evidence through the
currently connected account.

The Android-native Cashier Hub remains the operational authority foundation.
SQLCipher holds the local ledger, Android Keystore holds device keys, a signed
authorization bundle establishes one branch authority, and cloud receivers are
designed to replicate durable Hub events. Source-only R004/R005 add
order-transition authority and a cash-shift/cash-capture path.

The source-only native Kitchen workflow can request the already-authorized
`PLACED -> PREPARING -> READY` transitions through the Hub, but it does not
demonstrate remote Kitchen, printer, notification, or physical delivery.

The source-only Cashier collection workflow can request the existing
`READY -> COLLECTED` transition only after the local cash-capture fact is
present. It does not demonstrate physical handover, receipt printing, remote
delivery, or cloud acknowledgement.

The source-only Manager cash-shift-close workflow can record an explicit
physical count and Hub-derived variance after pending orders are resolved. It
does not demonstrate cash-up approval, bank deposit, printing, physical
custody transfer, or cloud acknowledgement.

The source-only Manager inventory-receipt workflow can record a physical
counted quantity for active signed branch products. It does not demonstrate a
supplier, purchase order, invoice, cost, payment, allocation, stock adjustment,
or cloud acknowledgement.

The source-only Manager inventory-count-correction workflow can record an
observed final quantity for active signed branch products and derive the stock
difference. It does not classify waste/loss, or demonstrate a supplier,
purchase order, cost, payment, approval, or cloud acknowledgement.

The source-only Manager inventory-waste workflow can record a positive unusable
quantity for an active signed branch product with a bounded spoilage, damage,
or expiry reason. It does not demonstrate a supplier claim, cost, tax, cash,
financial-loss calculation, disposal certificate, approval, or cloud
acknowledgement.

The source-only native pending-order-cancellation workflow exposes only the
already-authorized `PENDING` cancellation transitions for Cashier/Manager
roles. It does not demonstrate a refund, cash reversal, return, or cloud
acknowledgement.

The Android host now has a source-only native station-entry and local
session-end path that does not borrow an Owner browser session. This does not
constitute a cloud logout, a hardware acceptance result, or a production
release claim.

The source contains owner-controlled Hub/terminal pairing, admission renewal and
revocation, native local-link discovery, TLS certificate pinning, fresh terminal
challenge proof, native PIN/session authority, and role-minimized Cashier,
Kitchen, and Manager terminal workspaces. ADR-015/R024 and ADR-016/R025 harden
same-staff cross-device conflicts, role/session drift, restart binding,
stale-authority safe-stop, and reconnect revalidation. CI compilation and
source gates are not physical-device evidence.

Source migration R014 defines terminal staff-session/challenge authority and the
`hub-terminal-staff-session` receiver. Source migration R015 retires the broad
member write policies and narrows browser staff/catalog writes to the owner
control plane. Neither R014 nor R015 is recorded as applied to production; the
immutable production ledger remains R001A–R013.

ADR-012/R019 hardens source-only cloud batch acknowledgement handling: each
receiver acknowledgement is bound to its own contiguous action-family group,
and malformed, duplicate, missing, or cross-group IDs retain the local outbox.
This is not evidence of a deployed `hub-sync` Function, durable cloud
acknowledgement, retry/restart recovery, or production readiness.

### PASS 5 staging rehearsal readiness

ADR-020/R030 now provide a deterministic, HOLD-preserving backend rehearsal
path. `scripts/deploy-hub-cloud.sh --rehearse-staging` is staging-only and
refuses both the recorded production project and the preserved contaminated
legacy staging project. It invokes an explicit ordered schema applicator rather
than `supabase db push` because the canonical
`001a_retire_unsupported_legacy_staff_pins.sql` filename is not discoverable by
the current Supabase CLI numeric migration filename pattern.

The staging applicator requires a clean reviewed commit, a database URL bound
to the exact confirmed staging project, TLS certificate verification, and an
empty ThePlugOS target. It applies `001 -> 001A -> 002 ... -> 015`, verifies the
R014 RPCs and R015 owner policies, and only then allows Function secrets/code to
be published. R030 fixes the reviewed Function auth set at six custom
native-proof receivers with `verify_jwt=false` plus the JWT-protected
`hub-owner-enrollment` browser receiver.

This is **source/preflight readiness only**. No authorized isolated ThePlugOS
staging project is visible to the currently connected Supabase account, so
`docs/testing/STAGING_BACKEND_ACCEPTANCE.md` remains **BLOCKED / not executed**.
No Applied Commerce or other unrelated project may be substituted to obtain a
PASS.

No claim of production readiness, live multi-device operation, payment
settlement, completed order collection, Kitchen delivery, printer delivery, or
cloud acknowledgement is valid until the gates below have recorded direct
measured evidence.

## Environment boundary

| Environment | Current classification | Allowed action |
|---|---|---|
| Production `iwbbwcaylpulcpvbfkdx` | Immutable R001A–R013 schema baseline recorded; current connected account cannot re-inspect it; R014/R015 are source-only | Preserve the ledger. Do not replay source migrations or publish the R014-dependent terminal staff-session receiver until a separately accepted production schema-advance record exists. Production Function configuration remains subject to ADR-007/ADR-008/ADR-009 guards and is not product-release authority. |
| Legacy staging `dpqtgfxovmiwzkiuzoya` | Preserved contaminated rehearsal evidence | Do not resume, reset, overwrite, or use as the PASS 5 rehearsal target. ADR-020/R030 explicitly refuse it. |
| Historical clean-staging reference `nuufscrmkfoukndfmwcc` | Not visible/authorized through the current connected Supabase account; no current acceptance claim | Do not infer availability or mutate it without explicit authorized access and a fresh-environment preflight. |
| New isolated ThePlugOS staging-equivalent project | Not currently connected/authorized | Required next live backend target. Only after explicit project/cost authorization may ADR-020 rehearsal and `docs/testing/STAGING_BACKEND_ACCEPTANCE.md` be executed. |

## Required gates before a production release

1. Connect or create an explicitly authorized isolated ThePlugOS staging project
   and execute ADR-020's empty-target `001 -> 001A -> 002 ... -> 015` rehearsal.
2. Complete `docs/testing/STAGING_BACKEND_ACCEPTANCE.md`, including live owner
   RLS positive/negative cases, all seven Function authentication boundaries,
   R014 terminal staff-session challenge/PIN proof, and Hub sync acknowledgement
   behavior.
3. Complete owner-controlled native resets for retired production credential
   records through the accepted recovery path; do not expose legacy credential
   values.
4. Build and exercise the Android host on physical API 24+ hardware with the
   matching accepted public issuer-key map and staging cloud receiver
   configuration.
5. Prove atomic orders, stock reservations/reversals, durable acknowledgement,
   branch isolation, revoke/expiry safe-stop, exact retry and restart recovery.
6. Prove Hub/terminal enrollment, admission renewal/revocation, LAN mDNS,
   Wi-Fi Direct, Bluetooth proximity, certificate-pin rejection, and signed
   challenge behavior on supported physical Android hardware.
7. Exercise ADR-010/R014 and ADR-011/R018 terminal session, measured context,
   cross-device supersession and signed-command contracts on real devices before
   presenting an authenticated terminal link as a Cashier, Kitchen, or Manager
   station.
8. Complete payment settlement, cash-up custody, printing, Kitchen delivery,
   and the remaining operational workflows before presenting them as complete
   product features.
9. Complete accessibility, observability, backup/restore, incident, security,
   and pilot acceptance with evidence tied to exact source, deployment and
   migration hashes.
10. Only after the required staging/hardware/pilot evidence is accepted may a
    separately reviewed production schema-advance plan move beyond the recorded
    R001A–R013 ledger and reconsider release status.

## Documentation rule

The historical files under `docs/certification/` are not release evidence.
They describe previous prototype targets and can contain optimistic or
simulated claims. Each is marked as superseded. A release decision must cite
current, reproducible build, backend, hardware, staging and pilot evidence
instead.

## Never do from this source tree

- Run a file from `supabase/quarantine/` as a database input.
- Replay the production database through `supabase db push` or rewrite the
  immutable R001A–R013 production migration ledger to make local filenames fit.
- Apply R002/R003 or later production schema changes outside an explicitly
  accepted production remediation/schema-advance record.
- Use an unrelated Supabase project as ThePlugOS staging evidence.
- Re-enable the browser IndexedDB/event/certificate/sync kernels for operational
  authority.
- Declare a local event delivered merely because connectivity returned.
- Put a staff PIN, cloud secret, signing key, device session, authorization
  envelope, service key, or staging database password in browser storage, logs,
  screenshots, evidence documents, or the Capacitor bridge.

## Frontend correction — 5 October 2026; reconciled 12 October 2026

The frontend uses the established Supabase public configuration and owner
identity model. The temporary Better Auth/browser-database replacement remains
withdrawn; none of its migrations may be applied to this project. R003's
browser PIN/pairing privilege retirement and the installed native device
runtime remain intact.

PASS 4 extended the recovered frontend into a sectioned owner control plane and
an explicit public staff-entry path while preserving native staff authority.
Its responsive fixture journey, Vercel production frontend deployment and
Android package evidence are recorded in
`docs/evidence/PASS_4_OWNER_CONTROL_PLANE_AND_STAFF_ENTRY_HARDENING_2026-10-12.md`.
Those results do not establish live Supabase Auth/RLS/Function or independent
physical-device acceptance.

PASS 5 adds the guarded source path needed to obtain that backend evidence
without mutating production or silently skipping R001A. Until an authorized
staging project is connected and the current staging protocol is executed,
backend-dependent release gates remain BLOCKED and overall status remains HOLD.
