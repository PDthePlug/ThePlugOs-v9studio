import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => readFile(resolve(root, path), 'utf8');
const [deploy, verifier, packageSource] = await Promise.all([
  load('scripts/deploy-hub-cloud.sh'),
  load('scripts/verify-staging-schema-state.mjs'),
  load('package.json'),
]);

const manifest = JSON.parse(packageSource);
assert.equal(
  manifest.scripts['test:r033-staging-function-configuration'],
  'node scripts/test-r033-staging-function-configuration-contract.mjs',
  'R033 must have a dedicated command.',
);
assert.ok(manifest.scripts['test:all'].includes('test:r033-staging-function-configuration'));

for (const fragment of [
  '--configure-staging-functions',
  'controlled-staging-function-configuration',
  'THEPLUGOS_STAGING_FUNCTION_CONFIGURATION_CONFIRM',
  'verify-staging-schema-state.mjs',
  'configure-functions:staging:',
  'HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64',
  'supabase secrets set',
  'hub-terminal-staff-session',
]) assert.ok(deploy.includes(fragment), `Deployment helper missing ${fragment}`);

const schemaApplyGuard = 'if [[ "${deployment_mode}" == "hold-staging-rehearsal" ]]; then\n  node scripts/apply-staging-schema.mjs --apply --project-ref "$SUPABASE_PROJECT_REF"\nfi';
assert.ok(deploy.includes(schemaApplyGuard), 'Only the empty-target rehearsal mode may invoke the schema applicator.');
assert.ok(!deploy.includes('controlled-staging-function-configuration" ]]; then\n  node scripts/apply-staging-schema.mjs'), 'Configuration-only staging must execute no schema SQL.');
assert.ok(
  deploy.indexOf('verify-staging-schema-state.mjs') < deploy.indexOf('supabase secrets set'),
  'Live staging schema verification must occur before secret publication.',
);
assert.ok(
  deploy.indexOf('supabase secrets set') < deploy.indexOf('supabase functions deploy'),
  'Secrets must exist before Function deployment.',
);

for (const fragment of [
  'r001_mvp_core',
  'r001a_retire_unsupported_legacy_staff_pins',
  'r014_terminal_staff_session_and_command_authority',
  'r015_owner_control_plane_rls_hardening',
  'r016_terminal_staff_session_index_hardening',
  'STAGING_SCHEMA_LEDGER_MISMATCH',
  'STAGING_SCHEMA_AUTHORITY_MISMATCH',
  'rejectUnauthorized: true',
  "projectRef === productionProjectRef",
  "projectRef === contaminatedLegacyStagingRef",
  'r014_begin_terminal_staff_session',
  'r015_staff_update_denied',
  'r016_prepared_session_index',
]) assert.ok(verifier.includes(fragment), `Staging schema verifier missing ${fragment}`);

for (const forbidden of [
  "client.query('begin')",
  'insert into ',
  'update ',
  'delete from ',
  'create table ',
  'alter table ',
  'drop table ',
]) {
  assert.ok(!verifier.toLowerCase().includes(forbidden.toLowerCase()), `Verifier must remain read-only; found ${forbidden}`);
}

console.log('R033 staging function configuration contract passed');
