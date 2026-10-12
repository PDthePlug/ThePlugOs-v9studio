# PASS 4 — Owner control plane and staff-entry hardening evidence

- **Date:** 12 October 2026
- **Runtime/package candidate:** `286e7c3a86504961a2f4feba0966d0a05b1d85c8`
- **GitHub Actions run:** `38307178701`
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
| Journey artifact ID | `11773098330` |
| Artifact name | `theplugos-customer-journey-286e7c3a86504961a2f4feba0966d0a05b1d85c8` |
| Artifact archive SHA-256 | `7f779cf6e8adfffd30ed3cea9ab978bba73901cac1dedef5bede292e59ea5258` |
| Result | PASS |

## Android package evidence

The same candidate completed the CI Android debug-host assembly, checksum generation, and artifact upload.

| Evidence | Value |
| --- | --- |
| Android artifact ID | `11773610032` |
| Artifact name | `theplugos-android-debug-286e7c3a86504961a2f4feba0966d0a05b1d85c8` |
| Artifact archive SHA-256 | `742f3a56a57a77c3f63b65398a1fd96632d38106b9de388d007cbfb5c58f5347` |
| `app-debug.apk` SHA-256 | `0eda145eba27be9c5b0493abf792879419033480977371e141d59b6a74162581` |
| Result | Android `:app:assembleDebug` PASS; checksum PASS; upload PASS |

The downloaded APK was independently hashed after artifact extraction and matched the CI sidecar exactly.

**This package supersedes the earlier PASS2/PASS3 APK candidates for any future physical acceptance run.** The acceptance protocol itself remains `docs/testing/PHYSICAL_MULTI_DEVICE_TERMINAL_ACCEPTANCE.md`; its test requirements are unchanged.

## Vercel production evidence

The same runtime head reached Vercel production successfully:

- deployment: `dpl_CqrfkKuxZpWGKBxjpPtjQkPDk66n`
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
