# ThePlugOS Principles

## Constitutional Principles
- **The System is the Source of Truth:** The architecture is local-first, event-driven, and offline-resilient.
- **Resilience Over Everything:** The shop must keep running whether the internet works or not, whether the owner is present or not, and whether the rush is calm or chaotic.
- **Operational Clarity:** Minimum effort, maximum clarity. Fast under rush-hour load.

## Engineering Principles
- **Simplicity as a Feature:** The engineering design must work on cheap Android tablets and low-cost hardware.
- **Local-First by Design:** The system must continue operating without internet. Cloud sync is secondary to live shop function.
- **Event-Driven Communication:** Every meaningful action becomes an immutable event. This makes the system resilient and traceable.

## Product Principles
- **Not a Generic POS:** An operational control platform for high-speed, high-chaos food environments.
- **Speed First:** Every screen must be optimized for touch speed.
- **Actionable Intelligence:** Provide rule-based operational intelligence without relying on AI for core operations.

## System Principles
- **Hub-and-Spoke Local Architecture:** The cashier device acts as the local coordination hub, the kitchen device as a read-heavy display, and the cloud backend for reporting.
- **Event Sourcing:** Rebuild order state from the event stream.
- **Idempotency:** Every event must have a globally unique ID to handle retries safely.

## Architecture Principles
- **No External AI Dependency:** Operational intelligence is rule-based and deterministic.
- **Snapshot + Event Hybrid:** Use both event log for auditability/sync and current state tables for fast reads.
- **Branch Isolation:** Every operational record must include `branch_id` from the start.

## User Experience Principles
- **Large Targets:** Buttons, cards, and controls must be easy to tap on cheap tablets.
- **Low Cognitive Load:** Avoid clutter, nested menus, and unnecessary text.
- **Role-Based Simplicity:** Cashier, kitchen, and owner views expose only what each role needs.

## Business Principles
- **Recurring SaaS Product:** Generate recurring revenue with a subscription SaaS model.
- **Low Barrier to Entry:** Keep hardware costs minimized (cheap Android tablets, standard Wi-Fi routers).
- **Scale to Multi-Branch:** Provide owners with remote visibility, operational intelligence, and multi-branch management capabilities.

## Data Principles
- **Event-First Data Modeling:** Store each business action as an immutable event.
- **Price Snapshotting:** Historical orders must store the price at the time of sale.
- **Denormalization:** Store `productName` and price directly in the order to preserve history.

## Security Principles
- **Role-Based Access Control:** Differentiate access for cashier, kitchen, manager, and owner.
- **PIN Protection:** Require PIN for privileged actions (cancellations, edits).
- **Data Protection:** Encrypted cloud transport; sensitive admin functions must be logged.

## Operational Principles
- **Fast Order Handling:** Order creation should feel instantaneous (under 8 seconds).
- **Offline Resilience:** System must survive internet outages, local connection drops, and recover cleanly after restarts.
- **Queue-First Display:** Kitchen displays active queue, prioritizes orders, and supports tap-to-ready actions.

## Governance Principles
- **Phased Rollout:** Start with foundation (cashier, kitchen, owner dashboard), then add inventory, multi-branch, customer ordering in later phases.
- **Definition of Done:** MVP is complete when order capture is <8 seconds, kitchen sees updates in <500ms, and system survives offline with robust sync.

## Long-term Scalability Principles
- **Partitioning:** Implement cloud database partitioning (by month/branch) as data grows.
- **Branch Readiness:** System must be branch-aware from the beginning to support scaling to multiple stores.
- **Township Commerce Platform:** Architecture must extend beyond fast food to bakeries, spaza shops, and other township retail sectors.
