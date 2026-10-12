import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionProjectRef = 'iwbbwcaylpulcpvbfkdx';
const contaminatedLegacyStagingRef = 'dpqtgfxovmiwzkiuzoya';
const orderedMigrations = [
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
];

function fail(message, code = 64) {
  console.error(message);
  process.exit(code);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const mode = process.argv[2];
if (mode === '--plan') {
  console.log(JSON.stringify({
    mode: 'staging-only',
    sourceOrder: orderedMigrations,
    includesNonCliMigration: '001a_retire_unsupported_legacy_staff_pins.sql',
    finalSchema: '015_owner_control_plane_rls_hardening.sql',
  }, null, 2));
  process.exit(0);
}
if (mode !== '--apply') {
  fail('Usage: node scripts/apply-staging-schema.mjs --plan | --apply --project-ref <ref>');
}

const projectRef = argument('--project-ref');
if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) fail('A valid --project-ref is required.');
if (projectRef === productionProjectRef) fail('The staging schema applicator refuses the production project.');
if (projectRef === contaminatedLegacyStagingRef) fail('The staging schema applicator refuses the preserved contaminated legacy staging project.');

const databaseUrl = process.env.THEPLUGOS_STAGING_DATABASE_URL;
if (!databaseUrl) fail('THEPLUGOS_STAGING_DATABASE_URL is required in the secure execution environment.');
let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  fail('THEPLUGOS_STAGING_DATABASE_URL is not a valid PostgreSQL URL.');
}
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('THEPLUGOS_STAGING_DATABASE_URL must use PostgreSQL.');
const identityText = `${parsed.hostname}|${decodeURIComponent(parsed.username)}`;
if (!identityText.includes(projectRef)) fail('The staging database URL does not identify the confirmed project reference.');

const releaseCommit = process.env.THEPLUGOS_RELEASE_COMMIT;
if (!releaseCommit) fail('THEPLUGOS_RELEASE_COMMIT is required.');
const checkedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (releaseCommit !== checkedCommit) fail('THEPLUGOS_RELEASE_COMMIT does not match the checked-out source commit.');
const dirtySource = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (dirtySource) fail('The source tree is not clean; refusing to apply unreviewed migration contents.');
const confirmation = process.env.THEPLUGOS_STAGING_SCHEMA_CONFIRM;
const expectedConfirmation = `apply-empty-staging:${projectRef}:${checkedCommit}:001-015`;
if (confirmation !== expectedConfirmation) {
  fail('THEPLUGOS_STAGING_SCHEMA_CONFIRM must exactly acknowledge the empty staging project, commit, and 001-015 schema order.');
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  application_name: 'theplugos-staging-schema-rehearsal',
});

try {
  await client.connect();
  const preflight = await client.query(`
    select
      to_regclass('public.businesses')::text as businesses,
      to_regclass('public.staff_members')::text as staff_members,
      to_regclass('public.catalog_products')::text as catalog_products,
      to_regclass('public.hub_authorization_bundles')::text as hub_authorization_bundles,
      to_regclass('public.hub_terminal_staff_session_challenges')::text as terminal_staff_challenges
  `);
  if (Object.values(preflight.rows[0]).some(Boolean)) {
    throw Object.assign(new Error('STAGING_TARGET_NOT_EMPTY: canonical ThePlugOS objects already exist; restore or create a fresh staging target instead of replaying migrations.'), { exitCode: 78 });
  }

  for (const migration of orderedMigrations) {
    const sql = await readFile(resolve(root, 'supabase/migrations', migration), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration} failed: ${detail}`);
    }
  }

  const verification = await client.query(`
    select
      to_regprocedure('public.r014_begin_terminal_staff_session(uuid,text,text,text,text,uuid)') is not null as r014_begin,
      to_regprocedure('public.r014_finalize_terminal_staff_session(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz)') is not null as r014_finalize,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'staff_members'
          and policyname = 'Owners can create staff profiles for their businesses'
          and cmd = 'INSERT'
      ) as r015_staff_insert,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'catalog_products'
          and policyname = 'Owners can update catalog products for their businesses'
          and cmd = 'UPDATE'
      ) as r015_catalog_update,
      not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'staff_members'
          and cmd = 'UPDATE' and 'authenticated' = any(roles)
      ) as r015_staff_update_denied
  `);
  if (!Object.values(verification.rows[0]).every(Boolean)) {
    throw new Error(`Post-apply verification failed: ${JSON.stringify(verification.rows[0])}`);
  }

  console.log(JSON.stringify({
    ok: true,
    projectRef,
    sourceCommit: checkedCommit,
    appliedMigrations: orderedMigrations,
    verified: verification.rows[0],
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
} finally {
  await client.end().catch(() => {});
}
