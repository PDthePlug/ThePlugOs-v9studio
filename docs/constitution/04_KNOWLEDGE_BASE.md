# ThePlugOS Constitutional Knowledge Base

## Core Concepts & Definitions
- **Local-First Architecture:** The primary mode of operation occurs on a local shop network without requiring internet.
- **Hub-and-Spoke Local Model:** Cashier app acts as the Hub (local server/WebSocket host), Kitchen app acts as the Spoke (client).
- **Event Sourcing:** Every change is recorded as an immutable event (e.g., `ORDER_CREATED`, `STATUS_UPDATED`).
- **Internal Intelligence Engine:** A localized, rule-based SQL aggregation engine that provides insights (e.g., busy hours, stock burn rate) without external AI.
- **Kota Matrix (Menu Architecture):** Dynamic menu structure combining Base Items, Add-ons/Modifiers, and Pre-set Combos.
- **Denormalization (Price Snapshotting):** Storing product names and prices directly on the order line item to preserve historical accuracy.

## Relationships & Dependencies
- **Cashier App ↔ Kitchen App:** Connected via local WebSocket over LAN. Cashier holds the authoritative local event log.
- **Cashier App ↔ Cloud API:** Connected via internet (when available) for batch event synchronization (Outbox Pattern).
- **Owner Dashboard ↔ Cloud API:** Connected via internet to view aggregated metrics and manage central configurations (e.g., menus, staff).

## Assumptions & Explicit Rules
- **Assumption:** Township environments face unstable cellular networks and power interruptions (load shedding).
- **Rule:** Never use auto-incrementing IDs for operational data; use ULIDs or UUIDs.
- **Rule:** The kitchen tablet never talks directly to the internet/cloud.
- **Rule:** No AI in v1. Use rule-based reporting instead.
- **Rule:** All historical pricing must be immutable; menu price changes do not affect past orders.

## Future Implications
- **Phase 2 & 3 Expansion:** Architecture must naturally extend to support inventory tracking, multi-branch management, and customer QR ordering.
- **Township Commerce Platform:** The foundational system is designed to scale beyond fast food to other retail formats (spaza shops, bakeries, butcheries).
