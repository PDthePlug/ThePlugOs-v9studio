# Local-First Cash Shift Close Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Cash Shift and Cash Capture Contract
- **Depends on:** R003/R004 local-Hub authority, R005 cash custody/capture,
  and the native command-request bridge

## Purpose

A drawer must not be treated as closed because a screen says so or because a
new shift is opened. A verified Manager records one physical cash count against
the Hub-derived expected balance:

```text
Manager shift.open -> Cashier cash capture(s) -> Manager physical count -> shift.close
```

The close event records the expected cash, counted cash, and resulting signed
variance atomically with the shift's `CLOSED` projection, audit fact, receipt,
and cloud-outbox event. It is a local count/reconciliation fact, not proof of
cash-up approval, bank deposit, printing, physical custody transfer, or cloud
acknowledgement.

## Scope and authority

Only an active native Manager session for the active Hub business and branch
may submit `shift.close`. The command input contains only a stable request ID,
the active shift UUID, and a non-negative counted-cash amount with two-decimal
ZAR precision:

```ts
{
  commandId: string;
  type: 'shift.close';
  payload: { shiftId: string; countedCash: number };
}
```

Native code does not accept a caller-supplied expected amount, variance,
currency, business, branch, device, staff/session, sequence, or signature. It
loads the measured active shift and cash-drawer projection, verifies its scope
and balance, then derives the immutable close event:

```json
{
  "id": "shift UUID",
  "shiftId": "shift UUID",
  "status": "CLOSED",
  "currency": "ZAR",
  "expectedCash": 575.00,
  "countedCash": 560.00,
  "cashVariance": -15.00
}
```

The cloud receiver independently rechecks Manager role, device/session scope,
the open shift, exact payload, expected balance, variance arithmetic, pending
orders, event time, idempotency, and sequence before it changes its copy of the
cash-shift record.

## Safe-close invariants

1. The supplied `shiftId` must be the active branch/HUB shift and its local
   cash-drawer balance must equal its committed `expectedCash`.
2. The Hub blocks close while any order bound to that shift remains in a
   pending payment state and is `PLACED`, `PREPARING`, or `READY`. Cashier or
   Manager must resolve/cancel it first through the native pending-order
   cancellation workflow; a close never strands a payable order behind a
   closed drawer.
3. `countedCash` is finite, non-negative, within the supported local limit,
   and has at most two decimal places. `cashVariance = countedCash - expectedCash`
   is derived, may be negative, and cannot be supplied independently.
4. The single Hub transaction writes the `SHIFT_CLOSED` event, updated
   `shifts` projection, closed branch marker, closed cash-drawer projection,
   receipt, audit fact, staff sequence, and cloud-outbox item. Failure leaves
   none of these partial facts behind.
5. A closed marker is not active authority. It lets a later `shift.open`
   command create the next custody period while the prior shift's immutable
   event and closed projection remain available for audit.

## Retry and recovery

Before signing, native code reserves the non-secret exact request for the
current Manager session. A disrupted response can only retry the exact
`commandId`, type, `shiftId`, and count or ask native code to abandon an
uncommitted reservation. A reservation is removed only when no receipt exists;
it cannot delete a committed close event, cash count, variance, projection,
audit fact, or outbox record.

## Non-goals

- No dual-control cash-up approval, bank deposit, paid-out/paid-in, refund,
  card/QR settlement, receipt printing, customer notification, or physical
  handover claim.
- No staging, deployment, Supabase mutation, or production-release claim from
  this source implementation.

## Contract checks

Source checks must prove that a Cashier cannot close a shift, a pending order
blocks the close, a count/variance is accepted only when derived from the open
shift, exact event retry does not create a second close, and a new opening is
permitted only after the current shift has closed. Physical count procedures,
cloud acknowledgement, and cash-up approval evidence remain deferred until a
supported environment is available.
