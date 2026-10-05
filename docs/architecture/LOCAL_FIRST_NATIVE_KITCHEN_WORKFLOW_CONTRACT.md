# Local-First Native Kitchen Workflow Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Order Transition Authority Contract
- **Depends on:** R003 local Hub, R004 order-transition authority, and the
  native command-request bridge

## Purpose

This contract adds the first usable Kitchen surface without creating a second
source of order truth. The native Kitchen workspace renders a bounded,
branch-scoped view of committed local order projections and requests the two
already-authorized Kitchen transitions. It does not turn a browser component,
a push notification, or a printer acknowledgement into an operational fact.

```text
Committed local Hub projection
  PLACED     -- Kitchen: order.status.transition --> PREPARING
  PREPARING  -- Kitchen: order.status.transition --> READY
```

The status router and the independent R004 cloud receiver remain the only
authority for these transitions. The workspace is a task surface, not a
workflow engine.

## Scope and projection boundary

The Hub exposes a Kitchen session only the following non-secret facts for its
currently authorized business and branch:

| Field | Purpose | Deliberately excluded |
| --- | --- | --- |
| order UUID and current status | identify the local task and permitted next action | staff/session/device IDs, signatures, bundles, credentials |
| normalized item name and quantity | prepare the order | customer data, payment amount, tender, cashier identity, free-form notes |
| recoverable native request | exact retry after a lost UI response | any committed receipt or ability to edit the original request |

The native database proves the scope from the immutable local `ORDER_PLACED`
event before returning a projection. A projection that has no matching order
creation event for the active business and branch is not shown. This supports
older retained projections that predate explicit projection scope fields while
still failing closed for unrelated or malformed local data.

Only `PLACED` and `PREPARING` orders appear. `READY`, `COLLECTED`, and
`CANCELLED` orders are not a Kitchen queue. The view is a local measured
snapshot; it does not claim that another device received it, that a printer
printed it, or that cloud replication has been acknowledged.

## Command authority

| Current local status | Kitchen action | Native request | Result on accepted local commit |
| --- | --- | --- | --- |
| `PLACED` | Start preparation | `order.status.transition` to `PREPARING` | immutable `ORDER_STATUS_CHANGED`, updated local projection, receipt, audit fact, and outbox event |
| `PREPARING` | Mark ready | `order.status.transition` to `READY` | immutable `ORDER_STATUS_CHANGED`, updated local projection, receipt, audit fact, and outbox event |

The request payload contains only `orderId` and the exact target status. The
native runtime derives device, active staff session, sequence, timestamp,
signature, business, branch, and role. It rechecks the order's immutable local
scope and the R004 transition matrix before one SQLCipher transaction commits.

Kitchen Staff cannot create, cancel, collect, price, pay for, refund, assign,
or edit an order through this workflow. Cashiers and Managers retain only the
separate transitions defined by the Order Transition Authority Contract.

## Retry, interruption, and safe abandonment

Before signing, native code reserves the complete non-secret request. If the
Capacitor response is lost, the Kitchen workspace may submit the identical
`commandId`, type, and payload again. A committed request returns its original
receipt as a duplicate and does not create another status change.

If a request has no receipt, the workspace may ask native code to abandon its
reservation. Native code verifies that the active session owns the intent and
that no receipt exists before deleting only the reservation. It can never
remove an event, projection, audit fact, or cloud-outbox record. The UI must
not make a replacement request for the same order while an unresolved native
transition request exists.

## Explicit non-goals

- No printer, KDS-device, SMS, WhatsApp, or push-notification delivery claim.
- No kitchen timing/SLA, bump history, collection, refund, or cancellation
  workflow.
- No cloud acknowledgement, remote-device delivery, or physical-food
  completion claim from a local status transition.
- No staging, deployment, production database mutation, or production release
  claim from this source implementation.

## Failure handling

| Condition | Required behavior |
| --- | --- |
| No authenticated native Kitchen session | show no queue and accept no command. |
| Malformed, unscoped, cross-branch, or unsupported projection | omit/reject it; do not render a guessed ticket. |
| Status is no longer the expected local state | native router rejects without a partial write; refresh measured state. |
| Lost UI/native response | preserve and offer exact retry or native-confirmed abandonment only. |
| Cloud link unavailable | keep the committed event in the outbox; say queued locally, never delivered or synced. |

## Contract checks

Source checks must prove that:

1. the native operator context exposes only bounded, branch-scoped Kitchen
   task facts;
2. `order.status.transition` is recoverable for the current native session;
3. the Kitchen UI can request only `PLACED -> PREPARING` and
   `PREPARING -> READY` through the native bridge; and
4. R004 still rejects a non-Kitchen actor or stale transition at the receiver.

Physical-device, network, and release evidence remain deferred until a
supported environment is available. They are not represented as completed by
this contract.
