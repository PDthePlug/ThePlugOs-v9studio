# ADR-013 — Merchant Operational Surface V2

## Status

Accepted as a source-experience decision. This ADR does **not** change the product release status, native authority model, cloud-deployment status, or physical-device evidence boundary.

## Context

The local-first security spine established the Android Cashier Hub as operational authority and deliberately removed browser-created staff roles, command signatures, local ledgers, device identities, and direct operational table writes. That correction was necessary, but the hardened source had begun exposing internal engineering language directly to shop staff: signed snapshots, measured projections, local authority, outbox acknowledgement, native request recovery, and other implementation concepts.

Those concepts belong in architecture, evidence, logs, and diagnostics. They should not become the primary merchant workflow.

The product therefore needs two truths at once:

1. **The security truth remains unchanged.** Staff sessions, command sequence, device identity, signatures, event projection, durable retries, and safe abandonment remain native Hub responsibilities.
2. **The merchant experience becomes task-first again.** Cashier, Kitchen, and Manager see the work they are responsible for in the order they perform it.

## Decision

### 1. Shared merchant surface language

The active staff workspaces use a common warm ThePlugOS visual system with large touch targets, clear role identity, simple status badges, visible offline state, and progressive task hierarchy.

The experience layer may simplify language and presentation. It may **not** create a new fact or authority signal.

### 2. Cashier journey

The Cashier surface is organized around three shop actions:

1. **Build order** — choose products from the Hub-provided catalog and create the existing `order.create` request.
2. **Take payment** — record cash only through the existing `payment.capture` request while a Manager-opened cash shift is active.
3. **Hand over** — mark an already READY and paid order COLLECTED through the existing authorized order transition.

Cashier cancellation remains limited to the existing unprepared unpaid-order authority. No card, QR, refund, provider settlement, printing, customer notification, or cloud-delivery claim is added by this ADR.

### 3. Kitchen journey

The Kitchen surface is a two-stage queue:

- **Waiting to start** — locally committed PLACED orders.
- **Cooking now** — locally committed PREPARING orders.

Kitchen may request only the already-authorized `PLACED -> PREPARING -> READY` transitions. It receives no financial amount, tender, cancellation, collection, supplier, or Manager authority.

### 4. Manager journey

The Manager surface groups the existing command families into three operating responsibilities:

- **Cash control** — open the branch cash shift, view the Hub-derived drawer expectation, enter a physical count, and close the shift after pending orders are resolved.
- **Order exceptions** — review and cancel only the already-authorized unpaid PLACED/PREPARING orders.
- **Stock desk** — record counted receipts, physical count corrections, and bounded spoilage/damage/expiry waste using the existing inventory command families.

Supplier purchasing, supplier payment, banking, cash-up approval, cost accounting, tax adjustments, and stock-loss valuation remain outside this source slice.

### 5. Offline experience

When the cloud link is unavailable, the product says **Working offline** and may show the number of locally committed updates waiting to sync. It does not tell a merchant that cloud delivery occurred merely because connectivity exists.

The Hub remains the local operational authority. Cloud acknowledgement remains a separately measured state.

### 6. Interrupted actions

The merchant may see a simple interrupted-action message, but the underlying recovery contract is unchanged:

- retry the **same** native command ID and payload;
- never manufacture a replacement request while the preserved request is unresolved;
- abandon only through `discardNativeCommandRequest`, after native code confirms there is no committed receipt;
- never delete a committed event, projection, audit fact, payment, stock movement, or outbox item as part of abandonment.

### 7. Authority boundary

R023 must preserve all of the following:

- `localHubRuntime.getNativeOperatorContext()` as the role-minimized task-data boundary;
- `localHubRuntime.submitNativeCommandRequest()` as the React-to-native command-request boundary;
- `localHubRuntime.discardNativeCommandRequest()` as the bounded recovery path;
- no staff PIN in React;
- no browser-created staff role or staff session;
- no direct operational Supabase mutation from Cashier, Kitchen, or Manager workspaces;
- no browser signing key, session bearer, device credential, sequence, or authorization envelope;
- exact native role checks before a workspace renders.

## Evidence classification

R023 is source-level product-experience evidence only. It demonstrates that the hardened operational capabilities are presented as coherent merchant workflows without reopening the retired browser authority paths.

It is **not** evidence of:

- a successful Android build;
- a physical Cashier Hub or terminal run;
- radio discovery or TLS pinning;
- deployed Edge Functions;
- cloud acknowledgement;
- payment-provider settlement;
- printer or Kitchen-display delivery;
- production readiness.

The release status remains **HOLD** until the current release gates record the required environment, build, physical-device, and pilot evidence.
