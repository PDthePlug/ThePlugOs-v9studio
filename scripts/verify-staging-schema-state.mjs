import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const productionProjectRef = 'iwbbwcaylpulcpvbfkdx';
const contaminatedLegacyStagingRef = 'dpqtgfxovmiwzkiuzoya';
const expectedMigrations = [
  'r001_mvp_core',
  'r001a_retire_unsupported_legacy_staff_pins',
  'r002_secure_identity_devices',
  'r003_local_hub_authority',
  'r004_order_transition_authority',
  'r005_cash_shift_and_capture',
  'r006_cash_shift_close',
  'r007_inventory_receipt',
  'r008_inventory_count_correction',
  'r009_inventory_waste',
  'r010_device_pairing_and_local_links',
  'r011_terminal_admission_renewal',
  'r012_owner_controlled_native_credential_reset',
  'r013_production_schema_hardening',
  'r014_terminal_staff_session_and_command_authority',
  'r015_owner_control_plane_rls_hardening',
  'r016_terminal_staff_session_index_hardening',
];

function fail(message, code = 64) {
  console.error(message);
  process.exit(code);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectRef = argument('--project-ref');
const emitFingerprint = process.argv.includes('--emit-fingerprint');
if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) fail('A valid --project-ref is required.');
if (projectRef === productionProjectRef) fail('The staging schema verifier refuses the production project.', 78);
if (projectRef === contaminatedLegacyStagingRef) fail('The staging schema verifier refuses the preserved contaminated legacy staging project.', 78);

const databaseUrl = process.env.THEPLUGOS_STAGING_DATABASE_URL;
if (!databaseUrl) fail('THEPLUGOS_STAGING_DATABASE_URL is required.');
let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  fail('THEPLUGOS_STAGING_DATABASE_URL is not a valid PostgreSQL URL.');
}
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('THEPLUGOS_STAGING_DATABASE_URL must use PostgreSQL.');
const identityText = `${parsed.hostname}|${decodeURIComponent(parsed.username)}`;
if (!identityText.includes(projectRef)) fail('The staging database URL does not identify the confirmed project reference.');

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  application_name: 'theplugos-staging-schema-verifier',
});

try {
  await client.connect();
  const ledger = await client.query(`
    select version::text as version, name::text as name
    from supabase_migrations.schema_migrations
    order by version
  `);
  const migrationNames = ledger.rows.map((row) => row.name);
  if (migrationNames.length !== expectedMigrations.length || migrationNames.some((name, index) => name !== expectedMigrations[index])) {
    throw new Error(`STAGING_SCHEMA_LEDGER_MISMATCH: expected ${expectedMigrations.join(' -> ')}, received ${migrationNames.join(' -> ')}`);
  }

  const verification = await client.query(`
    select
      to_regprocedure('public.r014_begin_terminal_staff_session(uuid,text,text,text,text,uuid)') is not null as r014_begin,
      to_regprocedure('public.r014_get_terminal_staff_session_context(uuid)') is not null as r014_context,
      to_regprocedure('public.r014_verify_terminal_staff_pin(uuid,text)') is not null as r014_pin,
      to_regprocedure('public.r014_prepare_terminal_staff_session(uuid)') is not null as r014_prepare,
      to_regprocedure('public.r014_finalize_terminal_staff_session(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz)') is not null as r014_finalize,
      has_function_privilege('service_role', 'public.r014_begin_terminal_staff_session(uuid,text,text,text,text,uuid)', 'EXECUTE') as service_exec,
      not has_function_privilege('authenticated', 'public.r014_begin_terminal_staff_session(uuid,text,text,text,text,uuid)', 'EXECUTE') as authenticated_denied,
      not has_function_privilege('anon', 'public.r014_begin_terminal_staff_session(uuid,text,text,text,text,uuid)', 'EXECUTE') as anon_denied,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'staff_members'
          and policyname = 'Owners can create staff profiles for their businesses'
          and cmd = 'INSERT'
      ) as r015_staff_insert,
      not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'staff_members'
          and cmd = 'UPDATE' and 'authenticated' = any(roles)
      ) as r015_staff_update_denied,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'catalog_products'
          and policyname = 'Owners can update catalog products for their businesses'
          and cmd = 'UPDATE'
      ) as r015_catalog_update,
      to_regclass('public.idx_hub_terminal_staff_session_challenges_branch_id') is not null as r016_branch_index,
      to_regclass('public.idx_hub_terminal_staff_session_challenges_business_id') is not null as r016_business_index,
      to_regclass('public.idx_hub_terminal_staff_session_challenges_hub_device_id') is not null as r016_hub_index,
      to_regclass('public.idx_hub_terminal_staff_session_challenges_prepared_session_id') is not null as r016_prepared_session_index,
      to_regclass('public.idx_hub_terminal_staff_session_challenges_staff_id') is not null as r016_staff_index
  `);
  const verified = verification.rows[0];
  if (!Object.values(verified).every(Boolean)) {
    throw new Error(`STAGING_SCHEMA_AUTHORITY_MISMATCH: ${JSON.stringify(verified)}`);
  }

  const canonical = JSON.stringify({ projectRef, migrations: migrationNames, verified });
  const fingerprint = createHash('sha256').update(canonical, 'utf8').digest('hex');
  if (emitFingerprint) {
    console.log(fingerprint);
  } else {
    console.log(JSON.stringify({ ok: true, projectRef, migrations: ledger.rows, verified, fingerprint }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
