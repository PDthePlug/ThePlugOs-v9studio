# 02. Security Certification

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

## Audit Summary
- **Authentication:** Token-based authentication via `IdentityService`. Offline trust is established using cryptographically verified cached tokens.
- **RBAC & Permissions:** `PermissionService` enforces explicit role-based access. Deny-by-default architecture prevents accidental exposure.
- **Encryption:** Storage layer interfaces support transparent encryption at rest (requires configuring the production storage adapter with encryption keys).
- **Data Integrity:** Event sourcing guarantees an immutable audit log of all operations. Tamper resistance is achieved by hashing event payloads and chaining them (future enhancement).

## Vulnerability Assessment
- **Supply-Chain:** Minimal runtime dependencies. Domains are certified via `plugos certify` to prevent malicious rule injection.
- **Offline Risk:** Extended offline periods increase the risk of physical device compromise. Mitigation requires full disk encryption on host devices (Android/Linux).

## Status: PASS WITH CONDITIONS
*Condition:* Host environments (tablets/POS hardware) must enforce Full Disk Encryption (FDE) and MDM solutions to protect cached offline tokens.
