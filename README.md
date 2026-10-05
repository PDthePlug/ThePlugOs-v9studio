# ThePlugOS

ThePlugOS is a local-first operating system for high-chaos small-business
operations. The first domain is township fast food.

> **Current status: HOLD — not production-ready.** Read
> [the release status](docs/operations/RELEASE_STATUS.md) before using this
> source against any Supabase project or operational device.

## What this source currently provides

- An owner-authenticated browser shell for the R001 business foundation.
- A deliberately fail-closed Android-native Cashier Hub foundation: SQLCipher
  local ledger, Android Keystore device keys, signed authorization bundles,
  native PIN entry, durable outbox, and cloud-receiver source.
- Owner-controlled Hub/terminal pairing source: cloud-issued one-time codes,
  Keystore-bound terminal admissions and renewal, and measured LAN mDNS,
  Wi-Fi Direct, Bluetooth-proximity, pinned-TLS local-link plumbing.
- Owner-authorized native credential recovery source: browser-issued one-time
  reset codes, Hub Keystore proof, and native-only PIN entry.
- Ordered R001A, R001–R012 migration source and Edge Function source. Source
  implementation and a narrow remediation window do not constitute a deployed
  product release.

The browser does **not** provide operational authority, staff PIN entry,
browser-to-browser LAN operation, payment settlement, or a live kitchen flow.
An authenticated terminal link is not yet a terminal staff-command surface.
Those functions remain gated until the stated staging and physical-device
evidence exists.

## Local source checks

Use Node `22.22.2` and npm `11.9.0`:

```bash
npm ci --legacy-peer-deps --no-audit --no-fund
npm run lint
npm run build
npm test
```

The complete repository gate is available as `npm run test:all`. It includes
the R001/R002 source checks and native-Hub static contracts; it does not replace
Supabase staging, Deno deployment, Android build, or hardware acceptance.

## Android Cashier Hub

Use JDK 21 and Android SDK API 36:

```bash
npm run android:sync
npm run android:assemble:debug
```

The build has no default cloud endpoint or issuer key. Supply only staging or
production-approved public configuration through Gradle properties, never
browser variables or source control. See
[the Android build and security guide](docs/implementation/ANDROID_CASHIER_HUB_BUILD_AND_SECURITY.md).

## Database and release safety

The only deployment inputs are the ordered files in `supabase/migrations/` and
their corresponding preflight/validation scripts. Artifacts in
`supabase/quarantine/` are forensic reference only and must not be applied.

Do not run R002 or R003 on production outside the exact owner-approved,
ordered remediation record in
[the controlled production remediation window](docs/evidence/CONTROLLED_PRODUCTION_REMEDIATION_2026-08-26.md).
The normal clean-staging sequence is documented in
[the Hub-authority rehearsal](docs/implementation/STAGING_HUB_AUTHORITY_REHEARSAL.md).
The source-only release helper can run a local guard with
`scripts/deploy-hub-cloud.sh --verify-source`; it refuses all remote mutation
while the release status remains HOLD.

## Frontend integration correction — 5 October 2026

The frontend is restored to the established Supabase application, as requested
by the project owner. Use the existing `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` and canonical `VITE_OWNER_PORTAL_ORIGIN` configuration.
Do not use the temporary Better Auth/database replacement from the takeover
commits. This correction requires no new database or migration.

The owner portal now reads branch-scoped orders, catalog/stock and confirmed
paid sales from existing RLS-protected projections. Cashier, kitchen and manager
views refresh through the existing native device runtime. Native PIN and device
credentials remain in their existing Android security boundary.

The user's authorization covers publishing this frontend correction to `main`
and Vercel. It does not provide physical-device acceptance evidence or authorize
unrelated database changes. See the release status for the remaining integration
checks. `scripts/qa-supabase-renderer.mjs` tests independent renderer contexts with
local fixtures only; it is not a real pairing or multi-device test.
