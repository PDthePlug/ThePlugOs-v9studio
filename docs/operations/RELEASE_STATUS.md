# Release status and source-of-truth boundary

- **Status:** HOLD — implementation foundation, not production-ready
- **Release authority:** This document plus the accepted ADRs, ordered
  migrations, and environment-specific evidence records
- **Last reconciled source:** the native Cashier Hub authority foundation;
  source contracts for order/cash/inventory/kitchen/station workflows; R010
  terminal enrollment/revocation, R011 renewal, R012 native credential recovery,
  R013 schema hardening, ADR-007 modern Edge API-key resolution, ADR-008
  production migration-ledger safeguards, ADR-012/R022 role-experience
  restoration, and ADR-013/R023 merchant operational surfaces
- **Production mutation authority:** narrowly authorized for the exact
  R001A→R012 controlled remediation sequence in
  `docs/evidence/CONTROLLED_PRODUCTION_REMEDIATION_2026-08-26.md`; that
  database sequence and the additive R013 hardening migration are recorded as
  completed, but product
  release authority remains withheld

## What is true today

The browser application is an owner-authenticated cloud-foundation shell. It
can create an R001 business foundation and read owner-scoped business, branch,
and staff-directory facts. It does not act as a staff authority or directly
mutate operational tables.

Owner account signup is source-guarded: it is limited to an exact configured
owner-portal origin, separates confirmation from password recovery, and waits
for a confirmed email before the R001 foundation RPC. It is **not** live
signup evidence: the production Auth setting for leaked-password protection is
currently reported disabled, and the exact Site URL, redirect allow-list,
email-delivery, confirmation, and rate-limit settings have not yet been
recorded as accepted evidence.

The first operational slice is an Android-native Cashier Hub foundation. Its
design is local-first: SQLCipher holds the local ledger, Android Keystore holds
device keys, a signed authorization bundle establishes one branch authority,
and cloud receivers replicate durable Hub events. R001A–R013 database contracts
are recorded on the production project, but no Edge receiver is deployed and no
native client has used those contracts. Source-only R004/R005 add
order-transition authority and a cash-shift/cash-capture path. The source-only
native Kitchen workflow can request the already-authorized
`PLACED -> PREPARING -> READY` transitions through the Hub, but it does not
demonstrate remote Kitchen, printer, notification, or physical delivery. No
Edge receiver is **deployed**.

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

ADR-012/R022 restores a recognizable role-based merchant entry experience
without returning PIN verification or role selection to React. ADR-013/R023
then restores merchant-facing operational hierarchy across the source-only
Cashier, Kitchen, and Manager station surfaces: Cashier follows build order →
take payment → hand over; Kitchen follows waiting → preparing → ready; Manager
sees cash control, order exceptions, and counted-stock tasks. The same native
operator-context, command-request, exact-retry, and native-confirmed-abandonment
boundaries remain in force. This is source-level UX evidence only, not an
Android build, physical station, multi-device, cloud-acknowledgement, payment
settlement, or production-release result.

The source now contains an owner-only device-pairing control, terminal
admission/revocation and renewal contracts, and a native terminal local-link
engine. It discovers an admitted Hub over LAN mDNS or Wi-Fi Direct, treats
Bluetooth only as a proximity hint, pins the Hub TLS certificate, and proves
the terminal key against the Hub's fresh nonce. ADR-010/R014 define a native
PIN/session and signed-command path. ADR-011/R018 adds a native,
role-minimized Cashier, Kitchen, and Manager terminal workspace over that
authenticated link; it derives task data from the Hub and submits only the
already-authorized signed commands. R014 and its Edge receiver are not
deployed to the recorded R001A–R013 production baseline. No staging project,
Function deployment, Android build, radio connection, certificate handshake,
or multi-device result has been recorded. A terminal therefore remains
non-operational in live production until those exact schema, Function, and
physical evidence gates are complete.

ADR-012/R019 hardens source-only cloud batch acknowledgement handling: each
receiver acknowledgement is bound to its own contiguous action-family group,
and malformed, duplicate, or cross-group IDs retain the local outbox. This is
not evidence of a deployed `hub-sync` Function, durable cloud acknowledgement,
retry/restart recovery, or production readiness.

No claim of production readiness, live multi-device operation, payment
settlement, completed order collection, kitchen delivery, printer delivery, or
cloud acknowledgement is valid until the gates below have recorded evidence.

## Environment boundary

| Environment | Current classification | Allowed action |
|---|---|---|
| Production `iwbbwcaylpulcpvbfkdx` | R001A–R013 schema baseline recorded; no Edge Function deployed | Preserve the ledger; configure/deploy Functions only through ADR-007/ADR-008 guards after the required secrets, exact origin, Android public issuer map, and evidence are present; do not treat this as a product release or hardware acceptance |
| Legacy staging `dpqtgfxovmiwzkiuzoya` | Paused contaminated rehearsal evidence | Preserve for comparison; do not resume, reset, overwrite, or treat as a release target without a separate review |
| Clean staging `nuufscrmkfoukndfmwcc` | Not available for this delivery constraint | Do not use, deploy to, or mutate while delivery proceeds local-first without staging |

## Required gates before a production release

1. Create an isolated clean staging project and prove the R001 clone and
   restore path.
2. Complete owner-controlled native resets for the four retired credential
   records, then rehearse the same recovery path in staging.
3. Validate the recorded R001A–R013 baseline in an accepted staging-equivalent
   environment, including real Supabase RLS, Edge Function, and service-role
   checks; do not replay the production baseline through `db push`.
4. Build and exercise the Android host on physical API 24+ hardware with
   provisioned issuer keys and cloud receiver configuration.
5. Prove atomic orders, stock reservations/reversals, durable acknowledgement,
   branch isolation, revoke/expiry safe-stop, and restart recovery.
6. Prove Hub/terminal enrollment, admission renewal/revocation, LAN mDNS,
   Wi-Fi Direct, Bluetooth proximity, certificate-pin rejection, and signed
   challenge behavior on supported physical Android hardware.
7. Exercise the ADR-010/R014 and ADR-011/R018 terminal session, measured
   context, and signed-command contracts on real devices before presenting an
   authenticated terminal link as a Cashier, Kitchen, or Manager station.
8. Complete payment settlement, cashup custody, printing, Kitchen delivery,
   and the remaining operational workflows before presenting them as available
   product features.
9. Complete accessibility, observability, backup/restore, incident, and pilot
   acceptance with evidence tied to exact source and migration hashes.

## Documentation rule

The historical files under `docs/certification/` are not release evidence.
They describe previous prototype targets and can contain optimistic or
simulated claims. Each is marked as superseded. A release decision must cite
current, reproducible build, hardware, staging, and pilot evidence instead.

## Never do from this source tree

- Run a file from `supabase/quarantine/` as a database input.
- Apply R002 or R003 to production outside the documented owner-approved
  remediation window and its ordered evidence record.
- Re-enable the browser IndexedDB/event/certificate/sync kernels for
  operational authority.
- Declare a local event delivered merely because connectivity returned.
- Put a staff PIN, cloud secret, signing key, device session, or authorization
  envelope in browser storage, logs, or the Capacitor bridge.
