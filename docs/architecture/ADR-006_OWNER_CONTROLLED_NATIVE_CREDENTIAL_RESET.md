# ADR-006: Owner-Controlled Native Credential Reset

- **Status:** Accepted for implementation; live evidence pending
- **Date:** 26 August 2026
- **Decision owner:** ThePlugOS product owner
- **Depends on:** ADR-002 through ADR-005, R002, and R003

## Context

Production R001 contains four non-empty `staff_members.pin_hash` values that
do not prove they are supported bcrypt values. ADR-002 correctly refuses to
interpret them as plaintext. An owner-controlled reset is therefore the only
safe remediation path unless a separately reviewed server-side verifier for
the legacy format is discovered.

The existing owner browser may authenticate with Supabase Auth and issue a
short-lived device-pairing code, but it must not collect or transmit a staff
PIN. The existing Android Hub can securely collect a PIN, but had no
owner-authorized credential-provisioning control plane. Clearing the legacy
values without that control plane would strand every staff member.

## Decision

### 1. Retire unknown legacy values without copying or interpreting them

`001a_retire_unsupported_legacy_staff_pins.sql` records a private, minimal
reset-required ledger and clears only values that fail the accepted bcrypt
shape. It never copies a raw PIN or legacy value into a table, audit record,
browser response, log, URL, or native bridge. Valid bcrypt values, if any,
remain available for R002's normal isolated-credential migration.

The ledger is not a credential backup and must never be used to reconstruct a
PIN. Its sole purpose is to prove which staff records require a new owner-set
PIN before operational use.

### 2. The browser issues authority, never a PIN

The owner browser continues to require a valid Supabase user JWT and one exact
configured HTTPS origin. It may select an active staff record in its current
business/branch and receive a short-lived, single-use reset code. The code is
held only in component memory and is entered directly on the enrolled Android
Hub. The browser neither accepts nor sends a new staff PIN.

### 3. The enrolled Hub captures and proves the new PIN

The native Hub verifies the reset code through a no-CORS Edge Function,
receives a device-bound nonce, and proves possession of its Keystore P-256 key
before transmitting the new PIN over HTTPS to a service-only R012 RPC. The
RPC validates branch scope and active-Hub state, bcrypt-hashes the PIN via the
existing private R002 wrapper, clears lockout state, revokes all active and
pending branch staff continuations, advances the branch authority revision,
and writes an audit fact in one transaction.

No reset code, PIN, credential hash, device private key, session bearer, or
authorization bundle passes through Capacitor or browser storage.

### 4. Reset is online and fail closed

The reset flow requires an active cloud-authorized Hub. It cannot work while
offline, after device revocation, after challenge expiry, from a foreign
branch, or after a code has been consumed. A successful reset forces normal
Hub authority reconciliation before the new PIN can create a staff session.

## Protocol

The completion proof bytes are UTF-8 lines with LF separators and no trailing
newline:

```text
theplugos.staff-credential-reset.v1
{requestId}
{challengeId}
{nonceBase64url}
{hubDeviceId}
{staffId}
```

The detailed endpoint/database contract is in
`NATIVE_OWNER_CREDENTIAL_RESET_PROTOCOL.md`.

## Failure behavior

| Condition | Required outcome |
| --- | --- |
| Unknown legacy PIN format | Retire only after explicit owner authorization; never convert it. |
| Browser origin/JWT/owner scope invalid | Generic rejection; no code or staff disclosure. |
| No active enrolled Hub | No reset code is issued. |
| Code, nonce, signature, device, or scope invalid | Generic rejection; no credential or authority mutation. |
| Replayed completion | Return the prior completion state only for the same challenge; never write a second credential. |
| PIN malformed or confirmation differs | Native screen rejects it before the network call. |
| Successful reset | Revoke branch staff sessions, advance authority revision, and require Hub reconciliation. |

## Consequences

- R002 may proceed without weakening its unsupported-credential preflight.
- Staff must receive new PINs through an owner-present, native-only flow.
- The browser remains an owner cloud-control surface, not a staff credential
  entry surface.
- Source implementation does not prove a physical Android run, Edge deployment,
  secret configuration, or production acceptance. Those facts require recorded
  production evidence.
