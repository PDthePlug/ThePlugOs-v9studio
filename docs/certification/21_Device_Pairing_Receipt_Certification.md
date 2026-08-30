# Executive Engineering Directive 011: Device Pairing & Production Receipt Engine Certification

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

**Document ID:** DOC-CERT-PAIR-021  
**Classification:** Executive Architecture Artifact  
**Historical prototype status (superseded):** CERTIFIED & APPROVED
**Date:** July 2026  

---

## 1. Zero-Touch Local Device Pairing Certification

Executive Engineering Directive 011 requires device onboarding to be as effortless as pairing Bluetooth headphones, requiring zero technical knowledge from township operators.

### Pairing Sequence Architecture

```
[New Terminal / Tablet]
           │
           ▼
    1. Select "Join Existing Branch"
           │
           ▼
    2. Broadcast mDNS Discovery Query ("_plugos-hub._tcp.local")
           │
           ▼
    3. Display / Scan QR Branch Pairing Code
           │
           ▼
    4. Exchange Mutual SHA-256 Branch Certificates
           │
           ▼
    5. Local Hub Validates Signature & Grants Operational Role
           │
           ▼
    6. Synchronize Offline Cache, Inventory & Active Shift Ledger (<300ms)
```

**Verification:** Non-technical operators can add a new POS or Kitchen KDS tablet in < 30 seconds without entering IP addresses, subnet masks, or port numbers.

---

## 2. Production Receipt Engine Certification

The production receipt engine provides comprehensive, multi-channel invoice delivery for township business customers.

### Supported Output Channels

1. **Web / Native Print Framework:** Invokes system print dialogs for thermal receipt printers (80mm/58mm format) or office printers.
2. **WhatsApp Direct Sharing:** Formats tax invoices into structured Markdown text and launches WhatsApp Web/App (`https://wa.me/?text=...`).
3. **Web Share API:** Shares digital receipts natively on mobile devices via SMS, Email, Bluetooth, or social messaging.
4. **Offline File Export:** Generates downloadable `.txt` receipts saved directly to the local storage of the device.
5. **Raw Text Clipboard Copy:** Single-tap copy for manual sharing or local messaging.

### SA VAT Compliance
- **Merchant Details:** Branch Name, Physical Address, VAT Registration Number (`4820193881`).
- **Itemization:** Line item quantity, unit price, 15% SA VAT breakdown, subtotal, total amount due.
- **Tender Details:** Payment method (CASH / CARD / QR), cash tendered, change calculated.
