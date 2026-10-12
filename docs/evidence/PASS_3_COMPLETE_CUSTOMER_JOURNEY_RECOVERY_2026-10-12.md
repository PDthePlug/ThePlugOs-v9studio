# PASS 3 — Complete customer journey recovery evidence

- **Date:** 12 October 2026
- **Release status:** HOLD — frontend recovery evidence is not production certification
- **Canonical repository:** `PDthePlug/ThePlugOs-v9studio`
- **Runtime/UI code-bearing commit:** `00b79529cb706137d4a7c2deb72760545a377aa1`
- **Sealed source/test candidate:** `ce36e6dc6776695494f92ca8385aa0b8db524951`
- **Final GitHub Actions run:** `38262383544`

## What PASS 3 recovered

The end-to-end frontend audit recovered and verified the customer journey rather than testing isolated screens only.

Owner path:

`landing → Set up my business → owner account → business/first branch → onboarding → owner dashboard → Resume setup`

Staff path:

`staff access → native profile/PIN handoff → verified native operator context → Cashier / Kitchen / Manager workspace`

The audit found and corrected these concrete regressions:

1. owners with onboarding still in progress were trapped on the setup screen and could not reach the read-only owner dashboard;
2. a first-time visitor could be rejected before `signUp()` because browser business creation attempted a user lookup even when no Auth session existed yet;
3. customer-facing signup/setup copy still exposed internal R001/native-hardening language; and
4. the pending-setup reminder initially floated over owner-dashboard content on mobile/desktop instead of remaining in the page flow.

The browser still never captures or verifies a staff PIN and never receives operational staff authority.

## Responsive visual acceptance

The fixture-only Playwright journey drives the real React transitions while intercepting Auth/PostgREST/native bridge calls locally. It does not contact production Supabase or simulate a successful PIN inside React.

Final responsive matrix: **9 states × 2 viewports = 18 screenshots**.

- Desktop: `1280×900`
- Mobile: `390×844`
- Horizontal-overflow assertion: PASS for all 18 captures
- Browser/page error assertion: PASS
- Owner setup → dashboard → Resume setup transition: PASS
- Native staff-entry shell: PASS
- Cashier workspace: PASS
- Kitchen workspace: PASS; price leakage assertion PASS
- Manager workspace: PASS
- Manual visual review of all 18 captures: PASS after the pending-setup overlay was moved into normal page flow

### Final visual artifact

| Field | Value |
| --- | --- |
| GitHub Actions run | `38262383544` |
| Artifact ID | `11753277300` |
| Artifact name | `theplugos-customer-journey-ce36e6dc6776695494f92ca8385aa0b8db524951` |
| Archive SHA-256 | `6b59dd6ef63b47725272e3bbe129f763ab5cedf0471e439d9f17504a20e69554` |
| Result | PASS |

The artifact manifest explicitly classifies its scope as fixture-only owner/native presentation evidence and not production Auth/PIN/pairing/LAN evidence.

## Successor Android hardware-test candidate

This PASS 3 package supersedes the older PASS 2 `b500974…` APK for any future physical acceptance run because the Android asset bundle now includes the recovered frontend journey.

| Field | Value |
| --- | --- |
| Source commit | `ce36e6dc6776695494f92ca8385aa0b8db524951` |
| GitHub Actions run | `38262383544` |
| Artifact ID | `11752548542` |
| Artifact name | `theplugos-android-debug-ce36e6dc6776695494f92ca8385aa0b8db524951` |
| Artifact archive SHA-256 | `70487bca81a81ea91864c5a6421ae2e45bab43f68dc2e19909dc00732ec821a0` |
| `app-debug.apk` SHA-256 | `8d791bc27fc880037de080d03604de741b0fbf4c8ba84b8ef1ba7dd61652b6ae` |
| Source/web/R001–R027 | PASS |
| Responsive journey visual gate | PASS |
| Android `:app:assembleDebug` | PASS |
| Checksum + artifact upload | PASS |

Before physical installation, independently calculate the APK SHA-256 and compare it with the sidecar. A mismatch remains an immediate FAIL / STOP under `docs/testing/PHYSICAL_MULTI_DEVICE_TERMINAL_ACCEPTANCE.md`.

## Deployment evidence boundary

The code-bearing commit `00b79529cb706137d4a7c2deb72760545a377aa1` reached Vercel READY and was assigned the canonical production alias. The later sealed candidate `ce36e6dc…` adds ADR-018, R027 and package test wiring but no application/runtime UI source change after `00b79529…`.

The automatic Vercel deployment for `ce36e6dc…` failed before build with `git_info_fail`. A forced redeploy of the same commit was still in `INITIALIZING` with no build events when this evidence was recorded. This platform metadata state is not treated as a frontend failure and is not represented as a successful exact-head deployment. The canonical production runtime remains the already-READY code-bearing frontend.

## What this evidence does not prove

PASS 3 does **not** prove:

- live production Supabase owner signup, email delivery/confirmation, RLS or RPC acceptance;
- production Edge Function deployment or durable cloud acknowledgement;
- real native staff PIN verification;
- physical Android installation or API 24+ behavior;
- Hub/terminal pairing, TLS pinning, LAN mDNS, Wi-Fi Direct or Bluetooth proximity;
- real multi-device session conflict behavior; or
- payment settlement, printing or pilot acceptance.

Those gates remain BLOCKED / NOT RUN until an authorized staging-equivalent backend and physical Android devices are available. Production readiness therefore remains **HOLD**.
