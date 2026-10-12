# ADR-015 — Cross-device staff-session conflict hardening

- **Status:** Accepted source hardening; physical multi-device evidence pending
- **Date:** 12 October 2026
- **Applies to:** Android Cashier Hub terminal-session installation, terminal command verification, ADR-010 staff sessions, ADR-011 operator workspaces, and R014 cloud session authority
- **Authority:** Engineering Charter, ADR-003, ADR-010, ADR-011, and the R014 terminal staff-session schema contract

## Context

ADR-010 and R014 establish one authority chain for a terminal operator: the cloud verifies a native PIN and device proof, issues a role-bound signed terminal session, and the Cashier Hub independently verifies that assertion before installing it locally. R014 already retires prior active authority for both the signing terminal and the same staff member on the active Hub.

The local Hub must mirror that rule immediately. If local installation revoked only another session on the same terminal, a newly issued session on Terminal B could temporarily coexist with the same staff member's older session on Terminal A until a later bundle refresh. That creates an avoidable cross-device authority race.

A second fail-closed check is also required at command execution. Session installation binds role to the paired terminal, but every operational command should re-check that the current paired-device role still equals the staff-session role before role permissions are evaluated. A stale role-bearing session must never survive a later device-role change as usable authority.

## Decision

### 1. One active local operational session per staff member per Hub authority

When the Hub installs a newly verified terminal staff-session assertion, it atomically revokes every other unrevoked local staff session where either:

- the session belongs to the same terminal device; or
- the session belongs to the same staff member.

The newly verified session is then installed. Historical session rows remain retained for event and receipt references; only their operational authority is revoked.

This mirrors the R014 cloud rule and closes the window between cloud issuance and a later authorization-bundle refresh.

### 2. Device role and session role are checked on every command

`HubCommandVerifier` must reject an operational command when the current paired-device role differs from the installed staff-session role. Permission evaluation occurs only after this equality check.

The command is rejected even if its signature is otherwise valid, its session is unexpired, and its revocation version still matches the active bundle.

### 3. Existing retry and idempotency semantics remain unchanged

This hardening does not change command IDs, sequence allocation, exact signed retry, receipt idempotency, durable outbox acknowledgement, or role permission sets. A previously committed command remains auditable; a revoked session simply cannot authorize another command.

### Failure modes

| Condition | Required result |
| --- | --- |
| Same staff signs in on a second terminal | Revoke the earlier local staff session before the new session becomes usable. |
| New session replaces another operator on the same terminal | Revoke the earlier terminal session before the new session becomes usable. |
| Paired terminal role no longer equals session role | Reject the command before role permission and ledger mutation. |
| Old terminal retries after its staff session was superseded | Reject because the local session is revoked; do not allocate a new business effect. |
| Exact retry of a command already committed before revocation | Existing receipt/idempotency rules remain authoritative; no duplicate business effect. |

## Verification

R024 must prove in source that:

- local terminal-session installation revokes prior unrevoked sessions for both the same terminal and the same staff member;
- command verification requires `device.role == session.role` before permissions are accepted;
- R014 still contains the equivalent cloud same-terminal/same-staff retirement rule;
- the hardening does not expose PIN, signing key, session envelope, or command authority through React/Capacitor; and
- release status remains `HOLD` until real multi-device acceptance proves the conflict behavior on physical devices.

This ADR is source-level hardening only. It is not evidence that R014 is deployed, that two physical terminals have exercised the conflict, or that production release gates are complete.
