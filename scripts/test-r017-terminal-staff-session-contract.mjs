import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');
const requireText = (subject, fragment, message = `Expected source to contain: ${fragment}`) => {
  assert.ok(subject.includes(fragment), message);
};

const [
  packageSource,
  config,
  r014,
  endpoint,
  edge,
  protocol,
  transport,
  runtime,
  hubVerifier,
  terminalLink,
  terminalCloud,
  terminalSession,
  terminalCommandClient,
  terminalKeys,
  hubDatabase,
  hubCloudSync,
  manifest,
  adr,
  localLinkAdr,
  deployScript,
] = await Promise.all([
  load('package.json'),
  load('supabase/config.toml'),
  load('supabase/migrations/014_terminal_staff_session_and_command_authority.sql'),
  load('supabase/functions/hub-terminal-staff-session/index.ts'),
  load('supabase/functions/_shared/hub-edge.ts'),
  load('supabase/functions/_shared/hub-protocol.ts'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/AuthenticatedLocalWebSocketTransport.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalLocalLinkController.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalCloudAuthorityClient.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalStaffSessionCoordinator.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalOperationalCommandClient.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalKeyManager.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCloudSyncClient.kt'),
  load('android/app/src/main/AndroidManifest.xml'),
  load('docs/architecture/ADR-010_NATIVE_TERMINAL_STAFF_SESSION_AND_COMMAND_AUTHORITY.md'),
  load('docs/architecture/ADR-005_TERMINAL_LOCAL_LINK_RUNTIME_AND_RELEASE_GATES.md'),
  load('scripts/deploy-hub-cloud.sh'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r017-terminal-session'],
  'node scripts/test-r017-terminal-staff-session-contract.mjs',
  'R017 must retain a dedicated terminal-session source contract command.',
);
assert.ok(packageManifest.scripts['test:all'].includes('test:r017-terminal-session'), 'The full source gate must run the terminal-session contract.');

requireText(config, '[functions.hub-terminal-staff-session]');
assert.match(
  config.slice(config.indexOf('[functions.hub-terminal-staff-session]')),
  /verify_jwt\s*=\s*false/,
  'Native terminal staff sessions verify their own proof and must not require a browser JWT.',
);

for (const scope of [
  'terminal_enrollment_source',
  'terminal_enrollment_device',
  'terminal_admission_renewal_device',
  'terminal_staff_session_source',
  'terminal_staff_session_device',
]) requireText(r014, `'${scope}'`);
for (const fragment of [
  'ADD COLUMN IF NOT EXISTS command_device_id',
  'CREATE TABLE public.hub_terminal_staff_session_challenges',
  'r014_validate_hub_staff_command_device',
  'r014_begin_terminal_staff_session',
  'r014_get_terminal_staff_session_context',
  'r014_verify_terminal_staff_pin',
  'r014_prepare_terminal_staff_session',
  'r014_finalize_terminal_staff_session',
  'r014_validate_terminal_staff_session_assertion',
  "REVOKE ALL ON public.hub_terminal_staff_session_challenges FROM PUBLIC, anon, authenticated",
  "GRANT EXECUTE ON FUNCTION public.r014_finalize_terminal_staff_session",
  "'terminalDeviceId'",
]) requireText(r014, fragment);
assert.ok(r014.includes("v_command_device.terminal_role IS DISTINCT FROM NEW.role"), 'Terminal role binding must fail closed on NULL or mismatch.');
assert.ok(r014.includes("(p_payload->>'terminalDeviceId') IS DISTINCT FROM p_terminal.device_id"), 'Assertion payload binding must fail closed on a missing or mismatched terminal identity.');
assert.ok(r014.includes("command_device_id = v_terminal.id OR (hub_device_id = v_hub.id AND staff_id = v_session.staff_id)"), 'New sign-in must retire both prior terminal and same-staff Hub sessions.');

requireText(endpoint, 'requireNativeJson(request, 32 * 1024)');
requireText(endpoint, "if (action === 'begin')");
requireText(endpoint, "if (action === 'complete')");
requireText(endpoint, 'r014_begin_terminal_staff_session');
requireText(endpoint, 'r014_verify_terminal_staff_pin');
requireText(endpoint, 'r014_finalize_terminal_staff_session');
requireText(endpoint, 'terminalStaffSessionChallengeBytes');
assert.ok(!endpoint.includes('Access-Control-Allow-Origin'), 'Terminal staff-session receiver must have no browser CORS surface.');
requireText(edge, 'issueTerminalStaffSession');
requireText(protocol, "'theplugos.terminal-staff-session.v1'");

requireText(transport, '"STAFF_DIRECTORY_REQUEST"');
requireText(transport, '"STAFF_SESSION"');
requireText(transport, '"STAFF_SESSION_RESULT"');
requireText(runtime, 'HubTerminalStaffSessionVerifier');
requireText(runtime, 'terminalStaffDirectory');
requireText(runtime, 'installTerminalStaffSession');
requireText(hubVerifier, 'device.role !in TERMINAL_OPERATIONAL_ROLES');
requireText(terminalLink, 'TerminalLocalLinkState.STAFF_SESSION_ACTIVE');
requireText(terminalLink, 'fun installTerminalStaffSession');
requireText(terminalLink, 'fun submitOperationalCommand');
requireText(terminalCloud, 'fun startTerminalStaffSession');
requireText(terminalCloud, 'terminalStaffSessionChallengeBytes');
requireText(terminalSession, 'BuildConfigIssuerKeyResolver');
requireText(terminalSession, 'admissions.currentAdmission()');
requireText(terminalSession, 'keys.saveStaffSession');
requireText(terminalCommandClient, 'pendingCommand');
requireText(terminalCommandClient, 'keys.sign(commandBytes(unsigned))');
requireText(terminalKeys, 'STAFF_SESSION_WRAP_ALIAS');
requireText(hubDatabase, 'fun pendingCloudEvents(limit: Int, deliveryHubDeviceId: String)');
requireText(hubDatabase, 'bundle.hubDeviceId != deliveryHubDeviceId');
requireText(hubDatabase, '.put("deviceId", deliveryHubDeviceId)');
requireText(hubCloudSync, 'database.pendingCloudEvents(MAX_BATCH_EVENTS, bundle.hubDeviceId)');
requireText(manifest, 'NativeTerminalStaffSignInActivity');
assert.ok(!terminalSession.includes('@PluginMethod') && !terminalCommandClient.includes('@PluginMethod'), 'Terminal session/command material must not cross the Capacitor bridge.');

requireText(adr, 'not a bearer');
requireText(adr, 'theplugos.terminal-staff-session.v1');
requireText(adr, 'HUB_SESSION_ACTIVE');
requireText(localLinkAdr, 'ADR-010');
requireText(deployScript, 'test-r017-terminal-staff-session-contract.mjs');

const migrations = await Promise.all([
  '001_mvp_core.sql',
  '002_secure_identity_devices.sql',
  '003_local_hub_authority.sql',
  '004_order_transition_authority.sql',
  '005_cash_shift_and_capture.sql',
  '006_cash_shift_close.sql',
  '007_inventory_receipt.sql',
  '008_inventory_count_correction.sql',
  '009_inventory_waste.sql',
  '010_device_pairing_and_local_links.sql',
  '011_terminal_admission_renewal.sql',
  '012_owner_controlled_native_credential_reset.sql',
  '013_production_schema_hardening.sql',
  '014_terminal_staff_session_and_command_authority.sql',
].map((name) => load(`supabase/migrations/${name}`)));

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
  for (let index = 0; index < migrations.length; index += 1) {
    if (index === 1) await db.exec('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;');
    await db.exec(migrations[index]);
  }
  const schema = await db.query(`
    SELECT
      to_regclass('public.hub_terminal_staff_session_challenges')::text AS challenges,
      to_regprocedure('public.r014_begin_terminal_staff_session(uuid,text,text,text,text,uuid)')::text AS begin_session,
      to_regprocedure('public.r014_get_terminal_staff_session_context(uuid)')::text AS session_context,
      to_regprocedure('public.r014_verify_terminal_staff_pin(uuid,text)')::text AS verify_pin,
      to_regprocedure('public.r014_prepare_terminal_staff_session(uuid)')::text AS prepare_session,
      to_regprocedure('public.r014_finalize_terminal_staff_session(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz)')::text AS finalize_session,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'hub_staff_sessions' AND column_name = 'command_device_id'
      ) AS has_command_device;
  `);
  assert.deepEqual(schema.rows[0], {
    challenges: 'hub_terminal_staff_session_challenges',
    begin_session: 'r014_begin_terminal_staff_session(uuid,text,text,text,text,uuid)',
    session_context: 'r014_get_terminal_staff_session_context(uuid)',
    verify_pin: 'r014_verify_terminal_staff_pin(uuid,text)',
    prepare_session: 'r014_prepare_terminal_staff_session(uuid)',
    finalize_session: 'r014_finalize_terminal_staff_session(uuid,uuid,text,text,text,jsonb,timestamp with time zone,timestamp with time zone)',
    has_command_device: true,
  }, 'R014 must apply as an ordered, service-only terminal session extension.');
} finally {
  await db.close();
}

console.log('R017 terminal staff-session and command-authority contract checks passed');
