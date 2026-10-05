# Local-First Pending Order Cancellation Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Order Transition Authority Contract
- **Depends on:** R004 order-transition authority, the native command-request
  bridge, native Cashier/Manager station boundaries, and the cash-shift-close
  contract

## Purpose

An unresolved pending order must be explicitly cancelled before its stock
reservation or cash-shift obligation can disappear. This contract makes the
existing authorized `order.status.transition -> CANCELLED` available through
the native role surfaces that own it:

| Verified role | Eligible order state | Payment state | Result |
| --- | --- | --- | --- |
| Cashier | `PLACED` | `PENDING` | Cancel its own unprepared local cash order and restore its reserved stock. |
| Manager | `PLACED` or `PREPARING` | `PENDING` | Cancel a branch-scoped pending order and restore its reserved stock. |

`READY`, `COLLECTED`, or `CAPTURED` orders cannot use this path. They require
separate delivery, reversal/refund, or other explicit authority; the native
surfaces never disguise a cancellation as a refund.

## Scope and projection boundary

The Cashier works from their existing locally committed cash-pending queue.
The Manager receives a bounded branch-scoped queue constructed only from an
immutable local `ORDER_PLACED` event and a current projection with:

```text
paymentStatus = PENDING
status = PLACED | PREPARING
```

The Manager queue exposes only order UUID and state. It does not expose price,
tender, cash count, customer, staff/session/device, credential, signature, or
cloud-acknowledgement data. The queue is a task view, not cancellation
authority: native router and R004 cloud checks independently prove the role,
scope, prior status, payment state, sequence, and signature.

## Request and exact retry

The React request carries no identity, tenancy, financial, or stock decision:

```ts
{
  commandId: string;
  type: 'order.status.transition';
  payload: { orderId: string; status: 'CANCELLED' };
}
```

Native code reserves this complete non-secret request before signing. An
interrupted response may retry only the exact request or ask native code to
abandon an uncommitted reservation after confirming no receipt exists. It may
never replace a pending request with a new cancellation ID, or delete a
committed cancellation event, stock projection, audit fact, or outbox entry.

If a Kitchen transition changed the order while a cancellation request was
interrupted, the exact request is safely rejected on retry and remains
available for explicit native abandonment. The UI must not construct a new
request based on a stale task card.

## Cash-shift relationship

A cash-shift close blocks while an order bound to it remains pending. An
accepted cancellation removes that pending obligation through its authoritative
order projection and stock restoration. A Manager can then refresh measured
Hub state and count/close the drawer; no UI shortcut treats an attempted or
queued cancellation as a resolved order.

## Non-goals

- No cancellation after capture, cash reversal, refund, void-after-capture,
  return, replacement order, card/QR settlement, customer notification,
  receipt printing, physical-delivery, or cloud-acknowledgement claim.
- No staging, deployment, Supabase mutation, or production-release claim from
  this source implementation.

## Contract checks

Source checks must prove role/state/payment restrictions at R004, Manager
branch scoping and data minimization, Cashier/Manager exact retry and safe
abandonment, stock-restoration routing, and the absence of direct browser
Supabase mutation. Physical operations and cloud acknowledgement remain
deferred until a supported environment is available.
