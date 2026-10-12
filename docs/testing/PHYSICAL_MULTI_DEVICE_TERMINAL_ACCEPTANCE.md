# Physical multi-device terminal acceptance protocol

- **Status:** Protocol ready; execution evidence pending
- **Date:** 12 October 2026
- **Release status:** HOLD until every mandatory gate below has measured evidence
- **Authority:** ADR-005, ADR-010, ADR-011, ADR-015, ADR-016, `docs/operations/RELEASE_STATUS.md`

This document is the current physical acceptance protocol for the native Cashier Hub and admitted Cashier, Kitchen Staff, and Manager Android terminals. It is not a certification record and does not convert CI/source evidence into hardware, radio, Supabase, or production evidence.

## 1. Frozen CI candidate available for hardware testing

The first checksum-verifiable hardware-test candidate produced by the hardened pipeline is:

| Field | Value |
| --- | --- |
| Source commit | `b500974b313ade81435c35c4bd8858e8f116c2e6` |
| GitHub Actions run | `38248980672` |
| Artifact ID | `11746871695` |
| Artifact name | `theplugos-android-debug-b500974b313ade81435c35c4bd8858e8f116c2e6` |
| Artifact archive SHA-256 | `7cabfd978dba77cc7c8f89ede5b68706c6a7bc87b8717f194a8abe2c3317e792` |
| `app-debug.apk` SHA-256 | `b8d3c68570542fcc0ca4f1abebe691f8fca3b902e226abbc1a2de02ef7c22910` |
| CI result | source/web verification PASS; Android `:app:assembleDebug` PASS; checksum PASS; artifact upload PASS |

The archive contains `app-debug.apk` and `app-debug.apk.sha256`. Before installation, the tester must independently calculate the APK SHA-256 and compare it with the sidecar above. A mismatch is an immediate **FAIL / STOP**.

A later candidate may replace this one only when its exact commit, workflow run, artifact ID/name, archive digest, and APK digest are recorded before physical testing starts.

## 2. Required test environment

Do not begin end-to-end operational acceptance unless all mandatory prerequisites are present and recorded.

### Hardware

- One supported physical Android device acting as the Cashier Hub.
- At least two independent supported physical Android terminal devices so same-staff supersession can be measured across devices.
- At least one device/API combination at the supported lower boundary (API 24+) before release approval.
- Device model, Android version, API level, app install timestamp, and non-secret ThePlugOS device ID recorded for every device.

### Backend and authority

- An authorized non-production/staging-equivalent Supabase project containing the accepted ordered schema through the terminal-session contract required by ADR-010/R014.
- Required native proof Edge Functions deployed in that environment, including the terminal staff-session receiver and Hub sync receiver used by the exercised path.
- Release/test issuer public keys provisioned into the candidate build and the matching issuer signing material provisioned only in the secure backend environment.
- One active Hub authority for the test branch and current signed terminal admissions for the test terminals.
- Active test staff records for the operational roles being exercised.

Production project `iwbbwcaylpulcpvbfkdx` must not be substituted, reset, or mutated merely to satisfy this protocol. If the authorized account cannot access the intended test backend, backend-dependent cases remain **BLOCKED**, not passed.

### Evidence safety

Never place any of the following in screenshots, logs, issue text, exported evidence, or this document:

- staff PIN values or PIN hashes;
- Android Keystore private keys;
- issuer private keys;
- service-role secrets;
- nonce/challenge secrets;
- full staff-session assertion envelopes; or
- cloud access tokens.

Record non-secret identifiers, timestamps, measured states, receipt IDs, command IDs where safe, hashes, and redacted logs only.

## 3. Evidence header for each execution

Copy and complete this block for every acceptance run:

```text
Acceptance run ID:
Date/time/timezone:
Tester:
Environment/project reference:
Schema/migration baseline:
Function versions/deployment identifiers:
Source commit:
Workflow run:
Artifact ID/name:
APK SHA-256 measured before install:
Hub device model / Android / API / ThePlugOS device ID:
Terminal A model / Android / API / ThePlugOS device ID / admitted role:
Terminal B model / Android / API / ThePlugOS device ID / admitted role:
Additional terminal(s):
Primary transport:
Secondary transport exercised:
Evidence location/references:
Overall result: PASS / FAIL / BLOCKED
```

## 4. Acceptance gates

A release candidate passes this protocol only when every mandatory case has direct measured evidence. “Source says so,” emulator behavior, CI compilation, fixtures, and screenshots of an unverified UI are not substitutes.

### Gate A — Package integrity and physical execution

| ID | Test | Required measured result |
| --- | --- | --- |
| A01 | Verify candidate APK digest before install | Calculated APK SHA-256 exactly equals the recorded candidate digest. |
| A02 | Install on supported physical Hub device | Install succeeds; application launches without crash. |
| A03 | Install on two or more supported physical terminal devices | Each install succeeds independently; each device retains its own native identity. |
| A04 | Restart application and device | Native identity/recovery behavior remains consistent; no browser storage is promoted into device authority. |

### Gate B — Local-link discovery, pinning, and challenge

ADR-005 requires discovery hints to remain non-authoritative. `AUTHENTICATED` is valid only after signed admission verification, matching discovery record, pinned TLS certificate verification, and successful fresh challenge proof.

| ID | Test | Required measured result |
| --- | --- | --- |
| B01 | LAN mDNS discovery | Terminal resolves only the admitted Hub record and proceeds through TLS pinning/challenge to `AUTHENTICATED`. |
| B02 | Discovery mismatch | A record that does not match admitted Hub identity/fingerprint is ignored; terminal continues searching. |
| B03 | Valid certificate pin | Matching Hub certificate fingerprint permits challenge progression. |
| B04 | Invalid certificate pin | Socket closes/fails closed; no fallback to normal CA-only trust or cleartext; no operator context remains visible. |
| B05 | Fresh signed challenge | Correct terminal key proof reaches `AUTHENTICATED`; stale/incorrect proof does not. |
| B06 | Link loss | Terminal returns to non-authenticated state and immediately removes previously rendered operational controls. |
| B07 | Wi-Fi Direct alternate path | When supported/configured, it reaches the same pinned TLS + fresh challenge authority path; peer name/SSID/MAC alone grants nothing. |
| B08 | Bluetooth proximity | BLE may provide `PROXIMITY_SEEN` only; BLE alone cannot pair, authenticate, install a staff session, or carry a command. |

If the device/OS combination cannot support a required transport because of a documented platform limitation, mark the case **BLOCKED** and resolve the release-scope decision explicitly. Do not silently convert it to PASS.

### Gate C — Native PIN session and role-minimized workspace

ADR-010 requires native, online, proof-bound PIN verification. ADR-011 requires the Hub to provide only role-appropriate measured context after the exact TLS connection has authenticated the admitted terminal.

| ID | Test | Required measured result |
| --- | --- | --- |
| C01 | Cashier native sign-in | Current admission + authenticated link + correct Cashier staff/PIN produce a signed session installed by the Hub; only Cashier context/actions render. |
| C02 | Kitchen Staff native sign-in | Correct Kitchen Staff proof produces only Kitchen queue context and PREPARING/READY actions. |
| C03 | Manager native sign-in | Correct Manager proof produces only shift, cancellable unpaid-order, and counted-inventory context/actions. |
| C04 | Wrong-role staff selection/session | Staff role that differs from admitted terminal role is rejected; no active session/context is installed. |
| C05 | PIN failure/lockout path | Generic native failure only; no staff session is created and no sensitive credential material appears in evidence/logs. |
| C06 | Session ID from another terminal | `OPERATOR_CONTEXT_REQUEST` is rejected without returning role context. |
| C07 | Context secrecy | No PIN, private key, staff-session envelope, authorization bundle, device public key, or cloud token appears in operator context. |
| C08 | Explicit local sign-out | Operational context disappears and a fresh native sign-in is required before commands are possible again. |

### Gate D — Role authorization matrix

The Hub command router must repeat role, branch, lifecycle, stock, cash, sequence, and scope checks. A displayed context is never command authority.

| ID | Test | Required measured result |
| --- | --- | --- |
| D01 | Cashier allowed actions | `order.create`, cash `payment.capture`, and valid `COLLECTED` transition succeed only under the required domain preconditions. |
| D02 | Cashier forbidden Manager/Kitchen actions | Manager-only inventory/shift actions and Kitchen PREPARING/READY actions are rejected with no business effect. |
| D03 | Kitchen allowed actions | Only valid `PREPARING`/`READY` order transitions succeed. |
| D04 | Kitchen forbidden Cashier/Manager actions | Cash/order-creation, shift, cancellation, and inventory management commands are rejected with no business effect. |
| D05 | Manager allowed actions | Valid shift open/close, unpaid cancellation, inventory receive/adjust/waste actions succeed only under domain preconditions. |
| D06 | Manager wrong-terminal/wrong-session role drift | Even a correctly signed command is rejected when current paired-device role differs from installed staff-session role. |
| D07 | Wrong branch | Cross-branch session/context/command attempt is rejected without data disclosure or mutation. |

### Gate E — Cross-device staff-session conflict behavior

ADR-015 requires one active local operational session per staff member per Hub authority.

| ID | Test | Required measured result |
| --- | --- | --- |
| E01 | Same staff on Terminal A, then Terminal B | Earlier Terminal A local staff session is revoked before Terminal B's newly verified session becomes usable. |
| E02 | Replace operator on same terminal | Earlier session on that terminal is revoked before the replacement session becomes usable. |
| E03 | Superseded Terminal A attempts a new command | Hub rejects it; no new business effect is committed. |
| E04 | Superseded Terminal A requests operator context | Context request fails and stale operational controls are removed. |
| E05 | Already committed command retried after revocation | Exact retry follows existing receipt/idempotency rules and creates no duplicate business effect. |
| E06 | Role changed after prior session | Current device-role/session-role mismatch causes rejection before permission evaluation or ledger mutation. |

Record both terminal states and the Hub-side session/receipt evidence. The test is not passed merely because Terminal A's screen looks inactive; the earlier authority must be measurably unusable.

### Gate F — Safe-stop, revalidation, and reconnect

ADR-016 requires stale controls to disappear immediately on link loss and supplies a bounded authenticated authority revalidation backstop. The current native implementation revalidates operator context every **15,000 ms**.

| ID | Test | Required measured result |
| --- | --- | --- |
| F01 | Authenticated link drops | Previously rendered operational task controls are removed immediately when local-link state leaves `AUTHENTICATED`/`STAFF_SESSION_ACTIVE`. |
| F02 | Session superseded without link drop | Old terminal loses usable context on the next revalidation; measured time from supersession to safe-stop must be no greater than one 15-second revalidation interval plus a small recorded transport/processing allowance. |
| F03 | Session expires | Context becomes unavailable; terminal requires fresh native sign-in rather than continuing from cached task data. |
| F04 | Reconnect after prior staff directory load | In-memory roster/request state is discarded while unauthenticated; a fresh role-filtered staff directory is requested after re-authentication before PIN entry is enabled. |
| F05 | New operator sign-in | Previous unsent Cashier basket is cleared before fresh operator context loads. |
| F06 | `APPLIED` command result | Fresh operator context is requested and rendered from Hub state. |
| F07 | `DUPLICATE` command result | Fresh operator context is requested; no duplicate business effect exists. |
| F08 | `REJECTED` command result | Fresh context is requested; authority rejection collapses to session-required state when applicable. |
| F09 | `UNAVAILABLE` command result | Exact encrypted pending signed intent remains retryable; terminal does not fabricate a final receipt or allocate replacement command bytes. |

### Gate G — Sequence, exact retry, restart, and idempotency

| ID | Test | Required measured result |
| --- | --- | --- |
| G01 | Command issued then transport lost before receipt | One pending signed intent survives; retry uses the same command ID, sequence, payload bytes, and signature. |
| G02 | Repeated retry | Hub returns the existing measured receipt/duplicate outcome; no second business effect is committed. |
| G03 | Terminal process/device restart with pending intent | Recovery accepts the pending command only when terminal device ID, staff-session ID, and sequence match the re-verified stored session. |
| G04 | Tamper recovered binding | Mismatched terminal/session/sequence is rejected and cannot be retried as valid authority. |
| G05 | Restart with superseded/expired session | Session is unusable; stale context does not reappear as live authority. |

### Gate H — Hub durability and cloud acknowledgement

These cases require an authorized backend with the accepted receivers deployed. If that environment is unavailable, they remain **BLOCKED** and the release remains HOLD.

| ID | Test | Required measured result |
| --- | --- | --- |
| H01 | Local commit while cloud reachable | Hub commits locally first and durable outbox delivery reaches the intended cloud receiver; acknowledgement is bound to the exact action-family group. |
| H02 | Cloud unavailable after local commit | Local receipt/state remains; outbox is retained and later retries without inventing cloud delivery. |
| H03 | Hub restart with pending outbox | Pending delivery survives restart and later acknowledges once, without duplicate domain effect. |
| H04 | Malformed/duplicate/cross-group acknowledgement | Local outbox is retained/fails closed under ADR-012/R019 rules. |
| H05 | Branch isolation | Cloud acknowledgement/data effects remain scoped to the intended branch/business authority. |

## 5. Failure classification

Use only these classifications:

- **PASS** — required measured result was directly observed and evidence is attached.
- **FAIL** — the system produced a contradictory or unsafe result.
- **BLOCKED** — a required environment, permission, hardware capability, or backend deployment was unavailable; no pass claim is permitted.
- **NOT RUN** — the case was deliberately not attempted.

Any FAIL in a security/authority, duplicate-effect, branch-isolation, TLS pinning, challenge, session-conflict, restart-binding, or durable-acknowledgement case keeps release status **HOLD**.

Any BLOCKED mandatory case also keeps release status **HOLD**.

## 6. Minimum evidence bundle

For each acceptance execution, preserve:

1. completed evidence header;
2. candidate APK SHA-256 measurement before installation;
3. physical device/API inventory;
4. timestamped state transitions for discovery → pinning → challenge → authenticated/session-active where exercised;
5. redacted command/receipt identifiers sufficient to prove idempotency and conflict outcomes;
6. redacted Hub/cloud logs for the tested branch and time window;
7. screenshots/video only where they prove a presentation result, never as the sole proof of authority or ledger behavior;
8. test-case PASS/FAIL/BLOCKED table with evidence references; and
9. explicit statement that no secret values were captured.

## 7. Release decision rule

This protocol alone does not approve a release. After every mandatory case passes, its evidence must be reconciled with `docs/operations/RELEASE_STATUS.md`, staging/restore evidence, payment/printing/Kitchen delivery scope, accessibility, observability, backup/restore, incident handling, and pilot acceptance.

Until that reconciliation is complete, **ThePlugOS remains HOLD**.
