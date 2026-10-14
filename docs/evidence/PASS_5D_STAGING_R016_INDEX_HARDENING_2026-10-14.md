# PASS 5D — Live staging R016 index hardening evidence

- **Date:** 14 October 2026
- **Environment:** isolated ThePlug Supabase staging
- **Project ref:** `zwqnrxplbkzkzcpimpim`
- **Reviewed source candidate:** `b821b20fdfd39d85fa64bbef735073f96feef228`
- **GitHub Actions run:** `38505665533`
- **Release status:** **HOLD**
- **Result:** **PASS** for additive R016 staging hardening; Function/Auth/device gates remain separate

## Why R016 exists

The live PASS 5B staging rehearsal applied R001 -> R001A -> R015 and then ran Supabase's advisors. The performance advisor identified five unindexed foreign keys on the R014 table `public.hub_terminal_staff_session_challenges`:

- `branch_id`
- `business_id`
- `hub_device_id`
- `prepared_session_id`
- `staff_id`

R013 could not cover these because R013 predates the R014 table. The correction was therefore introduced as a new additive migration instead of rewriting R013/R014 or hand-editing staging.

## Source hardening

Migration:

`supabase/migrations/016_terminal_staff_session_index_hardening.sql`

R016 adds exactly five `CREATE INDEX IF NOT EXISTS` statements and has an R014-baseline preflight. It contains no policy, grant, revoke, function, trigger or business-data mutation.

R032:

`scripts/test-r032-terminal-session-index-hardening-contract.mjs`

R032 protects:

- the five expected index names and columns;
- the R014 prerequisite preflight;
- the requirement that R016 remain limited to those five index additions; and
- the prohibition on RLS, privilege, function, trigger or DML changes in this migration.

The staging applicator and guarded cloud-deployment helper now advance clean empty staging through:

`001 -> 001A -> 002 -> ... -> 014 -> 015 -> 016`

and verify all five R016 indexes before any staging Function secrets/code are published.

## CI seal

Run `38505665533` completed successfully on source `b821b20fdfd39d85fa64bbef735073f96feef228`:

- `verify`: PASS — lint, complete R001-R032 source gate, production web build;
- `journey-visual`: PASS;
- `android-debug`: PASS.

Artifacts:

| Evidence | Value |
| --- | --- |
| Journey artifact ID | `11867369449` |
| Journey archive SHA-256 | `3b9cc683a76a66bac3a417207e95b18c43927eaa20c8eeb60f7f5f4b2de7ad2b` |
| Android artifact ID | `11867793653` |
| Android archive SHA-256 | `c9afe2b179ad8f32fe71817434e237cd20db2c5a4214e42d2731168efe3ae4f7` |

## Live staging application

Before R016, the remote migration ledger ended at:

`20261013074717 r015_owner_control_plane_rls_hardening`

The reviewed R016 SQL was then applied through the explicit ThePlug Supabase connection. The transaction committed successfully.

The remote ledger now ends at:

`20261014032316 r016_terminal_staff_session_index_hardening`

No production project was contacted or mutated for this migration.

## Live advisor verification

After R016, Supabase's performance advisor no longer reports the `unindexed_foreign_keys` lint. The five new indexes appear only as unused indexes because this isolated staging database has no representative operational traffic yet; that is expected and is not a release defect.

The security advisor remains materially unchanged from PASS 5B:

- INFO `rls_enabled_no_policy` findings remain on service-only authority tables whose direct browser-role grants are intentionally revoked; and
- the known authenticated `SECURITY DEFINER` warning remains for `create_business_with_owner_and_branch`, the deliberate onboarding RPC bound by source to `auth.uid()`.

No new security finding was introduced by R016.

Supabase advisor references:

- RLS enabled/no policy: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Authenticated SECURITY DEFINER execution: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Unindexed foreign keys: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

## Current backend truth

- isolated staging target: **CONFIRMED**
- ordered staging schema R001 -> R001A -> R016: **PASS**
- R014 service-only terminal-session RPC boundary: **PASS**
- R015 owner-control-plane policy-state inspection: **PASS**
- R016 live index hardening/advisor closure: **PASS**
- staging secret material generation/isolation: **PASS**
- Supabase project-secret provisioning: **BLOCKED by current connector capability**
- live owner Auth/RLS positive-negative behavior: **BLOCKED pending real staging Auth identities**
- seven Edge Function deployment/invocation acceptance: **BLOCKED pending project-secret provisioning**
- terminal staff-session and Hub sync live acceptance: **BLOCKED pending configured Functions and enrolled devices**
- physical multi-device acceptance: **BLOCKED**
- production mutation from PASS 5D: **NONE**
- overall release: **HOLD**
