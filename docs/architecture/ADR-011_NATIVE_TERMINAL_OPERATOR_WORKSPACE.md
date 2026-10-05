# ADR-011 — Native terminal operator workspace and measured context protocol

- **Status:** Accepted source design
- **Date:** 27 August 2026
- **Applies to:** Admitted Cashier, Kitchen, and Manager Android terminals;
  the verified Cashier Hub TLS listener; and ADR-010 terminal staff sessions
- **Authority:** Engineering Charter, ADR-003, ADR-004, ADR-005, ADR-010, and
  the local-first operational command contracts

## Context

ADR-010 establishes that a terminal can prove its device identity, obtain a
cloud-signed staff assertion through a native PIN screen, and submit a
Keystore-signed local command. That is necessary but not sufficient for a
terminal to be operational: the terminal also needs a small, current, and
role-appropriate task projection to render and act on.

The terminal must not query SQLCipher, Supabase, React state, or browser
storage directly. It must also not receive a broad Hub snapshot merely because
it is connected to the same branch. The Hub remains the local authority and
constructs each projection from committed local facts after checking the
authenticated device and installed staff session.

## Decision

### Native state machine

```text
LINK_REQUIRED
  -> SESSION_REQUIRED
  -> CONTEXT_REQUESTED
  -> CONTEXT_ACTIVE
  -> COMMAND_PENDING
  -> CONTEXT_ACTIVE | RECEIPT_UNAVAILABLE | SESSION_REQUIRED
```

1. A terminal first proves possession of its admitted device key over pinned
   TLS, as defined by ADR-005.
2. It presents an ADR-010 signed session assertion through the native PIN flow.
   The Hub independently installs and verifies it before exposing any task
   projection.
3. The terminal sends `OPERATOR_CONTEXT_REQUEST` containing only its current
   session ID. The message is not a bearer grant: the TLS connection has
   already completed the fresh device-key challenge, and the Hub binds the
   request to that authenticated terminal device.
4. The Hub returns `OPERATOR_CONTEXT` only when the session is active,
   unrevoked, unexpired, revision-matched, branch-matched, and role-matched to
   the admitted terminal. The response contains no PIN, private key, staff
   session envelope, device public key, authorization bundle, or cloud token.
5. A native screen renders only the returned role projection. It creates a
   command through `TerminalOperationalCommandClient`, which uses the
   terminal's Keystore key, exact signed bytes, and monotonically increasing
   session sequence.
6. `APPLIED` and `DUPLICATE` receipts trigger a fresh measured context request.
   A lost link retains the terminal's one encrypted pending intent for an
   exact retry; it never fabricates a receipt or refreshes from stale browser
   data.

### Role-minimized context

| Terminal role | May render | May request commands |
| --- | --- | --- |
| Cashier | Active catalog, VAT fact, active shift fact, own pending cash orders, branch-ready collection orders | `order.create`, cash `payment.capture`, `order.status.transition` to `COLLECTED` |
| Kitchen Staff | Pending branch preparation tickets and line quantities | `order.status.transition` to `PREPARING` or `READY` |
| Manager | Active shift fact, cancellable unpaid orders, and counted inventory product balances | `shift.open`, `shift.close`, `order.status.transition` to `CANCELLED`, `inventory.receive`, `inventory.adjust`, `inventory.waste` |

The Hub's command router repeats all scope, lifecycle, stock, cash, and role
checks. A context response is a display projection, never command authority.

### Transport contract

```text
Terminal -> Hub: OPERATOR_CONTEXT_REQUEST { staffSessionId }
Hub      -> Terminal: OPERATOR_CONTEXT { context }
Terminal -> Hub: COMMAND { command }
Hub      -> Terminal: COMMAND_RESULT { receipt }
```

`OPERATOR_CONTEXT_REQUEST` and `COMMAND` are rejected unless the exact
WebSocket connection has passed `HELLO`. The Hub checks the requested session's
terminal device ID against the authenticated connection identity; a session ID
from another terminal or role is rejected without returning a context.

## Consequences

- The native terminal can execute the bounded existing workflows without
  granting browser authority or duplicating the Hub's SQLite data model.
- A disconnected or expired terminal renders `Unavailable` rather than cached
  inventory, cash, or order state as live operational truth.
- This closes the source-level terminal workflow gap, but does not prove
  physical-device, recovery, payment-provider, printing, or production cloud
  acceptance. Those remain release evidence gates.

## Verification

The R018 terminal-workspace gate must prove that:

- every context request is gated by a fresh authenticated terminal connection;
- the Hub binds context to the terminal session/device/role/revision;
- the Android parser rejects a cross-role or secret-bearing projection;
- all role actions pass through `TerminalOperationalCommandClient` rather than
  a browser bridge or unsigned socket message; and
- source checks retain `RELEASE_STATUS.md` as HOLD and do not deploy R014 or
  this workspace automatically.
