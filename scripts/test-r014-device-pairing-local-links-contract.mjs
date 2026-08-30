import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [
  packageSource,
  config,
  r010,
  r011,
  terminalEndpoint,
  edgeProtocol,
  deployScript,
  releaseStatus,
  adr,
  manifest,
  mainActivity,
  runtime,
  hubWifiDirect,
  terminalLink,
  terminalCoordinator,
  terminalCloud,
  plugin,
  bridge,
  app,
  roleLogin,
  pairingControl,
  authorityStation,
] = await Promise.all([
  load('package.json'),
  load('supabase/config.toml'),
  load('supabase/migrations/010_device_pairing_and_local_links.sql'),
  load('supabase/migrations/011_terminal_admission_renewal.sql'),
  load('supabase/functions/hub-terminal-enrollment/index.ts'),
  load('supabase/functions/_shared/hub-protocol.ts'),
  load('scripts/deploy-hub-cloud.sh'),
  load('docs/operations/RELEASE_STATUS.md'),
  load('docs/architecture/ADR-005_TERMINAL_LOCAL_LINK_RUNTIME_AND_RELEASE_GATES.md'),
  load('android/app/src/main/AndroidManifest.xml'),
  load('android/app/src/main/java/com/theplugos/cashierhub/MainActivity.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubWifiDirectAdvertiser.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalLocalLinkController.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalAdmissionCoordinator.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalCloudAuthorityClient.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/ThePlugOSLocalHubPlugin.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/App.tsx'),
  load('src/components/RoleLoginModal.tsx'),
  load('src/components/NativeHubEnrollmentControl.tsx'),
  load('src/workspaces/NativeAuthorityStatusStation.tsx'),
]);

const requireText = (subject, fragment, message = `Expected source to contain: ${fragment}`) => {
  assert.ok(subject.includes(fragment), message);
};

const manifestPackage = JSON.parse(packageSource);
assert.equal(
  manifestPackage.scripts['test:r014-device-pairing'],
  'node scripts/test-r014-device-pairing-local-links-contract.mjs',
  'R014 must have a dedicated source contract command.',
);
assert.ok(manifestPackage.scripts['test:all'].includes('test:r014-device-pairing'), 'The full source gate must run R014.');

for (const nativeFunction of ['hub-enrollment', 'hub-staff-session', 'hub-sync', 'hub-terminal-enrollment']) {
  requireText(config, `[functions.${nativeFunction}]`);
  requireText(config, 'verify_jwt = false');
}
requireText(config, '[functions.hub-owner-enrollment]');
assert.match(config.slice(config.indexOf('[functions.hub-owner-enrollment]')), /verify_jwt\s*=\s*true/, 'Owner enrollment must retain JWT verification.');

requireText(r010, 'r010_issue_terminal_pairing_code');
requireText(r010, 'r010_begin_terminal_enrollment');
requireText(r010, 'r010_finalize_terminal_enrollment');
requireText(r010, "'LAN_WIFI', 'WIFI_DIRECT', 'BLE_PROXIMITY'");
requireText(r011, 'R011_REQUIRES_COMPLETE_R010');
requireText(r011, 'CREATE TABLE public.hub_terminal_renewal_challenges');
requireText(r011, 'r011_begin_terminal_admission_renewal');
requireText(r011, 'r011_get_terminal_admission_renewal_context');
requireText(r011, 'r011_finalize_terminal_admission_renewal');
requireText(r011, "'TERMINAL_ADMISSION_RENEWED'");
assert.ok(!r011.includes('FROM public.hub_terminal_admissions\n    WHERE terminal_device_id = v_terminal.id AND revoked_at IS NULL\n    DELETE'), 'Terminal renewal must replace admissions through an audited revoke/insert path.');

requireText(terminalEndpoint, 'requireNativeJson(request, 64 * 1024)');
requireText(terminalEndpoint, "if (action === 'renew-begin')");
requireText(terminalEndpoint, "if (action === 'renew-complete')");
requireText(terminalEndpoint, 'r011_begin_terminal_admission_renewal');
requireText(terminalEndpoint, 'r011_finalize_terminal_admission_renewal');
assert.ok(!terminalEndpoint.includes('Access-Control-Allow-Origin'), 'Native terminal enrollment must not expose a browser CORS surface.');
requireText(edgeProtocol, "'theplugos.terminal-enrollment.v1'");
requireText(edgeProtocol, "'theplugos.terminal-renewal.v1'");

requireText(manifest, 'android.permission.BLUETOOTH_SCAN');
requireText(manifest, 'android.permission.NEARBY_WIFI_DEVICES');
requireText(manifest, 'android.permission.ACCESS_FINE_LOCATION');
requireText(manifest, 'NativeTerminalLocalLinkActivity');
requireText(mainActivity, 'Manifest.permission.ACCESS_FINE_LOCATION');
requireText(mainActivity, 'Manifest.permission.NEARBY_WIFI_DEVICES');
requireText(runtime, 'HubWifiDirectAdvertiser');
requireText(runtime, 'wifiDirectAdvertiser.start');
requireText(runtime, 'wifiDirectAdvertiser.stop');
requireText(hubWifiDirect, 'WifiP2pDnsSdServiceInfo');
requireText(hubWifiDirect, 'createGroup');
requireText(hubWifiDirect, 'addLocalService');
requireText(terminalLink, 'NsdManager');
requireText(terminalLink, 'WifiP2pDnsSdServiceRequest');
requireText(terminalLink, 'FingerprintTrustManager');
requireText(terminalLink, 'MessageDigest.isEqual');
requireText(terminalLink, 'client.setSocketFactory');
requireText(terminalLink, '"CHALLENGE"');
requireText(terminalLink, '"READY"');
assert.ok(!terminalLink.includes('submitNativeCommandRequest'), 'The local-link client must not invent a browser command path.');
requireText(terminalCoordinator, 'fun renewableAdmission()');
requireText(terminalCoordinator, 'verifyEnvelope(JSONObject(serialized), allowExpired = true)');
requireText(terminalCloud, 'fun renewTerminalAdmission()');
requireText(terminalCloud, '"renew-begin"');
requireText(plugin, 'fun openNativeTerminalLocalLink');
requireText(bridge, 'openNativeTerminalLocalLink(): Promise<void>;');

requireText(app, 'NativeAuthorityStatusStation');
requireText(app, "nativeStationRole === 'OWNER' || nativeStationRole === 'ADMINISTRATOR'");
requireText(app, 'selectOwnerBranch');
requireText(roleLogin, 'onSelectBranch?: (branchId: string) => void;');
requireText(roleLogin, 'const activeBranches = branches.filter((branch) => branch.isActive);');
requireText(pairingControl, 'Device pairing');
requireText(pairingControl, 'Open terminal local-link status');
requireText(pairingControl, 'setCode(null);');
requireText(authorityStation, 'no Owner or Administrator operational-command family');
assert.ok(!authorityStation.includes('supabase'), 'Owner/Administrator native status must not mutate Supabase directly.');

requireText(adr, 'local-link state machine');
requireText(adr, 'certificate pin');
requireText(adr, 'release helper may');
requireText(deployScript, '--verify-source');
requireText(deployScript, '--deploy');
requireText(deployScript, 'require_approved_release');
requireText(deployScript, 'THEPLUGOS_DEPLOY_CONFIRM');
requireText(deployScript, 'THEPLUGOS_RELEASE_COMMIT');
assert.ok(!deployScript.includes('supabase db push --project-ref "$SUPABASE_PROJECT_REF"\n\nfor') || deployScript.includes('require_approved_release'), 'A deployment must remain behind the release approval guard.');
requireText(deployScript, 'git status --porcelain');
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Source stays HOLD until staging and physical evidence exists.');

execFileSync('bash', ['-n', resolve(root, 'scripts/deploy-hub-cloud.sh')], { stdio: 'pipe' });

const [r001, r002, r003, r004, r005, r006, r007, r008, r009] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('supabase/migrations/005_cash_shift_and_capture.sql'),
  load('supabase/migrations/006_cash_shift_close.sql'),
  load('supabase/migrations/007_inventory_receipt.sql'),
  load('supabase/migrations/008_inventory_count_correction.sql'),
  load('supabase/migrations/009_inventory_waste.sql'),
]);

const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID LANGUAGE sql STABLE
    AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::UUID';
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT LANGUAGE sql STABLE
    AS 'SELECT NULLIF(current_setting(''request.jwt.claim.role'', true), '''')';
  `);
  await db.exec(r001);
  await db.exec('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;');
  for (const migration of [r002, r003, r004, r005, r006, r007, r008, r009, r010, r011]) await db.exec(migration);

  // PGlite applies the production DDL and validates function signatures. Its
  // embedded regex engine cannot execute PostgreSQL's `{64,4096}` key-pattern
  // guards, so behavioural proof tests remain in the real-Supabase release
  // gate rather than weakening the production migration for this local engine.
  const schema = await db.query(`
    SELECT
      to_regclass('public.hub_terminal_renewal_challenges')::text AS challenges,
      to_regprocedure('public.r011_begin_terminal_admission_renewal(text,text,uuid,text,text)')::text AS begin_renewal,
      to_regprocedure('public.r011_get_terminal_admission_renewal_context(uuid)')::text AS renewal_context,
      to_regprocedure('public.r011_finalize_terminal_admission_renewal(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz)')::text AS finish_renewal;
  `);
  assert.deepEqual(schema.rows[0], {
    challenges: 'hub_terminal_renewal_challenges',
    begin_renewal: 'r011_begin_terminal_admission_renewal(text,text,uuid,text,text)',
    renewal_context: 'r011_get_terminal_admission_renewal_context(uuid)',
    finish_renewal: 'r011_finalize_terminal_admission_renewal(uuid,uuid,text,text,text,jsonb,timestamp with time zone,timestamp with time zone)',
  }, 'R011 must apply as an ordered schema extension with all service-only renewal functions.');
} finally {
  await db.close();
}

console.log('R014 device-pairing and local-link contract checks passed');
