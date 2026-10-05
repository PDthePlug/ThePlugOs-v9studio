# Local-First Order Transition Authority Contract

- **Status:** Gate 2 implementation contract — source-only, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, and the Local-First
  Operational Command Contract
- **Depends on:** R003 local-Hub authority foundation and R004 order-transition
  authority hardening

## Purpose

An order status is an operational fact, not a display preference. This contract
defines who may make each state transition, the financial preconditions that
must hold, and the duplicate-safe local and cloud enforcement path. It closes
the unsafe gap where a valid signed Cashier command could request a
kitchen-owned state transition merely because it passed a generic command-type
permission check.

## Scope

This contract covers the first order workflow only:

```text
PLACED -> PREPARING -> READY -> COLLECTED
   |          |
   +----------+-> CANCELLED
```

`ORDER_PLACED` records a tender intent and stock reservation. It does **not**
record payment capture, settlement, a cash count, or a successful card/QR
provider result. The order therefore starts with `paymentStatus = PENDING`.

The R005 Cash Shift and Capture contract introduces a **cash-only**
`CAPTURED` fact and balanced financial postings. Card/QR capture, reversal,
refund, cashup, and close remain separate contracts. No path may present an
order as card/QR settled or completed outside those accepted facts.

## Authority matrix

The role comes only from the verified, expiry-bound native staff session. A
browser role, task payload, event payload, display name, or device ID is never
used as authority.

| Command/event | Allowed actor | Required existing state | Required financial state | Result |
| --- | --- | --- | --- | --- |
| `order.create` / `ORDER_PLACED` | Cashier | no local/cloud order with the ID | n/a | `PLACED`, `PENDING` tender intent and stock reservation |
| `order.status.transition` / `ORDER_STATUS_CHANGED` to `PREPARING` | Kitchen Staff | `PLACED` | `PENDING` or future `CAPTURED` | `PREPARING` |
| `order.status.transition` / `ORDER_STATUS_CHANGED` to `READY` | Kitchen Staff | `PREPARING` | `PENDING` or future `CAPTURED` | `READY` |
| transition to `CANCELLED` | Cashier from `PLACED`; Manager from `PLACED` or `PREPARING` | as stated | exactly `PENDING` | `CANCELLED`, one stock release |
| transition to `COLLECTED` | Cashier or Manager | `READY` | exactly `CAPTURED` | `COLLECTED` |

No other role, state, or transition is accepted. Owners and Administrators do
not receive a hidden operational bypass. Kitchen Staff cannot cancel; a
Cashier cannot mark preparation or readiness; a Manager cannot manufacture a
payment capture by changing the order state.

## Atomic local rule

The Hub command router obtains the current local order projection, checks the
matrix above, and emits a minimal transition payload:

```json
{
  "id": "order UUID",
  "orderId": "order UUID",
  "previousStatus": "PLACED",
  "status": "PREPARING"
}
```

The normal Hub transaction then writes the event, updated order projection,
receipt, audit record, session sequence, and cloud outbox entry together. A
cancellation also restores each original reservation in that same local
transaction. An invalid transition leaves no event, projection update, stock
movement, receipt, audit record, or outbox item.

The native bridge admits `shift.open` and cash-only `payment.capture` only
because R005 implements their routers and atomic contracts. The verifier must
not list card/QR capture, inventory, shift close, cashup, refund, or device
commands as permitted until their own handlers exist.

The native Kitchen workspace defined by
`LOCAL_FIRST_NATIVE_KITCHEN_WORKFLOW_CONTRACT.md` is a bounded rendering and
request surface for the two Kitchen-owned transitions only. It may show a
locally committed queue, but it does not prove notification, printer, remote
device, cloud, or physical-food delivery.

## Cloud replica rule

R004 adds a security-definer `BEFORE INSERT` trigger on `public.hub_events`.
The trigger reads the signed `hub_staff_sessions.role`, validates the event
action and state transition against this matrix, and checks the replicated
R001 order's payment state for cancellation or collection. This is an
independent receiver-side control: a compromised or older Hub cannot rely on a
local UI/router check to create an unauthorized replica event.

The receiver retains R003's event-ID/content-digest idempotency rule. A repeat
of the exact event returns its existing acknowledgement without running a
second stock release. An event-ID collision, wrong role, stale previous status,
or a status change that would collect/cancel a non-pending/non-captured order
is rejected before the R003 projection function runs.

## Safe-stop behavior around payment capture

Every new order begins `PENDING`. R005 may change that state to `CAPTURED`
only for a cash order inside a Manager-opened cash shift. Consequently,
`READY -> COLLECTED` remains unavailable for card/QR tender intents and every
other unverified payment state. This is a safety constraint, not an incomplete
status badge: customer handover requires a real, durable capture fact and its
balanced financial postings.

Cashier cancellation is limited to an unprepared, pending order. Manager
cancellation is limited to an unprepared or preparing, pending order. Once a
future payment capture occurs, cancellation must fail and use the separately
authorized refund/reversal workflow instead.

The native Cashier collection queue is defined in
`LOCAL_FIRST_CASH_COLLECTION_WORKFLOW_CONTRACT.md`. It exposes only locally
captured `READY` orders and requests the existing `COLLECTED` transition; it
does not prove physical handover, printing, notification, remote delivery, or
cloud acknowledgement.

The native pending-order cancellation workflow is defined in
`LOCAL_FIRST_PENDING_ORDER_CANCELLATION_CONTRACT.md`. It uses the existing
strict Cashier/Manager cancellation matrix and does not turn a cancellation
into a payment reversal, refund, or delivery claim.

## Failure handling

| Failure | Required behavior |
| --- | --- |
| Cashier requests `PREPARING` or `READY` | Reject locally and at cloud ingest; leave every durable fact unchanged. |
| Kitchen requests `CANCELLED` or `COLLECTED` | Reject locally and at cloud ingest; leave every durable fact unchanged. |
| Collection while payment is `PENDING` | Reject; no order status, receipt, or outbox update. |
| Cancellation after a future capture | Reject; require a refund/reversal command. |
| Retry of identical transition | Return the prior receipt; do not release stock twice. |
| Cloud rejection after a valid local commit | Retain the complete outbox event and surface reconciliation failure; never call it synced. |

## Contract checks

Source checks must prove that:

1. the native verifier lists only implemented command types;
2. the router has a role and payment-state gate for every supported transition;
3. R004 installs a `hub_events` trigger that rechecks signed staff role and
   payment state outside the Hub; and
4. the release-status document continues to say that payment capture and
   collection readiness are not delivered.

Runtime evidence remains required on an accepted staging clone and physical
Android devices before this contract can be promoted beyond source-only status.
