# ADR-012 — Role-Based Merchant Experience Restoration

**Status:** Accepted for source implementation; release authority remains HOLD.

## Context

ThePlugOS originally exposed a simple merchant model: a trusted shop device presented staff profiles, the worker entered a PIN, and the system opened only the workspace assigned to that role. Subsequent security work correctly moved device identity, PIN verification, staff-session issuance, command signing and offline authority out of React and into the enrolled Android Hub/terminal runtime. During that transition, however, engineering concepts became visible in the merchant interface and the original role experience was replaced by a two-step “open native sign-in / open native station” flow.

The security architecture was correct; the product experience was not.

## Decision

Restore the merchant-facing role experience **without restoring browser authority**.

### Staff entry

On an enrolled Android host the visible flow is:

1. ThePlugOS asks **“Who’s working this station?”**
2. The worker opens secure staff sign-in.
3. The native Android Activity displays the signed staff directory and captures the PIN.
4. `CashierHubRuntime.beginStaffSessionFromNativeScreen(...)` verifies and installs the staff session.
5. When the Activity returns, React requests only `getNativeOperatorContext()`.
6. The verified native role routes to the matching role-minimized station.

The PIN, session bearer, command sequence, device key and signature never enter React.

### Role separation

The experience must preserve these boundaries:

- **Cashier** — sales, payment, collection and shift tasks required at the counter.
- **Kitchen** — preparation queue and hand-off tasks; no business finance view.
- **Manager** — branch operations, inventory, exceptions and shift/cash controls permitted to management.
- **Owner** — business-wide read views, branches, team, device enrollment and owner-bounded recovery/administration.
- **Administrator** — system/security support only where separately authorized.

A role label rendered in React is never authorization. The role used for operational routing comes from the native operator context after successful native staff-session verification.

### Owner browser

A normal browser remains an authenticated owner portal, not a shop terminal. It may:

- read owner-authorized business projections under RLS;
- show business heartbeat metrics;
- select an owned branch;
- request the bounded owner device-enrollment flow;
- request the bounded staff-credential recovery flow.

It may not capture a staff PIN, create a staff session, sign an operational command, or reintroduce direct browser mutations.

## UX rule

Architecture terminology is not merchant interface copy. Phrases such as “authorization bundle”, “browser authority”, “native staff-session flow”, “read-only cloud shell” and “local Hub authority” belong in engineering diagnostics and documentation, not the normal shop experience.

The default merchant language is task language: **Sign in, Sell, Prepare, Ready, Collect, Stock, Shift, Devices, Team, Reports.**

## Compatibility constraints

This ADR does not reverse R017–R021:

- Android remains the staff-session and command authority.
- Legacy browser PIN verification remains retired.
- Legacy browser pairing remains retired.
- Operational writes continue through accepted native authority commands.
- Release status remains **HOLD** until the existing release gates and merchant acceptance tests pass.

## Acceptance evidence

The R022 source contract must prove that:

- the React role gate contains no PIN input or `verifyStaffPin` path;
- the native PIN Activity still uses password-style numeric input and `beginStaffSessionFromNativeScreen`;
- React routes only from `getNativeOperatorContext()`;
- owner browser reads remain non-mutating;
- owner enrollment and credential-recovery controls remain bounded;
- R021 legacy retirement and release HOLD are preserved.
