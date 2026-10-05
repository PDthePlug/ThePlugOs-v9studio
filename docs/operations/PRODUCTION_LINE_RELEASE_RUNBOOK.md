# Production-line release runbook

- **Status:** Source preparation only — not current deployment authority
- **Applies to:** the recorded R001A–R013 production schema baseline and
  Hub/terminal Edge Functions
- **Authority:** `RELEASE_STATUS.md`, ADR-002 through ADR-006

## Purpose

This runbook makes the repository deployable only after the missing staging,
hardware, recovery, and pilot evidence has been accepted. The R001A–R013
schema baseline is already recorded in production; this runbook never replays
it. It does not make a production deployment valid today. The checked-in helper
refuses remote mutation while the release status is HOLD.

## Secure deployment inputs

Supply these only through the secured deployment environment; never commit
them, add them to `.env`, expose them to Vite, or put them in Android:

- `SUPABASE_ACCESS_TOKEN`
- `HUB_AUTHORIZATION_ISSUER_KEY_ID`
- `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON`
- `HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64` — the matching public P-256
  SPKI used in the Android issuer-key map; this is checked locally and is not
  uploaded as a Function secret
- `HUB_RATE_LIMIT_PEPPER`
- `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES` — an explicit integer from 15 through
  720; use 120 for the first controlled production pilot unless a separately
  accepted operational continuity decision says otherwise.
- `HUB_OWNER_PORTAL_ORIGIN`

The Android release receives only the approved HTTPS Functions base URL and
public issuer-key map through Gradle properties.

## Source preparation check

Run the non-mutating guard from the exact reviewed commit:

```bash
scripts/deploy-hub-cloud.sh --verify-source
```

It validates the native Function configuration, migrations, protocol source,
dashboard boundary, Android host contracts, and deployment guard. It never
contacts Supabase.

## Controlled Function configuration — product remains HOLD

The production schema has already been recorded. If a separately authorized
cloud-configuration window is needed before the wider product can be accepted,
use the strictly production-only ADR-009 mode. This does not create a release,
does not run database migrations, and does not permit operational activation.

In addition to the secure deployment inputs, supply the **public** SPKI that
will be pinned in Android and the exact controlled confirmation:

```text
HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64=<Base64URL P-256 SPKI public key>
THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM=configure-functions:production:<project reference>:<checked-out git commit>:<ledger SHA-256>:<issuer public-key SHA-256>
```

The migration-ledger inputs are the same as the normal production release
inputs below. Run only from the reviewed, clean commit:

```bash
scripts/deploy-hub-cloud.sh --configure-production-functions
```

The helper validates the private JWK against the public SPKI without printing
either value, sets the five custom secrets, and deploys the six reviewed Hub
Functions. It never runs `supabase db push` and always reports that product
release remains HOLD.

## Release execution — only after approval

The release authority must first change `RELEASE_STATUS.md` to `APPROVED` with
accepted evidence linked to the exact commit and target project. The checked
out source tree must be clean; the helper rejects uncommitted or untracked
files so it cannot deploy a different tree than the reviewed commit. Then, in
the secure deployment environment, provide all required secrets plus:

```text
THEPLUGOS_DEPLOYMENT_ENV=staging|production
SUPABASE_PROJECT_REF=<target project reference>
THEPLUGOS_EXPECTED_PROJECT_REF=<same target project reference>
THEPLUGOS_RELEASE_COMMIT=<checked-out git commit>
THEPLUGOS_DEPLOY_CONFIRM=deploy:<environment>:<project reference>:<checked-out git commit>
```

For the existing production schema only, first compare the remote migration
history with
`supabase/production/iwbbwcaylpulcpvbfkdx-r001a-r013-ledger.json`, run the
local ledger verifier, then provide its exact fingerprint twice:

```text
THEPLUGOS_PRODUCTION_MIGRATION_LEDGER_SHA256=<ledger verifier output>
THEPLUGOS_REMOTE_MIGRATION_LEDGER_CONFIRM=verified:production:<project reference>:<ledger verifier output>
```

This explicit acknowledgement confirms that the operator has just checked the
remote history. It is required because the live R001A–R013 records use
Supabase-managed history versions that differ from the immutable source file
names. The production helper intentionally does not run `supabase db push`.

Run:

```bash
scripts/deploy-hub-cloud.sh --deploy
```

The helper sets only the five Hub runtime values and deploys only
`hub-enrollment`, `hub-owner-enrollment`,
`hub-terminal-enrollment`, `hub-staff-session`,
`hub-staff-credential-reset`, and `hub-sync`. A failed
staging migration stops Function deployment. It does not create, clone, reset,
overwrite, or replay the recorded production schema baseline.

`hub-terminal-staff-session` is intentionally excluded from the current
production configuration window because it depends on R014, which is not part
of the recorded R001A–R013 production ledger. It may be deployed only after an
approved R014 migration record and a fresh Function configuration check.

## Controlled legacy-credential remediation

The owner-approved R001A→R012 remediation window is recorded separately in
`docs/evidence/CONTROLLED_PRODUCTION_REMEDIATION_2026-08-26.md`. It is a
narrow database-recovery authorization, not a bypass of this full release
helper or a claim that the application is ready for production operation. The
normal `--deploy` guard remains intentionally HOLD-blocked until physical,
backup/restore, secret-configuration, and pilot evidence are accepted.

## Mandatory post-deployment evidence

Record results for exact source/migration hashes before changing release
status: RLS and service-role checks, owner-origin/JWT rejection, malformed and
replayed native proof rejection, Hub and terminal enrollment, terminal renewal
and revocation, LAN mDNS, Wi-Fi Direct, Bluetooth proximity, certificate-pin
rejection, signed challenge, restart/recovery, outbox acknowledgement,
backup/restore, monitoring, and pilot operations.
