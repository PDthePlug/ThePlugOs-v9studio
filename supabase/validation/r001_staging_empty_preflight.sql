\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
\pset footer off

SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '2min';

SELECT 'context', 'database', current_database();
SELECT 'context', 'role', current_user;
SELECT 'context', 'transaction_read_only', current_setting('transaction_read_only');
SELECT 'context', 'server_version_num', current_setting('server_version_num');

SELECT
    'preflight',
    'r001_relations_present',
    count(*)::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
      'businesses',
      'business_memberships',
      'branches',
      'devices',
      'staff_members',
      'catalog_products',
      'orders',
      'order_items',
      'device_pairing_codes',
      'audit_logs'
  );

SELECT
    'preflight',
    'r001_functions_present',
    count(*)::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
  AND p.proname IN (
      'update_updated_at_column',
      'is_business_member',
      'is_business_owner',
      'create_business_with_owner_and_branch'
  );

SELECT
    'preflight',
    'r002_relations_present',
    count(*)::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
      'staff_credentials',
      'staff_security_sessions',
      'device_pairing_attempts'
  );

SELECT
    'preflight',
    'r002_functions_present',
    count(*)::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'set_staff_pin',
      'verify_staff_pin',
      'revoke_staff_security_session',
      'create_device_pairing_code',
      'pair_device_with_code',
      'verify_device_status',
      'revoke_device',
      'get_device_bootstrap'
  );

SELECT 'preflight', 'auth_users', count(*)::text FROM auth.users;
SELECT 'preflight', 'auth_identities', count(*)::text FROM auth.identities;
SELECT 'preflight', 'storage_buckets', count(*)::text FROM storage.buckets;
SELECT 'preflight', 'storage_objects', count(*)::text FROM storage.objects;

SELECT (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::int AS r001_history_table_exists \gset
\if :r001_history_table_exists
SELECT 'preflight', 'migration_history_table', 'PRESENT';
SELECT 'preflight', 'migration_history_rows', count(*)::text FROM supabase_migrations.schema_migrations;
\else
SELECT 'preflight', 'migration_history_table', 'ABSENT';
SELECT 'preflight', 'migration_history_rows', '0';
\endif

SELECT
    'extension',
    e.extname,
    e.extversion || '|schema=' || n.nspname
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

SELECT
    'publication_table',
    pubname || '.' || schemaname || '.' || tablename,
    'member'
FROM pg_publication_tables
ORDER BY pubname, schemaname, tablename;

ROLLBACK;
