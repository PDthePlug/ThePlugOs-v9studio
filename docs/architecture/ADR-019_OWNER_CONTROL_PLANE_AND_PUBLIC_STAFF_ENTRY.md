# ADR-019 — Owner control plane and public staff entry

- **Status:** Accepted source design
- **Date:** 12 October 2026
- **Applies to:** Public access, browser owner portal, catalog administration, staff directory, native staff sign-in

## Context

The hardened security model correctly separated browser owner authority from native operational staff authority, but the recovered customer experience still created two product problems:

1. the public access surface visually presented only **Owner Access**, leaving Cashier, Kitchen and Manager users without an obvious entry path; and
2. the browser owner experience concentrated business information, pairing and recovery controls into one long page instead of a usable management workspace.

The marketing page promises connected orders, kitchen, stock, staff, cash and business insight. Those promises must map to real product surfaces without reintroducing retired browser PIN, local-ledger or operational-command authority.

## Decision

### Public entry

The public experience exposes two explicit paths:

- **Owner sign in / Set up my business** — Supabase owner authentication and business onboarding.
- **Staff sign in** — on an enrolled Android host, open the native staff profile/PIN activity; on an ordinary browser, direct the employee to their assigned enrolled shop device.

A staff PIN is never typed into, stored by, or verified by the public website or owner portal.

### Owner information architecture

The browser owner control plane is divided into distinct areas:

1. **Overview** — sales, order, team, device and stock-health summary.
2. **Orders** — searchable synchronized order history. Operational state transitions remain native.
3. **Menu** — owner-authorized catalog create, edit, archive and restore under Supabase RLS.
4. **Stock** — synchronized quantity visibility and low/out-of-stock signals. Physical receipt, count, correction and waste operations remain Manager/native commands.
5. **Finance** — captured sales, order value and payment-position reporting from synchronized order facts. The portal must not present historical profit, tax liability or COGS as verified facts until the data model records the required historical cost/settlement evidence.
6. **Team & access** — staff directory profiles and owner-authorized native credential recovery.
7. **Devices & settings** — Hub/terminal enrollment and branch device context.

### Staff profile administration

An owner may create a Cashier, Kitchen Staff or Manager directory profile in the cloud. Browser profile creation:

- contains no PIN;
- writes no credential verifier;
- creates no staff session;
- grants no device authority; and
- does not itself prove that the person can sign in operationally.

Initial PIN setup and later PIN recovery complete through the accepted native credential path on an enrolled Hub.

Role changes, deactivation and other actions that can invalidate operational authority are not implemented as casual browser table edits. They require a revocation/session-safe contract before they can be exposed as owner controls.

### Authority boundaries

The browser may mutate owner-control-plane catalog metadata and create non-credential staff directory records under the existing business/branch RLS. It must not:

- accept or verify a staff PIN;
- write stock quantities as a substitute for physical inventory commands;
- transition operational orders directly;
- create staff operational sessions;
- issue signed terminal commands; or
- fabricate financial results unsupported by synchronized records.

Cashier, Kitchen and Manager operational workspaces continue to open only after verified native operator context.

## Consequences

- Employees can immediately find the correct sign-in path without entering the Owner Access flow.
- Owners receive a navigable business-management workspace rather than one page attempting to represent every function.
- Menu administration becomes a real owner control-plane capability while inventory truth remains protected.
- Staff setup is useful without weakening PIN secrecy.
- Marketing promises map to explicit product areas, while unsupported accounting/profit claims remain visibly excluded.
- This ADR does not change release authority. Production readiness remains **HOLD** until live backend and physical-device acceptance evidence is complete.
