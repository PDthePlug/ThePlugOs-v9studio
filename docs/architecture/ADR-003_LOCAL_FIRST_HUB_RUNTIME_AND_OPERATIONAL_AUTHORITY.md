# ADR-003: Local-First Hub Runtime and Operational Authority

- **Status:** Accepted for Gate 0 architecture work
- **Date:** 15 August 2026
- **Decision owner:** ThePlugOS product owner
- **Authority:** ThePlugOS Constitution, Engineering Charter v1.0, ADR-001, and ADR-002

## Context

ThePlugOS is intended to keep a physical shop operating through internet loss,
tablet restarts, and high-volume periods. The current browser SPA can preserve
some per-browser state, but its `BroadcastChannel` implementation is not a
shop LAN and its browser-held role state is not an authorization boundary.

The product owner has selected the **full local-first** path. This resolves the
open runtime decision recorded in the Readiness Assessment: The production
Cashier Hub will be a managed Android runtime with a durable local database and
an authenticated local transport. Cloud sync is backup, reporting, remote
visibility, and recovery infrastructure; it is not a prerequisite for a sale
or a kitchen ticket within a running shop.

R001 remains the accepted cloud foundation. R002 remains an unapplied,
unaccepted security migration candidate and is not treated as sufficient
operational authorization.

## Decision

### 1. A branch has one active Cashier Hub

Each branch has one active, paired Cashier Hub at a time. It is the local
authority for operational writes while the shop is running. Controlled
failover is a separate, audited handover procedure; two independently writable
hubs for one branch are not permitted in the first production release.

### 2. The production runtime is native Android, not a browser-only LAN claim

The existing React/TypeScript experience layer is preserved and progressively
migrated into a Capacitor Android application. The Android host supplies a
native Hub Service and a Capacitor bridge for capabilities that a browser
cannot provide reliably:

- encrypted SQLite storage with keys protected by Android Keystore;
- background-safe local persistence and recovery;
- authenticated local WebSocket transport for paired shop devices;
- hardware and network capability discovery; and
- platform-held device key material.

Cashier, Kitchen, Manager, and Owner terminals that participate in shop-local
operation use the approved native companion runtime. An ordinary browser may
remain a development or remote-owner surface, but it may not claim physical
LAN discovery, trusted-device status, or cross-device offline delivery.

### 3. Every operational command passes through the Hub

Operational workspaces do not write business tables directly through a browser
Supabase JWT. A terminal sends an authenticated, idempotent command to the
Hub. The Hub validates the device, staff session, business, branch, role, and
command permission, then commits the command in one SQLite transaction.

The transaction writes the immutable event, current projection changes,
idempotency receipt, audit facts, and durable cloud outbox record together.
The Hub publishes the resulting event to subscribed local terminals only after
that commit succeeds.

This applies first to order, payment, stock, shift, cashup, refund, and kitchen
commands. Master-data administration follows the same command boundary rather
than bypassing it with direct client writes.

### 4. Device and staff authority is cryptographically bound and revocable

Each native terminal generates a non-exportable device key pair in Android
Keystore. Pairing is an online, one-time enrollment flow that requires proof of
possession of that key. The Hub authenticates every local connection with a
challenge signed by the paired device.

The cloud authority issues a signed, expiry-bound offline authorization bundle
for a paired branch. It contains only the minimum device, staff, role,
permission, and revocation-version facts required for an offline shop to keep
working. The encrypted local verifier never stores a plaintext PIN. The cloud
remains authoritative for enrollment, PIN reset, suspension, revocation, and
bundle renewal; the Hub enforces the last valid signed bundle while offline and
reconciles security events immediately on recovery.

R002 may provide server-side credential, lockout, pairing, and revocation
primitives after staging acceptance. It does not grant an owner browser JWT
unrestricted Cashier, Kitchen, Manager, or paired-device authority.

### 5. Cloud synchronization is a durable, acknowledged replication pipeline

The Hub is the only source that replicates branch operational events to the
cloud. It sends events to a server-side authenticated receiver with a globally
unique event ID, command idempotency key, branch, device, staff session, and
causal sequence. The receiver records idempotency and acknowledgement before
returning success.

The Hub removes an outbox record only after a durable acknowledgement. A
connection returning does not itself clear work. Cloud-to-hub configuration,
revocations, and remote-owner commands have their own acknowledged inbox path;
they do not overwrite local operational history.

### 6. Interfaces report measured state only

The shared shell and all workspaces derive connected, local, queued, synced,
sent, printed, healthy, and error states from named runtime authorities with
timestamps and failure detail. Unsupported capability is displayed as
unavailable, not as a successful simulation.

## Required command and event boundary

The detailed command contract is recorded in
`LOCAL_FIRST_OPERATIONAL_COMMAND_CONTRACT.md`. Local stock reservation and
authorization-bundle rebase rules are recorded in
`LOCAL_FIRST_INVENTORY_AND_RENEWAL_CONTRACT.md`. No Hub, transport, order, or
workspace implementation may proceed without complying with those contracts.

## Explicit non-goals

- No simulated LAN discovery, certificates, printer success, notifications, or
  sync acknowledgements.
- No direct browser mutation of operational tables as a role-authorization
  mechanism.
- No R002 deployment to production, and no production R001 mutation, during
  this architecture phase.
- No change to the accepted R001 migration or accepted R001 production data.
- No multi-writer hub topology in the initial release.

## Migration path

1. Reproduce the exact Node 22.22.2/npm 11.9.0 repository baseline and restore
   the missing statement-aware dump-inspector safety correction.
2. Complete the safe R001 staging clone and rehearse R002 only in staging.
3. Build the native Hub runtime, local schema, command boundary, receipts,
   outbox, receiver, and device/session authority behind executable contracts.
4. Move Cashier-to-Kitchen order execution onto the Hub and prove it on
   separate physical devices during cloud and router partitions.
5. Move inventory, payments, shifts, cashups, refunds, Manager, and Owner
   workflows onto the same authoritative pipeline.
6. Replace compatibility-layer workspace UI with task-first native surfaces
   backed by measured state.

## Acceptance criteria

The architecture is not accepted as operational until evidence proves that:

- a Cashier creates an order in under eight seconds while cloud access is off;
- a paired Kitchen receives complete line items from the Hub in under 500 ms on
  the shop LAN;
- restarts preserve committed orders and queued events without duplication;
- an acknowledged cloud retry has exactly one business effect;
- revoked, expired, unpaired, wrong-branch, and wrong-role terminals cannot
  issue operational commands;
- cloud recovery delivers queued work in causal order and exposes conflicts;
- no status surface reports success without a local or cloud acknowledgement;
- all role workflows pass on the intended low-cost Android hardware.

## Consequences

This path is more substantial than styling a web interface, but it is the only
path consistent with the Constitution's hub-and-spoke, local-first, durable
event model. It preserves the redesign as the experience direction while
replacing prototype authority with a production operating system.
