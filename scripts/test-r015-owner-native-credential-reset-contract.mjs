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
  config,
  r001a,
  r012,
  ownerEndpoint,
  resetEndpoint,
  edgeProtocol,
  androidProtocol,
  authorityClient,
  resetActivity,
  plugin,
  manifest,
  bridge,
  localHub,
  roleLogin,
  resetControl,
  adr,
  contract,
  r001,
  r002,
  r003,
  r004,
  r005,
  r006,
  r007,
  r008,
  r009,
  r010,
  r011,
  r013,
] = await Promise.all([
  load('supabase/config.toml'),
  load('supabase/migrations/001a_retire_unsupported_legacy_staff_pins.sql'),
  load('supabase/migrations/012_owner_controlled_native_credential_reset.sql'),
  load('supabase/functions/hub-owner-enrollment/index.ts'),
  load('supabase/functions/hub-staff-credential-reset/index.ts'),
  load('supabase/functions/_shared/hub-protocol.ts'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCloudProtocol.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCloudAuthorityClient.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeStaffCredentialResetActivity.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/ThePlugOSLocalHubPlugin.kt'),
  load('android/app/src/main/AndroidManifest.xml'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('packages/core/src/runtime/local-hub.ts'),
  load('src/components/RoleLoginModal.tsx'),
  load('src/components/NativeStaffCredentialResetControl.tsx'),
  load('docs/architecture/ADR-006_OWNER_CONTROLLED_NATIVE_CREDENTIAL_RESET.md'),
  load('docs/architecture/NATIVE_OWNER_CREDENTIAL_RESET_PROTOCOL.md'),
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('supabase/migrations/005_cash_shift_and_capture.sql'),
  load('supabase/migrations/006_cash_shift_close.sql'),
  load('supabase/migrations/007_inventory_receipt.sql'),
  load('supabase/migrations/008_inventory_count_correction.sql'),
  load('supabase/migrations/009_inventory_waste.sql'),
  load('supabase/migrations/010_device_pairing_and_local_links.sql'),
  load('supabase/migrations/011_terminal_admission_renewal.sql'),
  load('supabase/migrations/013_production_schema_hardening.sql'),
]);

requireText(config, '[functions.hub-staff-credential-reset]');
assert.match(config.slice(config.indexOf('[functions.hub-staff-credential-reset]')), /verify_jwt\s*=\s*false/, 'The native reset receiver must use its custom device proof boundary.');
requireText(r001a, 'UNSUPPORTED_LEGACY_CREDENTIAL');
requireText(r001a, 'credential_value_retained');
assert.ok(!r001a.includes('pin_hash text'), 'The reset ledger must not copy a credential column.');
requireText(r012, 'CREATE TABLE public.hub_staff_credential_reset_codes');
requireText(r012, 'CREATE TABLE public.hub_staff_credential_reset_challenges');
requireText(r012, 'private.r012_reset_code_fingerprint');
requireText(r012, 'r012_issue_staff_credential_reset_code');
requireText(r012, 'r012_begin_hub_staff_credential_reset');
requireText(r012, 'r012_get_hub_staff_credential_reset_context');
requireText(r012, 'r012_complete_hub_staff_credential_reset');
requireText(r012, "'owner_credential_reset'");
requireText(r012, "'credential_reset_source'");
requireText(r012, "'credential_reset_device'");
requireText(r012, 'SET search_path = \'\'');
requireText(r012, 'GRANT EXECUTE ON FUNCTION public.r012_complete_hub_staff_credential_reset(uuid, text) TO service_role;');
assert.ok(!r012.includes('GRANT EXECUTE ON FUNCTION public.r012_complete_hub_staff_credential_reset(uuid, text) TO authenticated'), 'Browser roles must not call the reset completion RPC.');
requireText(r013, 'R013_REQUIRES_COMPLETE_R001A_TO_R012_BASELINE');
requireText(r013, 'CREATE INDEX IF NOT EXISTS idx_hub_staff_credential_reset_challenges_staff_id');
requireText(r013, 'SET search_path = \'\'');

requireText(ownerEndpoint, "'issue-staff-credential-reset-code'");
requireText(ownerEndpoint, 'r012_issue_staff_credential_reset_code');
requireText(ownerEndpoint, 'credentialResetCodeResponse');
requireText(resetEndpoint, 'requireNativeJson(request, 32 * 1024)');
requireText(resetEndpoint, 'staffCredentialResetChallengeBytes');
requireText(resetEndpoint, 'verifyP256DerSignature');
requireText(resetEndpoint, 'r012_begin_hub_staff_credential_reset');
requireText(resetEndpoint, 'r012_complete_hub_staff_credential_reset');
assert.ok(!resetEndpoint.includes('Access-Control-Allow-Origin'), 'Native reset must not expose browser CORS.');
requireText(edgeProtocol, "'theplugos.staff-credential-reset.v1'");
requireText(androidProtocol, 'fun staffCredentialResetChallengeBytes');
requireText(androidProtocol, 'theplugos.staff-credential-reset.v1');
requireText(authorityClient, 'fun beginNativeStaffCredentialReset');
requireText(authorityClient, 'fun completeNativeStaffCredentialReset');
requireText(authorityClient, 'runtime.endNativeStaffSession()');
requireText(authorityClient, 'resetCode.fill');
requireText(authorityClient, 'pin.fill');
requireText(resetActivity, 'WindowManager.LayoutParams.FLAG_SECURE');
requireText(resetActivity, 'first.contentEquals(confirmation)');
requireText(resetActivity, 'beginStaffCredentialResetFromNativeScreen');
requireText(resetActivity, 'completeStaffCredentialResetFromNativeScreen');
requireText(plugin, 'fun openNativeStaffCredentialReset');
requireText(manifest, 'NativeStaffCredentialResetActivity');
requireText(bridge, 'openNativeStaffCredentialReset(): Promise<void>;');
requireText(localHub, 'openNativeStaffCredentialReset');
requireText(roleLogin, 'NativeStaffCredentialResetControl');
requireText(resetControl, "action: 'issue-staff-credential-reset-code'");
requireText(resetControl, 'openNativeStaffCredentialReset');
assert.ok(!resetControl.includes('type="password"'), 'The browser reset control must not render a PIN field.');
requireText(adr, 'browser neither accepts nor sends a new staff PIN');
requireText(contract, 'Browser-based PIN entry or reset.');

const ownerId = '11111111-1111-4111-8111-111111111111';
const businessId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const staffId = '44444444-4444-4444-8444-444444444444';
const hubId = '55555555-5555-4555-8555-555555555555';
const issueDigest = 'A'.repeat(43);
const ownerHash = 'B'.repeat(43);
const sourceHash = 'C'.repeat(43);
const deviceHash = 'D'.repeat(43);

function jsonValue(row, field) {
  const value = row[field];
  return typeof value === 'string' ? JSON.parse(value) : value;
}

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
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${ownerId}', 'owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES ('${businessId}', 'Reset Test', '${ownerId}', 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name, is_active)
    VALUES ('${branchId}', '${businessId}', 'Main', true);
    INSERT INTO public.staff_members (id, business_id, branch_id, name, role, status, pin_hash)
    VALUES ('${staffId}', '${businessId}', '${branchId}', 'Cashier One', 'CASHIER', 'ACTIVE', 'unknown-legacy-format');
  `);
  await db.exec(r001a);

  const legacy = await db.query(`
    SELECT
      (SELECT count(*)::int FROM private.r001a_legacy_credential_resets WHERE staff_id = '${staffId}') AS reset_required,
      (SELECT count(*)::int FROM public.staff_members WHERE id = '${staffId}' AND pin_hash IS NULL) AS credential_retired;
  `);
  assert.deepEqual(legacy.rows[0], { reset_required: 1, credential_retired: 1 }, 'R001A must record only the reset requirement and retire the opaque legacy value.');

  for (const migration of [r002, r003, r004, r005, r006, r007, r008, r009, r010, r011]) {
    await db.exec(migration);
  }
  // PGlite's embedded regex engine accepts the production key checks at DDL
  // time but cannot execute their `{64,4096}` repetition guard during a
  // fixture insert. Keep the production migration strict and remove only
  // those three test-engine-incompatible checks before creating a fake Hub.
  await db.exec(`
    ALTER TABLE public.devices DROP CONSTRAINT devices_signing_public_key_base64_check;
    ALTER TABLE public.devices DROP CONSTRAINT devices_tls_certificate_base64_check;
    ALTER TABLE public.devices DROP CONSTRAINT devices_hub_tls_certificate_sha256_check;
  `);
  await db.exec(`
    INSERT INTO public.devices (
      id, device_id, business_id, branch_id, name, type, status, last_seen,
      operational_role, signing_public_key_base64, tls_certificate_base64,
      hub_tls_certificate_sha256, identity_registered_at
    ) VALUES (
      '${hubId}', 'hub-reset-test-01', '${businessId}', '${branchId}', 'Reset Hub', 'TERMINAL', 'ACTIVE', now(),
      'CASHIER_HUB', repeat('A', 64), repeat('A', 128), repeat('a', 64), now()
    );
    INSERT INTO public.hub_branch_authority (branch_id, business_id, active_hub_device_id, revocation_version)
    VALUES ('${branchId}', '${businessId}', '${hubId}', 1);
  `);
  await db.exec(r012);
  await db.exec(r013);

  const hardening = await db.query(`
    SELECT
      (SELECT array_to_string(proconfig, ',')
       FROM pg_proc
       WHERE oid = 'public.update_updated_at_column()'::regprocedure) AS trigger_function_config,
      (SELECT count(*)::int
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'idx_hub_staff_credential_reset_challenges_staff_id') AS recovery_fk_index;
  `);
  assert.match(hardening.rows[0].trigger_function_config ?? '', /search_path=/, 'R013 must lock the trigger function search path.');
  assert.equal(hardening.rows[0].recovery_fk_index, 1, 'R013 must cover the recovery challenge staff foreign key.');

  const issuedResult = await db.query(`
    SELECT public.r012_issue_staff_credential_reset_code(
      '${businessId}'::uuid, '${branchId}'::uuid, '${staffId}'::uuid, '${ownerId}'::uuid,
      '${issueDigest}', '${ownerHash}'
    ) AS result;
  `);
  const issued = jsonValue(issuedResult.rows[0], 'result');
  assert.equal(issued.ok, true, 'Owner should issue a native recovery code for an active Hub/staff scope.');
  assert.match(issued.resetCode, /^[A-Za-z0-9_-]{12}$/);

  const codeRows = await db.query(`
    SELECT reset_code_hash, reset_code_fingerprint
    FROM public.hub_staff_credential_reset_codes;
  `);
  assert.equal(codeRows.rows.length, 1);
  assert.notEqual(codeRows.rows[0].reset_code_hash, issued.resetCode, 'The raw recovery code must not be stored.');
  assert.notEqual(codeRows.rows[0].reset_code_fingerprint, issued.resetCode, 'The lookup marker must not expose the raw recovery code.');

  const requestId = '66666666-6666-4666-8666-666666666666';
  const beginDigest = 'E'.repeat(43);
  const beginResult = await db.query(`
    SELECT public.r012_begin_hub_staff_credential_reset(
      '${issued.resetCode}', '${requestId}'::uuid, '${beginDigest}', '${sourceHash}', '${deviceHash}', 'hub-reset-test-01'
    ) AS result;
  `);
  const begin = jsonValue(beginResult.rows[0], 'result');
  assert.equal(begin.ok, true, 'The exact active Hub should receive a reset challenge.');
  assert.match(begin.nonce, /^[A-Za-z0-9_-]{43}$/);

  const contextResult = await db.query(`SELECT public.r012_get_hub_staff_credential_reset_context('${begin.challengeId}'::uuid) AS result;`);
  const context = jsonValue(contextResult.rows[0], 'result');
  assert.equal(context.state, 'PENDING');
  assert.equal(context.staffId, staffId);
  assert.equal(context.hubDeviceId, 'hub-reset-test-01');

  const completeResult = await db.query(`SELECT public.r012_complete_hub_staff_credential_reset('${begin.challengeId}'::uuid, '2468') AS result;`);
  const complete = jsonValue(completeResult.rows[0], 'result');
  assert.equal(complete.ok, true);
  assert.equal(complete.state, 'COMPLETE');
  assert.ok(Number(complete.revocationVersion) > 1, 'A completed reset must advance branch authority.');

  const completedFacts = await db.query(`
    SELECT
      (SELECT count(*)::int FROM public.staff_credentials WHERE staff_id = '${staffId}') AS isolated_credential,
      (SELECT count(*)::int FROM private.r001a_legacy_credential_resets WHERE staff_id = '${staffId}' AND reset_completed_at IS NOT NULL) AS ledger_completed,
      (SELECT revocation_version FROM public.hub_branch_authority WHERE branch_id = '${branchId}') AS revision,
      (SELECT count(*)::int FROM public.audit_logs WHERE event_type = 'HUB_STAFF_CREDENTIAL_RESET_COMPLETED') AS completion_audits;
  `);
  assert.equal(completedFacts.rows[0].isolated_credential, 1);
  assert.equal(completedFacts.rows[0].ledger_completed, 1);
  assert.ok(Number(completedFacts.rows[0].revision) > 1);
  assert.equal(completedFacts.rows[0].completion_audits, 1, 'Completion must remain a single audited fact.');

  const replayResult = await db.query(`SELECT public.r012_complete_hub_staff_credential_reset('${begin.challengeId}'::uuid, '2468') AS result;`);
  const replay = jsonValue(replayResult.rows[0], 'result');
  assert.equal(replay.ok, true, 'A same-challenge replay must be idempotent rather than write another credential.');
  const replayAudits = await db.query(`SELECT count(*)::int AS count FROM public.audit_logs WHERE event_type = 'HUB_STAFF_CREDENTIAL_RESET_COMPLETED';`);
  assert.equal(replayAudits.rows[0].count, 1, 'A replay must not create a second completion audit.');
} finally {
  await db.close();
}

console.log('R015 owner-authorized native credential-reset contract checks passed');
