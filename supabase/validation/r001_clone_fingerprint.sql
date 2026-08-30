\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
\pset footer off

SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10min';

-- Output contract: section<TAB>object<TAB>value. No raw merchant, Auth,
-- credential, token, or customer values are emitted.

SELECT 'context', 'database', current_database();
SELECT 'context', 'role', current_user;
SELECT 'context', 'transaction_read_only', current_setting('transaction_read_only');
SELECT 'context', 'server_version_num', current_setting('server_version_num');
SELECT 'context', 'server_version', current_setting('server_version');

SELECT
    'extension',
    e.extname,
    e.extversion || '|schema=' || n.nspname
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

SELECT
    'relation',
    n.nspname || '.' || c.relname,
    c.relkind || '|rls=' || c.relrowsecurity::text || '|force_rls=' ||
        c.relforcerowsecurity::text || '|owner=' || pg_get_userbyid(c.relowner)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'private')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
ORDER BY n.nspname, c.relname;

SELECT
    'column',
    n.nspname || '.' || c.relname || '.' || a.attname,
    a.attnum::text || '|type=' || pg_catalog.format_type(a.atttypid, a.atttypmod) ||
        '|not_null=' || a.attnotnull::text ||
        '|identity=' || a.attidentity ||
        '|generated=' || a.attgenerated ||
        '|default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname IN ('public', 'private')
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum;

SELECT
    'constraint',
    n.nspname || '.' || c.relname || '.' || con.conname,
    con.contype || '|' || pg_get_constraintdef(con.oid, true)
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'private')
ORDER BY n.nspname, c.relname, con.conname;

SELECT
    'index',
    schemaname || '.' || indexname,
    md5(indexdef)
FROM pg_indexes
WHERE schemaname IN ('public', 'private')
ORDER BY schemaname, indexname;

SELECT
    'function',
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'result=' || pg_get_function_result(p.oid) ||
        '|security_definer=' || p.prosecdef::text ||
        '|volatility=' || p.provolatile ||
        '|config=' || COALESCE(array_to_string(p.proconfig, ','), '') ||
        '|acl=' || COALESCE(array_to_string(p.proacl, ','), '') ||
        '|definition_md5=' || md5(pg_get_functiondef(p.oid))
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
  AND p.prokind IN ('f', 'p')
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

SELECT
    'trigger',
    n.nspname || '.' || c.relname || '.' || t.tgname,
    'enabled=' || t.tgenabled || '|definition_md5=' || md5(pg_get_triggerdef(t.oid, true))
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname IN ('public', 'private', 'auth', 'storage')
ORDER BY n.nspname, c.relname, t.tgname;

SELECT
    'policy',
    schemaname || '.' || tablename || '.' || policyname,
    'permissive=' || permissive ||
        '|roles=' || array_to_string(roles, ',') ||
        '|command=' || cmd ||
        '|using=' || COALESCE(qual, '') ||
        '|check=' || COALESCE(with_check, '')
FROM pg_policies
WHERE schemaname IN ('public', 'private', 'auth', 'storage')
ORDER BY schemaname, tablename, policyname;

SELECT
    'grant',
    table_schema || '.' || table_name || '.' || grantee || '.' || privilege_type,
    is_grantable
FROM information_schema.role_table_grants
WHERE table_schema IN ('public', 'private')
ORDER BY table_schema, table_name, grantee, privilege_type;

SELECT
    'routine_grant',
    routine_schema || '.' || specific_name || '.' || grantee || '.' || privilege_type,
    is_grantable
FROM information_schema.role_routine_grants
WHERE routine_schema IN ('public', 'private')
ORDER BY routine_schema, routine_name, grantee, privilege_type;

SELECT
    'publication',
    p.pubname,
    'all_tables=' || p.puballtables::text ||
        '|insert=' || p.pubinsert::text ||
        '|update=' || p.pubupdate::text ||
        '|delete=' || p.pubdelete::text ||
        '|truncate=' || p.pubtruncate::text
FROM pg_publication p
ORDER BY p.pubname;

SELECT
    'publication_table',
    pubname || '.' || schemaname || '.' || tablename,
    'member'
FROM pg_publication_tables
ORDER BY pubname, schemaname, tablename;

SELECT
    'sequence',
    schemaname || '.' || sequencename,
    'type=' || data_type ||
        '|start=' || start_value::text ||
        '|min=' || min_value::text ||
        '|max=' || max_value::text ||
        '|increment=' || increment_by::text ||
        '|cycle=' || cycle::text ||
        '|last=' || COALESCE(last_value::text, '')
FROM pg_sequences
WHERE schemaname IN ('public', 'private')
ORDER BY schemaname, sequencename;

SELECT 'data', 'public.businesses', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.businesses t;
SELECT 'data', 'public.business_memberships', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.business_memberships t;
SELECT 'data', 'public.branches', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.branches t;
SELECT 'data', 'public.devices', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.devices t;
SELECT 'data', 'public.staff_members', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.staff_members t;
SELECT 'data', 'public.catalog_products', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.catalog_products t;
SELECT 'data', 'public.orders', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.orders t;
SELECT 'data', 'public.order_items', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.order_items t;
SELECT 'data', 'public.device_pairing_codes', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.device_pairing_codes t;
SELECT 'data', 'public.audit_logs', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM public.audit_logs t;
SELECT 'data', 'auth.users', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM auth.users t;
SELECT 'data', 'auth.identities', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM auth.identities t;
SELECT 'data', 'storage.buckets', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM storage.buckets t;
SELECT 'data', 'storage.objects', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id::text), '')) FROM storage.objects t;
SELECT (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::int AS r001_history_table_exists \gset
\if :r001_history_table_exists
SELECT 'data', 'supabase_migrations.schema_migrations', count(*)::text || '|' || md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY version::text), '')) FROM supabase_migrations.schema_migrations t;
\else
SELECT 'data', 'supabase_migrations.schema_migrations', 'ABSENT';
\endif

SELECT 'invariant', 'business_without_auth_owner', count(*)::text
FROM public.businesses b
LEFT JOIN auth.users u ON u.id = b.owner_id
WHERE u.id IS NULL;

SELECT 'invariant', 'business_without_matching_owner_membership', count(*)::text
FROM public.businesses b
WHERE NOT EXISTS (
    SELECT 1
    FROM public.business_memberships bm
    WHERE bm.business_id = b.id
      AND bm.user_id = b.owner_id
      AND bm.role = 'OWNER'
);

SELECT 'invariant', 'membership_orphan', count(*)::text
FROM public.business_memberships bm
LEFT JOIN public.businesses b ON b.id = bm.business_id
LEFT JOIN auth.users u ON u.id = bm.user_id
WHERE b.id IS NULL OR u.id IS NULL;

SELECT 'invariant', 'branch_orphan', count(*)::text
FROM public.branches br
LEFT JOIN public.businesses b ON b.id = br.business_id
WHERE b.id IS NULL;

SELECT 'invariant', 'device_tenant_branch_mismatch', count(*)::text
FROM public.devices d
LEFT JOIN public.branches br ON br.id = d.branch_id
WHERE br.id IS NULL OR br.business_id <> d.business_id;

SELECT 'invariant', 'staff_tenant_branch_mismatch', count(*)::text
FROM public.staff_members sm
LEFT JOIN public.branches br ON br.id = sm.branch_id
WHERE br.id IS NULL OR br.business_id <> sm.business_id;

SELECT 'invariant', 'catalog_tenant_branch_mismatch', count(*)::text
FROM public.catalog_products cp
LEFT JOIN public.branches br ON br.id = cp.branch_id
WHERE cp.branch_id IS NOT NULL
  AND (br.id IS NULL OR br.business_id <> cp.business_id);

SELECT 'invariant', 'order_tenant_branch_mismatch', count(*)::text
FROM public.orders o
LEFT JOIN public.branches br ON br.id = o.branch_id
WHERE br.id IS NULL OR br.business_id <> o.business_id;

SELECT 'invariant', 'order_item_orphan', count(*)::text
FROM public.order_items oi
LEFT JOIN public.orders o ON o.id = oi.order_id
WHERE o.id IS NULL;

SELECT 'invariant', 'pairing_tenant_branch_mismatch', count(*)::text
FROM public.device_pairing_codes pc
LEFT JOIN public.branches br ON br.id = pc.branch_id
WHERE br.id IS NULL OR br.business_id <> pc.business_id;

SELECT 'invariant', 'audit_branch_tenant_mismatch', count(*)::text
FROM public.audit_logs al
LEFT JOIN public.branches br ON br.id = al.branch_id
WHERE al.branch_id IS NOT NULL
  AND (br.id IS NULL OR br.business_id <> al.business_id);

SELECT 'invariant', 'legacy_staff_pin_rows', count(*)::text
FROM public.staff_members
WHERE pin_hash IS NOT NULL;

SELECT
    'gate',
    'r002_tables_present',
    count(*)::text
FROM (
    VALUES
        (to_regclass('public.staff_credentials')),
        (to_regclass('public.staff_security_sessions')),
        (to_regclass('public.device_pairing_attempts'))
) AS r(object_id)
WHERE object_id IS NOT NULL;

SELECT
    'gate',
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

SELECT 'gate', 'representative_businesses', count(*)::text FROM public.businesses;
SELECT 'gate', 'representative_owner_memberships', count(*)::text FROM public.business_memberships WHERE role = 'OWNER';
SELECT 'gate', 'representative_branches', count(*)::text FROM public.branches;
SELECT 'gate', 'representative_staff', count(*)::text FROM public.staff_members;
SELECT 'gate', 'representative_catalog', count(*)::text FROM public.catalog_products;

ROLLBACK;
