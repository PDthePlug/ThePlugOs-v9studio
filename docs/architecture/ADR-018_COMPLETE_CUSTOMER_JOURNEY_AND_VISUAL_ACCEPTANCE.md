# ADR-018 — Complete customer journey and visual acceptance

- **Status:** Accepted source design
- **Date:** 12 October 2026
- **Applies to:** Browser owner journey, native staff entry, role workspaces, responsive frontend acceptance

## Context

ADR-017 recovered the merchant-facing onboarding presentation without restoring legacy browser operational authority. The subsequent end-to-end audit found two additional journey regressions that isolated screen review had not exposed:

1. an owner whose `onboarding_status` was still in progress could reach the setup screen but had no route into the read-only owner dashboard; and
2. a genuinely new owner could be rejected before `signUp()` because the create-business handler attempted a server user lookup even when no Auth session existed yet.

The audit also confirmed that the previous renderer began only after owner authentication or after a native staff session already existed. It therefore could not prove the customer journey that merchants actually traverse.

## Decision

1. **The browser owner journey is a continuous product flow:** landing → Set up my business → owner account → business and first branch → shop onboarding → owner dashboard.
2. A first-time owner with no Auth session is allowed to call Supabase `signUp()`. If a browser session already exists, it must be server-verified with `getUser()` before being reused to create a business.
3. Email confirmation remains a gate before the business/branch foundation RPC when the Supabase project requires confirmation.
4. An owner may enter the read-only cloud dashboard while secured shop onboarding remains in progress. Entering the dashboard must not mutate `onboarding_status`, imply trade readiness, or unlock operational authority.
5. Pending shop setup remains visibly resumable from the owner dashboard. The reminder must remain in normal page flow and must not cover orders, device pairing, or staff-recovery controls on mobile or desktop.
6. **The staff journey remains native-authority only:** staff access → native profile/PIN verification → verified operator context → Cashier, Kitchen or Manager workspace. React never captures or verifies the staff PIN.
7. Cashier, Kitchen and Manager workspaces remain role-minimized. In particular, the Kitchen presentation must not expose product price/payment controls.
8. A fixture-only Playwright journey is a required frontend acceptance gate. It must exercise the actual screen transitions and capture the following nine states at both 1280×900 desktop and 390×844 mobile:
   - landing;
   - create-business access drawer;
   - onboarding;
   - owner dashboard while setup is pending;
   - returning-owner sign-in;
   - native staff-entry shell;
   - Cashier workspace;
   - Kitchen workspace;
   - Manager workspace.
9. The renderer must fail on horizontal overflow, unexpected browser errors, broken route transitions, or Kitchen price leakage, and its screenshots/manifest must be retained as CI evidence.
10. Fixture visual acceptance proves frontend presentation and routing only. It is **not** evidence of live Supabase Auth/RLS/functions, real staff PIN verification, physical pairing, TLS/local-link behavior, or multi-device acceptance.
11. Restoring the complete customer journey does **not** change release authority. Production readiness remains **HOLD** until the backend and physical-device gates recorded in the release status and acceptance protocol pass.

## Consequences

- Frontend regressions that strand a new owner or bypass a major journey step are caught before merge/deployment.
- The owner can use the cloud control plane while shop setup is still incomplete without being told the business is trade-ready.
- Mobile and desktop presentation are evidence-backed rather than inferred from source code alone.
- Native staff authority and role isolation remain unchanged by the recovered customer experience.
- Visual CI becomes part of the application contract, but cannot be used to overstate live backend or hardware readiness.
