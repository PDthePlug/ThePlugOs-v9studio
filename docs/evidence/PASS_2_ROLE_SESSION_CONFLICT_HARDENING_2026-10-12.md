# PASS 2 — Role-session and cross-device conflict hardening evidence

Date: 12 October 2026

## Scope

This evidence record covers source-level hardening of the native terminal staff-session authority chain, terminal workspace safe-stop/revalidation, and reproducible Android debug-host compilation in CI. It does not claim live Supabase deployment, physical Android acceptance, radio connectivity, multi-device acceptance, or production release readiness.

Baseline source: `288731f1860ba9f1c49f40a0a4b66c7d11d4a63a`
CI-built hardening head: `af98903ab764f61e0a2aef52d919260099ba7eae`
GitHub Actions run: `38248092845` (`Verify established Supabase application`, push to `main`)

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

### 4. Terminal workspace stale-authority safe-stop

ADR-016/R025 harden the terminal workspace without widening the local wire protocol. Cashier, Kitchen, and Manager controls are cleared whenever the local link is not authenticated; authenticated operator/task context is periodically revalidated; final Hub command results, including rejections, trigger context refresh; and a re-authenticated link forces a fresh staff-directory request.

Result: expired, superseded, disconnected, or reconnected terminal authority is not intentionally presented as a durable live control surface, and reconnect does not remain stuck on a stale staff-directory request flag.

### 5. Native build path repaired and made reproducible

The Android CI path exposed several repository/build defects that were not visible to the TypeScript/source-contract gate. The pass repaired them rather than suppressing the native build:

- upgraded the hosted Android setup action to the supported v4 path;
- restored executable mode (`100755`) on `android/gradlew`;
- restored Capacitor 8.5's `:capacitor-cordova-android-plugins` Gradle settings include;
- restored the AndroidX AppCompat dependency required by Capacitor `BridgeActivity`;
- centralized the file-local terminal role policy so stored-session parsing and signed-session verification compile against the same role set; and
- added a conservative Java-WebSocket connecting-state compatibility property used by terminal discovery to avoid racing an in-flight connection.

Result: the Android host now completes `:app:assembleDebug` from a clean GitHub Actions checkout.

## Regression gates

R024 (`scripts/test-r024-cross-device-session-conflict-contract.mjs`) checks:

- local same-terminal/same-staff session retirement;
- current terminal role equals current staff-session role before command permissions;
- recovered pending-command device/session/sequence binding;
- the equivalent cloud R014 same-terminal/same-staff retirement rule;
- ADR-015 remains the governing source-hardening decision;
- release status remains HOLD; and
- the session coordinator remains outside the Capacitor plugin surface.

R025 (`scripts/test-r025-terminal-role-session-lifecycle-contract.mjs`) checks the Cashier/Kitchen/Manager terminal-role lifecycle, authority safe-stop/revalidation, reconnect behavior, and role isolation defined by ADR-016.

Both gates are wired into `npm run test:all`.

## Verification results

GitHub Actions run `38248092845` completed successfully for head `af98903ab764f61e0a2aef52d919260099ba7eae`:

- dependency installation: PASS
- TypeScript/lint gate: PASS
- complete `npm run test:all`, including R024 and R025: PASS
- production web build: PASS
- Java 21 setup: PASS
- Android SDK 36 setup: PASS
- Capacitor Android sync: PASS
- Kotlin compilation: PASS
- Android `:app:assembleDebug`: PASS

The native build reported non-blocking deprecation/future-compatibility warnings, including legacy Bluetooth/NSD/NetworkInfo APIs, status/navigation bar APIs, Gradle 9 deprecation warnings, and Kotlin intersection-type inference warnings in `HubDatabase.kt`. These did not fail the build and remain maintenance work, not PASS 2 acceptance evidence.

The same hardening head also received a successful Vercel deployment status. That web deployment status does not establish native-device or backend acceptance.

## Release boundary

The source remains **HOLD** for product release. The following are still NOT VERIFIED by this evidence record:

- the documented ThePlugOS Supabase production project and live R014 deployment;
- real cloud PIN/session receiver execution;
- installation and execution of this Android build on supported physical API 24+ hardware;
- two or more physical terminals proving same-staff conflict retirement;
- session replacement during live LAN/Wi-Fi Direct transport;
- terminal revoke/expiry while commands are in flight;
- certificate pinning and signed challenge behavior on actual local networks;
- restart/recovery on physical Android devices; and
- durable cloud acknowledgement following those conflict scenarios.

These items require authorized backend inspection and physical multi-device acceptance evidence before production-readiness certification.
