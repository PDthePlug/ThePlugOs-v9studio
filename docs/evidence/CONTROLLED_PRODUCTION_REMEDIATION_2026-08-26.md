# Controlled production remediation window — 26 August 2026

- **Status:** Database remediation executed and remotely re-verified; Edge
  Function secret configuration and deployment remain pending
- **Target:** Supabase project `iwbbwcaylpulcpvbfkdx` (ThePlugOS)
- **Authority:** Explicit product-owner approval in the delivery conversation
- **Scope:** Credential retirement/recovery control plane and ordered schema
  migrations only. This is not a product-release or hardware-acceptance
  approval.

## Baseline observed before this change window

- The target contains the canonical R001 public foundation and `private`
  schema, with RLS enabled on the audited R001 core tables.
- No partial R002 objects or Supabase migration-history records were observed.
- Four active staff records have non-empty credential values outside the
  accepted bcrypt format; no raw values were read, copied, converted, or
  exported.
- The target has no enrolled Hub, terminal, order, pairing-code, or Edge
  Function deployment evidence.
- The provider backup/PITR setting could not be independently verified from
  this environment. This is a known evidence gap, not an assertion that no
  provider backup exists.

## Approved mutation sequence

1. Apply `001a_retire_unsupported_legacy_staff_pins.sql`. It records only
   staff identity/scope/reset-required facts and clears unsupported legacy
   values; it does not retain a credential value.
2. Apply R002 through R011 in file order against the verified canonical R001
   baseline. Each migration retains its own fail-closed preflight.
3. Apply R012 to create the owner-authorized, native-only recovery code and
   Hub-proof flow.
4. Verify migration objects, RLS/privilege boundaries, the retired-value
   ledger, and expected empty operational state with read-only SQL.
5. Deploy Edge Functions only after the cloud secret set, exact owner portal
   origin, Android public issuer-key map, and source commit are evidenced in a
   secure deployment environment.

## Non-negotiable boundaries

- No raw PIN, legacy credential, service key, issuer private key, owner JWT,
  or device private key is written to source, a browser request, an audit
  payload, or evidence record.
- Browser ownership can issue/display a one-time recovery code only. The new
  PIN is entered and confirmed in `NativeStaffCredentialResetActivity` on the
  enrolled Cashier Hub, then protected by its Keystore P-256 proof.
- A successful reset revokes active/pending branch staff continuations and
  requires signed Hub authority reconciliation before a new native session.
- Migration success is not a physical Android, LAN, Wi-Fi Direct, Bluetooth,
  backup/restore, or pilot acceptance result. `RELEASE_STATUS.md` remains
  HOLD until those separate gates have recorded evidence.

## Execution record

The following entries come from the project's managed migration history and
read-only postflight query, re-observed at `2026-08-27T03:13:30.528Z`. The
source-to-remote mapping and source hashes are preserved in
`supabase/production/iwbbwcaylpulcpvbfkdx-r001a-r013-ledger.json`. Do not
infer any Edge, Android, radio, backup, or operational acceptance from this
database record.

| Step | Migration / verification | UTC result | Evidence reference |
| --- | --- | --- | --- |
| 1 | R001A retire unsupported values | Applied `2026-08-26T14:54:05Z` | Remote history `20260826145405` |
| 2 | R002 | Applied `2026-08-26T14:54:23Z` | Remote history `20260826145423` |
| 3 | R003 | Applied `2026-08-26T14:54:45Z` | Remote history `20260826145445` |
| 4 | R004–R011 | Applied `2026-08-26T14:54:48Z`–`14:55:24Z` | Remote history `20260826145448` through `20260826145524` |
| 5 | R012 | Applied `2026-08-26T14:55:33Z` | Remote history `20260826145533` |
| 6 | R013 additive hardening | Applied `2026-08-26T15:01:14Z` | Remote history `20260826150114` |
| 7 | Post-migration schema/RLS/privileges | Verified `2026-08-27T03:13:30.528Z`: zero legacy PIN values remain; four reset-required facts remain; 38 public tables have RLS; all three owner authority RPCs exist; trigger search path is locked | Read-only SQL postflight |
| 8 | Edge Function / secret configuration | Pending — no Edge Function is listed on the project; custom secret presence is not asserted | Remote Function inventory |

## Recovery position

These migrations are not auto-reverted. If an ordered migration fails, stop
at the failed step, record the exact database response, and use the provider's
documented restore/PITR process only after confirming the exact target and
recovery point. Do not delete, reset, or rerun a partially applied schema as a
substitute for recovery.
