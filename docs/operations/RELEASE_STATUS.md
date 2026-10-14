# Release status and source-of-truth boundary

- **Status:** HOLD — implementation foundation, not production-ready
- **Release authority:** This document plus the accepted ADRs, ordered
  migrations, and environment-specific evidence records
- **Last reconciled source:** native Cashier Hub authority; source contracts for
  order/cash/inventory/kitchen/station workflows; R010 terminal enrollment and
  revocation; R011 renewal; R012 native credential recovery; R013 production
  schema hardening; R014 terminal staff-session authority; R015 owner-control-
  plane RLS hardening; R016 terminal staff-session index hardening; ADR-015/R024
  cross-device session-conflict hardening; ADR-016/R025 stale-authority
  safe-stop/revalidation; ADR-019/R028/R029 owner control-plane hardening;
  ADR-020/R030 HOLD-safe staging rehearsal; R031 secure staging issuer-material
  generation; R032 R016 index regression protection; and current CI web/native
  Android evidence
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
Cashier/Kitchen/Manager directory profiles under the owner RLS boundary. It
does not accept staff PINs, write physical stock quantities, transition
operational orders directly, create operational staff sessions, or issue
terminal commands.

The owner control plane is split into Overview, Orders, Menu, Stock, Finance,
Team & access, and Devices & settings. Responsive fixture evidence and an
Android debug package exist for the same source family. Those artifacts prove
source/build/presentation behavior only; fixture Auth, cloud data, and bridge
responses are not live backend or hardware acceptance.

Owner account signup is source-guarded: it is limited to an exact configured
owner-portal origin, separates confirmation from password recovery, and waits
for a confirmed email before the R001 foundation RPC. This remains source
behavior, not production Auth acceptance. Production Site URL, redirect
allow-list, email delivery, confirmation, leaked-password protection and
rate-limit configuration still require separate production evidence.

The Android-native Cashier Hub remains the operational authority foundation.
SQLCipher holds the local ledger, Android Keystore holds device keys, a signed
authorization bundle establishes branch authority, and cloud receivers are
designed to replicate durable Hub events. Source-only R004/R005 add
order-transition authority and a cash-shift/cash-capture path. Native Cashier,
Kitchen and Manager workspaces are role-minimized and do not borrow browser
owner authority.

The source contains owner-controlled Hub/terminal pairing, admission renewal and
revocation, native local-link discovery, TLS certificate pinning, fresh terminal
challenge proof, native PIN/session authority, same-staff cross-device
supersession, restart binding, stale-authority safe-stop and reconnect
revalidation. CI compilation/source gates are not physical-device evidence.

R014 defines terminal staff-session/challenge authority and the
`hub-terminal-staff-session` receiver. R015 removes the broad member-write
policies and narrows browser staff/catalog writes to the owner control plane.
R016 adds only the five covering indexes identified by the live staging
performance advisor after R014; it changes no RLS policy, function, privilege,
trigger or business authority fact. R014-R016 are **not** recorded as applied
to production. The immutable recorded production ledger remains R001A-R013.

ADR-012/R019 hardens source-only cloud batch acknowledgement handling: each
receiver acknowledgement is bound to its own contiguous action-family group,
and malformed, duplicate, missing or cross-group IDs retain the local outbox.
This is not evidence of a deployed `hub-sync` Function, durable cloud
acknowledgement, retry/restart recovery, or production readiness.

## PASS 5 live staging state

An explicitly authorized isolated ThePlug staging project is now connected:

`zwqnrxplbkzkzcpimpim`

The target was confirmed clean before the rehearsal. PASS 5B applied the
canonical authority schema in explicit order:

`001 -> 001A -> 002 -> ... -> 014 -> 015`

Direct live verification then measured:

- all required R014 terminal staff-session RPCs present;
- R014 RPC execution allowed to `service_role` and denied to `authenticated`
  and `anon`;
- the R014 challenge table protected by RLS with no browser-role direct table
  read/write grant;
- R015 owner staff INSERT policy present with active branch/business binding;
- no authenticated browser staff UPDATE policy; and
- owner catalog INSERT/UPDATE policy with business/branch constraints.

PASS 5D subsequently applied additive migration R016 after a fully green source
candidate. The remote migration ledger now ends at:

`20261014032316 r016_terminal_staff_session_index_hardening`

The Supabase performance advisor no longer reports the five R014 unindexed
foreign-key findings. The new indexes are currently reported only as unused,
which is expected on this zero-traffic staging database.

The Supabase security advisor remains materially unchanged: INFO-level
`rls_enabled_no_policy` findings remain on intentionally service-only authority
tables whose direct browser-role grants are revoked, and the known warning
remains for the authenticated `create_business_with_owner_and_branch`
`SECURITY DEFINER` onboarding RPC. No new security finding was introduced by
R016.

Evidence:

- `docs/evidence/PASS_5B_LIVE_STAGING_SCHEMA_ACCEPTANCE_2026-10-13.md`
- `docs/evidence/PASS_5C_STAGING_SECRET_MATERIAL_HARDENING_2026-10-13.md`
- `docs/evidence/PASS_5D_STAGING_R016_INDEX_HARDENING_2026-10-14.md`

## Staging secret and Function boundary

R031 provides a local-only generator for staging issuer material. Real staging
material has been generated from the sealed R031 implementation. Only the safe
public identifiers are recorded in evidence; the P-256 private JWK and
rate-limit pepper were not printed or committed.

The connected Supabase action surface can deploy Edge Functions but does not
expose project-secret/environment-variable management. The reviewed deployment
contract requires these values to exist before Function publication:

- `HUB_AUTHORIZATION_ISSUER_KEY_ID`
- `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON`
- `HUB_RATE_LIMIT_PEPPER`
- `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES`
- `HUB_OWNER_PORTAL_ORIGIN`

Therefore no half-configured receiver has been published merely to make the
Function list look complete. Supabase project-secret provisioning and the live
Function invocation gates remain BLOCKED until those values are transferred
through a secure supported project-secret path.

The staging project currently also lacks the real Auth identities/sessions
needed to execute the protocol's positive/negative owner/member RLS cases.
Policy definitions have been verified live, but Gate C remains BLOCKED until
real staging Auth identities are available.

No claim of production readiness, live multi-device operation, payment
settlement, completed order collection, Kitchen delivery, printer delivery or
cloud acknowledgement is valid until the remaining gates have direct measured
evidence.

## Environment boundary

| Environment | Current classification | Allowed action |
|---|---|---|
| Production `iwbbwcaylpulcpvbfkdx` | Recorded R001A-R013 schema baseline; R014-R016 are not recorded as applied | Preserve the ledger. Do not replay source migrations or publish the R014-dependent terminal staff-session receiver until a separately accepted production schema-advance record exists. Production Function configuration remains subject to ADR-007/ADR-008/ADR-009 and is not release authority. |
| Active isolated staging `zwqnrxplbkzkzcpimpim` | R001 -> R001A -> R016 applied and live schema/advisor checks recorded; project secrets/Functions/Auth-behavior gates incomplete | Continue only the staging acceptance protocol. Project-secret provisioning must use a secure supported path; then deploy/test all seven receivers and real Auth positive/negative cases. |
| Legacy staging `dpqtgfxovmiwzkiuzoya` | Preserved contaminated rehearsal evidence | Do not resume, reset, overwrite or use as current acceptance evidence. |
| Historical staging reference `nuufscrmkfoukndfmwcc` | No current acceptance claim | Do not infer availability or mutate without explicit authorized access and a fresh preflight. |

## Required gates before a production release

1. **Closed:** isolated staging target confirmed and ordered schema rehearsed
   through R016 with live advisor verification.
2. Complete `docs/testing/STAGING_BACKEND_ACCEPTANCE.md`, including real owner
   and non-owner RLS cases, all seven Function authentication boundaries, R014
   terminal staff-session/PIN proof, and Hub sync acknowledgement behavior.
3. Securely provision the staging Function secrets, deploy all seven reviewed
   receivers with the prescribed JWT/custom-proof modes, and record deployment
   versions plus positive/negative invocation evidence.
4. Complete owner-controlled native resets for retired production credential
   records through the accepted recovery path; never expose legacy credential
   values.
5. Build and exercise the Android host on physical API 24+ hardware with the
   matching staging public issuer-key map and staging Function base URL.
6. Prove atomic orders, stock reservations/reversals, durable acknowledgement,
   branch isolation, revoke/expiry safe-stop, exact retry and restart recovery.
7. Prove Hub/terminal enrollment, admission renewal/revocation, LAN mDNS,
   Wi-Fi Direct, Bluetooth proximity, certificate-pin rejection, and signed
   challenge behavior on supported physical Android hardware.
8. Exercise ADR-010/R014 and ADR-011/R018 terminal session, measured context,
   cross-device supersession and signed-command contracts on real devices before
   presenting an authenticated terminal link as a Cashier, Kitchen or Manager
   station.
9. Complete payment settlement, cash-up custody, printing, Kitchen delivery,
   accessibility, observability, backup/restore, incident/security and pilot
   acceptance with evidence tied to exact source/deployment/migration hashes.
10. Only after staging, hardware and pilot evidence is accepted may a separately
    reviewed production schema-advance plan move beyond the recorded R001A-R013
    ledger and reconsider release status.

## Documentation rule

Historical files under `docs/certification/` are not release evidence. They
represent older prototype targets and are marked superseded. Release decisions
must cite current, reproducible source/build/backend/hardware/pilot evidence.

## Never do from this source tree

- Run a file from `supabase/quarantine/` as a database input.
- Replay production through `supabase db push` or rewrite the immutable
  R001A-R013 production ledger to make local filenames fit.
- Apply R014-R016 to production outside an explicitly accepted production
  schema-advance record.
- Use an unrelated Supabase project as ThePlugOS staging evidence.
- Re-enable browser IndexedDB/event/certificate/sync kernels for operational
  authority.
- Declare a local event delivered merely because connectivity returned.
- Put a staff PIN, cloud secret, private signing key, device session,
  authorization envelope, service key or database password in browser storage,
  logs, screenshots, evidence documents or the Capacitor bridge.

## Frontend recovery boundary

The frontend uses the established Supabase public configuration and owner
identity model. The temporary Better Auth/browser-database replacement remains
withdrawn; none of its migrations may be applied. R003's browser PIN/pairing
privilege retirement and the native device runtime remain intact.

PASS 4 recovered the owner control plane and explicit public staff-entry path
while preserving native staff authority. PASS 5 has now moved beyond source-only
backend readiness: the isolated staging schema through R016 is measured live.
That does **not** close Function/Auth/physical-device gates, and overall release
status remains HOLD.
