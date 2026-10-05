# Native Hub Enrollment, Authorization Bundle, and Sync Protocol

- **Status:** Gate 0 protocol contract
- **Date:** 15 August 2026
- **Applies to:** Android Cashier Hub, paired Android terminals, cloud enrollment, and cloud event receiver
- **Authority:** ADR-003 and `LOCAL_FIRST_OPERATIONAL_COMMAND_CONTRACT.md`

## Scope and safety boundary

This protocol is the only way a device becomes an operational Cashier Hub or a
paired shop terminal. It does not authorize any R002 deployment, production
write, or browser-held device identity. Until the cloud receiver and its issuer
key are staged and accepted, the Android host remains deliberately unavailable.

The cloud owns enrollment, suspension, revocation, PIN verification, and bundle
issuance. The Hub owns durable local command commits during the bundle's valid
offline window. A LAN address, a device ID, a browser local-storage value, or a
role selected in a UI is never authority.

## Device keys and TLS identity

Each Android runtime creates two independent non-exportable P-256 Android
Keystore key pairs:

| Key | Use | Leaves device? |
| --- | --- | --- |
| Hub/terminal signing key | Enrollment proof, signed local commands, LAN challenge response | Public key only |
| Hub local-TLS key | Self-signed local WebSocket server certificate | Public certificate and SHA-256 fingerprint only |

The Hub's TLS private key is not generated in cloud, copied into a bundle, or
stored in JavaScript. A cloud-signed bundle pins the Hub certificate fingerprint.
Paired terminals accept that certificate only when its fingerprint agrees with
the current signed bundle; ordinary CA trust or a LAN hostname is insufficient.

## Online enrollment sequence

1. An owner-authenticated cloud action creates a short-lived, single-use pairing
   code for one business and branch. It never returns its stored hash.
2. The native device sends `begin-enrollment` with the code, its signing public
   key, TLS certificate/fingerprint, request ID, and minimal non-secret device
   metadata over HTTPS.
3. The receiver applies source-aware and code/device rate limits, verifies the
   pairing code, and returns a short-lived nonce bound to the full request.
4. The device sends `complete-enrollment` with a P-256 signature over the
   exact challenge byte string below. The receiver verifies proof of possession,
   consumes the pairing code atomically, records the trusted device, and issues
   a signed authorization bundle.
5. The Android runtime verifies the issuer signature against a pinned public
   key, checks that the bundle names its own signing key and TLS certificate,
   and atomically replaces the SQLCipher authorization facts. Its own native
   station may accept commands only after those facts are valid and the
   foreground Hub service is live. It then attempts to start the TLS listener;
   a paired terminal is accepted only after that listener starts successfully.
   A listener failure is reported as unavailable peer transport, never as a
   reason to invent a LAN connection or discard the valid local ledger.

The enrollment challenge byte string is UTF-8 with LF separators and no trailing
newline:

```text
theplugos.enrollment.v1
{requestId}
{challengeId}
{nonceBase64url}
{hubSigningPublicKeyBase64}
{hubTlsCertificateSha256}
```

All public-key, certificate, nonce, payload, and signature wire fields use
unpadded Base64URL. All IDs are UUIDs or server-issued opaque IDs. All timestamps use exactly
`YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. The receiver rejects duplicate/mismatched
request fields, expired challenges, missing proof, and any device/key conflict.

## Signed authorization bundle

The server returns this outer envelope:

```json
{
  "schemaVersion": 1,
  "issuerKeyId": "issuer-2026-01",
  "payloadBase64": "base64url(UTF-8 JSON payload)",
  "signature": "base64url(ECDSA-SHA256 over decoded payloadBase64 bytes)"
}
```

The signed payload is stored exactly as received. Signing raw decoded payload
bytes, rather than a reserialized JSON object, prevents differences in key
ordering, Unicode escaping, or numeric rendering from changing the signature.

The signature encoding is base64url of an ASN.1 DER ECDSA signature. Android's
`SHA256withECDSA` uses DER while Web Crypto returns the fixed-width P-256
`r || s` form, so the Edge receiver/issuer must perform strict, lossless
conversion at that boundary. `supabase/functions/_shared/hub-protocol.ts` is
the executable reference; permissive ASN.1 parsing or a reserialized payload
is not permitted.
Its required fields are:

```ts
type AuthorizationBundleV1 = {
  schemaVersion: 1;
  bundleId: string;
  businessId: string;
  branchId: string;
  hubDeviceId: string;
  hubSigningPublicKeyBase64: string;
  hubTlsCertificateSha256: string; // lowercase SHA-256 of DER certificate
  issuedAt: string;                // exact canonical UTC format
  expiresAt: string;               // exact canonical UTC format
  revocationVersion: number;
  pairedDevices: Array<{
    deviceId: string;
    name: string;
    role: 'CASHIER' | 'KITCHEN_STAFF' | 'MANAGER' | 'OWNER' | 'ADMINISTRATOR';
    publicKeyBase64: string;
    connectionType: 'LAN_WIFI';
  }>;
  staffDirectory: Array<{
    staffId: string;
    name: string;
    role: 'CASHIER' | 'KITCHEN_STAFF' | 'MANAGER' | 'OWNER' | 'ADMINISTRATOR';
  }>;
  staffSessions: Array<{
    sessionId: string;
    staffId: string;
    deviceId: string;
    role: 'CASHIER' | 'KITCHEN_STAFF' | 'MANAGER' | 'OWNER' | 'ADMINISTRATOR';
    expiresAt: string;
    revocationVersion: number;
  }>;
  configuration: {
    vat: { enabled: boolean; rate: number };
    catalogProducts: Array<{
      id: string;
      name: string;
      category: string;
      price: number;
      stockQuantity: number;
      unit: string;
      branchId?: string; // absent only for a business-wide item
      status: 'ACTIVE' | 'ARCHIVED';
    }>;
  };
};
```

The payload has no PIN, password, bearer token, TLS private key, credential
hash, or pairing code. The `hubDeviceId` entry in `pairedDevices` must have the
same public key as `hubSigningPublicKeyBase64`. All session device IDs must name
an entry in `pairedDevices`, and every session revocation version must equal the
bundle revocation version.

`staffDirectory` is the active, non-secret branch roster used only by the
native sign-in surface to select a staff identity before its online PIN check;
it contains no credential or session-bearer material. `configuration` is a signed branch snapshot, not browser cache. The Android
Hub replaces only `catalog_products` and `configuration` projections atomically
on renewal; it never deletes locally committed orders, receipts, events, audit
facts, or queued cloud events. A product with a nonempty `branchId` must match
the bundle branch. The bundle size limit and catalog ceiling are enforcement
limits, not an invitation to send unbounded store data.

On renewal, the Hub replaces the active bundle, paired-device facts, and staff
sessions in one SQLCipher transaction. It does not merge old authority facts.
Because the bundle also carries a catalog balance snapshot, its installation is
blocked while the local operational outbox is non-empty. The Hub must first
obtain exact cloud acknowledgements for pending events; otherwise it retains
the old bundle and local stock state. The complete stock and recovery rules are
defined in `LOCAL_FIRST_INVENTORY_AND_RENEWAL_CONTRACT.md`. That contract also
defines the bounded delivery-recovery bridge used when cloud issuance succeeds
but Android installation is interrupted before the new bundle is persisted.

## Native staff-session activation

`staffSessions` are issuer-signed offline continuation assertions, not a
browser-selected role. A fresh staff PIN verification is initiated only in the
native Android sign-in flow while the cloud receiver is reachable; the PIN is
not passed through a Capacitor/browser API, included in a bundle, or stored in
the local ledger. The receiver returns a signed session assertion bound to the
command device key, business, branch, active Hub, role, expiry, and revocation
version. The Hub stores the resulting active-session fact in SQLCipher and may
continue that already-issued session through WAN loss until its expiry.

For the Hub's own native screen, the signed bundle replacement flow in R003 is
used. For an admitted terminal, ADR-010/R014 use the compact
`hub-terminal-staff-session` assertion after the terminal has already passed
the local TLS challenge. The terminal verifies the issuer signature and sends
the exact envelope in `STAFF_SESSION`; the Hub verifies it again before adding
the session to its local ledger. A terminal role must equal the staff role and
may only be `CASHIER`, `KITCHEN_STAFF`, or `MANAGER`. The assertion is not a
bearer: every later command still needs the terminal's Keystore signature and
strict per-session sequence.

Consequently, a new or expired staff session safely stops when offline in the
first release. This deliberately prioritizes credential containment over an
offline-verifier cache of weak staff PINs. Offline shift-start capability may be
added only by a separately approved, device-encrypted verifier-capsule design.

## Local TLS transport

The Hub listens only after a valid bundle is active and its pinned certificate
fingerprint matches the Android Keystore certificate. The listener is required
for *paired terminal* commands, while the Hub's own native station can still
call the same local command boundary if peer transport cannot start. The
protocol uses TLS and an application-layer proof of possession:

1. Server sends `CHALLENGE` with a random 32-byte nonce and expiry.
2. Terminal responds `HELLO` with its `deviceId` and ECDSA signature of that
   raw nonce.
3. Hub verifies device state, branch scope, bundle freshness, and the public
   key in the active bundle, then returns `READY`.
4. Terminal sends a signed command. The Hub commits it before it sends a
   `COMMAND_RESULT` or broadcasts `EVENT_COMMITTED`.

The local endpoint is not discovered or advertised by a browser simulation.
Native discovery/QR handoff must carry a currently signed certificate fingerprint
and is a separate accepted implementation step.

## Signed operational command wire format

The concrete native wire envelope avoids JSON canonicalization ambiguity:

```json
{
  "commandId": "uuid",
  "type": "order.create",
  "issuedAt": "2026-08-15T10:00:00.000Z",
  "deviceId": "opaque-device-id",
  "staffSessionId": "opaque-session-id",
  "sequence": 42,
  "payloadBase64": "base64url(UTF-8 JSON object)",
  "signature": "base64url(ECDSA-SHA256 command bytes)"
}
```

Command bytes are the UTF-8 concatenation of these fields, in this exact order,
separated by one ASCII Unit Separator (`0x1F`) and with no trailing separator:

```text
commandId 0x1F type 0x1F issuedAt 0x1F deviceId 0x1F staffSessionId 0x1F sequence 0x1F payloadBase64
```

The Hub parses the decoded payload only after decoding bounded base64url data.
It verifies the device signature, derives tenancy and role from the bundle, then
does receipt lookup, sequence enforcement, event/projection/outbox/audit writes,
and receipt persistence in one local transaction. An exact signed retry returns
the original receipt as `DUPLICATE`; a reused command ID with different signed
bytes is rejected.

## Cloud replication and inbound facts

Outbound replication contains immutable committed events and their IDs, never
raw commands or device private material. The cloud receiver verifies the Hub
credential and scope, deduplicates on `eventId`, persists its acknowledgement,
then returns acknowledged IDs. The Hub marks only those outbox entries as
acknowledged; transport reconnection alone changes nothing. A still-active Hub
may use the bounded, replication-only expired-bundle recovery window defined in
`LOCAL_FIRST_INVENTORY_AND_RENEWAL_CONTRACT.md`; expiry still blocks new local
commands.

ADR-012 requires the Edge receiver to validate the whole signed batch before
its first database receiver call and to accept only unique acknowledgement IDs
from the exact action-family group that returned them. Android repeats its own
submitted-batch check before any local outbox state changes.

Inbound bundle renewals, revocations, configuration snapshots, and remote-owner
requests use a separately signed, acknowledged inbox. They never overwrite
historical events or silently clear the local outbox.

## Required acceptance evidence

- A mismatched issuer key, Hub public key, TLS fingerprint, branch, or expired
  timestamp leaves the Hub unavailable and changes no local authorization fact.
- A revoked or removed device cannot complete a local challenge after bundle
  renewal.
- One signed command and an exact retry produce one receipt, one event set, one
  projection change, one audit fact, and one cloud-outbox set.
- A command-ID collision with different command bytes is rejected.
- WAN loss still permits valid local commands; local peer delivery occurs only
  after a durable receipt; cloud acknowledgement later changes only matching
  outbox entries.
- A duplicate outbound ID, duplicate acknowledgement, or cross-group
  acknowledgement keeps the exact local outbox rows retryable and produces no
  delivery claim.
