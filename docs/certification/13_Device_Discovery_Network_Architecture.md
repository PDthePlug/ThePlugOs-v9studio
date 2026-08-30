# Executive Engineering Directive 009: Local Device Discovery & Network Security Architecture

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

**Document ID:** DOC-CERT-DISC-013  
**Classification:** Executive Architecture Artifact  
**Historical prototype status (superseded):** CERTIFIED & APPROVED
**Date:** July 2026  

---

## 1. Zero-Configuration Local LAN Discovery

To deploy ThePlugOS in township environments without IT engineers, the system implements automatic local network discovery using **mDNS (Multicast DNS)** and **UDP LAN Broadcasts**.

```
[New Terminal Powered On]
          │
          ▼
   1. Broadcast mDNS Query: "_plugos-hub._tcp.local"
          │
          ▼
   2. Local Hub Responds with IP (192.168.1.100) & Port (3000)
          │
          ▼
   3. Mutual SHA-256 Certificate Handshake & Challenge-Response
          │
          ▼
   4. Local Terminal Authorized & Registered in Branch Device Registry
          │
          ▼
   5. Download State Snapshot & Begin Live Event Streaming (<500ms total)
```

---

## 2. Local Device Security & Authentication

1. **Shared Branch Identity Certificate:** Every authorized terminal receives a cryptographically signed SHA-256 certificate during initial onboarding.
2. **Mutual TLS / Token Validation:** Connections lacking a valid branch certificate are automatically dropped by the Local Hub WebSocket gateway.
3. **Role-Based Permission Enforcement:** POS terminals are restricted to order creation and shift operations; only Supervisor terminals can authorize refunds or inventory adjustments.
4. **Device Revocation:** The Local Hub maintains a local Certificate Revocation List (CRL). If a tablet is lost or stolen, the manager can instantly revoke its access with one tap.
