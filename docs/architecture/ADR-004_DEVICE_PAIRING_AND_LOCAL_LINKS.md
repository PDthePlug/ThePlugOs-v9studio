# ADR-004: Device Pairing and Local-Link Authority

- **Status:** Accepted for implementation by the product owner
- **Date:** 21 August 2026
- **Decision owner:** ThePlugOS product owner
- **Supersedes:** The pairing claims in the historical certification artefacts
- **Depends on:** ADR-003, `NATIVE_HUB_ENROLLMENT_AND_SYNC_PROTOCOL.md`, and the local operational-command contract

## Context

The previous implementation contained two incomplete and unsafe extremes: a
browser-facing prototype pairing flow, and a native Hub enrollment flow that
could enroll one Hub but could not give the owner a clear dashboard control or
complete the lifecycle for a second terminal.  It also described LAN, Wi-Fi,
and Bluetooth more broadly than the implemented runtime could prove.

The production objective is simple for an operator: an owner can pair a Cashier
Hub or a branch terminal without entering an IP address, and every paired
device has a cloud-verifiable identity before it can join the local branch
network.  The objective does not permit an unauthenticated Bluetooth device,
a browser tab, a local-storage ID, or an IP address to become authority.

## Decision

### 1. Pairing has two explicit device classes

1. **Cashier Hub enrollment** creates or replaces the one active, branch-local
   authority.  It creates a non-exportable Android signing key and a local TLS
   certificate, then obtains a cloud-signed Hub authorization bundle.
2. **Terminal enrollment** adds a non-Hub device to the already active branch.
   It creates its own non-exportable Android signing key and receives a
   cloud-signed terminal admission.  The active Hub receives the terminal
   identity only through a renewed signed Hub bundle; it never trusts a
   terminal merely because it saw it on a network.

An owner selects the device class, terminal name, and terminal role in the
owner dashboard.  The dashboard asks the cloud to issue a short-lived,
single-use code.  The code is held only in component memory and is entered
directly on the native Android screen.  It is never put in a URL, browser
storage, Capacitor call, logs, or a local pairing API.

### 2. Cloud remains the authority for enrollment and revocation

The cloud records only bcrypt code hashes and public device facts.  It issues
both Hub bundles and terminal admissions with the same pinned P-256 issuer.
The issuer private JWK exists only as an Edge Function secret; an Android build
contains only the corresponding public key(s), indexed by immutable key ID.

Terminal enrollment or revocation increments the branch authority revision.
The Hub's normal maintenance cycle reconciles that revision and installs the
next signed bundle before it accepts the new terminal or continues a revoked
terminal.  An already-running Hub never imports an unsigned cloud row or
browser-provided device record.

### 3. Link selection is capability-based, not a security bypass

| Link | Purpose | Security requirement |
| --- | --- | --- |
| Wi-Fi LAN | Primary local command and event transport | Native service discovery, TLS certificate fingerprint pinning, and signed device challenge |
| Wi-Fi Direct | Routerless alternative to the same local TLS transport | The same discovery record, pinned certificate, and signed challenge after a native P2P network is established |
| Bluetooth LE | Proximity-assisted discovery and enrollment handoff | It carries no operational command authority and does not replace TLS/pinned-certificate validation |

Bluetooth may help a terminal confirm that a Hub is physically nearby and may
help an operator choose the right Hub.  It does **not** turn raw Bluetooth into
an unencrypted operational channel.  A terminal only becomes connected when a
native LAN or Wi-Fi Direct TLS connection has passed the certificate pin and
the Hub's signed-device challenge.  This keeps the local-first command
boundary coherent across all available radios.

### 4. Measured status is mandatory

The UI must distinguish:

- code issued;
- native enrollment screen opened;
- cloud admission installed;
- active Hub bundle updated;
- LAN/Wi-Fi Direct listener advertised;
- Bluetooth proximity capability available; and
- authenticated local connection established.

No screen may call a device paired merely because a code was generated or a
radio is enabled.  Bluetooth, LAN, Wi-Fi Direct, and cloud status are all
reported as measured native capabilities with a timestamp or failure detail.

## Required cloud configuration

The deployment requires these Edge Function secrets, none of which may be
committed to Git or a Vite variable:

- `HUB_AUTHORIZATION_ISSUER_KEY_ID`
- `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON`
- `HUB_RATE_LIMIT_PEPPER`
- `HUB_OWNER_PORTAL_ORIGIN`

The Android release receives only:

- `THEPLUGOS_CLOUD_FUNCTIONS_BASE_URL`
- `THEPLUGOS_BUNDLE_ISSUER_KEYS_JSON`

The public browser receives the Supabase URL and publishable key only.  The
repository provides validation and deployment configuration for these values;
it never stores passwords, service-role keys, issuer private keys, or database
connection strings.

## Consequences

This removes the misleading legacy browser pairing controls.  It also means a
physical-device release still requires permission grants and real radio tests:
source code can be complete and fail closed, but only an Android device and
branch network can prove a radio connection.  Until that proof exists, the UI
must show an unverified or unavailable state rather than a success state.
