# Native owner credential-reset protocol

- **Status:** Implemented source contract; live evidence pending
- **Authority:** ADR-006, ADR-003, and ADR-002
- **Applies to:** R012, `hub-owner-enrollment`, `hub-staff-credential-reset`,
  the owner setup surface, and the Android Cashier Hub

## Purpose

This protocol lets a Supabase-authenticated owner authorize a new PIN for one
active staff member without allowing a browser to collect a staff PIN. It is
also the recovery path after `001a` retires an unrecognised R001 credential.

## Roles and data boundary

| Actor | May do | Must never receive |
| --- | --- | --- |
| Owner browser | Choose scoped staff record; issue/display a short-lived reset code | New PIN, credential hash, private key, staff session, device proof |
| Enrolled Android Hub | Receive code directly, collect/confirm PIN natively, sign fresh challenge | Owner JWT, service key, issuer private key |
| `hub-owner-enrollment` | Validate owner JWT/origin and issue code | PIN or stored bcrypt hash |
| `hub-staff-credential-reset` | Validate Hub proof and call service-only R012 RPCs | Browser CORS route or reusable bearer |
| R012 service RPCs | Persist reset authority and isolated bcrypt credential atomically | Raw legacy credential output |

## Sequence

1. An authenticated owner selects an active staff member under their active
   business/branch and requests `issue-staff-credential-reset-code`.
2. R012 verifies owner scope and an active Hub, revokes a prior unused code for
   that staff member, stores only a bcrypt code hash, and returns a ten-minute
   one-time code.
3. The owner enters the code directly on the Android Hub. The native screen
   sends `begin` with its active Hub identity and a request ID. The receiver
   records/returns a short-lived nonce bound to the code, staff, and Hub.
4. The native screen displays only the target's signed-directory name/role,
   collects the new PIN twice, verifies equality locally, and clears both
   input fields before the network call.
5. The Hub signs `theplugos.staff-credential-reset.v1` bytes using its
   Keystore P-256 key and sends `complete` with the PIN over HTTPS.
6. The receiver validates the stored context and signature, then R012 sets the
isolated bcrypt credential, consumes the code/challenge, revokes every active
or pending branch staff continuation, advances the branch authority revision,
and records an audit fact atomically.
7. The Hub reconciles its signed authority bundle. The staff member then uses
   the normal native sign-in screen with the newly chosen PIN.

## Required controls

- Owner endpoint: JWT verification enabled, exact HTTPS origin, no wildcard
  CORS, bounded JSON, `Cache-Control: no-store`.
- Native endpoint: POST only, no `Origin`, no CORS headers, bounded JSON,
  generic failure responses, source/device throttling, and a valid active Hub.
- Code/challenge: bcrypt code hash only, one use, expiry, idempotent request
  binding, rate limiting, and no raw code/PIN in audit details.
- Database: private R002 bcrypt wrapper, `SECURITY DEFINER SET search_path =
  ''`, RLS with no browser policy, explicit service-role function grants, and
  a short transaction containing the credential/session/revision/audit update.
- Reconciliation: a reset changes the authority revision and ends the native
  local staff selector. A stale Hub bundle cannot issue a new staff session
  until it installs the current signed bundle.

## Explicit non-goals

- Browser-based PIN entry or reset.
- Offline PIN reset.
- Preserving, exporting, guessing, or re-hashing unsupported legacy values.
- Replacing the normal native staff-session flow or granting an operational
  command to the owner browser.
