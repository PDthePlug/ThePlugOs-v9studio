# Staging Hub-Authority Rehearsal

- **Status:** Required release gate — no deployment has been performed
- **Date:** 15 August 2026
- **Scope:** R001 clone → R002 credential migration → R003 Hub authority → Edge receivers → one physical Android Hub

## Non-negotiable boundaries

- Production project `iwbbwcaylpulcpvbfkdx` is read-only throughout this
  rehearsal. Do not run a migration, deploy an Edge Function, change Auth, or
  alter a row there.
- Legacy staging project `dpqtgfxovmiwzkiuzoya` contains incompatible rehearsal
  artifacts and test data and is paused. Treat it as preserved comparison
  evidence: do **not** resume, reset, overwrite, or use it as a release target.
  Clean staging `nuufscrmkfoukndfmwcc` is the only replacement target and is
  currently empty. Rebuild it as an **exact R001 clone** using an approved
  database client/credential path. Do not hand-copy rows or use
  `supabase/quarantine/legacy-browser-prototype-schema.sql`; it contradicts the
  canonical migrations.
- The four unsupported live legacy PIN values must be handled under the
  separately approved owner-controlled reset/conversion plan. Never expose,
  guess, or copy them into a ticket, log, browser, or chat.
- A green source check is not a release. This sequence needs database evidence
  and physical-device evidence.

## Required tooling and secrets

The operator running this rehearsal needs an approved Postgres/Supabase CLI
connection to both projects, including the production source pooler/database
credentials needed for the exact clone. The current workspace does not contain
that database client or those credentials, so no clone or migration is run
from here.

Create the following **staging-only** Edge secrets in the Supabase secret
store; never commit their values:

| Secret | Requirement |
| --- | --- |
| `HUB_RATE_LIMIT_PEPPER` | Random secret, at least 32 characters; used only to HMAC source/device throttle keys. |
| `HUB_AUTHORIZATION_ISSUER_KEY_ID` | Stable public key identifier, e.g. `staging-issuer-2026-01`. |
| `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON` | P-256 private JWK, generated and retained only in the approved secret store. |
| `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES` | Integer from 15 through 720; start at 120 for rehearsal. |
| `HUB_OWNER_PORTAL_ORIGIN` | Exact HTTPS origin of the owner portal, with no path or wildcard. It is the only browser origin allowed to request a pairing code. |

The Android staging build receives only public configuration:

| Gradle property | Value |
| --- | --- |
| `THEPLUGOS_CLOUD_FUNCTIONS_BASE_URL` | `https://<clean-staging-project-ref>.supabase.co/functions/v1` |
| `THEPLUGOS_BUNDLE_ISSUER_KEYS_JSON` | JSON map from the issuer key ID to its **Base64URL SPKI public key**. It must match the private JWK above. |

When the guarded helper is used for staging, pass that same single public SPKI
as `HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64`; it verifies the JWK/SPKI pair
locally before it uploads any Function secret or code.

Do not put the issuer private JWK, service-role key, pairing codes, PINs, or
database passwords in Gradle properties, APK resources, browser variables, or
source control.

## Ordered rehearsal

1. Verify the immutable R001 source and staging target fingerprints using the
   existing clone gates. Stop if they differ.
2. Create the exact R001 staging clone with the approved dump/restore method.
   Record clone timestamp, source fingerprint, target fingerprint, row counts,
   and schema object counts in the deployment record.
3. Run `supabase/preflight/002_secure_identity_devices_preflight.sql` against
   staging. Resolve every stop condition through the approved data plan, then
   rerun it successfully.
4. Apply `002_secure_identity_devices.sql` to staging once. Re-run its
   repository/database validation and preserve the result.
5. Run `supabase/preflight/003_local_hub_authority_preflight.sql`. Every row
   must be `passed = true`; otherwise restore the clean accepted R002 staging
   checkpoint instead of attempting manual R003 repair.
6. Apply `003_local_hub_authority.sql` to staging once. Record the migration
   transaction result and review the new private/function execute privileges.
7. Deploy `hub-owner-enrollment`, `hub-enrollment`, `hub-staff-session`, and
   `hub-sync` to the staging project using `supabase/config.toml`. The three
   native endpoints use `verify_jwt = false` intentionally: they perform
   device-proof and service-RPC checks and must not gain browser CORS access.
   The owner endpoint retains JWT verification and permits only the configured
   exact owner-portal origin.
8. Set the staging Edge secrets, build the Android staging APK with the public
   issuer-key map, and confirm an empty configuration fails closed.
9. Create a one-time staging pairing code through an approved owner/server
   control. Enroll one Android Cashier Hub, verify its pinned bundle and TLS
   fingerprint, then complete a staff sign-in using the native PIN screen.
10. Exercise a real order create, an exact retry, a cancellation, a wrong-role
    attempt, an expired-bundle recovery upload, a cloud outage/recovery, and
    an event-batch retry. Preserve database and device evidence that one
    command causes one order/event/branch-stock-movement effect, that pending
    outbox work blocks catalog-bundle replacement, and that only acknowledged
    outbox IDs are cleared.
11. Capture separate physical-device evidence before enabling any paired
    kitchen terminal: TLS challenge rejection, successful authenticated peer
    delivery, restart recovery, and revoked-device rejection.

## Acceptance / rejection

Approve the next release gate only if the evidence proves all of the following:

- no staging owner/browser JWT can directly mutate operational tables;
- native PIN, private key, staff-session ID, and bundle signature never appear
  in browser storage, logs, plugin responses, or Edge responses; the one-time
  pairing code appears only in the authenticated owner endpoint response and
  transient component memory until it expires or is discarded;
- Hub sequence/idempotency survives a bundle renewal and an app restart;
- a repeated cloud batch produces one durable business effect and exact
  acknowledgement IDs;
- a local stock reservation and cancellation produce matching, single cloud
  `inventory_movements` rows and branch balances without cross-branch effects;
- a catalog-bearing replacement bundle cannot overwrite a pending local stock
  reservation; after acknowledgement, renewal converges the local and cloud
  balance;
- an interrupted bundle installation can recover the current bundle with the
  same active Hub key while a replacement/revoked Hub cannot use that bridge;
- a replacement/revoked Hub fails locally and at the receiver; and
- the UI labels local commit, queued cloud work, and cloud acknowledgement as
  distinct measured states.

The implementation currently supports native `order.create` and
`order.status.transition` as the first atomic domain slice, including only
stock reservation on order placement and one-time release on cancellation.
Payment capture, stock receipt/waste/adjustment/BOM, shifts, cash-up, refunds,
and paired-terminal enrollment remain separate release slices; do not describe
this rehearsal as whole-business production acceptance until those contracts and
physical proofs exist.
