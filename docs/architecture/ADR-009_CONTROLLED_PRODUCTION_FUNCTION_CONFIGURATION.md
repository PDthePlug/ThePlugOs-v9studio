# ADR-009 — Controlled production Function-configuration window

- **Status:** Accepted source design
- **Date:** 27 August 2026
- **Applies to:** Production project `iwbbwcaylpulcpvbfkdx` and the six
  R001A–R013-compatible Hub Edge Functions
- **Authority:** Engineering Charter, ADR-007, ADR-008, and the recorded
  controlled production-remediation decision

## Context

The production R001A–R013 schema baseline is recorded and is deliberately not
eligible for a second `db push`. The product remains on HOLD because physical
device, recovery, pilot, and operational evidence is still missing. Those
facts must not prevent a separately authorized, tightly bounded configuration
of the cloud receivers, but they must prevent that configuration from being
misrepresented as product-release approval.

The Hub receivers cannot operate correctly unless five custom values are held
in the Edge Function secret store. The issuer private key also has to match
the public SPKI value that will be pinned into the Android release build.

## Decision

1. `scripts/deploy-hub-cloud.sh --configure-production-functions` is a
   distinct, production-only operation. It is not an alias for `--deploy`.
2. The configuration operation remains available only while
   `RELEASE_STATUS.md` is HOLD. A fully approved release must use the normal
   `--deploy` path instead.
3. It sets only the five documented Hub Function secret-store values and
   deploys only the six reviewed baseline Hub Functions. It never runs `supabase db push`,
   applies no SQL, changes no Auth setting, and does not activate any operational workflow.
   The R014 terminal staff-session receiver
   remains excluded until its additive schema migration has an approved exact
   ledger entry.
4. The operation requires all of the following before any remote call:
   - a clean exact source commit and all R014–R017 source gates;
   - the fixed production project reference and the exact R001A–R013 ledger
     fingerprint plus a just-verified remote-ledger acknowledgement;
   - a valid P-256 issuer private JWK whose derived SPKI exactly matches the
     supplied Android-pinning public key;
   - an explicit configuration confirmation containing the production project,
     source commit, migration-ledger fingerprint, and public issuer-key
     fingerprint; and
   - all custom secrets supplied only through the secured deployment
     environment.
5. The private JWK is neither written to the repository nor echoed by the
   helper. The supplied public SPKI is not stored in the Function secret
   store; it is checked only so the Android build can pin the matching public
   key.
6. A successful configuration prints that the product remains HOLD. It is
   evidence of a deployed cloud configuration only, never hardware acceptance
   or production-operational readiness. It does not change
   `RELEASE_STATUS.md`.

## Consequences

- The existing user-authorized production configuration can be carried out
  without weakening the evidence gate for the wider product.
- A mis-targeted project, changed source tree, changed database ledger, or
  mismatched Android issuer key fails before secrets or Function code are
  uploaded.
- The remaining non-source controls are still required: secure secret entry,
  enabling Auth leaked-password protection, Android build provisioning, and
  physical/recovery verification.
