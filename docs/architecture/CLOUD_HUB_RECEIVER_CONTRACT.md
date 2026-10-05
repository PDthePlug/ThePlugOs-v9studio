# Cloud Hub Enrollment, Session, and Event Receiver Contract

- **Status:** Gate 2 implementation contract — not deployed
- **Date:** 15 August 2026
- **Depends on:** Accepted R001 staging clone, accepted R002 staging rehearsal,
  ADR-003, and `NATIVE_HUB_ENROLLMENT_AND_SYNC_PROTOCOL.md`

## Purpose

The cloud is not the live shop command authority. It is the trusted issuer of
device/session facts and the durable receiver of locally committed events. This
contract defines the narrow server boundary that lets an authenticated owner
issue a one-time Hub code, and lets an Android Cashier Hub enroll, renew its
authority, start a staff session, and acknowledge replication without granting
a browser owner token direct operational-table mutation.

No endpoint in this contract may be deployed to production before the R001
clone/R002 gate. Implementing source files or a staging migration does not
authorize either production database mutation or a production Edge deployment.

## Required server facts

The post-R002 migration (R003) adds the following server-owned facts. Browser
roles have no direct table privileges for any of them.

| Fact | Purpose | Authority |
| --- | --- | --- |
| `hub_branch_authority` | Exactly one active Cashier Hub and revocation version per branch | Service-only receiver function |
| `hub_enrollment_challenges` | Short-lived request/key/TLS binding during online enrollment | Service-only receiver function |
| `hub_authorization_bundles` | Issued bundle metadata, expiry, revocation version, and payload digest | Service-only receiver function |
| `hub_staff_sessions` | Native-terminal, expiry-bound staff continuation assertion | Native staff-session receiver |
| `hub_events` | Immutable cloud replica of local committed events, deduplicated by event ID | Authenticated Hub sync receiver |
| `inventory_receipts` / `inventory_receipt_lines` | Immutable Manager-counted stock intake header and product lines | Authenticated Hub sync receiver |
| `inventory_adjustments` / `inventory_adjustment_lines` | Immutable Manager-counted final-balance correction header and product lines | Authenticated Hub sync receiver |
| `inventory_waste` / `inventory_waste_lines` | Immutable Manager-recorded unusable stock header and product lines | Authenticated Hub sync receiver |
| `inventory_movements` | Immutable reservation/release/receipt/count-correction/waste movement produced with each projected stock event | Authenticated Hub sync receiver |
| `hub_rate_limit_windows` | Durable hashed source/device/staff throttles | Service-only receiver function |

`devices` gains a signing public key, Hub TLS certificate fingerprint, and
Hub-role fields. The server stores public identity only; it never receives a
private device key, database key, or plaintext credential hash.

## Owner enrollment endpoint

### `hub-owner-enrollment`

This is the sole browser-facing endpoint in this contract. It requires a valid
Supabase owner JWT, an exact configured portal origin (no wildcard CORS), and
an owner/business/branch check inside the service-only R003 function. It may
perform only `issue-hub-pairing-code`.

The response contains a newly generated six-digit code and its ten-minute
expiry for the authenticated owner to enter directly on the Android screen. It
is intentionally not stored in browser persistence, URL state, logs, database
plaintext, or any Capacitor bridge call. Issuing a replacement revokes a prior
waiting code for the same branch. This endpoint cannot enumerate devices,
staff, bundles, database rows, or operational data.

## Native-only HTTPS endpoints

The functions accept HTTPS `POST` only, return `Cache-Control: no-store`, and
do not set permissive CORS headers. They are called by the Android host, not a
browser application.

### `hub-enrollment`

| Action | Input | Required result |
| --- | --- | --- |
| `begin` | One-time code, request ID, device signing SPKI, TLS certificate/fingerprint, non-secret device name | A stored, expiry-bound challenge with an exact key/fingerprint binding |
| `complete` | Challenge ID, nonce, DER ECDSA proof, request ID | Atomic code consumption, Hub device creation/rotation, branch-authority update, and signed bundle |
| `renew` | Current Hub ID/bundle ID, canonical timestamp, signed renewal proof | A new signed bundle only if the Hub remains active and unrevoked |

The exact completion proof is already defined in the native enrollment protocol.
The Edge Function compares the SHA-256 of the presented nonce with the stored
nonce digest before verifying the native P-256 signature. It uses generic
failure responses for invalid/expired code, nonce, proof, or key binding.

If a new Cashier Hub is explicitly enrolled for an existing branch, the receiver
revokes the prior active Hub, advances the branch revocation version, and issues
authority only to the replacement. This is the controlled failover path; two
active writers are never accepted.

### `hub-staff-session`

Fresh staff authentication is native-only and online:

1. `begin` receives only active device/staff IDs and returns a short-lived,
   device-bound nonce after source/device/staff rate limiting.
2. The Android native sign-in surface captures the PIN; no Capacitor method
   receives it.
3. `complete` receives the nonce, device signature, and PIN over HTTPS. The
   receiver verifies device proof, calls the accepted R002 credential/lockout
   primitive, creates a `hub_staff_sessions` assertion, and returns a newly
   signed bundle/session result.

Only an already-issued unexpired session may continue during a WAN outage.
Fresh login safely stops offline in the first release. The receiver never logs
the PIN, its result, a session bearer, or an unsupported credential value.

### `hub-sync`

The Hub sends a bounded base64url payload of already committed events. The
signed request envelope is intentionally independent of JSON field ordering:

```text
theplugos.sync.v1
{requestId}
{hubDeviceId}
{bundleId}
{issuedAt}
{payloadBase64}
```

Each line is UTF-8 with LF separators and no trailing newline. `issuedAt` uses
the canonical millisecond UTC representation. Signature encoding is base64url
of DER P-256 ECDSA; the shared protocol helper performs the strict DER/Web
Crypto conversion.

The receiver verifies that the Hub is the active device for its branch and that
the named bundle is current before it calls the transactional event ingest
function. It permits only the bounded, replication-only expired-bundle recovery
case defined in `LOCAL_FIRST_INVENTORY_AND_RENEWAL_CONTRACT.md`; it never uses
that case to authorize a new command. The ingest function checks every event's
tenancy, session, and expiry facts, deduplicates on `eventId`, rejects an
event-ID collision with different immutable content, projects the matching
stock movement atomically, and returns only durable acknowledged IDs. The Hub
retains every other outbox row. The same contract permits a bounded,
same-device delivery bridge for a recently superseded bundle only when Android
must recover the current issued bundle after an interrupted installation.

ADR-012 further binds each acknowledgement to the exact contiguous receiver
group that produced it. The Edge Function validates the entire batch for
duplicate event IDs before any receiver call, then rejects a non-string,
duplicate, unknown, or cross-group acknowledgement. Android repeats the
submitted-batch check before it marks an exact local outbox row acknowledged.

## Bundle issuance

The Edge issuer creates a raw UTF-8 JSON payload, base64url encodes it, signs
the decoded payload bytes, records its metadata/digest as the active bundle,
and returns the exact envelope. The Android app pins the issuer public key by
key ID in its release build configuration. The private issuer JWK lives only in
the Edge Function secret store.

The payload includes the active branch's device keys, valid staff session
assertions, VAT setting, and branch/business-wide catalog snapshot. It does not
include PINs, credential hashes, bearer tokens, device private keys, or TLS
private material.

## Required controls

- Hash source identifiers before storing a throttle bucket; do not retain raw
  IP addresses for rate limiting.
- Permit browser CORS only at the owner code endpoint and only for a configured
  exact HTTPS owner-portal origin. Native proof endpoints have no CORS path.
- Perform database mutation through `SECURITY DEFINER` service-only functions
  with an empty search path and explicit grants; RLS is defense in depth.
- Cap request body, catalog, event batch, ID, string, and timestamp sizes.
- Use generic authentication failures and do not disclose whether a staff,
  pairing code, challenge, device, or bundle exists.
- Write security/audit facts in the same transaction as a consumed code,
  session issuance, revocation, or event ingestion.
- Never clear the native outbox due only to transport reconnection or HTTP 2xx
  without acknowledged event IDs.
- Reject a duplicate outbound event ID before any receiver runs, and reject a
  receiver acknowledgement that is not a unique member of that exact receiver
  group.
- Reject catalog-bearing authorization-bundle installation while the Hub has
  unacknowledged operational events; the Hub must drain its outbox first.

## Acceptance evidence

- Invalid code/proof/nonce/source throttle paths change no device or branch
  authority facts.
- Completing the exact same enrollment request is idempotent; a different
  request cannot consume its challenge or code.
- A replacement Hub revokes the prior Hub and invalidates old session/bundle
  authority through the revocation version.
- An active Hub can send a valid event batch twice and receives one durable
  business effect with the same acknowledgement IDs.
- A foreign branch/device, expired bundle, modified payload, malformed DER,
  or event-ID collision is rejected without partial ingestion.
- A duplicate batch ID, duplicate acknowledgement, or acknowledgement from a
  different receiver group is rejected while the affected outbox entries stay
  retryable.
- Native fresh PIN login is source/device throttled, uses R002 lockout state,
  and exposes no PIN or credential material to the browser or logs.
- An authenticated owner can issue one short-lived code for its own active
  branch, while a foreign owner/origin cannot distinguish an invalid branch
  from any other rejected request.
