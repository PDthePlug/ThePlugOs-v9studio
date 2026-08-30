# ThePlugOS Standards

## Documentation Standards
- **Versioned Migrations:** All schema and event model changes must be versioned and backward compatible.
- **Architectural Blueprints:** Use C4 model (Context, Container, Component, Deployment) for architectural documentation.
- **API Contracts:** OpenAPI 3.1.0 specification with JSON Schema-compatible reusable components.

## Naming Conventions
- **Screen Components:** Suffix with "Screen" (e.g., `CashierHomeScreen`).
- **Shared Components:** Use descriptive nouns (e.g., `OrderCard`, `StatusBadge`).
- **Logic Components:** Suffix with "Manager", "Engine", "Service", or "Controller" (e.g., `QueueManager`).

## Folder Standards
- `apps/cashier`: Cashier tablet application
- `apps/kitchen`: Kitchen display application
- `apps/owner-dashboard`: Owner web dashboard
- `packages/ui`: Shared UI component library
- `packages/types`: Shared TypeScript definitions
- `packages/shared`: Shared utilities
- `packages/event-engine`: Event processing and syncing logic
- `services/api`: Cloud REST API
- `services/sync-engine`: Cloud synchronization service
- `infrastructure/docker`: Docker containers and compose files
- `infrastructure/deployment`: CI/CD and deployment configs

## Code Standards
- **React/React Native:** For touch UI and web dashboard.
- **TypeScript:** Preferred for type safety across apps and services.
- **Local Storage:** IndexedDB (Dexie.js/localForage) for web/PWA or SQLite for native.
- **Backend:** Node.js API layer with PostgreSQL.

## API Standards
- **REST-First:** For operational clarity and CRUD operations.
- **Event-Based Sync:** For reliability and offline reconciliation.
- **Idempotency Keys:** Mandatory for POST endpoints (e.g., `POST /orders`, `POST /events/batch`).
- **Standard Error Format:** Uniform JSON structure for errors with code, message, and details.

## Database Standards
- **Identifiers:** Use ULIDs for orders and events (sortable by time), UUIDs for static records (branches, users).
- **Core Entities:** Branch, User, Product, Modifier, OrderHeader, OrderLine, Payment, OrderEvent, SyncMarker.
- **Indexing:** Optimize for common queries (today's orders, active queue, pending syncs).
- **Data Retention:** Keep current business day active locally; compact/archive older records; cloud keeps long-term history.

## Testing Standards
- **Unit Tests:** Price calculation, modifier logic, state transitions, event deduplication.
- **Integration Tests:** Cashier-to-kitchen sync, offline queue recovery, cloud batch upload.
- **UI Tests:** Tap flow speed, menu usability, tablet resolution compatibility.
- **Failure Tests:** Internet loss, router disconnect, power restart, duplicate event replay.

## Deployment Standards
- **Local Shop:** One cashier tablet (Hub), one kitchen tablet (Spoke), one low-cost Wi-Fi router.
- **Cloud:** API server, Authentication service, PostgreSQL database, Reporting service.
- **Staged Releases:** Push app updates in controlled releases.

## Observability Standards
- **Logging:** Produce logs for order creation, ready confirmations, cancellations, sync success/failures, reconnects.
- **Monitoring:** Monitor sync failures and system latency (kitchen latency < 500ms, dashboard sync < 30s).
