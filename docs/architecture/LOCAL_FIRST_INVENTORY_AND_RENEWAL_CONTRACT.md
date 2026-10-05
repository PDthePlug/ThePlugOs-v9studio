# Local-First Inventory and Authority-Renewal Contract

- **Status:** Gate 2 implementation contract — not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational Command Contract, and the Cloud Hub Receiver Contract

## Purpose

This contract closes a correctness gap between a Cashier Hub's local stock
reservation and its cloud replica. A locally committed order must not be
treated as a completed payment, but it must reserve the signed stock snapshot
in the same durable transaction as its event, receipt, audit fact, and outbox
record. The cloud must later produce the same stock effect exactly once.

It also defines the renewal barrier that prevents a freshly issued catalog
bundle from overwriting locally committed, unacknowledged stock changes.

## Scope and non-goals

The first implementation covers only these event effects:

| Local command/event | Stock effect | Payment effect |
| --- | --- | --- |
| `order.create` / `ORDER_PLACED` | Reserve the ordered quantity | Record tender intent only |
| `order.status.transition` to `CANCELLED` | Release the original reservation once | None |
| `inventory.receive` / `INVENTORY_RECEIVED` | Increase a counted active-product branch balance once | None |
| `inventory.adjust` / `INVENTORY_ADJUSTED` | Reconcile an active-product balance to a Manager-counted final quantity once | None |
| `inventory.waste` / `INVENTORY_WASTED` | Remove a Manager-recorded unusable active-product quantity once | None |

Card, QR, cash capture, refunds, BOM, supplier and
purchase-order workflows, and financial postings are deliberately outside this
slice. They must not be represented as successful by the UI or projected as if
this contract had settled them.

## Inventory authority and data model

One active Cashier Hub is the sole branch operational writer. Its signed bundle
contains a branch-scoped catalog snapshot. The Hub derives every accepted line
name, unit price, tax, and stock balance from that snapshot; browser input only
selects an item and quantity.

The cloud keeps the branch-scoped current balance in
`inventory_branch_balances`, and appends a server-owned
`inventory_movements` row for every replicated reservation, release,
Manager-counted receipt, Manager count correction, or Manager-recorded waste.
R007/R008/R009 also store one immutable intake, correction, or waste header and
line per event. A movement contains
the immutable Hub event ID, business, branch, product, order-or-inventory
origin, movement type, signed quantity delta, balance-before, balance-after,
actor/session facts, and occurrence time. The legacy
`catalog_products.stock_quantity` remains product master-data compatibility
only; it is never used as a shared cross-branch operational balance.

`hub_events.event_id` is the idempotency key for the cloud stock effect. A
replayed event returns its existing acknowledgement and creates neither a
second movement nor a second balance change.

R003 seeds a branch-specific product's first balance from its R001 product
quantity. A business-wide product receives a zero balance in each branch until
a Manager records the narrow R007 counted receipt or R008 physical count
correction. Copying one global legacy quantity into multiple branch balances
would fabricate stock, so the migration deliberately fails safe instead.

## Order payload contract

For `ORDER_PLACED`, every normalized line carries exactly:

```ts
{
  productId: string;   // UUID
  name: string;        // derived from the signed local catalog
  price: number;       // derived from the signed local catalog
  quantity: number;    // positive, maximum three decimal places
  stockBefore: number; // signed local balance before this reservation
  stockAfter: number;  // exactly stockBefore - quantity
}
```

The native Hub rejects duplicate products in one order, unavailable/archived
products, a negative balance, unsupported precision, or a caller price/name
that differs from its signed catalog. It writes the normalized payload rather
than the browser request.

The cloud locks the catalog product row, verifies the same branch/business,
price, name, and expected `stockBefore`, applies `stockAfter`, and appends the
movement in the same transaction that stores the Hub event, order projection,
audit log, and acknowledgement. A stale or mismatched cloud balance rejects
the batch without a partial stock or order effect.

For a cancellation, the cloud locks and restores the authoritative order-line
products in a deterministic product-ID order. It accepts only the allowed
state transition; a duplicate or a second cancellation cannot restore stock
twice.

## Bundle-renewal barrier

The authorization bundle carries a catalog balance snapshot. Replacing that
snapshot while local stock events remain unacknowledged would erase a local
reservation or apply it twice. Therefore the first release uses a simple,
deterministic rebase barrier:

1. The Hub runs cloud replication before attempting enrollment replacement,
   renewal, or fresh native staff-session bundle installation.
2. A bundle containing catalog/configuration state may be installed only when
   its operational outbox is empty.
3. If any event remains unacknowledged, installation fails closed as
   `DEFERRED_UNTIL_SYNC`; the old valid bundle and encrypted local projections
   remain intact.
4. Once the receiver acknowledges every pending event, the next signed bundle
   replaces the catalog snapshot. Its cloud balance already includes those
   acknowledged movements, so no local rebase calculation is required.

This does not clear or mutate local event history. It only prevents an unsafe
replacement of the signed current-state snapshot.

## Bundle-delivery recovery

The cloud may record a renewed or fresh-session bundle before the Android
process has durably installed it. A process crash in that interval must not
strand the old encrypted ledger. For seven days, a still-active, unrevoked Hub
may use its immediately superseded bundle only to:

- replicate durable local events through the normal receiver checks; and
- prove possession of its existing device key and retrieve the current active
  bundle for that same Hub and branch.

It cannot enroll another Hub, bypass a revocation, choose a different branch,
or create a second authority chain. Once its outbox is empty, it installs the
retrieved current bundle atomically. A replacement or revoked Hub has no
delivery-recovery path because its device record no longer satisfies the
active-Hub check.

## Expired-bundle recovery

Expiry stops new operational commands and fresh local authority. It must not
silently discard a sale that was committed before expiry. While the Hub device
is still active and unrevoked, the cloud receiver permits replication-only
recovery for up to seven days after an active bundle expires, subject to all of
the following:

- the request itself has a fresh signed timestamp;
- every submitted event occurred no later than the expired bundle's expiry;
- every event still passes its original staff-session expiry, branch, device,
  event-ID, sequence, and payload checks; and
- the bundle is still the branch's active bundle and has not been revoked or
  superseded.

Recovery mode does not permit a new local command, an enrollment, a new staff
session, or a different Hub. A revoked or replaced Hub has no automatic
recovery upload path; its retained ledger requires an explicit forensic
recovery procedure. After acknowledged recovery drains the outbox, the active
Hub may renew its bundle and resume according to normal authority rules.

## Failure handling

| Failure | Required behavior |
| --- | --- |
| Local stock insufficient | Reject before any event, receipt, stock projection, audit fact, or outbox row is committed. |
| Cloud stock mismatch | Keep the complete local event queued and expose an explicit reconciliation failure; never mark it synced. |
| Cloud unreachable | Keep the local reservation, immutable event, and outbox row. |
| Bundle renewal while outbox is non-empty | Do not install the replacement bundle or replace local catalog state. |
| Bundle expired while events are queued | Stop new commands; attempt signed recovery replication only within the recovery window. |
| Device revoked/replaced | Reject new commands and automatic recovery replication. |

## Acceptance evidence

Before staging acceptance, demonstrate all of the following against a real
staging clone:

- a local `ORDER_PLACED` decrements exactly one local signed balance and one
  cloud balance/movement after retry-safe replication;
- an exact event retry produces one order, one movement, and one balance
  change;
- a cancellation restores the same quantity exactly once;
- a stale cloud balance rejects the batch with no partial order or movement;
- a pending outbox prevents bundle installation and preserves local stock;
- syncing the outbox before renewal yields an identical local/cloud balance;
- a still-active Hub can recover pre-expiry events during the bounded grace
  window, while a revoked Hub cannot; and
- the cashier interface says `Locally reserved` or `Queued for cloud`, never
  `paid`, `settled`, or `synced` without its corresponding authoritative fact.
