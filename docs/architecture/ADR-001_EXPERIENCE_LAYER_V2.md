# ADR-001: ThePlugOS Experience Layer v2

- **Status:** Approved for implementation
- **Date:** 11 August 2026
- **Scope:** Public entry, business access, operating shell, and role workspaces
- **Authority:** ThePlugOS Constitution and Engineering Charter v1.0

## Context

The current React application contains the required operational workflows, role boundaries, local-first engines, Supabase integration, and device-pairing flows. The experience layer does not yet communicate that product clearly.

The present entry surface is a fixed authentication modal. It asks an operator to choose between sign-in, registration, and device pairing before explaining what ThePlugOS is. Inside the operating system, visual hierarchy is largely created through repeated slate cards, small text, borders, and horizontal tab strips. This makes distinct tasks appear equally important and forces operators to interpret system terminology during active work.

The redesign must improve the experience without moving business rules into presentation components or changing the event, storage, security, sync, or state-machine contracts.

## Decision

ThePlugOS will use a three-layer experience model:

1. **Arrival layer** — a public, product-specific landing surface that explains the operating system through real operational outcomes.
2. **Access layer** — focused sign-in, business creation, and device-pairing panels that reuse the existing authenticated workflows.
3. **Operating layer** — a shared role-aware shell with progressive disclosure, operational status, and task-first role workspaces.

The existing React, TypeScript, Tailwind CSS, Supabase, SDK, engine, repository, and state-machine architecture remains authoritative. UI state may control presentation only. Persistent or operational state continues to flow through the existing engines and services.

## Constitutional evaluation

| Question | Decision evidence |
| --- | --- |
| Constitution compliant? | Large touch targets, high contrast, role isolation, and local-first status remain explicit. |
| Strengthens the Internal Intelligence Engine? | The shell exposes engine state and business signals without inventing AI behavior. |
| Reduces operational complexity? | One primary task per role, fewer simultaneous controls, and clearer status language. |
| Improves maintainability? | Shared experience primitives and tokens replace repeated one-off styling decisions. |
| Improves observability? | Connection, sync, shift, branch, and device states are visible in a single system strip. |
| Improves resilience? | Offline mode is presented as a supported operating state, not an application failure. |
| Improves scalability? | The shell remains branch-aware and role-aware without coupling to the fast-food domain. |
| Improves developer understanding? | Arrival, access, shell, and workspace boundaries are explicit and documented. |

## Architectural boundaries

### Preserved without modification

- Event names and event publishing behavior
- Order state transitions and validation
- Supabase authentication and business membership lookup
- Device identity, pairing, and bootstrap contracts
- IndexedDB and in-memory storage adapters
- Sync service behavior and outbox semantics
- Role authorization and role workspace routing
- Domain packages and product data contracts

### Presentation-owned state

- Landing navigation state
- Access panel visibility and selected access mode
- Responsive navigation visibility
- Workspace view or filter selection
- Non-persistent disclosure and help state

### Forbidden coupling

- A component must not calculate a new source-of-truth value when an engine or selector owns it.
- A landing or access component must not publish operational events.
- A role workspace must not expose another role's privileged action merely for visual convenience.
- A network failure must not block local operational controls that are designed to remain available offline.

## Failure modes

| Failure | Required experience |
| --- | --- |
| Cloud unavailable | Preserve local operation and show a calm, persistent “Local mode” status. |
| Sync backlog | Show the queued count and recovery state without alarming or blocking the operator. |
| Invalid credentials | Keep entered non-secret context where safe and provide an actionable inline message. |
| Pairing failure | Preserve the entered device name/type and explain how to retry. |
| Empty business data | Provide role-specific empty states with a single next action. |
| Narrow/low-cost tablet | Collapse secondary navigation; preserve 48px primary controls and critical data. |
| Reduced motion | Remove non-essential transitions and animated status effects. |

## Testing strategy

- Type-check the complete repository.
- Run the existing core and domain test suite and record pre-existing failures separately.
- Add interface tests for landing-to-access transitions and access-mode switching.
- Validate production output with the repository's existing build.
- Inspect 360px mobile, 768px tablet, and desktop layouts.
- Exercise keyboard focus, accessible names, escape/close behavior, and reduced-motion behavior.
- Confirm that no UI change alters event payloads, state transitions, persistence, or backend calls.

## Consequences

The product gains a coherent public identity and a maintainable experience layer while preserving the operating system underneath it. Some existing large components remain candidates for later decomposition; this ADR does not authorize changes to operational contracts merely to simplify visual code.

