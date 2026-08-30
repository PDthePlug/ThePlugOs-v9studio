# Local-First Inventory Waste Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Inventory and Renewal Contract
- **Depends on:** R003/R008 inventory authority, R009 waste receiver source,
  native command-request bridge, and a valid signed catalog snapshot

## Purpose

This contract introduces one narrow unusable-stock fact: a verified Manager
records a positive physical quantity that must leave the active signed branch
balance due to spoilage, damage, or expiry. The Hub derives the prior and
resulting balances; the client cannot claim a cost, supplier, return, or
financial result.

```text
Manager waste record -> inventory.waste -> INVENTORY_WASTED
  -> waste header + waste lines + stock movement(s) + branch balance(s)
```

## Authority and request boundary

Only a verified native `MANAGER` session scoped to the active Hub business and
branch may request waste. React supplies only a stable command ID, a new waste
UUID, one fixed reason for the record, and positive product quantities:

```ts
{
  commandId: string;
  type: 'inventory.waste';
  payload: {
    wasteId: string;
    reason: 'SPOILAGE' | 'DAMAGE' | 'EXPIRED';
    items: Array<{
      productId: string;
      quantity: number;
    }>;
  };
}
```

The native Hub never accepts caller-supplied business, branch, device,
staff/session, price, supplier, cost, tax, stock-before, stock-after, movement
type, event ID, sequence, timestamp, or signature. Each line must name one
distinct active signed catalog product and a positive quantity with at most
three decimals. The Hub rejects an unavailable product, a duplicate product,
or a quantity greater than the current signed balance.

The normalized immutable event is deliberately small:

```json
{
  "id": "waste UUID",
  "wasteId": "waste UUID",
  "status": "RECORDED",
  "reason": "SPOILAGE",
  "items": [
    {
      "productId": "product UUID",
      "quantity": 3.000,
      "stockBefore": 8.000,
      "stockAfter": 5.000
    }
  ]
}
```

## Local and cloud atomicity

One accepted native command transaction writes the `INVENTORY_WASTED` event,
an `inventory_waste` projection, every updated `catalog_products` stock
projection, command receipt, audit record, sequence advancement, and durable
cloud-outbox item together. It returns `APPLIED` only after that transaction
commits locally.

R009 stores immutable waste header and line facts and checks Hub/device/bundle/
session scope, Manager role, exact event shape, allowed reason, line
uniqueness, catalog scope/status, expected `stockBefore`, positive quantity,
and resulting `stockAfter` in one server transaction. An exact retry returns
the existing acknowledgement without another waste record, movement, or
balance change.

## Retry and renewal boundary

Native code preserves the exact non-secret request before signing. An
interrupted response can retry only the same command ID, waste ID, reason, and
line payload. Native code can abandon only an uncommitted request after proving
there is no receipt; it cannot remove a committed waste record, stock movement,
event, audit fact, projection, or outbox row.

A queued waste event still blocks a catalog-bearing bundle replacement. The UI
may state locally committed or queued for cloud; it may not call the record
approved, costed, supplier-confirmed, tax-adjusted, disposed, or cloud
acknowledged without a separately authorized fact.

## Non-goals

- No supplier claim, purchase order, invoice, cost, tax, accounts payable,
  cash payment, financial-loss calculation, disposal certificate, return,
  void, BOM consumption, transfer, receipt printing, or cloud delivery claim.
- No staging, deployment, Supabase mutation, or production-release claim from
  this source implementation.

## Contract checks

Source checks must prove a Cashier cannot create waste, only a Manager may do
so, a stale or insufficient cloud balance has no partial effect, duplicate
lines fail, and an exact retry produces one waste/movement set. The Manager UI
must not directly mutate Supabase or expose supplier or financial facts.
Physical counts and cloud evidence remain deferred until a supported
environment is available.
