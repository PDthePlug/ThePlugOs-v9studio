# Phase 0–1 Backend Remediation Plan

- **Authorized scope:** Phase 0 control baseline and Phase 1 R002 migration
  hardening only
- **Canonical input SHA-256:**
  `529ca75388fda6d9c66ff6a6251eb7561cd2fca1f59a2c2af8ed6a8fdde1e4cc`
- **Baseline Git commit:** `c010448690f7d4e77043b2034063da837a1650d4`
- **Backend Reality Audit SHA-256:**
  `13e07e20bfeac848d36101430f5e2f4428a89cdb9c05a55440b3e77bec0b5b76`
- **Live Supabase changes permitted:** No

## Phase 0 outcomes

- The exact redesigned archive is integrity-checked before extraction.
- A local Git repository records the untouched canonical source as the root
  commit.
- The Backend Reality Matrix is represented by stable `BR-###` identifiers in
  `docs/audits/BACKEND_REMEDIATION_REGISTER.md`.
- Engineering decisions, test criteria, failure modes, and rollback rules are
  documented before migration edits.

## Phase 1 implementation boundary

Phase 1 may change only the artifacts necessary to make the unapplied R002
migration inspectable, fail-closed, and executable in an isolated clone:

- `supabase/migrations/002_secure_identity_devices.sql`;
- R002 preflight and isolated test SQL;
- development-only migration test tooling and package scripts;
- R002 contracts, ADRs, runbooks, and evidence reports.

Phase 1 must not change:

- `supabase/migrations/001_mvp_core.sql`;
- R001 application behavior;
- production Supabase resources;
- order, inventory, finance, cloud-sync, realtime, or UI architecture;
- legacy-runtime reachability, except to document the future gate.

## Work packages

| Work package | Audit findings | Deliverable | Exit evidence |
|---|---|---|---|
| P0.1 Control baseline | All | Git root commit and immutable input hash | Clean baseline commit |
| P1.1 Schema preflight | BR-009, BR-016–BR-20, BR-024–BR-031 | Read-only target inspection SQL | Preflight fixture assertions |
| P1.2 Credential migration | BR-016–BR-019 | Fail-closed bcrypt-only carry-forward | Unsupported-format rollback test |
| P1.3 Pgcrypto safety | BR-017–BR-019, BR-024–BR-030 | Private schema-qualified wrappers | RPC execution with non-public extension schema |
| P1.4 Session completeness | BR-020, BR-023 | Session revoke primitive and grants | Issue, use, revoke, reject test |
| P1.5 Pairing defense in depth | BR-024–BR-026 | Persistent per-device attempt lockout | Five-attempt/refresh persistence test |
| P1.6 Migration harness | BR-069 | Isolated 001 → 002 integration runner | Deterministic test command |
| P1.7 Gate evidence | All Phase 1 items | Evidence report and residual blockers | Reviewed diff + complete command log |

## Status model

Every register item moves through this exact sequence:

`OPEN → IMPLEMENTED → REPOSITORY_VERIFIED → STAGING_VERIFIED → LIVE_ACCEPTED`

No source inspection alone can produce `STAGING_VERIFIED` or `LIVE_ACCEPTED`.
Items classified A from supplied R001 acceptance use `PROTECTED` until a
regression test or live acceptance changes their state.

## Stop condition

Phase 1 stops after repository verification and packaging. The migration must
remain unapplied. The final evidence must explicitly list all remaining P0/P1
findings and the staging prerequisites required for the next authorization.

