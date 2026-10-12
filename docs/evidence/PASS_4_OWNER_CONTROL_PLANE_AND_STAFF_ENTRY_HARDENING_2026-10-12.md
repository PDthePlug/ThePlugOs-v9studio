# PASS 4 — Owner control plane and staff-entry hardening evidence

- **Date:** 12 October 2026
- **Runtime/package candidate:** `3ab4ed04528713d32b33bc1e3f0091398bf51a13`
- **GitHub Actions run:** `38307761868`
- **Overall release status:** **HOLD** — this evidence closes the source/frontend/native-build slice only
- **Architecture:** ADR-019
- **Regression gates:** R028 owner control plane/public staff entry; R029 owner-control-plane RLS hardening

## What this pass closed

The public and owner-facing product no longer presents ThePlugOS as an owner-only login followed by a single overloaded management page.

The accepted customer entry model is now:

- **Owner sign in / Set up my business** → owner Auth → business/branch → onboarding → sectioned owner control plane.
- **Staff sign in** → enrolled Android shop device → native staff profile/PIN activity → verified native Cashier, Kitchen Staff, or Manager workspace.

A staff PIN is never entered into, stored by, or verified by the public website or owner portal.

The owner control plane is separated into seven real areas:

1. Overview
2. Orders
3. Menu
4. Stock
5. Finance
6. Team & access
7. Devices & settings

The public landing page now advertises only role experiences implemented by the hardened runtime: **Cashier, Kitchen, Manager, and Owner**. The unsupported Administrator marketing card was removed rather than representing an unavailable workspace as product capability.

The landing-page insight preview was also reconciled with the current owner data model. Unsupported **average preparation / pace** analytics were removed because the synchronized owner projection does not yet contain historical preparation-duration evidence. The owner promise now maps to facts the product actually surfaces: sales, order status, stock pressure, team, and device health.

## Owner capabilities verified in source/fixture journey

### Orders

The owner sees synchronized order history, cashier, operational/payment status, time, and total. The browser remains review-only for operational order transitions; those actions stay in the authorized Cashier/Kitchen/Manager path.

On phone widths the same semantic order table is presented as labeled order cards so the owner is not required to pan horizontally across a desktop table.

### Menu

The owner-control-plane catalog path supports real Supabase-backed create, edit, archive, and restore operations for customer-facing catalog metadata. The browser does not write physical stock quantities.

### Stock

The owner sees synchronized product quantities and low/out-of-stock signals. Physical receipt, count, correction, and waste remain Manager/native operations.

### Finance

The owner sees synchronized captured sales, captured order count, average captured order, open/unpaid value, and a seven-trading-day view. The portal intentionally does **not** present profit, tax liability, historical COGS, or bank settlement as verified facts until those source records exist.

### Team & access

The owner can create a credential-free Cashier, Kitchen Staff, or Manager directory profile. Profile creation creates no PIN and no operational session. Initial PIN activation and later PIN recovery continue through the owner-authorized native credential path on the enrolled Hub.

Role changes/deactivation remain withheld from ordinary browser row updates until a revocation/session-safe mutation contract exists.

### Devices & settings

The owner receives the existing hardened Hub/terminal enrollment controls and branch device context. This pass does not convert browser controls into device authority.

## Mobile hardening

At phone widths the owner workspace now exposes all seven control-plane areas as a visible two-column navigation grid rather than requiring discovery through a horizontal rail. The Devices & settings entry spans the final row.

The Orders surface converts to labeled cards at phone widths while retaining the full semantic table on desktop.

These mobile behaviors are protected by R028 and exercised by the responsive journey renderer.

## Responsive journey evidence

The local-fixture journey renderer exercised the real React transitions without contacting production Supabase and without emulating staff PIN verification in React.

It covers desktop `1280×900` and mobile `390×844` states for:

- landing;
- public staff access;
- create business;
- onboarding;
- owner overview with setup still pending;
- owner Orders;
- owner Menu, including fixture edit + add;
- owner Stock;
- owner Finance;
- owner Team & access, including fixture staff-profile creation;
- owner Devices & settings;
- returning-owner sign-in;
- native staff sign-in;
- Cashier;
- Kitchen; and
- Manager.

The journey completed successfully and retained the no-horizontal-page-overflow and Kitchen price-leak assertions.

| Evidence | Value |
| --- | --- |
| Journey artifact ID | `11773361352` |
| Artifact name | `theplugos-customer-journey-3ab4ed04528713d32b33bc1e3f0091398bf51a13` |
| Artifact archive SHA-256 | `c4b7527720b9ca4d964278161a02400c2eb09ed710ad0159bc4b724125a74563` |
| Result | PASS |

## Android package evidence

The same candidate completed the CI Android debug-host assembly, checksum generation, and artifact upload.

| Evidence | Value |
| --- | --- |
| Android artifact ID | `11772644528` |
| Artifact name | `theplugos-android-debug-3ab4ed04528713d32b33bc1e3f0091398bf51a13` |
| Artifact archive SHA-256 | `602b87b05af58946244d6375a86c39fcc8f821cf083e22a4033a81e6cb5d00d3` |
| `app-debug.apk` SHA-256 | `031c0b693eb2198c80dd3e7d31107e19768d1d640ed70d9d89ba2d779ffd883e` |
| Result | Android `:app:assembleDebug` PASS; checksum PASS; upload PASS |

The downloaded APK was independently hashed after artifact extraction and matched the CI sidecar exactly.

**This package supersedes the earlier PASS2/PASS3 and interim PASS4 APK candidates for any future physical acceptance run.** The acceptance protocol itself remains `docs/testing/PHYSICAL_MULTI_DEVICE_TERMINAL_ACCEPTANCE.md`; its test requirements are unchanged.

## Vercel production evidence

The same runtime head reached Vercel production successfully:

- deployment: `dpl_CVH6JqCcwz8MR9T3QUTDvKUJUgSw`
- target: production
- state: READY
- canonical alias: `theplugos-v9studio.vercel.app`

This proves frontend deployment/build availability only. It is not live Supabase Auth/RLS/function evidence.

## Backend boundary

Source migration `015` tightens owner-control-plane staff/catalog write policy so ordinary business membership does not imply unrestricted administration. Staff directory creation is owner-only and branch-bound; casual staff-row updates remain denied pending a session-revoking workflow.

That migration is **source evidence only in this pass**. The currently connected Supabase account cannot inspect or mutate ThePlugOS project `iwbbwcaylpulcpvbfkdx`, and the user has identified that project as paused. This pass therefore does not claim that migration `015`, current RLS, Edge Functions, Auth settings, or cloud acknowledgements are live-verified.

## What remains outside this pass

Production readiness remains **HOLD** until the existing release gates have measured evidence, including:

- authorized backend migration/RLS/Function validation;
- physical API 24+ Android execution;
- real native PIN activation/recovery;
- Hub + multiple terminal enrollment and cross-device session behavior;
- LAN/Wi-Fi Direct/BLE discovery boundaries;
- TLS pinning and fresh signed challenge behavior;
- restart/retry/outbox/cloud-ack durability; and
- remaining payment settlement, printing, cash-custody, and pilot acceptance requirements.

This record closes the frontend/customer-flow and package-build slice. It does not grant product release authority.
