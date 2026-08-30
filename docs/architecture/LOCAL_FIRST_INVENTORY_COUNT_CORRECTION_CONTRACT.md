# Local-First Inventory Count-Correction Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Inventory and Renewal Contract
- **Depends on:** R003/R007 inventory authority, R008 count-correction
  receiver source, native command-request bridge, and a valid signed catalog
  snapshot

## Purpose

Physical stock sometimes differs from the signed local balance. This contract
introduces one narrow reconciliation fact: a verified Manager records the
final quantity physically counted for one or more active branch products. The
Hub derives the signed prior balance and immutable positive or negative
difference.

```text
Manager physical count -> inventory.adjust -> INVENTORY_ADJUSTED
  -> count correction + correction lines + stock movement(s) + branch balance(s)
```

This is a count correction only. It is not a supplier receipt, waste/loss
classification, purchase order, cost, tax, payment, cash movement, approval,
or cloud-delivery claim.

## Authority and request boundary

Only a verified native `MANAGER` session scoped to the active Hub business and
branch may request a correction. React supplies only a stable request ID, a
new correction UUID, the fixed first-release reason, and measured final
quantities:

```ts
{
  commandId: string;
  type: 'inventory.adjust';
  payload: {
    adjustmentId: string;
    reason: 'COUNT_CORRECTION';
    items: Array<{
      productId: string;
      stockAfter: number;
    }>;
  };
}
```

The native Hub never accepts caller-supplied business, branch, device,
staff/session, price, cost, supplier, stock-before, quantity difference,
movement type, event ID, sequence, timestamp, or signature. Each line must
identify one distinct active signed catalog product with a non-negative final
quantity (up to three decimal places). A line equal to the current signed
balance is rejected; no-op count corrections are not ledger facts.

The normalized immutable event is deliberately small:

```json
{
  "id": "adjustment UUID",
  "adjustmentId": "adjustment UUID",
  "status": "ADJUSTED",
  "reason": "COUNT_CORRECTION",
  "items": [
    {
      "productId": "product UUID",
      "stockBefore": 8.000,
      "stockAfter": 5.000,
      "quantityDelta": -3.000
    }
  ]
}
```

## Local and cloud atomicity

One accepted native command transaction writes the `INVENTORY_ADJUSTED` event,
an `inventory_adjustments` projection, every updated `catalog_products` stock
projection, command receipt, audit record, sequence advancement, and durable
cloud-outbox item together. It returns `APPLIED` only after that transaction
commits locally.

R008 stores the cloud correction header and line facts, extends the existing
branch stock ledger, and verifies Hub/device/bundle/session scope, Manager
role, exact event shape, reason, line uniqueness, catalog scope/status,
expected `stockBefore`, derived `quantityDelta`, resulting `stockAfter`, and
event idempotency in one database transaction. An exact retry returns the
existing acknowledgement without a second correction, movement, or balance
change.

## Retry and renewal boundary

Before signing, native code reserves the complete non-secret request. If a
Capacitor response is interrupted, the Manager surface may retry only the same
command ID, correction ID, reason, and line payload. Native code may abandon
only an uncommitted reservation after proving no receipt exists; it cannot
delete a committed correction, stock movement, event, audit fact, projection,
or cloud-outbox row.

The catalog-bearing bundle replacement barrier remains unchanged. A queued
correction prevents a fresh signed catalog snapshot from replacing the local
stock projection. The UI may say locally committed or queued for cloud; it may
not call the correction reconciled, approved, wasted, supplier-confirmed, or
cloud acknowledged without the corresponding authority.

## Non-goals

- No waste/spoilage/damage/expiry classification, supplier directory, purchase
  order, invoice, cost, tax, accounts payable, cash payment, allocation, BOM
  consumption, transfer, return, void, or receipt printing.
- No staging, deployment, Supabase mutation, or production-release claim from
  this source implementation.

## Contract checks

Source checks must prove a Cashier cannot create a count correction, only a
Manager may do so, duplicate products and no-op/invalid balances fail, a stale
cloud balance rejects without a partial movement, and an exact retry leaves
one correction/movement set. The Manager UI must not mutate Supabase directly
or expose financial/supplier facts. Physical counts and cloud evidence remain
deferred until a supported environment is available.
