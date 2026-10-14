import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  deployScript,
  applicator,
  r014,
  r015,
  r016,
  productionLedgerSource,
  releaseStatus,
  ownerEndpoint,
  hubEnrollment,
  hubStaffSession,
  credentialReset,
  hubSync,
  terminalEnrollment,
  terminalStaffSession,
] = await Promise.all([
  load('package.json'),
  load('supabase/config.toml'),
  load('scripts/deploy-hub-cloud.sh'),
  load('scripts/apply-staging-schema.mjs'),
  load('supabase/migrations/014_terminal_staff_session_and_command_authority.sql'),
  load('supabase/migrations/015_owner_control_plane_rls_hardening.sql'),
  load('supabase/migrations/016_terminal_staff_session_index_hardening.sql'),
  load('supabase/production/iwbbwcaylpulcpvbfkdx-r001a-r013-ledger.json'),
  load('docs/operations/RELEASE_STATUS.md'),
  load('supabase/functions/hub-owner-enrollment/index.ts'),
  load('supabase/functions/hub-enrollment/index.ts'),
  load('supabase/functions/hub-staff-session/index.ts'),
  load('supabase/functions/hub-staff-credential-reset/index.ts'),
  load('supabase/functions/hub-sync/index.ts'),
  load('supabase/functions/hub-terminal-enrollment/index.ts'),
  load('supabase/functions/hub-terminal-staff-session/index.ts'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r030-staging-backend-rehearsal'],
  'node scripts/test-r030-staging-backend-rehearsal-contract.mjs',
  'R030 must have a dedicated executable contract command.',
);
assert.ok(
  packageManifest.scripts['test:all'].includes('test:r030-staging-backend-rehearsal'),
  'The full source gate must include R030.',
);

const customProofFunctions = [
  'hub-enrollment',
  'hub-staff-session',
  'hub-staff-credential-reset',
  'hub-sync',
  'hub-terminal-enrollment',
  'hub-terminal-staff-session',
];
for (const functionName of customProofFunctions) {
  const start = config.indexOf(`[functions.${functionName}]`);
  const next = config.indexOf('[functions.', start + 1);
  assert.ok(start >= 0, `${functionName} must remain in supabase/config.toml.`);
  assert.match(
    config.slice(start, next < 0 ? undefined : next),
    /verify_jwt\s*=\s*false/,
    `${functionName} must retain its independently authenticated native-proof boundary.`,
  );
}
const falseJwtSections = [...config.matchAll(/\[functions\.([^\]]+)\][\s\S]*?verify_jwt\s*=\s*false/g)].map((match) => match[1]);
assert.deepEqual(
  falseJwtSections.sort(),
  [...customProofFunctions].sort(),
  'No Edge Function may join the verify_jwt=false set without explicit R030 review.',
);
const ownerStart = config.indexOf('[functions.hub-owner-enrollment]');
assert.ok(ownerStart >= 0, 'Owner enrollment Function must remain configured.');
assert.match(config.slice(ownerStart), /verify_jwt\s*=\s*true/, 'Browser owner enrollment must retain platform JWT verification.');

for (const endpoint of [hubEnrollment, hubStaffSession, credentialReset, hubSync, terminalEnrollment, terminalStaffSession]) {
  requireText(endpoint, 'platformServiceKey()', 'Every custom-proof receiver must create its service client through the shared secret-key resolver.');
  assert.ok(!endpoint.includes('Access-Control-Allow-Origin'), 'Custom-proof receivers must not expose browser CORS.');
}
requireText(ownerEndpoint, 'platformPublishableKey()');
requireText(ownerEndpoint, 'platformServiceKey()');

for (const fragment of [
  '--rehearse-staging',
  'hold-staging-rehearsal',
  'require_hold_release',
  'THEPLUGOS_STAGING_DATABASE_URL',
  'THEPLUGOS_STAGING_SCHEMA_CONFIRM',
  'THEPLUGOS_STAGING_REHEARSAL_CONFIRM',
  'apply-staging-schema.mjs --apply',
  'test-r030-staging-backend-rehearsal-contract.mjs',
  'hub-terminal-staff-session',
  'iwbbwcaylpulcpvbfkdx',
  'dpqtgfxovmiwzkiuzoya',
]) requireText(deployScript, fragment);
assert.ok(!deployScript.includes('supabase db push'), 'The guarded helper must not rely on Supabase CLI migration discovery; R001A has a non-CLI filename and production has an immutable remote ledger.');
assert.ok(
  deployScript.indexOf('node scripts/apply-staging-schema.mjs --apply') < deployScript.indexOf('supabase secrets set'),
  'Staging schema must verify through R016 before any receiver secrets/code are published.',
);
assert.ok(
  deployScript.indexOf('supabase secrets set') < deployScript.indexOf('supabase functions deploy'),
  'Function secrets must be present before receiver deployment.',
);

const plan = JSON.parse(execFileSync(
  process.execPath,
  [resolve(root, 'scripts/apply-staging-schema.mjs'), '--plan'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
));
const expectedOrder = [
  '001_mvp_core.sql',
  '001a_retire_unsupported_legacy_staff_pins.sql',
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
  '015_owner_control_plane_rls_hardening.sql',
  '016_terminal_staff_session_index_hardening.sql',
];
assert.deepEqual(plan.sourceOrder, expectedOrder, 'Staging must apply the canonical schema in exact authority order, including R001A.');
assert.equal(plan.includesNonCliMigration, '001a_retire_unsupported_legacy_staff_pins.sql');
assert.equal(plan.finalSchema, '016_terminal_staff_session_index_hardening.sql');

for (const fragment of [
  "projectRef === productionProjectRef",
  "projectRef === contaminatedLegacyStagingRef",
  "identityText.includes(projectRef)",
  "rejectUnauthorized: true",
  "git', ['status', '--porcelain']",
  'refusing to apply unreviewed migration contents',
  "STAGING_TARGET_NOT_EMPTY",
  "apply-empty-staging:${projectRef}:${checkedCommit}:001-016",
  "await client.query('begin')",
  "await client.query('rollback')",
  "r014_begin_terminal_staff_session",
  "Owners can create staff profiles for their businesses",
  "Owners can update catalog products for their businesses",
  "r015_staff_update_denied",
  "r016_branch_index",
  "r016_business_index",
  "r016_hub_index",
  "r016_prepared_session_index",
  "r016_staff_index",
]) requireText(applicator, fragment);

requireText(r014, 'r014_begin_terminal_staff_session');
requireText(r014, 'r014_finalize_terminal_staff_session');
requireText(r015, 'Owners can create staff profiles for their businesses');
requireText(r015, 'Owners can update catalog products for their businesses');
for (const indexName of [
  'idx_hub_terminal_staff_session_challenges_branch_id',
  'idx_hub_terminal_staff_session_challenges_business_id',
  'idx_hub_terminal_staff_session_challenges_hub_device_id',
  'idx_hub_terminal_staff_session_challenges_prepared_session_id',
  'idx_hub_terminal_staff_session_challenges_staff_id',
]) requireText(r016, indexName);
assert.equal(JSON.parse(productionLedgerSource).entries.length, 13, 'Recorded production remains R001A-R013 until separately advanced with evidence.');
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Staging rehearsal source must not silently grant release authority.');

execFileSync('bash', ['-n', resolve(root, 'scripts/deploy-hub-cloud.sh')], { stdio: 'pipe' });
console.log('R030 staging backend rehearsal and cloud-boundary contract passed');
