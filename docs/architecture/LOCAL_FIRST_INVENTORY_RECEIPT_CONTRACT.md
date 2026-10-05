# Local-First Inventory Receipt Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Inventory and Renewal Contract
- **Depends on:** R003/R004 local-Hub authority, R007 inventory-receipt
  receiver source, native command-request bridge, and a valid signed catalog
  snapshot

## Purpose

A product balance must not rise because a Manager screen changes a local array.
This contract introduces one narrow physical-stock intake fact: a verified
Manager records the quantities they counted into the active branch. The Hub
derives the prior and resulting balance for each signed catalog product and
commits one immutable receipt.

```text
Manager counted delivery -> inventory.receive -> INVENTORY_RECEIVED
  -> inventory receipt + receipt lines + stock movement(s) + branch balance(s)
```

This is a counted quantity receipt. It is not a supplier invoice, purchase
order, cost, tax, payment, cash movement, approval, or cloud-delivery claim.

## Authority and request boundary

Only a verified native `MANAGER` session scoped to the active Hub business and
branch may request an inventory receipt. React supplies only a stable request
ID, a new receipt UUID, and selected product quantities:

```ts
{
  commandId: string;
  type: 'inventory.receive';
  payload: {
    receiptId: string;
    items: Array<{
      productId: string;
      quantity: number;
    }>;
  };
}
```

The native Hub never accepts a caller-supplied branch, business, device,
staff/session, price, cost, supplier, purchase-order, stock balance, movement
type, event ID, sequence, timestamp, or signature. Each line must identify one
distinct active signed catalog product and a positive quantity with no more
than three decimal places.

The normalized immutable event is deliberately small:

```json
{
  "id": "receipt UUID",
  "receiptId": "receipt UUID",
  "status": "RECEIVED",
  "items": [
    {
      "productId": "product UUID",
      "quantity": 12.000,
      "stockBefore": 8.000,
      "stockAfter": 20.000
    }
  ]
}
```

The Hub derives the `stockBefore` and `stockAfter` facts from SQLCipher's
measured signed catalog projection. It rejects an inactive product, duplicate
line, invalid quantity, missing catalog projection, invalid local balance, or
overflow before any receipt, event, audit fact, projection, or outbox item is
committed.

## Local and cloud atomicity

One accepted native command transaction writes the `INVENTORY_RECEIVED` event,
an `inventory_receipts` projection, every updated `catalog_products` stock
projection, command receipt, audit record, sequence advancement, and durable
cloud-outbox item together. It returns `APPLIED` only after that transaction
commits locally.

R007 adds cloud receipt and line tables and extends the existing branch stock
ledger. The cloud receiver independently verifies Hub/device/bundle/session
scope, Manager role, canonical event shape, receipt ID, line uniqueness,
catalog scope/status, exact expected `stockBefore`, derived `stockAfter`, and
event idempotency before it writes the receipt, receipt lines, movement rows,
balances, audit row, and acknowledgement in one database transaction.

Each `INVENTORY_RECEIVED` movement has an event ID and product ID uniqueness
boundary. An exact retry returns the existing acknowledgement without creating
a second receipt, movement, or balance change.

## Retry and recovery

Before signing, native code reserves the complete non-secret request. If a
Capacitor response is interrupted, the Manager surface may only retry that
same command ID, receipt ID, and line payload. It may ask native code to
abandon an uncommitted reservation only after native code proves no receipt
exists. That recovery action cannot delete a committed receipt, stock movement,
event, audit fact, projection, or cloud-outbox row.

## Renewal and visibility boundary

The existing catalog-bearing bundle replacement barrier applies unchanged: a
new bundle cannot replace a local stock snapshot while any operational outbox
event remains unacknowledged. A receipt accepted offline remains locally
committed and queued; the UI may say so, but it must never call it cloud
acknowledged, supplier approved, received by a purchase order, paid, or
reconciled.

The Manager task projection exposes only a product UUID, name, unit, and
current signed quantity. Price, tax, cost, supplier, purchase-order, cash,
customer, device, staff-session, and credential material are excluded.

## Non-goals

- No supplier directory, purchase order, invoice, cost, tax, accounts payable,
  cash payment, allocation, stock adjustment, waste, BOM consumption,
  transfer, count variance, return, void, or receipt printing.
- No staging, deployment, Supabase mutation, or production-release claim from
  this source implementation.

## Contract checks

Source checks must prove that only a Manager can receive stock, a Cashier
cannot create a receipt, duplicate product lines and invalid quantities fail,
the receiver rejects a stale balance without partial stock movement, an exact
retry leaves one receipt/movement set, and the Manager UI cannot mutate
Supabase directly or view financial/supplier facts. Physical delivery,
supplier-document reconciliation, and cloud evidence remain deferred until a
supported environment is available.
