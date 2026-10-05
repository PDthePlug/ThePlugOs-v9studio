# Native Hub Command-Request Bridge

- **Status:** Gate 2 implementation contract — not deployed
- **Date:** 15 August 2026
- **Depends on:** ADR-003, `LOCAL_FIRST_OPERATIONAL_COMMAND_CONTRACT.md`, and `NATIVE_HUB_ENROLLMENT_AND_SYNC_PROTOCOL.md`

## Purpose

The React layer may collect an operator's task input on an enrolled Android
Cashier Hub, but it must not hold a device private key, a staff PIN, an active
staff-session identifier, a command sequence, or a command signature. This
contract defines the narrow native bridge that converts a non-secret command
request into a Keystore-signed operational command.

It exists only inside the Capacitor Android host. A normal web browser receives
an explicit native-capability-unavailable result and may not imitate this path.

## Request boundary

JavaScript may call the native plugin with only:

```ts
type NativeCommandRequest = {
  commandId: string; // UUID; stable across an exact retry
  type: 'shift.open' | 'shift.close' | 'order.create' | 'order.status.transition' | 'payment.capture' | 'inventory.receive' | 'inventory.adjust' | 'inventory.waste';
  payload: Record<string, unknown>; // bounded, non-secret domain input
};
```

It must not provide `deviceId`, `staffSessionId`, `sequence`, `issuedAt`, a
signature, an authorization bundle, a pairing code, a PIN, a token, or any key
material. The native runtime rejects secret-looking field names recursively
before an intent reaches the command router.

The first supported command families are intentionally limited to the domain
handlers implemented by the native Hub. Unsupported command types fail rather
than being recorded as generic events.

`shift.open` and `payment.capture` follow
`LOCAL_FIRST_CASH_SHIFT_AND_CAPTURE_CONTRACT.md`. The bridge can capture only
cash inside a Manager-opened cash shift. A `CARD` or `SPAZAPAY_QR` order intent
is not a provider capture and fails closed until a verified provider adapter is
implemented.

The bridge may also return a **non-secret operator view** only after a valid
native session is active: display name, role, the signed catalog snapshot, VAT
configuration, and measured Hub health. It never returns an ID that can be
used as a session selector, a bundle, a signature, or any credential material.
The UI treats catalog totals as a preview; the native router recalculates price
and tax from its SQLCipher signed snapshot before it commits an order.

The Android host can end its local active-staff selector through the no-argument
native `endNativeStaffSession()` capability. It is not a browser logout or a
cloud revocation, and it cannot select or erase another staff session. The
full entry and session-end boundary is defined in
`NATIVE_STATION_ENTRY_AND_SESSION_END_CONTRACT.md`.

## Native authority flow

1. The native-only staff sign-in activity verifies a fresh PIN online and
   receives a signed bundle containing exactly one newly activated staff
   session for that staff member and Hub.
2. The runtime records that session's opaque ID in SQLCipher as the active
   native session. The ID is an internal selector, not a bearer credential;
   each command is still verified against the signed bundle, expiry, role,
   device key, branch, and revocation version.
3. A bridge request creates or reuses a durable SQLCipher command intent. The
   intent fixes `commandId`, type, payload bytes, native session, issue time,
   and next per-session sequence before signing.
4. The Keystore signs the exact operational command bytes. The existing Hub
   verifier, router, transaction, immutable event ledger, audit record, and
   cloud outbox then run unchanged.
5. The bridge returns a *sanitized receipt*: command ID, outcome, commit time,
   and event/outbox IDs. It never returns a staff-session ID, private material,
   PIN, signature, bundle, or token.

An exact retry with the same command ID and identical request bytes reuses the
stored intent and returns the existing receipt as `DUPLICATE`; a changed
request with the same command ID is rejected. A prepared but uncommitted intent
retains its sequence so a crash cannot cause a later request to reuse it.

The native operator view may expose a current-session list of recoverable,
**non-secret** task requests that have no receipt yet. JavaScript may submit
one unchanged request again, or call `discardNativeCommandRequest(commandId)`.
The latter is not a browser delete: the native Hub confirms the active session
owns the intent and that no receipt exists before it removes only that
reservation. It cannot delete a committed event, projection, audit fact, or
cloud-outbox item.

`order.status.transition` uses this same recovery rule for the native Kitchen
workflow. The Kitchen surface may retry only the original `orderId` and target
status, and it must block a replacement transition request for that order until
native code returns a receipt or confirms abandonment.

`inventory.receive` is Manager-only and accepts only a receipt UUID plus
product quantities. The Hub derives the active catalog balance before/after
facts and never returns supplier, cost, purchase-order, or financial data to
the React layer. Its receipt-specific rules are in
`LOCAL_FIRST_INVENTORY_RECEIPT_CONTRACT.md`.

`inventory.adjust` is Manager-only and accepts only a correction UUID, the
fixed `COUNT_CORRECTION` reason, and a physically counted final product
balance. The Hub derives the prior balance and signed difference. It is not a
waste, supplier, or financial workflow; its precise rules are in
`LOCAL_FIRST_INVENTORY_COUNT_CORRECTION_CONTRACT.md`.

`inventory.waste` is Manager-only and accepts only a waste UUID, one supported
physical reason (`SPOILAGE`, `DAMAGE`, or `EXPIRED`), and positive product
quantities. The Hub derives the balances and rejects insufficient stock. It is
not a supplier, return, cost, tax, cash, approval, or financial-loss workflow;
its precise rules are in `LOCAL_FIRST_INVENTORY_WASTE_CONTRACT.md`.

## Bundle and restart rules

Installing a renewed bundle replaces server authority facts atomically, but it
preserves the durable sequence for a session ID that remains in the new signed
bundle. A native active-session selector is removed if that session is absent,
expired, or revoked after replacement. Process restart may restore a still
valid selector, but the next command must independently pass all normal Hub
verification checks.

## Non-goals

- This does not authorize browser-originated device enrollment or PIN entry.
- This does not make a browser tab a LAN terminal.
- This does not add card/QR provider capture, supplier or purchase-order
  inventory workflows, stock void, cash-up, refund, or
  remote-device pairing handlers before their atomic domain contracts exist.
- This is source implementation only until the required staging database and
  physical-device acceptance gates are complete.
