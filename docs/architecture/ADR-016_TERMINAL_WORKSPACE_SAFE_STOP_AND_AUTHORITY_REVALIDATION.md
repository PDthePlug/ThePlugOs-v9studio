# ADR-016 — Terminal workspace safe-stop and authority revalidation

- **Status:** Accepted source hardening; physical multi-device evidence pending
- **Date:** 12 October 2026
- **Applies to:** ADR-010 terminal staff sessions, ADR-011 native terminal operator workspace, ADR-015 cross-device session conflict handling, the authenticated Hub local link, and Cashier/Kitchen/Manager terminal surfaces
- **Authority:** Engineering Charter, ADR-003, ADR-005, ADR-010, ADR-011, ADR-015

## Context

ADR-011 requires a disconnected or expired terminal to render unavailable rather than cached inventory, cash, or order state as live operational truth. The existing command path already fails closed: an expired, revoked, wrong-role, or superseded session cannot authorize a Hub mutation. The remaining gap is presentation lifecycle.

A terminal can hold a previously measured role context while the local link re-enters discovery. It can also keep that context visible after the same staff member signs in on another terminal until the old terminal next requests context or attempts a command. Those stale controls do not bypass Hub authorization, but they violate the intended safe-stop experience and make cross-device session replacement look inconsistent.

## Decision

### 1. Non-authenticated link state invalidates rendered operational context

The native terminal workspace may render Cashier, Kitchen, or Manager task controls only while the local-link state is `AUTHENTICATED` or `STAFF_SESSION_ACTIVE` and a fresh role context has been accepted.

When the link moves to discovery, TLS pinning, challenge, unavailable, not-enrolled, or any other non-authenticated state, the workspace immediately removes the rendered operational context and action controls. It may retain the encrypted exact pending command intent for retry, because that is recovery state rather than a display authorization.

### 2. Session authority changes are broadcast as a non-secret invalidation signal

After the Hub atomically installs a verified terminal staff session, it broadcasts an `AUTHORITY_CHANGED` notification to authenticated local peers. The message contains no staff ID, session ID, role, key, PIN, bundle, or command data.

A terminal treats this notification only as a reason to request a fresh measured operator context. It is not itself authority and cannot activate a session.

This allows a terminal whose staff session was superseded under ADR-015 to remove stale controls promptly when its next context request is rejected.

### 3. Periodic context revalidation is a fallback, not synchronization authority

While the workspace is open, it requests a fresh operator context at a bounded interval. This provides a fallback for missed invalidation notifications and locally detects session expiry through the already verified terminal session coordinator.

The periodic request never substitutes for event delivery, durable cloud acknowledgement, or the Hub ledger. `EVENT_COMMITTED` remains the immediate task-data refresh signal for operational changes.

### 4. Every final Hub command result remeasures context

`APPLIED`, `DUPLICATE`, and `REJECTED` are final Hub outcomes for the submitted terminal command. After any of those outcomes, the workspace requests a fresh operator context.

- `APPLIED` and `DUPLICATE` refresh state after a measured receipt.
- `REJECTED` refreshes so a business conflict shows current tasks and an authority rejection collapses the workspace to session-required state.
- `UNAVAILABLE` retains the exact pending signed intent and does not pretend the command is final.

### 5. Failed context revalidation safe-stops the workspace

When a fresh operator-context request fails, the current role projection and action controls are removed before the terminal offers native sign-in again. Previously rendered data is not left on screen as current authority.

## Consequences

- A superseded Cashier, Kitchen, or Manager session loses visible operational controls promptly as well as mutation authority.
- A disconnected terminal no longer presents cached task controls as live while rediscovering the Hub.
- Exact retry remains intact for an unavailable command result.
- No browser authority, new database, new migration, or new secret-bearing message is introduced.
- The Hub remains the only source of terminal task context and local command authority.

## Verification

R025 must prove at source level that:

- all non-authenticated local-link states clear the rendered terminal context;
- the Hub emits only a non-secret `AUTHORITY_CHANGED` invalidation after verified staff-session installation;
- the terminal maps that message to a fresh context request rather than to session activation;
- the open workspace performs bounded periodic context revalidation;
- `APPLIED`, `DUPLICATE`, and `REJECTED` all trigger context remeasurement while `UNAVAILABLE` retains exact retry behavior; and
- release status remains `HOLD` until the behavior is exercised on multiple physical Android devices.

This ADR is source-level hardening only. It does not prove live LAN/Wi-Fi Direct delivery, real expiry timing, cloud revocation propagation, or physical multi-device safe-stop behavior.
