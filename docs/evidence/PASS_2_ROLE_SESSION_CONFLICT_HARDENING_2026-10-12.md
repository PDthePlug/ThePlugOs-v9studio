# PASS 2 — Role-session and cross-device conflict hardening evidence

Date: 12 October 2026

## Scope

This evidence record covers source-level hardening of the native terminal staff-session authority chain. It does not claim live Supabase deployment, physical Android acceptance, radio connectivity, or production release readiness.

Baseline source: `288731f1860ba9f1c49f40a0a4b66c7d11d4a63a`
Verified hardening head: `bafd5178ef272e839b4fb009adf6e341d026a0a8`
GitHub Actions run: `38234127221` (`Verify established Supabase application`, push to `main`)

## Defects closed at source level

### 1. Cross-device same-staff session conflict

R014 cloud authority already revokes another active session where either the command terminal matches or the same staff member has an active session on the same Hub.

The local SQLCipher installation path previously retired only another session on the same terminal. It now mirrors the cloud rule atomically: before a newly verified terminal staff session is inserted, every other unrevoked local session for either the same terminal device or the same staff member is marked revoked. Historical rows remain for command receipt and event references.

Result: a newly installed staff session cannot intentionally coexist locally with an earlier active session for that staff member on another terminal.

### 2. Terminal-role/session-role drift

`HubCommandVerifier` now checks the current paired-device role against the installed staff-session role for every operational command, before role permissions are evaluated.

Result: an otherwise valid signed command is rejected if a stale role-bearing session no longer matches the terminal's current admitted role.

### 3. Restart recovery binding for pending terminal commands

`TerminalStaffSessionCoordinator.currentSession()` already re-verifies the stored signed staff-session assertion after restart. It now additionally accepts a persisted pending command only when its terminal device ID, staff-session ID, and sequence exactly match the re-verified session and its durable last allocated sequence.

Result: a recovered pending intent cannot be retried under a different verified terminal/session authority.

## Regression gate

R024 (`scripts/test-r024-cross-device-session-conflict-contract.mjs`) now checks:

- local same-terminal/same-staff session retirement;
- current terminal role equals current staff-session role before command permissions;
- recovered pending-command device/session/sequence binding;
- the equivalent cloud R014 same-terminal/same-staff retirement rule;
- ADR-015 remains the governing source-hardening decision;
- release status remains HOLD; and
- the session coordinator remains outside the Capacitor plugin surface.

R024 is wired into `npm run test:all`.

## Verification results

GitHub Actions run `38234127221` completed successfully for head `bafd5178ef272e839b4fb009adf6e341d026a0a8`:

- dependency installation: PASS
- TypeScript/lint gate: PASS
- complete `npm run test:all`, including R024: PASS
- production build: PASS

The same head also received a successful Vercel deployment status.

## Release boundary

The source remains **HOLD** for product release. The following are still NOT VERIFIED by this evidence record:

- the documented ThePlugOS Supabase production project and live R014 deployment;
- real cloud PIN/session receiver execution;
- two or more physical terminals proving same-staff conflict retirement;
- session replacement during live LAN/Wi-Fi Direct transport;
- terminal revoke/expiry while commands are in flight;
- restart/recovery on physical Android devices;
- durable cloud acknowledgement following those conflict scenarios.

These items require authorized backend inspection and physical multi-device acceptance evidence before production-readiness certification.
