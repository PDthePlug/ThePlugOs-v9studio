# ADR-016 — Terminal workspace safe-stop and authority revalidation

- **Status:** Accepted source hardening; physical multi-device evidence pending
- **Date:** 12 October 2026
- **Applies to:** ADR-010 terminal staff sessions, ADR-011 native terminal operator workspace, ADR-015 cross-device session conflict handling, the authenticated Hub local link, and Cashier/Kitchen/Manager terminal surfaces
- **Authority:** Engineering Charter, ADR-003, ADR-005, ADR-010, ADR-011, ADR-015

## Context

ADR-011 requires a disconnected or expired terminal to render unavailable rather than cached inventory, cash, or order state as live operational truth. The existing command path already fails closed: an expired, revoked, wrong-role, or superseded session cannot authorize a Hub mutation. The remaining gap is presentation lifecycle.

A terminal can hold a previously measured role context while the local link re-enters discovery. It can also keep that context visible after the same staff member signs in on another terminal until the old terminal next requests context or attempts a command. Those stale controls do not bypass Hub authorization, but they violate the intended safe-stop experience and make cross-device session replacement look inconsistent.

The existing terminal wire protocol intentionally rejects unsupported message types. This hardening therefore must not introduce a new unsolicited message that could force an older terminal peer to drop an otherwise authenticated connection.

## Decision

### 1. Non-authenticated link state invalidates rendered operational context

The native terminal workspace may render Cashier, Kitchen, or Manager task controls only while the local-link state is `AUTHENTICATED` or `STAFF_SESSION_ACTIVE` and a fresh role context has been accepted.

When the link moves to discovery, TLS pinning, challenge, unavailable, not-enrolled, or any other non-authenticated state, the workspace immediately removes the rendered operational context and action controls. It may retain the encrypted exact pending command intent for retry, because that is recovery state rather than a display authorization.

### 2. Periodic authenticated context revalidation detects expiry and supersession

While the workspace is open and the local link is authenticated, it requests a fresh operator context at a bounded interval. The request uses the existing ADR-011 `OPERATOR_CONTEXT_REQUEST` protocol; no new wire message or authority mechanism is introduced.

This revalidation provides a backstop for session expiry, same-staff supersession under ADR-015, and other authority changes which do not create an operational event. A superseded session is rejected by the Hub on the next context request and the stale controls are removed.

The periodic request never substitutes for event delivery, durable cloud acknowledgement, or the Hub ledger. `EVENT_COMMITTED` remains the immediate task-data refresh signal for operational changes.

### 3. Every final Hub command result remeasures context

`APPLIED`, `DUPLICATE`, and `REJECTED` are final Hub outcomes for the submitted terminal command. After any of those outcomes, the workspace requests a fresh operator context.

- `APPLIED` and `DUPLICATE` refresh state after a measured receipt.
- `REJECTED` refreshes so a business conflict shows current tasks and an authority rejection collapses the workspace to session-required state.
- `UNAVAILABLE` retains the exact pending signed intent and does not pretend the command is final.

### 4. Failed context revalidation safe-stops the workspace

When a fresh operator-context request fails, the current role projection and action controls are removed before the terminal offers native sign-in again. Previously rendered data is not left on screen as current authority.

A completed native sign-in also starts with a fresh empty unsent Cashier basket before the new operator context is requested, so ephemeral order-entry state is not carried across staff-session replacement.

## Consequences

- A superseded Cashier, Kitchen, or Manager session loses visible operational controls within the bounded local revalidation interval even when no operational event is emitted.
- A disconnected terminal no longer presents cached task controls as live while rediscovering the Hub.
- Exact retry remains intact for an unavailable command result.
- The local-link protocol stays backward-compatible; unsupported-message fail-closed behavior remains unchanged.
- No browser authority, new database, new migration, or new secret-bearing message is introduced.
- The Hub remains the only source of terminal task context and local command authority.

## Verification

R025 must prove at source level that:

- all non-authenticated local-link states clear the rendered terminal context;
- the open workspace performs bounded periodic context revalidation through the existing `OPERATOR_CONTEXT_REQUEST` path;
- completed native sign-in clears ephemeral unsent Cashier basket state before loading the new operator context;
- `APPLIED`, `DUPLICATE`, and `REJECTED` all trigger context remeasurement while `UNAVAILABLE` retains exact retry behavior;
- no new unsolicited local-link message type is introduced for this hardening; and
- release status remains `HOLD` until the behavior is exercised on multiple physical Android devices.

This ADR is source-level hardening only. It does not prove live LAN/Wi-Fi Direct delivery, real expiry timing, cloud revocation propagation, or physical multi-device safe-stop behavior.
