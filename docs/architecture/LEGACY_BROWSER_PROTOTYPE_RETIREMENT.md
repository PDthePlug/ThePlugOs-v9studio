# Legacy browser prototype retirement boundary

**Status:** Accepted source-hygiene boundary. It does not grant product release
authority.

## Purpose

The original browser prototype contained simulated local-hub, browser pairing,
and browser operational-sync surfaces. They are not compatible with the
local-first authority model adopted by ADR-003 and ADR-005:

- the Android Cashier Hub is the local operational authority;
- a browser owner portal may request a short-lived enrollment code only through
  the authenticated `hub-owner-enrollment` Function;
- native hardware keys, signed cloud admission, pinned TLS, and a fresh Hub
  challenge establish a terminal's local authority;
- a browser tab, BroadcastChannel, manually entered LAN address, Express/SSE
  relay, or browser-held device credential cannot substitute for that path.

## Retired surfaces

The following unreferenced prototype files are intentionally removed:

- `src/services/PairingService.ts` — browser pairing compatibility stub;
- `src/components/DevicePairingWizard.tsx` — browser QR/pairing presentation
  that was not connected to the native enrollment authority.

`src/lib/security.ts` remains only as a fail-closed compatibility surface so
older browser callers receive a safe rejection rather than an accidental cloud
RPC. `OfflineHubInspector.tsx` remains a status-only browser view and must not
claim local delivery, peer discovery, or durable outbox state unless reported
by the native bridge.

## Historical certification archive

`docs/certification/` contains historical prototype material only. Its former
approval language is retained for audit history but every status label must
identify it as historical and superseded. The sole release authority is
`docs/operations/RELEASE_STATUS.md` plus named source, migration, deployment,
and physical-device evidence.

## Regression boundary

R021 verifies that removed browser pairing surfaces do not return, the
certification archive is visibly superseded, and the repository continues to
declare HOLD until cloud and hardware evidence exists. This test is a source
guard; it is not proof of radio, cloud, or operational acceptance.
