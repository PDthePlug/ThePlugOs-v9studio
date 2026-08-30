# 06. FastFood Reference Domain

## Purpose
A fully certified reference implementation demonstrating how to build a Township Fast-Food operating system on ThePlugOS.

## Scope
- **Entities:** Orders, Menu Items, Inventory, Kitchen Stations.
- **Events:** `ORDER_PLACED`, `PAYMENT_RECEIVED`, `ORDER_PREPARED`, `INVENTORY_DEPLETED`.
- **Workflows:** The lifecycle of an Order (Pending -> Prep -> Ready -> Complete).
- **Rules:** Inventory threshold alerts, pricing constraints.

## Architecture
- Exists strictly as a domain package.
- Modifies zero code in `@plugos/core` or `@plugos/sdk`.
- Fully offline-capable (CQRS based).
