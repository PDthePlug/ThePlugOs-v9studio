# ADR-020 — HOLD-safe staging backend rehearsal

- **Status:** Accepted source design
- **Date:** 12 October 2026
- **Applies to:** Supabase staging schema rehearsal, Edge Function deployment, R014/R015 validation, release evidence

## Context

ThePlugOS remains on release **HOLD** while backend and physical-device evidence is incomplete. The recorded production project is bound to an immutable R001A–R013 migration ledger and must not be replayed through local migration filenames.

Two source constraints make a normal `supabase db push` unsuitable for the required staging rehearsal:

1. the production migration ledger uses hosted remote versions that intentionally differ from the repository filenames; and
2. `001a_retire_unsupported_legacy_staff_pins.sql` is an accepted canonical source migration but its `001a_` prefix does not match the current Supabase CLI migration filename pattern `^([0-9]+)_...sql$`, so CLI migration discovery would skip it.

The previous deployment helper also placed staging mutation behind the final `APPROVED` release path. That creates a circular release gate: staging evidence is required before approval, but the helper required approval before staging could be exercised.

## Decision

### Separate rehearsal from release

A dedicated `scripts/deploy-hub-cloud.sh --rehearse-staging` mode is permitted while `docs/operations/RELEASE_STATUS.md` remains **HOLD**.

This mode is evidence-only. It:

- requires `THEPLUGOS_DEPLOYMENT_ENV=staging`;
- requires the supplied project ref to equal an independently supplied expected project ref;
- refuses production project `iwbbwcaylpulcpvbfkdx`;
- refuses preserved contaminated legacy staging project `dpqtgfxovmiwzkiuzoya`;
- requires an exact source commit and clean Git worktree;
- requires a matching P-256 issuer private/public key pair;
- requires separate exact acknowledgements for schema application and staging rehearsal;
- does not modify release status; and
- cannot establish production release authority.

### Explicit ordered staging schema application

Fresh isolated staging uses `scripts/apply-staging-schema.mjs`, not Supabase CLI migration discovery.

The applicator requires a secure PostgreSQL URL whose hostname or database username identifies the exact confirmed staging project. TLS certificate verification remains enabled. It refuses a target if canonical ThePlugOS tables already exist.

It applies the source files in this exact order, one transaction per migration:

`001 -> 001A -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 -> 010 -> 011 -> 012 -> 013 -> 014 -> 015`

After application it directly verifies the R014 terminal-session RPCs and the R015 owner-only staff/catalog policy state. A failure leaves the rehearsal failed; it is never converted into release evidence.

This staging applicator intentionally does **not** rewrite the production migration ledger or rename the canonical R001A source file.

### Edge Function authentication boundary

The reviewed Function set has exactly six native-proof receivers with `verify_jwt = false`:

- `hub-enrollment`
- `hub-staff-session`
- `hub-staff-credential-reset`
- `hub-sync`
- `hub-terminal-enrollment`
- `hub-terminal-staff-session`

Those endpoints have no browser CORS surface and independently authenticate their native proof before using service-only RPCs.

`hub-owner-enrollment` remains the browser owner receiver and retains `verify_jwt = true`, followed by owner/business/branch authorization in the handler/database contract.

Adding another `verify_jwt = false` Function requires an explicit source-contract change; it must not happen by configuration drift.

### Schema before receivers

During isolated staging rehearsal, schema 001–015 must apply and verify before ThePlugOS Function secrets are set and before receiver code is deployed. All seven receivers may then be deployed to staging.

Production remains bound to the recorded R001A–R013 ledger. Until production has a separately accepted schema-advance record for R014/R015, the `hub-terminal-staff-session` receiver must not be published there.

## Consequences

- Staging evidence can be collected while the product correctly remains on HOLD.
- The nonstandard but immutable R001A source migration cannot be silently skipped.
- A clean staging project cannot be confused with production or the contaminated legacy staging project.
- Production migration history remains unchanged by staging work.
- Function authentication modes are centrally regression-protected by R030.
- Staging source success is still not backend acceptance: the actual authorized project, RLS behavior, Function invocations and physical devices must be measured before release gates can close.
