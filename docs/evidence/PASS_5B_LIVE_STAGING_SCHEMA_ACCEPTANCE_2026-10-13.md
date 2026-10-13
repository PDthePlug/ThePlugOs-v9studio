# PASS 5B — Live ThePlug staging schema acceptance evidence

- **Date:** 13 October 2026
- **Environment:** isolated ThePlug Supabase staging
- **Project ref:** `zwqnrxplbkzkzcpimpim`
- **Region:** `eu-west-1`
- **Source/preflight candidate:** `d3c55dc6d0c0ede02923d5c77464af2191498f69`
- **Source CI run:** `38311195110`
- **Release status:** **HOLD**
- **Overall live backend result:** **PARTIAL PASS** — Gate B closed; Gates C–G not yet fully executable

## Target isolation

The connected `ThePlug` organization already contained one active project, so no additional Supabase project was created and no additional project cost was incurred. Before rehearsal the target had zero ThePlugOS application tables, zero Supabase migration-ledger entries, zero Edge Functions and zero Auth users. Production `iwbbwcaylpulcpvbfkdx`, contaminated historical staging `dpqtgfxovmiwzkiuzoya`, and unrelated projects were not mutated.

## Ordered schema application

The reviewed PASS 5 migration semantics from the frozen candidate were applied transactionally in exact order. SQL formatting/comments were compacted where required for connector transport; authority logic and migration ordering were preserved. A failed transport attempt before the accepted R002 run rolled back transactionally and did not enter the migration ledger.

| Version | Migration |
| --- | --- |
| `20261012224557` | `r001_mvp_core` |
| `20261012224629` | `r001a_retire_unsupported_legacy_staff_pins` |
| `20261013073158` | `r002_secure_identity_devices` |
| `20261013073549` | `r003_local_hub_authority` |
| `20261013073611` | `r004_order_transition_authority` |
| `20261013073820` | `r005_cash_shift_and_capture` |
| `20261013073906` | `r006_cash_shift_close` |
| `20261013073956` | `r007_inventory_receipt` |
| `20261013074041` | `r008_inventory_count_correction` |
| `20261013074128` | `r009_inventory_waste` |
| `20261013074251` | `r010_device_pairing_and_local_links` |
| `20261013074328` | `r011_terminal_admission_renewal` |
| `20261013074424` | `r012_owner_controlled_native_credential_reset` |
| `20261013074452` | `r013_production_schema_hardening` |
| `20261013074615` | `r014_terminal_staff_session_and_command_authority` |
| `20261013074717` | `r015_owner_control_plane_rls_hardening` |

**Gate B result: PASS.**

## R014 live authority verification

Direct read-only database verification measured all five required R014 RPCs as present: `r014_begin_terminal_staff_session`, `r014_get_terminal_staff_session_context`, `r014_verify_terminal_staff_pin`, `r014_prepare_terminal_staff_session`, and `r014_finalize_terminal_staff_session`.

For `r014_begin_terminal_staff_session`, live privilege checks measured `service_role EXECUTE = true`, `authenticated EXECUTE = false`, and `anon EXECUTE = false`. The R014 terminal staff-session challenge table is present with RLS enabled.

## R015 live policy verification

Direct `pg_policies` inspection measured the following.

`staff_members`: authenticated SELECT `Users can view staff for their businesses`; authenticated INSERT `Owners can create staff profiles for their businesses`; **no authenticated UPDATE policy**.

`catalog_products`: authenticated SELECT `Users can view products for their businesses`; authenticated INSERT `Owners can create catalog products for their businesses`; authenticated UPDATE `Owners can update catalog products for their businesses`.

The retired broad member-write policies are absent.

## Supabase advisor review

The security advisor produced no exposed operational-table warning. INFO-level `rls_enabled_no_policy` findings apply to service-only Hub/credential/inventory authority tables whose direct `PUBLIC`, `anon`, and `authenticated` grants are revoked; they are reached through reviewed SECURITY DEFINER service RPCs. The advisor also reports the intended authenticated `public.create_business_with_owner_and_branch` SECURITY DEFINER onboarding RPC.

The performance advisor reports five INFO-level unindexed foreign keys on `hub_terminal_staff_session_challenges`: `branch_id`, `business_id`, `hub_device_id`, `prepared_session_id`, and `staff_id`. These are recorded as a later schema-performance hardening delta and were not patched ad hoc into the accepted R001–R015 rehearsal. Unused-index findings are expected on this fresh zero-traffic database.

## Gates not yet closed

### Gate C — live RLS/Auth behavior: BLOCKED

The staging project currently has zero Auth users, and the available connector exposes no Auth-user/session creation action. Policy definitions are verified live, but the protocol requires real Supabase Auth identities and positive/negative JWT-backed calls before Gate C can pass.

### Gates D/G — Edge Functions and secrets: BLOCKED BEFORE DEPLOYMENT

The connector can deploy Edge Functions but exposes no Supabase secret-management action. The guarded deployment contract requires these ThePlugOS-owned secrets before Function publication: `HUB_AUTHORIZATION_ISSUER_KEY_ID`, `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON`, `HUB_RATE_LIMIT_PEPPER`, `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES`, and `HUB_OWNER_PORTAL_ORIGIN`.

No half-configured receiver was published merely to satisfy a deployment count. Function deployment/invocation remains BLOCKED until these secrets are provisioned in the secure Supabase environment.

### Gates E/F and physical handoff: BLOCKED

Terminal staff-session, signed Hub sync, exact acknowledgement, outage/retry/restart and physical Android acceptance depend on configured staging Functions plus legitimately enrolled staging identities/devices.

## Current truth

- Source/preflight PASS: **CLOSED**
- Isolated staging target: **CONFIRMED**
- Schema R001 → R001A → R015: **PASS**
- R014 service-only RPC boundary: **PASS**
- R015 policy-state inspection: **PASS**
- Gate C Auth/RLS behavior: **BLOCKED**
- Gates D/G Function secret/deployment acceptance: **BLOCKED**
- Gates E/F live terminal/sync acceptance: **BLOCKED**
- Physical multi-device acceptance: **BLOCKED**
- Production mutation: **NONE**
- Overall release: **HOLD**
