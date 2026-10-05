-- R002 read-only operator preflight
--
-- Safe to run against an R001 database or an already migrated R002 database.
-- It does not install extensions, create objects, update rows, or expose any
-- credential/hash value. Any exception is a hard stop for the migration gate.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- Environment and catalog-only contract report. This remains executable even
-- when an expected application table is absent.
SELECT jsonb_pretty(jsonb_build_object(
    'checked_at', statement_timestamp(),
    'server_version', current_setting('server_version'),
    'database', current_database(),
    'current_role', current_user,
    'pgcrypto', COALESCE((
        SELECT jsonb_build_object(
            'installed', true,
            'schema', n.nspname,
            'version', e.extversion
        )
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pgcrypto'
    ), jsonb_build_object(
        'installed', false,
        'available', EXISTS (
            SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto'
        )
    )),
    'roles', (
        SELECT jsonb_object_agg(required_role, role_exists ORDER BY required_role)
        FROM (
            SELECT required_role,
                   EXISTS (SELECT 1 FROM pg_roles WHERE rolname = required_role) AS role_exists
            FROM (VALUES ('anon'), ('authenticated'), ('service_role')) required(required_role)
        ) roles
    ),
    'auth_helpers', jsonb_build_object(
        'auth.uid()', to_regprocedure('auth.uid()') IS NOT NULL,
        'auth.role()', to_regprocedure('auth.role()') IS NOT NULL
    ),
    'objects', (
        SELECT jsonb_object_agg(object_name, object_exists ORDER BY object_name)
        FROM (
            SELECT object_name, to_regclass(object_name) IS NOT NULL AS object_exists
            FROM (VALUES
                ('auth.users'),
                ('public.audit_logs'),
                ('public.branches'),
                ('public.business_memberships'),
                ('public.businesses'),
                ('public.catalog_products'),
                ('public.device_pairing_attempts'),
                ('public.device_pairing_codes'),
                ('public.devices'),
                ('public.staff_credentials'),
                ('public.staff_members'),
                ('public.staff_security_sessions')
            ) required(object_name)
        ) objects
    ),
    'r002_functions', (
        SELECT jsonb_object_agg(signature, function_exists ORDER BY signature)
        FROM (
            SELECT signature, to_regprocedure(signature) IS NOT NULL AS function_exists
            FROM (VALUES
                ('public.create_device_pairing_code(uuid,uuid,text)'),
                ('public.get_device_bootstrap(text)'),
                ('public.pair_device_with_code(text,text,text,text)'),
                ('public.revoke_device(uuid,text,text)'),
                ('public.revoke_staff_security_session(text)'),
                ('public.set_staff_pin(uuid,uuid,uuid,text,text)'),
                ('public.verify_device_status(text)'),
                ('public.verify_staff_pin(uuid,uuid,uuid,text)')
            ) required(signature)
        ) functions
    )
)) AS r002_environment_report;

DO $r002_read_only_gate$
DECLARE
    v_missing_tables TEXT;
    v_missing_columns TEXT;
    v_missing_roles TEXT;
    v_unsupported_count INTEGER;
    v_unsupported_staff TEXT;
    v_scope_drift TEXT;
    v_r002_table_count INTEGER;
    v_r002_function_count INTEGER;
    v_has_raw_pairing_code BOOLEAN;
    v_has_pairing_hash BOOLEAN;
BEGIN
    SELECT string_agg(required_table, ', ' ORDER BY required_table)
    INTO v_missing_tables
    FROM (VALUES
        ('auth.users'),
        ('public.audit_logs'),
        ('public.branches'),
        ('public.business_memberships'),
        ('public.businesses'),
        ('public.catalog_products'),
        ('public.device_pairing_codes'),
        ('public.devices'),
        ('public.staff_members')
    ) required(required_table)
    WHERE to_regclass(required_table) IS NULL;

    IF v_missing_tables IS NOT NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_TABLES: %', v_missing_tables;
    END IF;

    SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name)
    INTO v_missing_columns
    FROM (VALUES
        ('audit_logs', 'business_id'),
        ('audit_logs', 'event_id'),
        ('audit_logs', 'event_type'),
        ('branches', 'business_id'),
        ('branches', 'id'),
        ('businesses', 'id'),
        ('businesses', 'owner_id'),
        ('catalog_products', 'branch_id'),
        ('catalog_products', 'business_id'),
        ('device_pairing_codes', 'branch_id'),
        ('device_pairing_codes', 'business_id'),
        ('device_pairing_codes', 'status'),
        ('devices', 'branch_id'),
        ('devices', 'business_id'),
        ('devices', 'device_id'),
        ('devices', 'last_seen'),
        ('staff_members', 'branch_id'),
        ('staff_members', 'business_id'),
        ('staff_members', 'id'),
        ('staff_members', 'pin_hash')
    ) required(table_name, column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = required.table_name
          AND c.column_name = required.column_name
    );

    IF v_missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_COLUMNS: %', v_missing_columns;
    END IF;

    SELECT string_agg(required_role, ', ' ORDER BY required_role)
    INTO v_missing_roles
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) required(required_role)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = required_role);

    IF v_missing_roles IS NOT NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_ROLES: %', v_missing_roles;
    END IF;

    IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_AUTH_HELPERS';
    END IF;

    SELECT count(*)::INTEGER,
           string_agg(id::TEXT, ', ' ORDER BY id::TEXT) FILTER (WHERE sample_rank <= 20)
    INTO v_unsupported_count, v_unsupported_staff
    FROM (
        SELECT id, row_number() OVER (ORDER BY id) AS sample_rank
        FROM public.staff_members
        WHERE pin_hash IS NOT NULL
          AND trim(pin_hash) <> ''
          AND pin_hash !~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
    ) unsupported;

    IF v_unsupported_count > 0 THEN
        RAISE EXCEPTION 'R002_UNSUPPORTED_LEGACY_CREDENTIALS: % staff row(s); sample staff IDs: %',
            v_unsupported_count, COALESCE(v_unsupported_staff, 'not available');
    END IF;

    -- Detect existing branch/business contradictions before R002 gives any of
    -- these rows additional security authority. This reports counts only.
    SELECT string_agg(scope_name || '=' || drift_count::TEXT, ', ' ORDER BY scope_name)
    INTO v_scope_drift
    FROM (
        SELECT 'catalog_products' AS scope_name, count(*) AS drift_count
        FROM public.catalog_products p
        JOIN public.branches b ON b.id = p.branch_id
        WHERE p.branch_id IS NOT NULL AND p.business_id <> b.business_id
        UNION ALL
        SELECT 'device_pairing_codes', count(*)
        FROM public.device_pairing_codes p
        JOIN public.branches b ON b.id = p.branch_id
        WHERE p.business_id <> b.business_id
        UNION ALL
        SELECT 'devices', count(*)
        FROM public.devices d
        JOIN public.branches b ON b.id = d.branch_id
        WHERE d.business_id <> b.business_id
        UNION ALL
        SELECT 'staff_members', count(*)
        FROM public.staff_members s
        JOIN public.branches b ON b.id = s.branch_id
        WHERE s.business_id <> b.business_id
    ) drift
    WHERE drift_count > 0;

    IF v_scope_drift IS NOT NULL THEN
        RAISE EXCEPTION 'R002_TENANT_SCOPE_DRIFT: %', v_scope_drift;
    END IF;

    SELECT count(*) INTO v_r002_table_count
    FROM (VALUES
        ('public.device_pairing_attempts'),
        ('public.staff_credentials'),
        ('public.staff_security_sessions')
    ) required(object_name)
    WHERE to_regclass(object_name) IS NOT NULL;

    SELECT count(*) INTO v_r002_function_count
    FROM (VALUES
        ('public.create_device_pairing_code(uuid,uuid,text)'),
        ('public.get_device_bootstrap(text)'),
        ('public.pair_device_with_code(text,text,text,text)'),
        ('public.revoke_device(uuid,text,text)'),
        ('public.revoke_staff_security_session(text)'),
        ('public.set_staff_pin(uuid,uuid,uuid,text,text)'),
        ('public.verify_device_status(text)'),
        ('public.verify_staff_pin(uuid,uuid,uuid,text)')
    ) required(signature)
    WHERE to_regprocedure(signature) IS NOT NULL;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'device_pairing_codes'
          AND column_name = 'pairing_code'
    ), EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'device_pairing_codes'
          AND column_name = 'pairing_code_hash'
    )
    INTO v_has_raw_pairing_code, v_has_pairing_hash;

    IF NOT (
        (v_r002_table_count = 0 AND v_r002_function_count = 0
         AND v_has_raw_pairing_code AND NOT v_has_pairing_hash)
        OR
        (v_r002_table_count = 3 AND v_r002_function_count = 8
         AND NOT v_has_raw_pairing_code AND v_has_pairing_hash)
    ) THEN
        RAISE EXCEPTION 'R002_PARTIAL_STATE: tables=%/3, functions=%/8, raw_pairing_code=%, pairing_code_hash=%',
            v_r002_table_count, v_r002_function_count,
            v_has_raw_pairing_code, v_has_pairing_hash;
    END IF;
END;
$r002_read_only_gate$;

-- Data-shape report. Counts are safe; secret values are intentionally absent.
SELECT jsonb_pretty(jsonb_build_object(
    'result', 'READY',
    'schema_phase', CASE
        WHEN to_regclass('public.staff_credentials') IS NULL THEN 'R001_READY_FOR_R002_REHEARSAL'
        ELSE 'R002_ALREADY_APPLIED'
    END,
    'legacy_credentials', jsonb_build_object(
        'nonempty_total', (
            SELECT count(*) FROM public.staff_members
            WHERE pin_hash IS NOT NULL AND trim(pin_hash) <> ''
        ),
        'unsupported_total', (
            SELECT count(*) FROM public.staff_members
            WHERE pin_hash IS NOT NULL
              AND trim(pin_hash) <> ''
              AND pin_hash !~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
        )
    ),
    'legacy_waiting_pairing_codes', (
        SELECT count(*) FROM public.device_pairing_codes WHERE status = 'WAITING'
    ),
    'devices_with_null_last_seen', (
        SELECT count(*) FROM public.devices WHERE last_seen IS NULL
    ),
    'rls', (
        SELECT jsonb_object_agg(c.relname, c.relrowsecurity ORDER BY c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
              'device_pairing_attempts', 'device_pairing_codes', 'staff_credentials',
              'staff_security_sessions', 'staff_members'
          )
    )
)) AS r002_data_report;

ROLLBACK;
