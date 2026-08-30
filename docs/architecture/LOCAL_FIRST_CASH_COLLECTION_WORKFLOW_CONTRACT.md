# Local-First Cash Collection Workflow Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Order Transition Authority Contract
- **Depends on:** R004 transition authority, R005 cash capture, the native
  command-request bridge, and the native Kitchen workflow

## Purpose

An order marked `READY` is not automatically handed to a customer. This
contract completes the first cash-order lifecycle with an explicit, durable
Cashier collection transition:

```text
CASH capture committed -> Kitchen READY -> Cashier COLLECTED
```

The native Cashier workspace renders a bounded local collection queue from
committed Hub projections and requests the existing
`order.status.transition` to `COLLECTED`. A badge, printed slip, spoken
handover, browser click, or connectivity recovery is never a collection fact.

## Scope and authority

The Cashier sees only branch-scoped local orders whose immutable
`ORDER_PLACED` event belongs to the active Hub business and branch and whose
current projection is exactly:

```text
status = READY
paymentStatus = CAPTURED
```

The view exposes only the order UUID and state required to identify the
handover task. It excludes customer data, tender detail, payment amount,
cashier identity, staff/session/device IDs, credentials, signatures, and
cloud acknowledgement.

| Command | Verified actor | Required local state | Result |
| --- | --- | --- | --- |
| `order.status.transition` to `COLLECTED` | Cashier | `READY` and `CAPTURED` | `ORDER_STATUS_CHANGED`, updated projection, receipt, audit fact, and cloud-outbox event in one local transaction |

The native router rechecks the order scope, state, payment status, staff role,
session, sequence, and signature. R004 independently applies the same
Cashier/Manager collection rule at cloud ingest. A Kitchen Staff member cannot
use this collection queue or action.

## Request and retry rule

The React task input is limited to:

```ts
{
  commandId: string; // UUID stable across exact retry
  type: 'order.status.transition';
  payload: { orderId: string; status: 'COLLECTED' };
}
```

Native code reserves the complete non-secret request before signing. If the
response is interrupted, the Cashier can retry only that exact request or ask
native code to abandon its uncommitted reservation. The Hub validates current
session ownership and absence of a receipt before it removes the reservation.
It can never delete a committed collection event, order projection, audit fact,
or outbox record.

The UI must not create a replacement collection request for an order with an
unresolved native collection request.

## Failure handling

| Condition | Required behavior |
| --- | --- |
| `READY` order is still `PENDING` | do not expose it for collection; it must first receive a supported capture fact. |
| Replayed/changed command ID | return matching receipt for exact retry, otherwise reject without a second collection. |
| Kitchen or browser-selected role requests collection | reject at native router and R004 receiver; no partial write. |
| Cloud is unavailable | accepted local collection remains queued; UI says local/queued, never delivered or synced. |
| Stale local view | native transition check rejects and the UI refreshes measured state. |

## Non-goals

- No card/QR capture, refund, return, void, replacement order, receipt printer,
  customer notification, proof-of-physical-handover, or remote-device delivery
  claim.
- No staging, deployment, Supabase mutation, or production-release claim from
  this source implementation.

## Contract checks

Source checks must prove that the Cashier queue is branch-scoped and
`READY`/`CAPTURED` only, that it uses the existing native transition bridge
with exact retry/abandonment, and that R004 still accepts only a captured
Cashier collection event. Physical handover and release evidence remain
deferred until a supported environment is available.
