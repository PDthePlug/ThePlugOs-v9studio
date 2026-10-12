# PASS 2 — Role-session and cross-device conflict hardening evidence

Date: 12 October 2026

## Scope

This evidence record covers source-level hardening of the native terminal staff-session authority chain, terminal workspace safe-stop/revalidation, reproducible Android debug-host compilation in CI, and publication of a checksum-verifiable Android debug artifact for later physical acceptance. It does not claim live Supabase deployment, physical Android acceptance, radio connectivity, multi-device acceptance, or production release readiness.

Baseline source: `288731f1860ba9f1c49f40a0a4b66c7d11d4a63a`
CI-built hardening head: `af98903ab764f61e0a2aef52d919260099ba7eae`
First checksum-verifiable hardware-test candidate: `b500974b313ade81435c35c4bd8858e8f116c2e6`

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

The native workspace's current bounded authority revalidation interval is `15_000L` (15 seconds). Link loss itself clears the rendered task controls immediately when the measured local-link state leaves the authenticated/session-active states.

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

### 6. Checksum-verifiable hardware-test artifact

The CI workflow now requires the Android APK to exist after assembly, records an APK SHA-256 sidecar, and uploads both files as a short-retention GitHub Actions artifact. A missing APK or artifact upload fails the job.

The first completed candidate is:

| Field | Value |
| --- | --- |
| Source commit | `b500974b313ade81435c35c4bd8858e8f116c2e6` |
| GitHub Actions run | `38248980672` |
| Artifact ID | `11746871695` |
| Artifact name | `theplugos-android-debug-b500974b313ade81435c35c4bd8858e8f116c2e6` |
| Artifact size | `12,248,431` bytes |
| Artifact archive SHA-256 | `7cabfd978dba77cc7c8f89ede5b68706c6a7bc87b8717f194a8abe2c3317e792` |
| `app-debug.apk` size | `12,248,043` bytes |
| `app-debug.apk` SHA-256 | `b8d3c68570542fcc0ca4f1abebe691f8fca3b902e226abbc1a2de02ef7c22910` |
| Artifact expiry | 26 October 2026 |

The artifact was downloaded after publication and independently checked: the archive SHA-256 matched GitHub's recorded artifact digest, and the APK SHA-256 matched the uploaded `.sha256` sidecar exactly.

This proves package integrity and repeatable CI publication only. It is not evidence that the APK has been installed or run on physical Android hardware.

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

GitHub Actions run `38248092845` completed successfully for hardening head `af98903ab764f61e0a2aef52d919260099ba7eae`:

- dependency installation: PASS
- TypeScript/lint gate: PASS
- complete `npm run test:all`, including R024 and R025: PASS
- production web build: PASS
- Java 21 setup: PASS
- Android SDK 36 setup: PASS
- Capacitor Android sync: PASS
- Kotlin compilation: PASS
- Android `:app:assembleDebug`: PASS

GitHub Actions run `38248980672` completed successfully for artifact head `b500974b313ade81435c35c4bd8858e8f116c2e6`:

- dependency installation: PASS
- TypeScript/lint gate: PASS
- complete `npm run test:all`: PASS
- production web build: PASS
- Android debug host build: PASS
- APK checksum generation: PASS
- checksum-verifiable artifact upload: PASS

The native build reported non-blocking deprecation/future-compatibility warnings, including legacy Bluetooth/NSD/NetworkInfo APIs, status/navigation bar APIs, Gradle 9 deprecation warnings, and Kotlin intersection-type inference warnings in `HubDatabase.kt`. These did not fail the build and remain maintenance work, not PASS 2 acceptance evidence.

## Physical acceptance protocol

`docs/testing/PHYSICAL_MULTI_DEVICE_TERMINAL_ACCEPTANCE.md` now defines the required measured gates for:

- package integrity and physical API 24+ execution;
- LAN mDNS, Wi-Fi Direct, BLE proximity boundaries, TLS pinning, and fresh challenge proof;
- Cashier, Kitchen Staff, and Manager native PIN/session authority;
- role-minimized context and negative role matrix;
- same-staff cross-device supersession and same-terminal operator replacement;
- immediate safe-stop on link loss and bounded 15-second authority revalidation;
- exact signed retry, restart binding, and idempotency; and
- durable cloud acknowledgement and branch isolation when an authorized backend is available.

The protocol uses only PASS, FAIL, BLOCKED, and NOT RUN classifications. Any mandatory BLOCKED/FAIL condition keeps release status HOLD.

## Backend access boundary measured during PASS 2

A read-only project-access check was performed against the intended ThePlugOS production project reference `iwbbwcaylpulcpvbfkdx`. The currently connected Supabase account could list other accessible projects but returned permission denied for this project reference.

No Supabase project was mutated and no unrelated project was substituted.

Therefore live R014/Edge Function inspection, deployment, native cloud PIN/session receiver execution, and durable cloud-acknowledgement acceptance remain a real access/environment gate rather than a source-code pass condition.

## Release boundary

The source remains **HOLD** for product release. The following are still NOT VERIFIED by this evidence record:

- authorized inspection of the documented ThePlugOS Supabase production project and live R014 deployment;
- real cloud PIN/session receiver execution;
- installation and execution of the checksum-verifiable Android candidate on supported physical API 24+ hardware;
- two or more physical terminals proving same-staff conflict retirement;
- session replacement during live LAN/Wi-Fi Direct transport;
- terminal revoke/expiry while commands are in flight;
- certificate pinning and signed challenge behavior on actual local networks;
- restart/recovery on physical Android devices; and
- durable cloud acknowledgement following those conflict scenarios.

These items require authorized backend access and physical multi-device acceptance evidence before production-readiness certification.
