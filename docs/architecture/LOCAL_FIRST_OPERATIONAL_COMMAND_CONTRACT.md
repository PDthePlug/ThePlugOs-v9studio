# Local-First Operational Command Contract

- **Status:** Gate 0 contract
- **Date:** 15 August 2026
- **Applies to:** Cashier Hub, paired terminals, cloud receiver, and all role workspaces
- **Authority:** ADR-003

## Purpose

This contract defines the minimum authoritative path for an operational action.
It prevents a React component, browser JWT, local array, or connectivity badge
from becoming the source of truth.

## Trust boundaries

| Boundary | May do | Must not do |
| --- | --- | --- |
| Native paired terminal | Collect input; hold device key; submit a signed command; render measured projections | Write operational records directly; decide its own permissions; claim cloud delivery |
| Cashier Hub | Verify device/session/role; run atomic local transaction; publish committed local events; maintain outbox | Trust a caller-supplied business, branch, role, device ID, or success result |
| Cloud command/sync receiver | Verify hub authority; deduplicate; persist replicated events and acknowledgements; issue revocation/configuration facts | Mutate historical facts on behalf of an unverified client |
| React experience layer | Present state and request commands | Derive financial, stock, sync, or authorization truth independently |

## Command envelope

Every command must contain these fields. The Hub derives effective tenancy and
authority from the verified session rather than trusting repeated payload data.

```ts
type OperationalCommand = {
  commandId: string;            // globally unique, stable across retry
  type: string;                 // e.g. order.create
  issuedAt: string;             // ISO-8601 UTC
  deviceId: string;             // verified against signed challenge
  staffSessionId: string;       // verified, expiry-bound, revocable
  sequence: number;             // monotonic per terminal session
  payloadBase64: string;        // base64url of bounded UTF-8 JSON object
  signature: string;            // device proof of possession
};
```

The command result is `APPLIED`, `DUPLICATE`, `REJECTED`, or `UNAVAILABLE`.
`APPLIED` means the local transaction committed; it does not mean cloud delivery
or external payment capture. A duplicate submitted under matching active
authority returns the original receipt; it never repeats its business effect. A
command ID reused with different signed bytes is rejected. The concrete raw-byte
signature encoding is defined in `NATIVE_HUB_ENROLLMENT_AND_SYNC_PROTOCOL.md`;
a JSON reserialization is never used as a signature substitute.

## Atomic local commit

For every accepted command, one SQLite transaction must:

1. verify device/session proof, record the command receipt or return the matching existing receipt;
2. validate current branch state and domain invariants;
3. append immutable event records with globally unique event IDs;
4. update current-state projections;
5. record audit facts;
6. append one or more cloud-outbox records; and
7. commit before notifying another terminal or rendering success.

If any step fails, the command is rejected and no partial order, payment,
stock movement, audit record, or outbox item remains.

## Initial command families

| Family | Required atomic facts |
| --- | --- |
| `order.create` | order header, price/tax snapshots, stable line items, payment intent/tender facts, stock reservation or movement, audit event, kitchen outbox event |
| `order.status.transition` | authorized state transition, actor, timestamp, kitchen/cashier event, immutable transition audit |
| `payment.capture` / `payment.refund` | provider/tender evidence, idempotency, balanced financial postings, order transition, audit and replication events |
| `inventory.receive` | Manager-counted active-product quantity, derived before/after balance, immutable receipt and movement, actor, audit and replication events |
| `inventory.adjust` | Manager-counted final active-product balance, derived signed difference, immutable count correction and movement, actor, audit and replication events |
| `inventory.waste` | Manager-recorded physical unusable quantity, fixed reason, derived stock balance, immutable movement, audit and replication events |
| `inventory.void` | source-document reversal, actor, resulting balance, audit and replication events |
| `shift.open`, `shift.close`, `cashup.submit`, `cashup.approve` | active-shift validation, float/counts, variance, approval authority, financial postings, audit and replication events |
| `device.pair`, `device.revoke`, `staff.session.*` | server-authoritative enrollment/revocation/lockout facts plus local authorization-bundle refresh |

For the currently implemented order lifecycle, the exact role, state, payment,
and cloud-replica rules are defined in
`LOCAL_FIRST_ORDER_TRANSITION_AUTHORITY_CONTRACT.md`. A generic command type
permission never substitutes for that transition matrix.

The first cash-custody and cash-capture path is defined in
`LOCAL_FIRST_CASH_SHIFT_AND_CAPTURE_CONTRACT.md`. It is deliberately limited
to a Manager-opened cash shift and cash tender; no UI selection may stand in
for a card/QR provider capture or a completed financial settlement.

## Event envelope

Every locally committed event includes `eventId`, `commandId`, `aggregateType`,
`aggregateId`, `businessId`, `branchId`, `deviceId`, `staffId`, `sequence`,
`occurredAt`, `schemaVersion`, and an immutable domain payload. Sensitive
secrets, PINs, raw credential hashes, and access tokens are never event data.

Events are ordered by the Hub's durable branch sequence. Cloud replication
preserves the event ID and sequence; it does not generate a replacement event
for a client retry.

For a terminal-originated command, the local event and audit facts retain the
terminal's device ID. The cloud receiver accepts delivery only under the active
Hub identity, so the outbox envelope uses the Hub device ID for that delivery
hop. Its `staffSessionId` binds the original terminal to R014's
`command_device_id`; delivery authority must never be mistaken for the local
command actor.

## Sync and recovery rules

- Outbox removal requires an acknowledged event ID from the receiver.
- An event that cannot be acknowledged stays queued with retry/error metadata.
- A restart replays committed local projections and retains unsent outbox work.
- Conflicts are explicit inbox records; they never silently overwrite the Hub's
  authoritative event history.
- Local terminal delivery acknowledgement is separate from cloud acknowledgement.
- A UI may display `Local committed`, `Queued for cloud`, `Cloud acknowledged`,
  `Delivery failed`, or `Unavailable`; it may not collapse these into `synced`.

## Security rules

- A device ID alone is never authority.
- A staff role array in client state is never authority.
- Permission checks use the verified device, signed authorization bundle,
  staff session, business, branch, role, command type, expiry, and revocation
  version.
- Offline authority expires. The Hub must surface approaching expiry and must
  follow the documented safe-stop policy after it expires.
- PIN values, credential hashes, private keys, bearer tokens, and raw
  production/staging data must not enter logs, events, browser storage, or chat.

## Contract test matrix

Before implementation merges, tests must cover:

- repeat of the same signed command returns one receipt and one business effect;
- reuse of a command ID with different signed bytes is rejected without a business effect;
- two terminals cannot cross business or branch boundaries;
- a Cashier cannot invoke Manager/Owner commands;
- an expired, revoked, or unpaired device is rejected;
- a rejected command produces no partial local state;
- cloud failure retains the complete outbox entry;
- recovery delivers a complete Cashier-to-Kitchen ticket exactly once in
  business effect; and
- status copy is derived from measured receipt/outbox/acknowledgement data.
