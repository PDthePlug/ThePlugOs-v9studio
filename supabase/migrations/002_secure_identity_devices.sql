-- Supabase Migration: 002_secure_identity_devices.sql
-- Description: R002 Secure Identity, Staff Credentials Isolation, Pgcrypto
--              Blowfish Hashing & Trusted Device Enrollment (Incremental)
-- Live status: NOT APPROVED. Run the R002 preflight and acceptance gate first.

-- =========================================================
-- 0. FAIL-CLOSED R001 CONTRACT PREFLIGHT
-- =========================================================

-- This check intentionally runs before every R002 mutation. It names schema
-- drift and refuses to guess how an unknown legacy credential was encoded.
DO $r002_preflight$
DECLARE
    v_missing_tables TEXT;
    v_missing_columns TEXT;
    v_missing_roles TEXT;
    v_partial_state TEXT;
    v_scope_drift TEXT;
    v_unsupported_count INTEGER;
    v_unsupported_staff TEXT;
BEGIN
    SELECT string_agg(required_table, ', ' ORDER BY required_table)
    INTO v_missing_tables
    FROM (
        VALUES
            ('public.businesses'),
            ('public.business_memberships'),
            ('public.branches'),
            ('public.devices'),
            ('public.staff_members'),
            ('public.catalog_products'),
            ('public.device_pairing_codes'),
            ('public.audit_logs'),
            ('auth.users')
    ) AS required(required_table)
    WHERE to_regclass(required_table) IS NULL;

    IF v_missing_tables IS NOT NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_TABLES: %', v_missing_tables
            USING HINT = 'The target is not the canonical R001 schema. Stop and reconcile schema drift before R002.';
    END IF;

    IF to_regnamespace('private') IS NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_SCHEMA: private'
            USING HINT = 'The target is not the canonical R001 schema. Do not create an ad-hoc replacement during a live migration.';
    END IF;

    SELECT string_agg(table_schema || '.' || table_name || '.' || column_name, ', '
                      ORDER BY table_schema, table_name, column_name)
    INTO v_missing_columns
    FROM (
        VALUES
            ('auth', 'users', 'id'),
            ('public', 'audit_logs', 'actor_id'),
            ('public', 'audit_logs', 'branch_id'),
            ('public', 'audit_logs', 'business_id'),
            ('public', 'audit_logs', 'details'),
            ('public', 'audit_logs', 'device_id'),
            ('public', 'audit_logs', 'entity_id'),
            ('public', 'audit_logs', 'event_id'),
            ('public', 'audit_logs', 'event_type'),
            ('public', 'branches', 'business_id'),
            ('public', 'branches', 'id'),
            ('public', 'branches', 'name'),
            ('public', 'businesses', 'id'),
            ('public', 'businesses', 'name'),
            ('public', 'businesses', 'onboarding_status'),
            ('public', 'businesses', 'owner_id'),
            ('public', 'catalog_products', 'branch_id'),
            ('public', 'catalog_products', 'business_id'),
            ('public', 'catalog_products', 'category'),
            ('public', 'catalog_products', 'cost_price'),
            ('public', 'catalog_products', 'description'),
            ('public', 'catalog_products', 'id'),
            ('public', 'catalog_products', 'name'),
            ('public', 'catalog_products', 'price'),
            ('public', 'catalog_products', 'stock_quantity'),
            ('public', 'catalog_products', 'unit_of_measure'),
            ('public', 'device_pairing_codes', 'branch_id'),
            ('public', 'device_pairing_codes', 'business_id'),
            ('public', 'device_pairing_codes', 'created_at'),
            ('public', 'device_pairing_codes', 'created_by'),
            ('public', 'device_pairing_codes', 'expires_at'),
            ('public', 'device_pairing_codes', 'id'),
            ('public', 'device_pairing_codes', 'pairing_code'),
            ('public', 'device_pairing_codes', 'status'),
            ('public', 'device_pairing_codes', 'used_at'),
            ('public', 'devices', 'branch_id'),
            ('public', 'devices', 'business_id'),
            ('public', 'devices', 'device_id'),
            ('public', 'devices', 'id'),
            ('public', 'devices', 'last_seen'),
            ('public', 'devices', 'name'),
            ('public', 'devices', 'status'),
            ('public', 'devices', 'type'),
            ('public', 'devices', 'updated_at'),
            ('public', 'staff_members', 'active_shift'),
            ('public', 'staff_members', 'branch_id'),
            ('public', 'staff_members', 'business_id'),
            ('public', 'staff_members', 'id'),
            ('public', 'staff_members', 'name'),
            ('public', 'staff_members', 'performance_score'),
            ('public', 'staff_members', 'pin_hash'),
            ('public', 'staff_members', 'role'),
            ('public', 'staff_members', 'status')
    ) AS required(table_schema, table_name, column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = required.table_schema
          AND c.table_name = required.table_name
          AND c.column_name = required.column_name
    );

    IF v_missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_COLUMNS: %', v_missing_columns
            USING HINT = 'Do not partially repair the live database. Restore or reconcile the versioned R001 contract first.';
    END IF;

    SELECT string_agg(required_role, ', ' ORDER BY required_role)
    INTO v_missing_roles
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS required(required_role)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = required.required_role);

    IF v_missing_roles IS NOT NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_ROLES: %', v_missing_roles
            USING HINT = 'R002 must run in a Supabase-compatible PostgreSQL environment.';
    END IF;

    IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_MISSING_AUTH_HELPERS'
            USING HINT = 'Required Supabase auth.uid() and auth.role() helpers are not available.';
    END IF;

    SELECT string_agg(object_name, ', ' ORDER BY object_name)
    INTO v_partial_state
    FROM (
        SELECT 'column public.device_pairing_codes.' || column_name AS object_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'device_pairing_codes'
          AND column_name IN ('pairing_code_hash', 'created_by_user_id', 'created_by_staff_id')
        UNION ALL
        SELECT 'table ' || object_name
        FROM (VALUES
            ('public.device_pairing_attempts'),
            ('public.staff_credentials'),
            ('public.staff_security_sessions')
        ) objects(object_name)
        WHERE to_regclass(object_name) IS NOT NULL
        UNION ALL
        SELECT 'function ' || signature
        FROM (VALUES
            ('private.r002_crypt(text,text)'),
            ('private.r002_gen_salt(text,integer)'),
            ('private.r002_random_bytes(integer)'),
            ('public.create_device_pairing_code(uuid,uuid,text)'),
            ('public.get_device_bootstrap(text)'),
            ('public.pair_device_with_code(text,text,text,text)'),
            ('public.revoke_device(uuid,text,text)'),
            ('public.revoke_staff_security_session(text)'),
            ('public.set_staff_pin(uuid,uuid,uuid,text,text)'),
            ('public.verify_device_status(text)'),
            ('public.verify_staff_pin(uuid,uuid,uuid,text)')
        ) functions(signature)
        WHERE to_regprocedure(signature) IS NOT NULL
    ) partial;

    IF v_partial_state IS NOT NULL THEN
        RAISE EXCEPTION 'R002_PREFLIGHT_PARTIAL_STATE: %', v_partial_state
            USING HINT = 'Do not continue or rerun R002 over a partially migrated schema. Restore the clean R001 clone and investigate the prior attempt.';
    END IF;

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
        RAISE EXCEPTION 'R002_TENANT_SCOPE_DRIFT: %', v_scope_drift
            USING HINT = 'Correct cross-business branch bindings under an approved data-remediation plan before R002.';
    END IF;

    SELECT count(*)::INTEGER,
           string_agg(id::TEXT, ', ' ORDER BY id::TEXT)
               FILTER (WHERE sample_rank <= 20)
    INTO v_unsupported_count, v_unsupported_staff
    FROM (
        SELECT id,
               row_number() OVER (ORDER BY id) AS sample_rank
        FROM public.staff_members
        WHERE pin_hash IS NOT NULL
          AND trim(pin_hash) <> ''
          AND pin_hash !~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
    ) unsupported;

    IF v_unsupported_count > 0 THEN
        RAISE EXCEPTION 'R002_UNSUPPORTED_LEGACY_CREDENTIALS: % staff row(s); sample staff IDs: %',
            v_unsupported_count,
            COALESCE(v_unsupported_staff, 'not available')
            USING HINT = 'R002 never interprets an unknown value as plaintext. Complete an owner-controlled PIN reset or an explicitly reviewed format conversion, then rerun preflight.';
    END IF;
END;
$r002_preflight$;

-- =========================================================
-- 1. PGCRYPTO DISCOVERY AND PRIVATE WRAPPERS
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase commonly installs extensions outside public. Discover the real
-- namespace and create fully qualified internal wrappers without moving an
-- existing extension or weakening SECURITY DEFINER search paths.
DO $r002_pgcrypto$
DECLARE
    v_pgcrypto_schema TEXT;
BEGIN
    SELECT n.nspname
    INTO v_pgcrypto_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto';

    IF v_pgcrypto_schema IS NULL THEN
        RAISE EXCEPTION 'R002_PGCRYPTO_UNAVAILABLE'
            USING HINT = 'Install the trusted pgcrypto extension before R002.';
    END IF;

    EXECUTE format($wrapper$
        CREATE OR REPLACE FUNCTION private.r002_crypt(p_input TEXT, p_salt TEXT)
        RETURNS TEXT
        LANGUAGE sql
        IMMUTABLE STRICT PARALLEL SAFE
        SET search_path = pg_catalog
        AS $function$ SELECT %I.crypt($1, $2) $function$
    $wrapper$, v_pgcrypto_schema);

    EXECUTE format($wrapper$
        CREATE OR REPLACE FUNCTION private.r002_gen_salt(p_type TEXT, p_iterations INTEGER)
        RETURNS TEXT
        LANGUAGE sql
        VOLATILE STRICT PARALLEL UNSAFE
        SET search_path = pg_catalog
        AS $function$ SELECT %I.gen_salt($1, $2) $function$
    $wrapper$, v_pgcrypto_schema);

    EXECUTE format($wrapper$
        CREATE OR REPLACE FUNCTION private.r002_random_bytes(p_count INTEGER)
        RETURNS BYTEA
        LANGUAGE sql
        VOLATILE STRICT PARALLEL UNSAFE
        SET search_path = pg_catalog
        AS $function$ SELECT %I.gen_random_bytes($1) $function$
    $wrapper$, v_pgcrypto_schema);
END;
$r002_pgcrypto$;

REVOKE ALL ON FUNCTION private.r002_crypt(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r002_gen_salt(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r002_random_bytes(INTEGER) FROM PUBLIC, anon, authenticated;

-- 2. Create isolated staff_credentials table
CREATE TABLE IF NOT EXISTS public.staff_credentials (
    staff_id UUID PRIMARY KEY REFERENCES public.staff_members(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL CHECK (
        pin_hash ~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
    ),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defense-in-Depth RLS and strict privilege revocation for staff_credentials
ALTER TABLE public.staff_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_credentials FROM PUBLIC, anon, authenticated;

-- 3. Migrate existing device_pairing_codes
-- Drop the index if it exists
DROP INDEX IF EXISTS public.idx_device_pairing_codes_active_code;

-- Add pairing_code_hash and separate identity actor columns
ALTER TABLE public.device_pairing_codes
ADD COLUMN IF NOT EXISTS pairing_code_hash TEXT,
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS created_by_staff_id UUID REFERENCES public.staff_members(id) ON DELETE SET NULL;

-- Safely migrate legacy created_by if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'device_pairing_codes' AND column_name = 'created_by'
    ) THEN
        -- Legacy created_by referenced auth.users(id)
        UPDATE public.device_pairing_codes 
        SET created_by_user_id = created_by 
        WHERE created_by_user_id IS NULL AND created_by IS NOT NULL;

        ALTER TABLE public.device_pairing_codes DROP COLUMN created_by;
    END IF;
END $$;

-- Revoke all legacy waiting codes. A valid one-way dummy bcrypt hash avoids
-- retaining the raw code and avoids an invalid-salt value in later crypt calls.
UPDATE public.device_pairing_codes
SET status = 'REVOKED',
    pairing_code_hash = private.r002_crypt(
        encode(private.r002_random_bytes(32), 'hex'),
        private.r002_gen_salt('bf', 8)
    )
WHERE status = 'WAITING' OR pairing_code_hash IS NULL;

-- Enforce new schema
ALTER TABLE public.device_pairing_codes
ALTER COLUMN pairing_code_hash SET NOT NULL,
DROP COLUMN IF EXISTS pairing_code;

ALTER TABLE public.device_pairing_codes
ADD CONSTRAINT device_pairing_codes_bcrypt_hash
CHECK (pairing_code_hash ~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$');

-- STRICTLY REVOKE direct client access to enrollment code hashes
REVOKE ALL ON public.device_pairing_codes FROM PUBLIC, anon, authenticated;

-- Persistent defense-in-depth throttle for anonymous pairing attempts. This
-- does not replace the required API-gateway rate limit because a hostile caller
-- can rotate a caller-supplied device ID.
CREATE TABLE IF NOT EXISTS public.device_pairing_attempts (
    device_id TEXT PRIMARY KEY CHECK (
        device_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    ),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.device_pairing_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_pairing_attempts FROM PUBLIC, anon, authenticated;

-- 4. Migrate existing devices table
ALTER TABLE public.devices
ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'TERMINAL';

UPDATE public.devices
SET last_seen = NOW()
WHERE last_seen IS NULL;

ALTER TABLE public.devices
ALTER COLUMN last_seen SET NOT NULL;

ALTER TABLE public.devices
ALTER COLUMN last_seen SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_devices_device_id_status ON public.devices(device_id, status);

-- 5. Create staff_security_sessions for delegated manager authority
CREATE TABLE IF NOT EXISTS public.staff_security_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('MANAGER', 'OWNER')),
    session_token_hash TEXT NOT NULL CHECK (
        session_token_hash ~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
    ),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defense-in-Depth RLS and strict privilege revocation for staff_security_sessions
ALTER TABLE public.staff_security_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_security_sessions FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_staff_security_sessions_active
    ON public.staff_security_sessions (business_id, branch_id, staff_id, expires_at)
    WHERE revoked_at IS NULL;

-- 6. Safely carry forward supported R001 bcrypt credentials. Unknown formats
-- were rejected before any R002 mutation. Never hash an unknown value as if it
-- were a plaintext PIN.
DO $r002_credentials$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.staff_members sm
        JOIN public.staff_credentials sc ON sc.staff_id = sm.id
        WHERE sm.pin_hash IS NOT NULL
          AND trim(sm.pin_hash) <> ''
          AND (sc.business_id <> sm.business_id OR sc.pin_hash <> sm.pin_hash)
    ) THEN
        RAISE EXCEPTION 'R002_PARTIAL_CREDENTIAL_CONFLICT'
            USING HINT = 'Existing staff_credentials disagree with R001. Restore a clean R001 clone or reconcile the partial migration before retrying.';
    END IF;

    INSERT INTO public.staff_credentials (staff_id, business_id, pin_hash)
    SELECT id, business_id, pin_hash
    FROM public.staff_members
    WHERE pin_hash IS NOT NULL
      AND trim(pin_hash) <> ''
      AND pin_hash ~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
    ON CONFLICT (staff_id) DO NOTHING;

    UPDATE public.staff_members
    SET pin_hash = NULL
    WHERE pin_hash IS NOT NULL;
END;
$r002_credentials$;

-- =========================================================
-- SECURE CREDENTIAL MANAGEMENT RPCs
-- =========================================================

-- Clean up older function signatures to prevent overload conflicts
DROP FUNCTION IF EXISTS public.set_staff_pin(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.set_staff_pin(UUID, UUID, UUID, TEXT, TEXT);

-- Function: set_staff_pin
CREATE OR REPLACE FUNCTION public.set_staff_pin(
    p_staff_id UUID,
    p_business_id UUID,
    p_branch_id UUID DEFAULT NULL,
    p_pin TEXT DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_clean_pin TEXT;
    v_new_pin_hash TEXT;
    v_caller_id UUID;
    v_is_authorized BOOLEAN := false;
    v_target_staff RECORD;
    v_session_rec RECORD;
BEGIN
    IF p_staff_id IS NULL OR p_business_id IS NULL OR p_pin IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Staff ID, Business ID, and PIN are required.');
    END IF;

    -- Fetch target staff member record
    SELECT id, business_id, branch_id, role 
    INTO v_target_staff
    FROM public.staff_members 
    WHERE id = p_staff_id 
      AND business_id = p_business_id 
      AND (p_branch_id IS NULL OR branch_id = p_branch_id);

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid staff, business, or branch binding.');
    END IF;

    v_clean_pin := trim(p_pin);
    IF v_clean_pin !~ '^\d{4,8}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN must be between 4 and 8 numeric digits.');
    END IF;

    -- Authorization check:
    -- ACCOUNT ONBOARDING AUTHORITY vs OPERATIONAL TERMINAL AUTHORITY (R002 PATCH-F)
    -- 1. If p_session_token is provided (Operational Terminal Authority), evaluate staff security session FIRST.
    IF p_session_token IS NOT NULL AND trim(p_session_token) != '' THEN
        IF p_session_token !~ '^[a-f0-9]{64}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired session token for PIN administration.');
        END IF;

        FOR v_session_rec IN 
            SELECT sss.*, sm.status as staff_status
            FROM public.staff_security_sessions sss
            JOIN public.staff_members sm
              ON sm.id = sss.staff_id
             AND sm.business_id = sss.business_id
             AND sm.branch_id = sss.branch_id
            WHERE sss.business_id = p_business_id 
              AND sss.role IN ('MANAGER', 'OWNER')
              AND sss.role = sm.role
              AND sm.status = 'ACTIVE'
              AND sss.expires_at > NOW() 
              AND sss.revoked_at IS NULL
        LOOP
            IF v_session_rec.session_token_hash = private.r002_crypt(p_session_token, v_session_rec.session_token_hash) THEN
                -- Manager authority safety checks:
                -- A Manager CANNOT modify OWNER credentials
                IF v_session_rec.role = 'MANAGER' AND v_target_staff.role = 'OWNER' THEN
                    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Managers cannot modify Owner credentials.');
                END IF;

                -- A Manager CAN ONLY modify staff within their authorized branch
                IF v_session_rec.role = 'MANAGER' AND v_target_staff.branch_id != v_session_rec.branch_id THEN
                    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Managers can only set PINs for staff in their authorized branch.');
                END IF;

                v_is_authorized := true;
                v_caller_id := v_session_rec.staff_id;
                EXIT;
            END IF;
        END LOOP;

        IF NOT v_is_authorized THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired session token for PIN administration.');
        END IF;
    -- 2. Account Onboarding Authority (Pre-terminal setup via authenticated Supabase Owner account or service_role)
    ELSIF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id AND owner_id = auth.uid()) THEN
        v_is_authorized := true;
        v_caller_id := auth.uid();
    ELSIF auth.role() = 'service_role' THEN
        v_is_authorized := true;
        v_caller_id := NULL;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not permitted to set credentials for this business.');
    END IF;

    -- Upsert credential into isolated staff_credentials table with one
    -- server-generated bcrypt hash and invalidate all prior elevated sessions
    -- belonging to the target whose credential changed.
    v_new_pin_hash := private.r002_crypt(
        v_clean_pin,
        private.r002_gen_salt('bf', 8)
    );

    INSERT INTO public.staff_credentials (
        staff_id, business_id, pin_hash, failed_attempts, locked_until, updated_at
    ) VALUES (
        p_staff_id, p_business_id, v_new_pin_hash, 0, NULL, NOW()
    ) ON CONFLICT (staff_id) DO UPDATE SET
        business_id = EXCLUDED.business_id,
        pin_hash = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = NOW();

    UPDATE public.staff_security_sessions
    SET revoked_at = NOW()
    WHERE staff_id = p_staff_id
      AND revoked_at IS NULL;

    -- Audit event (NEVER log PIN or pin_hash)
    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, actor_id, entity_id, event_type, details
    ) VALUES (
        'evt-pin-set-' || encode(private.r002_random_bytes(16), 'hex'),
        p_business_id,
        v_target_staff.branch_id,
        COALESCE(v_caller_id::text, p_staff_id::text),
        p_staff_id::text,
        'STAFF_PIN_CREATED',
        jsonb_build_object('staff_id', p_staff_id, 'business_id', p_business_id)
    );

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Clean up older function signatures
DROP FUNCTION IF EXISTS public.verify_staff_pin(UUID, UUID, UUID, TEXT);

-- Function: verify_staff_pin (Strict 4-parameter requirement per R002 PATCH-D)
CREATE OR REPLACE FUNCTION public.verify_staff_pin(
    p_staff_id UUID,
    p_business_id UUID,
    p_branch_id UUID,
    p_pin TEXT
) RETURNS jsonb AS $$
DECLARE
    v_clean_pin TEXT;
    v_staff_id UUID;
    v_biz_id UUID;
    v_branch_id UUID;
    v_name TEXT;
    v_role TEXT;
    v_status TEXT;
    v_stored_hash TEXT;
    v_failed_attempts INTEGER;
    v_locked_until TIMESTAMPTZ;
    v_new_attempts INTEGER;
    v_lock_until TIMESTAMPTZ;
    v_session_token TEXT;
    v_session_hash TEXT;
    v_session_expires TIMESTAMPTZ;
BEGIN
    IF p_staff_id IS NULL OR p_business_id IS NULL OR p_branch_id IS NULL OR p_pin IS NULL THEN
        RETURN jsonb_build_object('authenticated', false, 'error', 'Staff ID, Business ID, Branch ID, and PIN are required.');
    END IF;

    v_clean_pin := trim(p_pin);

    IF v_clean_pin !~ '^\d{4,8}$' THEN
        RETURN jsonb_build_object('authenticated', false, 'error', 'Invalid security PIN.');
    END IF;

    -- Concurrency-Safe Atomicity: Lock credential record with exact staff, business, and branch binding
    SELECT s.id, s.business_id, s.branch_id, s.name, s.role, s.status,
           c.pin_hash, c.failed_attempts, c.locked_until
    INTO v_staff_id, v_biz_id, v_branch_id, v_name, v_role, v_status,
         v_stored_hash, v_failed_attempts, v_locked_until
    FROM public.staff_members s
    JOIN public.staff_credentials c
      ON c.staff_id = s.id
     AND c.business_id = s.business_id
    WHERE s.id = p_staff_id
      AND s.business_id = p_business_id
      AND s.branch_id = p_branch_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('authenticated', false, 'error', 'Invalid security PIN.');
    END IF;

    IF v_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('authenticated', false, 'error', 'Staff account is inactive.');
    END IF;

    -- Enforce Lockout
    IF v_locked_until IS NOT NULL AND v_locked_until > NOW() THEN
        RETURN jsonb_build_object(
            'authenticated', false,
            'locked', true,
            'error', 'Terminal locked due to 5 consecutive failed attempts. Please wait 5 minutes.'
        );
    END IF;

    -- Verify PIN using the schema-qualified private pgcrypto wrapper.
    IF v_stored_hash = private.r002_crypt(v_clean_pin, v_stored_hash) THEN
        UPDATE public.staff_credentials
        SET failed_attempts = 0,
            locked_until = NULL,
            updated_at = NOW()
        WHERE staff_id = p_staff_id;

        INSERT INTO public.audit_logs (
            event_id, business_id, branch_id, actor_id, entity_id, event_type, details
        ) VALUES (
            'evt-login-ok-' || encode(private.r002_random_bytes(16), 'hex'),
            v_biz_id,
            v_branch_id,
            p_staff_id::text,
            p_staff_id::text,
            'STAFF_LOGIN_SUCCESS',
            jsonb_build_object('staff_id', p_staff_id, 'name', v_name, 'role', v_role)
        );

        -- If MANAGER or OWNER, create a short-lived security session
        IF v_role IN ('MANAGER', 'OWNER') THEN
            v_session_token := encode(private.r002_random_bytes(32), 'hex');
            v_session_hash := private.r002_crypt(
                v_session_token,
                private.r002_gen_salt('bf', 8)
            );
            v_session_expires := NOW() + INTERVAL '12 hours';

            -- One active elevated session per staff identity. A new verified
            -- login rotates all previous delegated tokens.
            UPDATE public.staff_security_sessions
            SET revoked_at = NOW()
            WHERE staff_id = v_staff_id
              AND revoked_at IS NULL;

            INSERT INTO public.staff_security_sessions (
                staff_id, business_id, branch_id, role, session_token_hash, expires_at
            ) VALUES (
                v_staff_id, v_biz_id, v_branch_id, v_role, v_session_hash, v_session_expires
            );

            RETURN jsonb_build_object(
                'authenticated', true,
                'staff', jsonb_build_object(
                    'id', v_staff_id,
                    'business_id', v_biz_id,
                    'branch_id', v_branch_id,
                    'name', v_name,
                    'role', v_role,
                    'status', v_status
                ),
                'sessionToken', v_session_token
            );
        END IF;

        RETURN jsonb_build_object(
            'authenticated', true,
            'staff', jsonb_build_object(
                'id', v_staff_id,
                'business_id', v_biz_id,
                'branch_id', v_branch_id,
                'name', v_name,
                'role', v_role,
                'status', v_status
            )
        );
    ELSE
        v_new_attempts := COALESCE(v_failed_attempts, 0) + 1;
        IF v_new_attempts >= 5 THEN
            v_lock_until := NOW() + INTERVAL '5 minutes';
        ELSE
            v_lock_until := NULL;
        END IF;

        UPDATE public.staff_credentials
        SET failed_attempts = v_new_attempts,
            locked_until = v_lock_until,
            updated_at = NOW()
        WHERE staff_id = p_staff_id;

        INSERT INTO public.audit_logs (
            event_id, business_id, branch_id, actor_id, entity_id, event_type, details
        ) VALUES (
            'evt-login-fail-' || encode(private.r002_random_bytes(16), 'hex'),
            v_biz_id,
            v_branch_id,
            p_staff_id::text,
            p_staff_id::text,
            CASE WHEN v_new_attempts >= 5 THEN 'STAFF_LOGIN_LOCKED' ELSE 'STAFF_LOGIN_FAILURE' END,
            jsonb_build_object('staff_id', p_staff_id, 'attempts', v_new_attempts)
        );

        IF v_new_attempts >= 5 THEN
            RETURN jsonb_build_object(
                'authenticated', false,
                'locked', true,
                'error', 'Terminal locked due to 5 consecutive failed attempts. Please wait 5 minutes.'
            );
        ELSE
            RETURN jsonb_build_object(
                'authenticated', false,
                'error', 'Invalid security PIN.'
            );
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Function: revoke_staff_security_session
-- A bearer can invalidate only the exact active delegated token it presents.
DROP FUNCTION IF EXISTS public.revoke_staff_security_session(TEXT);

CREATE OR REPLACE FUNCTION public.revoke_staff_security_session(
    p_session_token TEXT
) RETURNS jsonb AS $$
DECLARE
    v_session_rec RECORD;
BEGIN
    IF p_session_token IS NULL OR p_session_token !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'A security session token is required.');
    END IF;

    SELECT sss.id, sss.staff_id, sss.business_id, sss.branch_id,
           sss.session_token_hash
    INTO v_session_rec
    FROM public.staff_security_sessions sss
    WHERE sss.revoked_at IS NULL
      AND sss.expires_at > NOW()
      AND sss.session_token_hash = private.r002_crypt(p_session_token, sss.session_token_hash)
    ORDER BY sss.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired security session.');
    END IF;

    UPDATE public.staff_security_sessions
    SET revoked_at = NOW()
    WHERE id = v_session_rec.id
      AND revoked_at IS NULL;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, actor_id, entity_id, event_type, details
    ) VALUES (
        'evt-session-revoked-' || encode(private.r002_random_bytes(16), 'hex'),
        v_session_rec.business_id,
        v_session_rec.branch_id,
        v_session_rec.staff_id::TEXT,
        v_session_rec.id::TEXT,
        'STAFF_SECURITY_SESSION_REVOKED',
        jsonb_build_object('staff_id', v_session_rec.staff_id, 'session_id', v_session_rec.id)
    );

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =========================================================
-- TRUSTED DEVICE ENROLLMENT RPCs
-- =========================================================

-- Clean up older function signatures
DROP FUNCTION IF EXISTS public.create_device_pairing_code(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.create_device_pairing_code(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_device_pairing_code(UUID, UUID, TEXT);

-- Function: create_device_pairing_code (RNG via gen_random_bytes and derived caller identity per R002 PATCH-D)
CREATE OR REPLACE FUNCTION public.create_device_pairing_code(
    p_business_id UUID,
    p_branch_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_caller_user_id UUID := NULL;
    v_caller_staff_id UUID := NULL;
    v_is_authorized BOOLEAN := false;
    v_raw_code TEXT;
    v_code_hash TEXT;
    v_expires_at TIMESTAMPTZ;
    v_session_rec RECORD;
    v_branch_exists BOOLEAN := false;
    v_candidate_available BOOLEAN := false;
    v_generation_attempt INTEGER;
BEGIN
    IF p_business_id IS NULL OR p_branch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Business ID and Branch ID are required.');
    END IF;

    -- Verify branch belongs to business
    SELECT EXISTS (
        SELECT 1 FROM public.branches 
        WHERE id = p_branch_id AND business_id = p_business_id
    ) INTO v_branch_exists;

    IF NOT v_branch_exists THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid branch or business binding.');
    END IF;

    -- OPERATIONAL TERMINAL CONTRACT (R002 PATCH-F):
    -- Terminal device pairing MUST require an active OWNER or MANAGER staff security sessionToken.
    -- Do NOT fall through to background Supabase owner auth (auth.uid()) on shared terminal calls.
    IF p_session_token IS NOT NULL AND trim(p_session_token) != '' THEN
        IF p_session_token !~ '^[a-f0-9]{64}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Operational terminal pairing requires an active OWNER or MANAGER session token.');
        END IF;

        FOR v_session_rec IN 
            SELECT sss.*, sm.status as staff_status, sm.role as staff_role
            FROM public.staff_security_sessions sss
            JOIN public.staff_members sm
              ON sm.id = sss.staff_id
             AND sm.business_id = sss.business_id
             AND sm.branch_id = sss.branch_id
            WHERE sss.business_id = p_business_id 
              AND sss.branch_id = p_branch_id 
              AND sss.role IN ('MANAGER', 'OWNER')
              AND sss.role = sm.role
              AND sm.status = 'ACTIVE'
              AND sss.expires_at > NOW() 
              AND sss.revoked_at IS NULL
        LOOP
            IF v_session_rec.session_token_hash = private.r002_crypt(p_session_token, v_session_rec.session_token_hash) THEN
                v_is_authorized := true;
                v_caller_staff_id := v_session_rec.staff_id;
                EXIT;
            END IF;
        END LOOP;
    ELSIF auth.role() = 'service_role' THEN
        v_is_authorized := true;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Operational terminal pairing requires an active OWNER or MANAGER session token.');
    END IF;

    -- Pairing is entered before a tenant is known, so the six-digit code must
    -- be unique across every currently active enrollment. Serialize generation
    -- to close the race between collision checking and insertion.
    PERFORM pg_catalog.pg_advisory_xact_lock(847002002::BIGINT);

    UPDATE public.device_pairing_codes
    SET status = 'REVOKED'
    WHERE branch_id = p_branch_id AND status = 'WAITING';

    -- Cryptographically secure 6-digit RNG via the private pgcrypto wrapper.
    -- Existing hashes are checked without disclosing them to a caller.
    FOR v_generation_attempt IN 1..32 LOOP
        v_raw_code := lpad((((('x' || encode(private.r002_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 900000) + 100000)::text, 6, '0');

        SELECT NOT EXISTS (
            SELECT 1
            FROM public.device_pairing_codes dpc
            WHERE dpc.status = 'WAITING'
              AND dpc.expires_at > NOW()
              AND dpc.pairing_code_hash = private.r002_crypt(v_raw_code, dpc.pairing_code_hash)
        ) INTO v_candidate_available;

        EXIT WHEN v_candidate_available;
    END LOOP;

    IF NOT v_candidate_available THEN
        RAISE EXCEPTION 'R002_PAIRING_CODE_SPACE_EXHAUSTED'
            USING HINT = 'Retry after active pairing codes expire. Do not weaken collision or entropy checks.';
    END IF;

    v_code_hash := private.r002_crypt(v_raw_code, private.r002_gen_salt('bf', 8));
    v_expires_at := NOW() + INTERVAL '10 minutes';

    -- Identity derived strictly from authenticated caller (created_by_user_id or created_by_staff_id)
    INSERT INTO public.device_pairing_codes (
        pairing_code_hash, business_id, branch_id, created_by_user_id, created_by_staff_id, status, expires_at
    ) VALUES (
        v_code_hash, p_business_id, p_branch_id, v_caller_user_id, v_caller_staff_id, 'WAITING', v_expires_at
    );

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, actor_id, event_type, details
    ) VALUES (
        'evt-enroll-code-' || encode(private.r002_random_bytes(16), 'hex'),
        p_business_id,
        p_branch_id,
        COALESCE(v_caller_user_id::text, v_caller_staff_id::text, 'service_role'),
        'DEVICE_ENROLLMENT_CREATED',
        jsonb_build_object('business_id', p_business_id, 'branch_id', p_branch_id, 'expires_at', v_expires_at)
    );

    RETURN jsonb_build_object(
        'success', true,
        'pairing_code', v_raw_code,
        'expires_at', v_expires_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Clean up older function signature
DROP FUNCTION IF EXISTS public.pair_device_with_code(TEXT, TEXT, TEXT, TEXT);

-- Function: pair_device_with_code
CREATE OR REPLACE FUNCTION public.pair_device_with_code(
    p_pairing_code TEXT,
    p_device_id TEXT,
    p_device_name TEXT DEFAULT 'POS Terminal',
    p_device_type TEXT DEFAULT 'TERMINAL'
) RETURNS jsonb AS $$
DECLARE
    v_clean_code TEXT;
    v_clean_device_id TEXT;
    v_code_rec RECORD;
    v_rows_updated INTEGER;
    v_existing_dev RECORD;
    v_attempt_rec RECORD;
    v_new_attempts INTEGER;
    v_lock_until TIMESTAMPTZ;
BEGIN
    IF p_pairing_code IS NULL OR p_device_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enrollment code and device ID are required.');
    END IF;

    v_clean_code := trim(p_pairing_code);
    v_clean_device_id := trim(p_device_id);

    IF v_clean_code !~ '^\d{6}$'
       OR v_clean_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired enrollment code. Please generate a new code.');
    END IF;

    -- Persistent per-device defense in depth. The API gateway must also apply
    -- source-aware throttling because a hostile anonymous caller can rotate a
    -- self-asserted device ID.
    INSERT INTO public.device_pairing_attempts (device_id)
    VALUES (v_clean_device_id)
    ON CONFLICT (device_id) DO NOTHING;

    SELECT failed_attempts, window_started_at, locked_until
    INTO v_attempt_rec
    FROM public.device_pairing_attempts
    WHERE device_id = v_clean_device_id
    FOR UPDATE;

    IF v_attempt_rec.locked_until IS NOT NULL
       AND v_attempt_rec.locked_until > NOW() THEN
        RETURN jsonb_build_object(
            'success', false,
            'locked', true,
            'error', 'Invalid or expired enrollment code. Please generate a new code.'
        );
    END IF;

    IF v_attempt_rec.window_started_at <= NOW() - INTERVAL '5 minutes' THEN
        UPDATE public.device_pairing_attempts
        SET failed_attempts = 0,
            window_started_at = NOW(),
            locked_until = NULL,
            updated_at = NOW()
        WHERE device_id = v_clean_device_id;

        v_attempt_rec.failed_attempts := 0;
        v_attempt_rec.locked_until := NULL;
    END IF;

    SELECT id, business_id, branch_id, pairing_code_hash, expires_at
    INTO v_code_rec
    FROM public.device_pairing_codes
    WHERE status = 'WAITING'
      AND expires_at > NOW()
      AND pairing_code_hash = private.r002_crypt(v_clean_code, pairing_code_hash)
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        v_new_attempts := COALESCE(v_attempt_rec.failed_attempts, 0) + 1;
        v_lock_until := CASE
            WHEN v_new_attempts >= 5 THEN NOW() + INTERVAL '5 minutes'
            ELSE NULL
        END;

        UPDATE public.device_pairing_attempts
        SET failed_attempts = v_new_attempts,
            locked_until = v_lock_until,
            updated_at = NOW()
        WHERE device_id = v_clean_device_id;

        RETURN jsonb_strip_nulls(jsonb_build_object(
            'success', false,
            'locked', CASE WHEN v_new_attempts >= 5 THEN true ELSE NULL END,
            'error', 'Invalid or expired enrollment code. Please generate a new code.'
        ));
    END IF;

    -- Device Upsert Safety
    SELECT * INTO v_existing_dev
    FROM public.devices
    WHERE device_id = v_clean_device_id
    FOR UPDATE;
    
    IF FOUND THEN
        IF v_existing_dev.business_id != v_code_rec.business_id AND v_existing_dev.status = 'ACTIVE' THEN
            -- Device belongs to a different business and is still active. Reject.
            RETURN jsonb_build_object('success', false, 'error', 'Device enrollment failed. Revoke the existing enrollment before retrying.');
        END IF;
    END IF;

    UPDATE public.device_pairing_codes
    SET status = 'CONSUMED', used_at = NOW()
    WHERE id = v_code_rec.id AND status = 'WAITING';

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enrollment code already used. Please generate a new code.');
    END IF;

    INSERT INTO public.devices (
        device_id, business_id, branch_id, name, type, status, last_seen, updated_at
    ) VALUES (
        v_clean_device_id, v_code_rec.business_id, v_code_rec.branch_id, COALESCE(NULLIF(trim(p_device_name), ''), 'POS Terminal'), COALESCE(NULLIF(trim(p_device_type), ''), 'TERMINAL'), 'ACTIVE', NOW(), NOW()
    ) ON CONFLICT (device_id) DO UPDATE SET
        business_id = EXCLUDED.business_id,
        branch_id = EXCLUDED.branch_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        status = 'ACTIVE',
        last_seen = NOW(),
        updated_at = NOW();

    DELETE FROM public.device_pairing_attempts
    WHERE device_id = v_clean_device_id;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, event_type, details
    ) VALUES (
        'evt-device-enrolled-' || encode(private.r002_random_bytes(16), 'hex'),
        v_code_rec.business_id,
        v_code_rec.branch_id,
        v_clean_device_id,
        'DEVICE_ENROLLED',
        jsonb_build_object('device_id', v_clean_device_id, 'device_name', p_device_name, 'type', p_device_type)
    );

    RETURN jsonb_build_object(
        'success', true,
        'device_id', v_clean_device_id,
        'business_id', v_code_rec.business_id,
        'branch_id', v_code_rec.branch_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Clean up older function signature
DROP FUNCTION IF EXISTS public.verify_device_status(TEXT);

-- Function: verify_device_status
CREATE OR REPLACE FUNCTION public.verify_device_status(
    p_device_id TEXT
) RETURNS jsonb AS $$
DECLARE
    v_dev_rec RECORD;
BEGIN
    IF p_device_id IS NULL THEN
        RETURN jsonb_build_object('active', false, 'status', 'NO_DEVICE_ID');
    END IF;

    SELECT id, device_id, status
    INTO v_dev_rec
    FROM public.devices
    WHERE device_id = p_device_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('active', false, 'status', 'NOT_FOUND');
    END IF;

    IF v_dev_rec.status != 'ACTIVE' THEN
        RETURN jsonb_build_object('active', false, 'status', v_dev_rec.status);
    END IF;

    UPDATE public.devices SET last_seen = NOW() WHERE id = v_dev_rec.id;

    -- Minimal disclosure
    RETURN jsonb_build_object(
        'active', true,
        'status', 'ACTIVE'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Clean up older function signatures
DROP FUNCTION IF EXISTS public.revoke_device(UUID, TEXT);
DROP FUNCTION IF EXISTS public.revoke_device(UUID, TEXT, TEXT);

-- Function: revoke_device
CREATE OR REPLACE FUNCTION public.revoke_device(
    p_business_id UUID,
    p_device_id TEXT,
    p_session_token TEXT DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_clean_device_id TEXT;
    v_caller_id UUID;
    v_is_authorized BOOLEAN := false;
    v_session_rec RECORD;
    v_device_rec RECORD;
BEGIN
    IF p_business_id IS NULL OR p_device_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Business ID and Device ID are required.');
    END IF;

    v_clean_device_id := trim(p_device_id);

    IF v_clean_device_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Business ID and Device ID are required.');
    END IF;

    -- Lookup device to find branch_id
    SELECT * INTO v_device_rec
    FROM public.devices
    WHERE device_id = v_clean_device_id
      AND business_id = p_business_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Device record not found.');
    END IF;

    -- OPERATIONAL TERMINAL CONTRACT (R002 PATCH-F):
    -- Operational device revocation MUST require an active OWNER or MANAGER staff security sessionToken.
    -- Do NOT fall through to background Supabase owner auth (auth.uid()) on shared terminal calls.
    IF p_session_token IS NOT NULL AND trim(p_session_token) != '' THEN
        IF p_session_token !~ '^[a-f0-9]{64}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Terminal operational revocation requires an active OWNER or MANAGER session token.');
        END IF;

        FOR v_session_rec IN 
            SELECT sss.*, sm.status as staff_status, sm.role as staff_role
            FROM public.staff_security_sessions sss
            JOIN public.staff_members sm
              ON sm.id = sss.staff_id
             AND sm.business_id = sss.business_id
             AND sm.branch_id = sss.branch_id
            WHERE sss.business_id = p_business_id 
              AND sss.branch_id = v_device_rec.branch_id 
              AND sss.role IN ('MANAGER', 'OWNER')
              AND sss.role = sm.role
              AND sm.status = 'ACTIVE'
              AND sss.expires_at > NOW() 
              AND sss.revoked_at IS NULL
        LOOP
            IF v_session_rec.session_token_hash = private.r002_crypt(p_session_token, v_session_rec.session_token_hash) THEN
                v_is_authorized := true;
                v_caller_id := v_session_rec.staff_id;
                EXIT;
            END IF;
        END LOOP;
    ELSIF auth.role() = 'service_role' THEN
        v_is_authorized := true;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Terminal operational revocation requires an active OWNER or MANAGER session token.');
    END IF;

    UPDATE public.devices
    SET status = 'REVOKED', updated_at = NOW()
    WHERE business_id = p_business_id AND device_id = v_clean_device_id;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, actor_id, event_type, details
    ) VALUES (
        'evt-device-revoked-' || encode(private.r002_random_bytes(16), 'hex'),
        p_business_id,
        v_device_rec.branch_id,
        v_clean_device_id,
        v_caller_id::text,
        'DEVICE_REVOKED',
        jsonb_build_object('device_id', v_clean_device_id, 'business_id', p_business_id)
    );

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Clean up older function signature
DROP FUNCTION IF EXISTS public.get_device_bootstrap(TEXT);

-- Function: get_device_bootstrap
-- Retrieves minimal authorized terminal configuration and catalog for an active enrolled device.
-- Excludes credentials, PIN hashes, and sensitive financial logs.
CREATE OR REPLACE FUNCTION public.get_device_bootstrap(
    p_device_id TEXT
) RETURNS jsonb AS $$
DECLARE
    v_dev_rec RECORD;
    v_biz_rec RECORD;
    v_branch_rec RECORD;
    v_staff_list jsonb;
    v_product_list jsonb;
BEGIN
    IF p_device_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Device ID is required.');
    END IF;

    -- 1. Prove device exists and status = 'ACTIVE'
    SELECT d.id, d.device_id, d.business_id, d.branch_id, d.status
    INTO v_dev_rec
    FROM public.devices d
    WHERE d.device_id = p_device_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Device not registered.', 'status', 'NOT_FOUND');
    END IF;

    IF v_dev_rec.status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Device status is not active.', 'status', v_dev_rec.status);
    END IF;

    -- Update last_seen timestamp
    UPDATE public.devices SET last_seen = NOW() WHERE id = v_dev_rec.id;

    -- 2. Fetch Business public identity (EXCLUDING cloud owner_id per R002 PATCH-F capability review)
    SELECT id, name, onboarding_status
    INTO v_biz_rec
    FROM public.businesses
    WHERE id = v_dev_rec.business_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Associated business not found.');
    END IF;

    -- 3. Fetch Branch
    SELECT id, name, business_id
    INTO v_branch_rec
    FROM public.branches
    WHERE id = v_dev_rec.branch_id;

    -- 4. Fetch Staff directory for branch (EXCLUDING any credential or PIN data)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'role', s.role,
                'branch_id', s.branch_id,
                'status', s.status,
                'active_shift', COALESCE(s.active_shift, false),
                'performance_score', COALESCE(s.performance_score, 100)
            )
        ),
        '[]'::jsonb
    ) INTO v_staff_list
    FROM public.staff_members s
    WHERE s.business_id = v_dev_rec.business_id
      AND s.branch_id = v_dev_rec.branch_id
      AND s.status = 'ACTIVE';

    -- 5. Fetch Products catalog for business/branch
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', p.id,
                'name', p.name,
                'category', p.category,
                'price', p.price,
                'cost_price', p.cost_price,
                'costPrice', p.cost_price,
                'stock', p.stock_quantity,
                'description', p.description,
                'unit', p.unit_of_measure,
                'branch_id', p.branch_id
            )
        ),
        '[]'::jsonb
    ) INTO v_product_list
    FROM public.catalog_products p
    WHERE p.business_id = v_dev_rec.business_id
      AND (p.branch_id IS NULL OR p.branch_id = v_dev_rec.branch_id);

    RETURN jsonb_build_object(
        'success', true,
        'business', jsonb_build_object(
            'id', v_biz_rec.id,
            'name', v_biz_rec.name,
            'onboarding_status', v_biz_rec.onboarding_status
        ),
        'branch', jsonb_build_object(
            'id', v_branch_rec.id,
            'name', v_branch_rec.name,
            'business_id', v_branch_rec.business_id
        ),
        'staff', v_staff_list,
        'products', v_product_list
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- BLOCKER 11: EXPLICIT FUNCTION PRIVILEGES MATRIX
-- PostgreSQL functions receive PUBLIC EXECUTE by default.
-- For EVERY R002 RPC, REVOKE ALL from PUBLIC, anon, authenticated, then GRANT only intended roles.

REVOKE ALL ON FUNCTION public.set_staff_pin(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_staff_pin(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_staff_security_session(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_device_pairing_code(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pair_device_with_code(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_device_status(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_device(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_device_bootstrap(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_staff_pin(UUID, UUID, UUID, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(UUID, UUID, UUID, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_staff_security_session(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_device_pairing_code(UUID, UUID, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pair_device_with_code(TEXT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.verify_device_status(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_device(UUID, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_device_bootstrap(TEXT) TO authenticated, anon, service_role;
