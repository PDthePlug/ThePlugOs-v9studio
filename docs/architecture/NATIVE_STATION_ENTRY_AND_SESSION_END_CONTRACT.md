# Native Station Entry and Session-End Contract

- **Status:** Gate 2 source implementation — local-first, not deployed
- **Date:** 21 August 2026
- **Authority:** ThePlugOS Constitution, ADR-003, and the Native Hub
  Command-Request Bridge
- **Depends on:** verified native enrollment, native PIN sign-in, and the
  active native staff-session selector

## Purpose

Operational staff must not need an Owner's browser session to use an enrolled
Android Hub. This contract gives the native Capacitor host its own station
entry path while keeping a normal browser build owner-only and read-only.

```text
Android-native host
  -> native PIN sign-in
  -> non-secret native operator context
  -> role-specific native station
  -> end native staff session

Normal browser
  -> Owner authentication / cloud foundation only
  -> no staff station fallback
```

The selected role comes only from the verified native session returned by the
Hub. A URL, React state value, browser owner JWT, cached staff profile, or
plugin argument never selects a role or session.

## Entry boundary

The application may identify an Android-native host only by the presence of
the installed local Hub Capacitor capability. The host then presents the
native staff-sign-in path directly. It does not need a business ID, branch ID,
owner account, or browser Supabase session to open a station.

After a native sign-in, the operator context controls the route:

| Verified native role | Surface |
| --- | --- |
| `CASHIER` | Native Cashier station |
| `KITCHEN_STAFF` | Native Kitchen station |
| `MANAGER` | Native Manager station |
| all other values | explicit unavailable state; no generic operational screen |

The existing native station components remain incapable of accepting an
unverified role from a caller: each reads and checks the native operator
context again before rendering a task UI.

## End-session boundary

`endNativeStaffSession()` is a native capability with no request parameters.
It removes only the local SQLCipher `active_native_staff_session` selector and
notifies Hub observers after the deletion. It must be available even when the
selected session has expired, so a stale selector can be cleared.

It does **not** revoke a cloud staff session, change a PIN, alter a bundle,
delete a command receipt, delete an event/projection/audit fact/outbox item,
or discard an uncommitted native intent. Ending a local selector is not a
financial or workflow event. A later station entry requires a new native
PIN-sign-in flow and independently passes normal server/bundle/session checks.

Uncommitted intents remain durable because they are evidence of an interrupted
request. If their original signed session becomes unavailable, they remain
unusable rather than being silently reassigned or deleted.

## Failure handling

| Condition | Required behavior |
| --- | --- |
| Browser build attempts native entry or session end | return an explicit native-capability-unavailable result; never emulate it. |
| No active local selector | session end is a safe no-op and station data remains unavailable. |
| Local selector removal fails | keep the station visible and surface the native error; do not pretend sign-out succeeded. |
| Native staff role unsupported by a completed workspace | show an explicit unavailable state and no operational mutations. |
| Owner browser session changes | it cannot create, retain, or end native staff authority. |

## Non-goals

- No cloud revocation or remote logout protocol.
- No browser-selected role, PIN entry, session ID, or direct local-database
  mutation.
- No staging, deployment, production database mutation, or production-release
  claim from this source implementation.

## Contract checks

Source checks must prove that the Android host is routed independently of the
Owner browser shell, that the bridge's session-end method has no caller-supplied
selector, and that the database deletes only the active-selector row. Build,
device, and release evidence remain deferred until a supported environment is
available.
