# ADR-017 — Owner journey recovery and native onboarding handoff

- **Status:** Accepted source design
- **Date:** 12 October 2026
- **Applies to:** Browser owner access, first-business onboarding, native device enrollment, role workspaces

## Context

The hardened browser architecture correctly retired browser-held staff PINs, device authority, and operational role sessions. During that hardening, the former first-business wizard was replaced with an engineering safe-stop. The replacement exposed release/staging language to merchants and no longer matched the product journey. It also stopped using the existing `plug-setup-head` / `plug-setup-body` presentation contract, producing a light card with light body text on mobile.

Owner authentication is also intentionally restricted to one configured portal origin. Vercel preview, branch, and deployment aliases therefore fail closed with `UNAPPROVED_RUNTIME_ORIGIN`; those aliases must not become credential collection surfaces.

## Decision

1. **V9 Studio remains canonical.** V9 is a forensic UX reference only; its browser operational/session shortcuts are not restored.
2. The approved owner portal remains the only browser origin allowed to collect owner credentials or receive Auth confirmation/recovery redirects.
3. Non-approved Vercel aliases must route or hand off to the approved owner portal rather than becoming alternate login surfaces.
4. The first-business browser experience is restored as a merchant-facing setup journey after the owner account, business and first branch exist.
5. Browser onboarding may explain progress and invoke the bounded `NativeHubEnrollmentControl` pairing action. It must not collect or verify staff PINs, expose device keys, create local operational authority, or write independent partial staff/catalog/credential completion state.
6. Staff profiles, PIN authority, station authority, and operational setup finish on the enrolled Android Cashier Hub/native flow.
7. Cashier, Kitchen and Manager workspaces continue to open only from verified native operator context. The Owner browser remains cloud/control-plane presentation.
8. The setup journey must use the established merchant setup presentation contract (`plug-setup-head` and `plug-setup-body`) so mobile contrast and layout remain coherent.
9. Restoring this UX does **not** change the product release status. Production readiness remains HOLD until backend and physical-device acceptance gates pass.

## Consequences

- Merchants see a coherent setup journey instead of internal release instructions.
- Existing owner signup/login and role dashboards are preserved rather than replaced.
- Generated Vercel URLs do not weaken the owner credential-origin boundary.
- The frontend can be completed and visually accepted while Supabase production access or physical hardware remains unavailable.
- No browser staff PIN path or legacy browser operational authority is reintroduced.
