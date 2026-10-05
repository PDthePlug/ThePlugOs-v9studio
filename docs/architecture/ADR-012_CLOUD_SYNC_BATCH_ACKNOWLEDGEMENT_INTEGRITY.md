# ADR-012 — Cloud sync batch acknowledgement integrity

- **Status:** Accepted source design
- **Date:** 28 August 2026
- **Applies to:** The native Hub durable outbox, `hub-sync` Edge Function,
  R003–R009 cloud receivers, and later recovery/reconciliation operations
- **Authority:** Engineering Charter, ADR-003, `CLOUD_HUB_RECEIVER_CONTRACT.md`,
  and the local-first inventory/renewal contract

## Context

The Hub commits an operational event, its local projection, command receipt,
audit fact, and outbox row in one SQLCipher transaction. Cloud delivery is a
separate replication step. A successful HTTPS connection, HTTP `2xx`, or an
unvalidated JSON response is not a durable acknowledgement.

`hub-sync` routes a bounded, signed batch to narrow database receivers by
contiguous event family. That preserves required event order, but it also
creates a boundary: an acknowledgement returned from one receiver must never
clear an outbox row that belonged to another receiver group in the same batch.
The Hub must fail closed if the response is malformed, duplicated, unknown, or
cross-group.

## Decision

### State machine

```text
OUTBOX_PENDING
  -> BATCH_SIGNED
  -> RECEIVER_GROUP_PENDING
  -> ACK_VALIDATED
  -> ACKNOWLEDGED

RECEIVER_GROUP_PENDING
  -> DELIVERY_FAILED
  -> OUTBOX_FAILED
```

1. The Hub selects ordered `PENDING`/`FAILED` outbox rows, serializes them
   once, and signs the exact base64url payload.
2. `hub-sync` verifies the outer Hub proof and rejects duplicate `eventId`
   values before it invokes a receiver.
3. Every receiver gets only its contiguous action-family group. Its
   `acknowledgedEventIds` values must be strings, unique, and members of that
   exact group. An empty list is permitted; an identifier outside the group,
   a duplicate identifier, or an invalid value rejects the entire HTTP
   response.
4. The Android Hub applies acknowledgements only when every returned value is
   a unique string from the submitted batch. It marks only those exact outbox
   rows `ACKNOWLEDGED` in one local transaction.
5. Any transport error, non-`ok` response, invalid acknowledgement, or
   receiver failure records an opaque failure reason and retains every
   unacknowledged outbox row for an exact later retry.

### Authority and recovery boundaries

- The Edge Function uses service-only RPCs only after native request proof;
  `verify_jwt = false` applies solely because these native endpoints do not
  send a browser Supabase JWT.
- R003–R009 receiver SQL remains the final authority for scope, expiry,
  idempotency, collision, and projection rules. The Edge validation narrows
  response handling; it does not grant a client new authority.
- Recovery mode is replication-only. It cannot authorize a new local command,
  clear an outbox row, replace an authorization bundle, or treat a reconnect
  as delivery.
- The response never carries a device key, session assertion, bundle, PIN,
  credential, or service credential.

## Failure modes

| Condition | Required result |
| --- | --- |
| Duplicate event ID in an outbound batch | Reject before any receiver call; no acknowledgement is returned. |
| Receiver acknowledges another group’s ID | Reject the response; retain all affected outbox rows. |
| Duplicate/non-string/malformed acknowledgement | Reject the response; retain all affected outbox rows. |
| Partial valid acknowledgement | Mark only its exact submitted IDs acknowledged; retain the rest. |
| HTTP error, timeout, malformed body, or lost response | Mark the submitted rows failed locally; exact events remain retryable. |
| Replay of an already ingested event | The database receiver returns the same durable event ID without creating another business effect. |

## Verification

R019 must prove in source that:

- `hub-sync` validates unique batch IDs and group-scoped acknowledgement IDs;
- Android accepts only unique string acknowledgement IDs from its submitted
  batch;
- local outbox acknowledgement and failure handling remain mutually exclusive;
- native `hub-sync` configuration is explicit and release deployment remains
  blocked while `RELEASE_STATUS.md` is `HOLD`; and
- no source test implies a deployed Function, live acknowledgement, backup,
  restore, or production acceptance.
