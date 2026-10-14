# PASS 5E — Staging Function configuration guard evidence

- **Date:** 14 October 2026
- **Environment:** isolated ThePlug staging control path
- **Active staging project:** `zwqnrxplbkzkzcpimpim`
- **Reviewed source candidate:** `ba71b274a7e61866aaee5f469e12419eca8a1a15`
- **GitHub Actions run:** `38507544056`
- **Release status:** **HOLD**
- **Result:** **PASS** for source/configuration guard; remote project-secret provisioning and Function invocation remain BLOCKED

## Problem closed by this pass

After PASS 5B/PASS 5D, the active staging project is intentionally populated through R016. The original `--rehearse-staging` path correctly refuses non-empty targets, so it cannot be reused merely to configure Functions.

PASS 5E adds a separate configuration-only staging path that verifies the accepted live schema and then permits secret/Function publication without replaying migration SQL.

## R031 issuer handoff correction

The earlier staging generator produced a correct P-256 public JWK, while the guarded deployment verifier requires canonical P-256 SPKI DER encoded as Base64URL in `HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64`.

The generator now emits both:

- `HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64` — deploy-verifiable SPKI Base64URL;
- public JWK material and its non-secret SHA-256 fingerprint.

It also emits `HUB_AUTHORIZATION_ISSUER_CONFIGURATION_SHA256`, calculated from the exact issuer key ID and SPKI value. R031 feeds the generated private JWK + SPKI into `verify-issuer-key-configuration.mjs` and requires the verifier fingerprint to equal that generator fingerprint exactly.

Private JWK and rate-limit pepper remain mode-`0600`, fail-on-overwrite and absent from stdout/evidence.

The earlier PASS 5C rehearsal issuer pair was never provisioned to Supabase and predates this SPKI handoff contract. It is therefore treated as **superseded/unprovisioned**. The final staging pair must be freshly generated in the same secure operator environment that can immediately execute `supabase secrets set`.

## R033 configuration-only staging path

Added:

- `scripts/verify-staging-schema-state.mjs`
- `scripts/test-r033-staging-function-configuration-contract.mjs`
- `scripts/deploy-hub-cloud.sh --configure-staging-functions`
- `docs/operations/STAGING_FUNCTION_CONFIGURATION_RUNBOOK.md`

### Read-only live verifier

`verify-staging-schema-state.mjs`:

- refuses production `iwbbwcaylpulcpvbfkdx`;
- refuses contaminated legacy staging `dpqtgfxovmiwzkiuzoya`;
- requires the database URL to identify the confirmed staging project;
- requires verified TLS;
- reads `supabase_migrations.schema_migrations` and requires exact migration-name order R001 → R001A → R016;
- verifies all five R014 RPCs;
- verifies `service_role` execution plus authenticated/anon denial on the terminal-session begin RPC;
- verifies the R015 owner staff/catalog policy state and browser staff UPDATE denial;
- verifies all five R016 indexes; and
- emits a non-secret SHA-256 fingerprint binding the project, ledger and measured authority state.

R033 inspects the verifier's executable `client.query` template blocks and requires each top-level statement to begin with `SELECT`; transaction calls are forbidden.

### Configuration acknowledgement

The new staging configuration mode requires an exact acknowledgement binding:

```text
configure-functions:staging:<project-ref>:<source-commit>:<live-schema-fingerprint>:<issuer-configuration-fingerprint>
```

A mismatch stops before project-secret publication.

### No schema replay

Only `hold-staging-rehearsal` may call `scripts/apply-staging-schema.mjs --apply`.

`controlled-staging-function-configuration` verifies the accepted live R001–R016 state and executes **no migration SQL**.

### Secret-before-code ordering

After source, issuer and live-schema verification, the path requires `supabase secrets set` before any `supabase functions deploy` call.

The staging path then deploys all seven reviewed receivers:

- `hub-enrollment`
- `hub-owner-enrollment`
- `hub-terminal-enrollment`
- `hub-staff-session`
- `hub-staff-credential-reset`
- `hub-sync`
- `hub-terminal-staff-session`

Production remains separately bound to its recorded R001A–R013 ledger and does not receive the R014-dependent terminal staff-session receiver from this staging path.

## CI seal

Run `38507544056` on source `ba71b274a7e61866aaee5f469e12419eca8a1a15` completed successfully:

- `verify`: PASS — lint, full R001–R033 source gate, release-truth, test suite and web build;
- `journey-visual`: PASS;
- `android-debug`: PASS.

Artifacts:

| Evidence | Value |
| --- | --- |
| Journey artifact ID | `11868287695` |
| Journey archive SHA-256 | `435bc101d094b682a6148edd22c0ef0cdd08920f9f7a9e247feb8cdb7cc26cbe` |
| Android artifact ID | `11868392287` |
| Android archive SHA-256 | `e48477d6a55da7ed834e77c2f9e875b5bac48e211a68f17ec68bb2b9c674addf` |

## What this pass does not prove

The current connected Supabase tool surface still exposes no supported project-secret write action and no staging Auth-user/session creation action. Therefore this pass deliberately did **not**:

- upload the final private issuer key or pepper;
- publish half-configured Edge Functions;
- claim live owner/non-owner JWT-backed RLS behavior;
- claim live signed Hub/terminal Function behavior;
- claim durable acknowledgement/retry/restart behavior; or
- claim physical multi-device acceptance.

## Current truth

- staging schema R001 → R016: **PASS live**
- R016 performance-advisor closure: **PASS live**
- source R031 SPKI/private-JWK composition: **PASS**
- R033 configuration-only staging guard: **PASS**
- secure operator runbook: **READY**
- final staging issuer pair: **NOT YET GENERATED/PROVISIONED by the deployment operator**
- staging project secrets: **BLOCKED by current connector capability**
- seven staging Edge Functions: **NOT DEPLOYED in this pass**
- live Auth/RLS behavior: **BLOCKED**
- live terminal/sync acceptance: **BLOCKED**
- physical acceptance: **BLOCKED**
- production mutation from PASS 5E: **NONE**
- overall release: **HOLD**
