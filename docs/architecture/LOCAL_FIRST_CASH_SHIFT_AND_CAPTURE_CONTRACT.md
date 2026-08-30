# Local-First Cash Shift and Cash Capture Contract

- **Status:** Gate 2 implementation contract — source-only, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, the Local-First Operational
  Command Contract, and the Order Transition Authority Contract
- **Depends on:** R003/R004 local-Hub authority source and R005 cash-shift
  receiver source

## Purpose

This contract introduces the first financially meaningful operational path:
one active cash shift per branch and a Cashier-captured cash payment that
settles a locally reserved order. It replaces a tender selector that could
look like payment with a durable, auditable, balanced financial fact.

It is intentionally narrow. It does not emulate a card terminal, SpazaPay QR,
refund, cash withdrawal, cashup approval, tax filing, cost of goods, or
profit/margin calculation. Those are separate contracts and must stay
unavailable until their authority and evidence exist.

## Cash-drawer model

The initial release has one active cash drawer/shift for one branch's active
Cashier Hub. A signed Manager session opens it before a Cashier can create an
order or take cash. This avoids sales operating outside a known cash custody
period while retaining the single-Hub topology from ADR-003.

```text
Manager: shift.open
  -> active cash shift with opening float
Cashier: order.create
  -> PLACED + PENDING tender intent + stock reservation
Cashier: payment.capture (CASH only)
  -> CAPTURED + financial postings + shift totals
Manager: shift.close
  -> physical count + derived variance + closed cash-shift fact
Future: cashup.submit -> cashup.approve
```

The shift is branch-scoped, Hub-scoped, and immutable in its opening facts. A
second open shift for the same branch is rejected; it is not silently merged or
used to reset the drawer total.

## Command authority

| Command | Allowed verified role | Required state | Result |
| --- | --- | --- | --- |
| `shift.open` | Manager | no active branch shift | exactly one `OPEN` cash shift with a non-negative opening float |
| `order.create` | Cashier | active branch shift | normal `PLACED` / `PENDING` local reservation |
| `payment.capture` | Cashier | active shift; order is `PENDING`, not cancelled/collected, and has `CASH` tender intent | exactly one captured cash payment and balanced postings |

The Hub derives the branch, business, Hub device, staff session, role,
currency, order total, and active shift from verified local authority. A
browser request does not supply any of those facts.

## Shift-open request and event

The native bridge receives only:

```ts
{
  commandId: string;        // UUID, stable on retry
  type: 'shift.open';
  payload: {
    shiftId: string;        // UUID
    openingFloat: number;  // ZAR, non-negative and at most two decimals
  };
}
```

The normalized `SHIFT_OPENED` event payload is:

```json
{
  "id": "shift UUID",
  "shiftId": "shift UUID",
  "status": "OPEN",
  "currency": "ZAR",
  "openingFloat": 500.00,
  "cashSalesTotal": 0.00,
  "cashTenderedTotal": 0.00,
  "cashChangeTotal": 0.00,
  "expectedCash": 500.00
}
```

The single Hub transaction writes the event, `shifts` projection,
`active_cash_shift` branch projection, receipt, audit fact, session sequence,
and cloud outbox entry. It rejects a duplicate active shift before any write.

## Cash capture request and event

Only a cash capture is implemented in this contract:

```ts
{
  commandId: string;
  type: 'payment.capture';
  payload: {
    paymentId: string;      // UUID
    orderId: string;        // UUID
    cashTendered: number;   // ZAR, at least the Hub-derived order total
  };
}
```

The Hub ignores a caller amount, tender label, order total, cash change, shift
ID, actor ID, and account list. It reads the active local order and shift,
derives the captured amount from `totalAmount`, and writes exactly this
normalized `PAYMENT_CAPTURED` payload:

```json
{
  "id": "payment UUID",
  "paymentId": "payment UUID",
  "orderId": "order UUID",
  "shiftId": "shift UUID",
  "tender": "CASH",
  "status": "CAPTURED",
  "currency": "ZAR",
  "amount": 75.00,
  "cashTendered": 100.00,
  "changeDue": 25.00,
  "financialPostings": [
    { "account": "CASH_DRAWER", "debit": 75.00, "credit": 0.00 },
    { "account": "ORDER_SETTLEMENT_CLEARING", "debit": 0.00, "credit": 75.00 }
  ]
}
```

The two postings must use the exact captured amount and balance to zero. Cash
tendered and change due are custody/count facts; only the captured amount
increases `CASH_DRAWER`. The local order becomes `paymentStatus = CAPTURED`,
and the active shift derives its `cashSalesTotal`, `cashTenderedTotal`,
`cashChangeTotal`, and `expectedCash` from the durable payment facts.

## Explicit tender boundary

`CARD` and `SPAZAPAY_QR` remain valid **order tender intents** only. They are
not capture-enabled in this release. A native bridge request for either method
is rejected as unavailable because a claim of card/QR capture requires a
verified provider response, provider reference, provider-specific
idempotency/reversal rules, and a merchant configuration that this repository
does not yet have.

The Cashier interface must therefore show Cash as the only capture-enabled
tender and must not present a card/QR button, receipt, or completion message
as a successful settlement.

## Local and cloud atomicity

For an accepted capture, one SQLCipher transaction writes:

1. the idempotency receipt/sequence advancement;
2. `PAYMENT_CAPTURED` event;
3. order payment projection;
4. payment projection;
5. active-shift and shift-total projections;
6. audit fact; and
7. cloud outbox record.

R005 adds cloud `cash_shifts`, `hub_payments`, and
`financial_postings` tables. Its receiver validates the same role, order,
shift, tender, amount, and posting facts, then records the event, payment,
order payment fields, balanced postings, shift totals, audit record, and
acknowledgement in one cloud transaction. The event ID remains the
replication idempotency key; a duplicate may not add a second payment or a
second ledger posting.

The Hub submits queued events in their durable local-outbox insertion order.
That order—not a per-staff-session sequence or a timestamp tie—is the
cross-session causal order used to keep `SHIFT_OPENED`, `ORDER_PLACED`, and
`PAYMENT_CAPTURED` in their committed dependency sequence.

## Native retry and recovery boundary

Before the Keystore signs a native command, the Hub durably reserves a
non-secret command intent. An interrupted Capacitor response therefore never
requires the browser to guess whether an order, shift, or payment committed:

- if a receipt exists, the same command returns that receipt as a duplicate;
- if no receipt exists, the current signed staff session may retry the exact
  reserved `commandId`, type, and payload; and
- the current session may explicitly abandon an **uncommitted** reserved
  intent after review. Native code verifies that no receipt exists before it
  removes the reservation. It can never delete a committed event, order,
  payment, posting, audit fact, or outbox item.

The browser receives only the recoverable command's non-secret task payload.
It does not receive the staff-session ID, device ID, sequence, issue time, or
signature used to reproduce the command. While a recoverable order intent is
present, the Cashier surface must not silently construct a replacement order;
it must retry that exact request or use the native-reviewed abandonment path.

## State machine and safe stop

```text
No active shift --shift.open--> OPEN
OPEN + PENDING cash order --payment.capture--> CAPTURED cash order
OPEN + card/QR intent --payment.capture--> UNAVAILABLE
OPEN + PENDING order without cash tender --payment.capture--> REJECTED
```

The shift-close contract is defined in
`LOCAL_FIRST_CASH_SHIFT_CLOSE_CONTRACT.md`. It records a Manager's physical
count and derived variance, but does not fabricate cash-up approval, bank
deposit, printing, or cloud acknowledgement. `cashup.submit`,
`cashup.approve`, refund, void-after-capture, and paid-out commands remain
unavailable.

## Failure handling

| Failure | Required behavior |
| --- | --- |
| No active shift | Reject order creation and cash capture; no partial order/payment/outbox fact. |
| Duplicate open-shift command | Return its original receipt; do not create a second drawer. |
| Another active shift exists | Reject before any new shift event, projection, or outbox item. |
| Under-tendered/invalid cash | Reject before any payment, order status, shift total, posting, or outbox write. |
| Capture against card/QR tender intent | Return unavailable/rejected; no payment record. |
| Capture of cancelled, collected, or already captured order | Reject; no duplicate receipt or posting is created. |
| Repeat exact capture command | Return the original receipt and preserve one payment/posting set. |
| Cloud link unavailable | Preserve the full local payment and outbox; display `Locally committed` / `Queued for cloud`, never settled or synced. |
| Cloud balance/authority failure | Keep the event queued for explicit reconciliation; do not roll back the already committed local ledger. |

## Test and acceptance evidence

Source tests must prove local command types/roles, money precision, shift
uniqueness, cash-only capture, event payload normalization, balanced postings,
and R005 receiver constraints. Staging and physical-device evidence must later
prove an exact retry produces one payment/posting set, an interrupted process
retains the local cash fact, and cloud acknowledgement does not double-count
the drawer.
