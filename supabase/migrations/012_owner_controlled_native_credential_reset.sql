-- Supabase Migration: 012_owner_controlled_native_credential_reset.sql
-- Description: R012 owner-authorized, native-only staff credential recovery.
--
-- This migration is intentionally ordered after R001A -> R002 -> R011.  It
-- creates a short-lived recovery control plane; it never copies, exports, or
-- attempts to interpret a retired legacy credential.

-- =========================================================
-- 0. FAIL-CLOSED PREREQUISITES
-- =========================================================

DO $r012_preflight$
DECLARE
    v_missing text;
    v_partial text;
BEGIN
    SELECT string_agg(required_object, ', ' ORDER BY required_object)
    INTO v_missing
    FROM (VALUES
        ('public.businesses'),
        ('public.branches'),
        ('public.staff_members'),
        ('public.staff_credentials'),
        ('public.staff_security_sessions'),
        ('public.devices'),
        ('public.hub_branch_authority'),
        ('public.hub_staff_sessions'),
        ('public.hub_rate_limit_windows'),
        ('public.audit_logs'),
        ('private.r002_crypt(text,text)'),
        ('private.r002_gen_salt(text,integer)'),
        ('private.r002_random_bytes(integer)'),
        ('private.r003_sha256(bytea)'),
        ('private.r003_base64url_encode(bytea)'),
        ('private.r003_canonical_utc(timestamp with time zone)'),
        ('private.r003_consume_rate_limit(text,text,integer,interval)')
    ) AS required(required_object)
    WHERE (
        required_object LIKE '%.%(%'
        AND to_regprocedure(required_object) IS NULL
    ) OR (
        required_object NOT LIKE '%.%(%'
        AND to_regclass(required_object) IS NULL
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'R012_MISSING_PREREQUISITES: %', v_missing
            USING HINT = 'Run the complete accepted R002 and R003-R011 contracts before the credential-recovery control plane.';
    END IF;

    SELECT string_agg(object_name, ', ' ORDER BY object_name)
    INTO v_partial
    FROM (VALUES
        ('public.hub_staff_credential_reset_codes'),
        ('public.hub_staff_credential_reset_challenges'),
        ('private.r012_reset_code_fingerprint(text)'),
        ('public.r012_issue_staff_credential_reset_code(uuid,uuid,uuid,uuid,text,text)'),
        ('public.r012_begin_hub_staff_credential_reset(text,uuid,text,text,text,text)'),
        ('public.r012_get_hub_staff_credential_reset_context(uuid)'),
        ('public.r012_complete_hub_staff_credential_reset(uuid,text)')
    ) AS expected(object_name)
    WHERE (
        object_name LIKE '%.%(%'
        AND to_regprocedure(object_name) IS NOT NULL
    ) OR (
        object_name NOT LIKE '%.%(%'
        AND to_regclass(object_name) IS NOT NULL
    );

    IF v_partial IS NOT NULL THEN
        RAISE EXCEPTION 'R012_PARTIAL_STATE: %', v_partial
            USING HINT = 'Do not layer credential recovery over a partially applied R012. Restore the accepted baseline and investigate.';
    END IF;
END;
$r012_preflight$;

-- R003 owns the durable throttle implementation.  R012 adds namespaced,
-- purpose-specific subjects while preserving the exact rate-limit mechanics.
ALTER TABLE public.hub_rate_limit_windows
    DROP CONSTRAINT IF EXISTS hub_rate_limit_windows_scope_check;

ALTER TABLE public.hub_rate_limit_windows
    ADD CONSTRAINT hub_rate_limit_windows_scope_check CHECK (
        scope IN (
            'owner_pairing',
            'enrollment_source',
            'enrollment_device',
            'staff_source',
            'staff_device',
            'sync_device',
            'owner_credential_reset',
            'credential_reset_source',
            'credential_reset_device'
        )
    );

CREATE OR REPLACE FUNCTION private.r003_consume_rate_limit(
    p_scope text,
    p_subject_hash text,
    p_max_attempts integer,
    p_window interval
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_window public.hub_rate_limit_windows%ROWTYPE;
BEGIN
    IF p_scope NOT IN (
        'owner_pairing',
        'enrollment_source',
        'enrollment_device',
        'staff_source',
        'staff_device',
        'sync_device',
        'owner_credential_reset',
        'credential_reset_source',
        'credential_reset_device'
    ) OR p_subject_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR p_max_attempts < 2
       OR p_window <= interval '0 seconds' THEN
        RAISE EXCEPTION 'R003_INVALID_RATE_LIMIT_ARGUMENT';
    END IF;

    INSERT INTO public.hub_rate_limit_windows (scope, subject_hash)
    VALUES (p_scope, p_subject_hash)
    ON CONFLICT (scope, subject_hash) DO NOTHING;

    SELECT * INTO v_window
    FROM public.hub_rate_limit_windows
    WHERE scope = p_scope AND subject_hash = p_subject_hash
    FOR UPDATE;

    IF v_window.locked_until IS NOT NULL AND v_window.locked_until > now() THEN
        RETURN false;
    END IF;

    IF v_window.window_started_at <= now() - p_window THEN
        UPDATE public.hub_rate_limit_windows
        SET failed_attempts = 1,
            window_started_at = now(),
            locked_until = NULL,
            updated_at = now()
        WHERE scope = p_scope AND subject_hash = p_subject_hash;
        RETURN true;
    END IF;

    IF v_window.failed_attempts >= p_max_attempts - 1 THEN
        UPDATE public.hub_rate_limit_windows
        SET failed_attempts = failed_attempts + 1,
            locked_until = now() + p_window,
            updated_at = now()
        WHERE scope = p_scope AND subject_hash = p_subject_hash;
        RETURN false;
    END IF;

    UPDATE public.hub_rate_limit_windows
    SET failed_attempts = failed_attempts + 1,
        updated_at = now()
    WHERE scope = p_scope AND subject_hash = p_subject_hash;
    RETURN true;
END;
$function$;

-- =========================================================
-- 1. PRIVATE RECOVERY FACTS
-- =========================================================

-- The fingerprint is only an indexed identifier for a high-entropy, one-time
-- code.  The bcrypt value remains the verifier.  No raw code is persisted.
CREATE OR REPLACE FUNCTION private.r012_reset_code_fingerprint(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $function$
    SELECT private.r003_base64url_encode(
        private.r003_sha256(pg_catalog.convert_to($1, 'UTF8'))
    )
$function$;

CREATE TABLE public.hub_staff_credential_reset_codes (
    reset_code_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
    owner_hash text NOT NULL CHECK (owner_hash ~ '^[A-Za-z0-9_-]{43}$'),
    reset_code_fingerprint text NOT NULL UNIQUE CHECK (reset_code_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
    reset_code_hash text NOT NULL CHECK (
        reset_code_hash ~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
    ),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at),
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE TABLE public.hub_staff_credential_reset_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reset_code_id uuid NOT NULL UNIQUE
        REFERENCES public.hub_staff_credential_reset_codes(reset_code_id) ON DELETE RESTRICT,
    request_id uuid NOT NULL UNIQUE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
    source_hash text NOT NULL CHECK (source_hash ~ '^[A-Za-z0-9_-]{43}$'),
    device_hash text NOT NULL CHECK (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    nonce_base64 text NOT NULL CHECK (nonce_base64 ~ '^[A-Za-z0-9_-]{43}$'),
    nonce_sha256 bytea NOT NULL CHECK (octet_length(nonce_sha256) = 32),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at),
    CHECK (completed_at IS NULL OR completed_at >= created_at)
);

ALTER TABLE public.hub_staff_credential_reset_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_staff_credential_reset_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hub_staff_credential_reset_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_staff_credential_reset_challenges FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_hub_staff_credential_reset_codes_business_pending
    ON public.hub_staff_credential_reset_codes (business_id, expires_at DESC)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_hub_staff_credential_reset_codes_branch_staff_pending
    ON public.hub_staff_credential_reset_codes (branch_id, staff_id, expires_at DESC)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_hub_staff_credential_reset_codes_hub_device
    ON public.hub_staff_credential_reset_codes (hub_device_id);

CREATE INDEX idx_hub_staff_credential_reset_codes_staff
    ON public.hub_staff_credential_reset_codes (staff_id);

CREATE INDEX idx_hub_staff_credential_reset_codes_owner
    ON public.hub_staff_credential_reset_codes (owner_user_id);

CREATE INDEX idx_hub_staff_credential_reset_challenges_hub_pending
    ON public.hub_staff_credential_reset_challenges (hub_device_id, expires_at DESC)
    WHERE completed_at IS NULL;

CREATE INDEX idx_hub_staff_credential_reset_challenges_branch_staff_pending
    ON public.hub_staff_credential_reset_challenges (branch_id, staff_id, expires_at DESC)
    WHERE completed_at IS NULL;

CREATE INDEX idx_hub_staff_credential_reset_challenges_business
    ON public.hub_staff_credential_reset_challenges (business_id);

-- =========================================================
-- 2. OWNER CODE ISSUANCE (SERVICE-ONLY RPC)
-- =========================================================

CREATE OR REPLACE FUNCTION public.r012_issue_staff_credential_reset_code(
    p_business_id uuid,
    p_branch_id uuid,
    p_staff_id uuid,
    p_owner_user_id uuid,
    p_request_digest text,
    p_owner_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hub public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_raw_code text;
    v_code_fingerprint text;
    v_expires_at timestamptz;
    v_created boolean := false;
    v_attempt integer;
BEGIN
    IF p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR p_owner_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR NOT private.r003_consume_rate_limit(
           'owner_credential_reset', p_owner_hash, 4, interval '10 minutes'
       ) THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    -- The owner is the explicit business owner, rather than merely a manager
    -- membership. A recovery code is bound to the sole active Hub for scope.
    SELECT staff.* INTO v_staff
    FROM public.businesses business
    JOIN public.branches branch ON branch.id = p_branch_id
    JOIN public.staff_members staff ON staff.id = p_staff_id
    WHERE business.id = p_business_id
      AND business.owner_id = p_owner_user_id
      AND branch.business_id = business.id
      AND branch.is_active
      AND staff.business_id = business.id
      AND staff.branch_id = branch.id
      AND staff.status = 'ACTIVE'
      AND staff.role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR');

    SELECT device.* INTO v_hub
    FROM public.hub_branch_authority authority
    JOIN public.devices device ON device.id = authority.active_hub_device_id
    WHERE authority.business_id = p_business_id
      AND authority.branch_id = p_branch_id
      AND device.operational_role = 'CASHIER_HUB'
      AND device.status = 'ACTIVE'
      AND device.revoked_at IS NULL;

    IF v_staff.id IS NULL OR v_hub.id IS NULL THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    -- Serialize per staff identity. A fresh owner decision invalidates an
    -- earlier unconsumed code before the new code becomes visible.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_staff_id::text, 12012012)
    );

    UPDATE public.hub_staff_credential_reset_codes
    SET revoked_at = now()
    WHERE staff_id = p_staff_id
      AND branch_id = p_branch_id
      AND used_at IS NULL
      AND revoked_at IS NULL;

    v_expires_at := now() + interval '10 minutes';
    FOR v_attempt IN 1..16 LOOP
        -- First twelve base64url characters of sixteen random bytes provide
        -- 72 bits of online-guess-resistant, human-transcribable entropy.
        v_raw_code := substring(
            private.r003_base64url_encode(private.r002_random_bytes(16))
            FROM 1 FOR 12
        );
        v_code_fingerprint := private.r012_reset_code_fingerprint(v_raw_code);
        BEGIN
            INSERT INTO public.hub_staff_credential_reset_codes (
                business_id, branch_id, staff_id, hub_device_id, owner_user_id,
                request_digest, owner_hash, reset_code_fingerprint,
                reset_code_hash, expires_at
            ) VALUES (
                p_business_id, p_branch_id, p_staff_id, v_hub.id, p_owner_user_id,
                p_request_digest, p_owner_hash, v_code_fingerprint,
                private.r002_crypt(v_raw_code, private.r002_gen_salt('bf', 8)),
                v_expires_at
            );
            v_created := true;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            -- The fingerprint collision probability is negligible, but this
            -- loop means an unlikely collision never turns into a migration
            -- failure or a cross-code ambiguity.
            NULL;
        END;
    END LOOP;

    IF NOT v_created THEN
        RAISE EXCEPTION 'R012_RESET_CODE_SPACE_EXHAUSTED';
    END IF;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, actor_id, entity_id, event_type, details
    ) VALUES (
        'evt-hub-credential-reset-code-' || encode(private.r002_random_bytes(16), 'hex'),
        p_business_id,
        p_branch_id,
        p_owner_user_id::text,
        p_staff_id::text,
        'HUB_STAFF_CREDENTIAL_RESET_CODE_ISSUED',
        jsonb_build_object(
            'hub_device_id', v_hub.device_id,
            'expires_at', v_expires_at,
            'credential_value_retained', false
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'resetCode', v_raw_code,
        'expiresAt', private.r003_canonical_utc(v_expires_at)
    );
END;
$function$;

-- =========================================================
-- 3. NATIVE HUB CHALLENGE AND ATOMIC COMPLETION
-- =========================================================

CREATE OR REPLACE FUNCTION public.r012_begin_hub_staff_credential_reset(
    p_reset_code text,
    p_request_id uuid,
    p_request_digest text,
    p_source_hash text,
    p_device_hash text,
    p_hub_device_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.hub_staff_credential_reset_challenges%ROWTYPE;
    v_code public.hub_staff_credential_reset_codes%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_nonce bytea;
    v_nonce_base64 text;
    v_fingerprint text;
BEGIN
    IF p_reset_code IS NULL
       OR btrim(p_reset_code) !~ '^[A-Za-z0-9_-]{12}$'
       OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR NOT private.r003_consume_rate_limit(
           'credential_reset_source', p_source_hash, 8, interval '10 minutes'
       ) OR NOT private.r003_consume_rate_limit(
           'credential_reset_device', p_device_hash, 6, interval '10 minutes'
       ) THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_existing
    FROM public.hub_staff_credential_reset_challenges
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.request_digest <> p_request_digest
           OR v_existing.source_hash <> p_source_hash
           OR v_existing.device_hash <> p_device_hash
           OR v_existing.hub_device_id <> (
               SELECT id FROM public.devices WHERE device_id = p_hub_device_id
           ) THEN
            RETURN jsonb_build_object('ok', false);
        END IF;
        RETURN jsonb_build_object(
            'ok', true,
            'challengeId', v_existing.challenge_id::text,
            'nonce', v_existing.nonce_base64,
            'expiresAt', private.r003_canonical_utc(v_existing.expires_at),
            'completed', v_existing.completed_at IS NOT NULL
        );
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.hub_branch_authority authority
        WHERE authority.business_id = v_device.business_id
          AND authority.branch_id = v_device.branch_id
          AND authority.active_hub_device_id = v_device.id
    ) THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    v_fingerprint := private.r012_reset_code_fingerprint(btrim(p_reset_code));
    SELECT * INTO v_code
    FROM public.hub_staff_credential_reset_codes code
    WHERE code.reset_code_fingerprint = v_fingerprint
      AND code.used_at IS NULL
      AND code.revoked_at IS NULL
      AND code.expires_at > now()
      AND code.reset_code_hash = private.r002_crypt(btrim(p_reset_code), code.reset_code_hash)
    FOR UPDATE;

    IF NOT FOUND
       OR v_code.business_id <> v_device.business_id
       OR v_code.branch_id <> v_device.branch_id
       OR v_code.hub_device_id <> v_device.id THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_staff
    FROM public.staff_members
    WHERE id = v_code.staff_id
      AND business_id = v_code.business_id
      AND branch_id = v_code.branch_id
      AND status = 'ACTIVE';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    v_nonce := private.r002_random_bytes(32);
    v_nonce_base64 := private.r003_base64url_encode(v_nonce);

    INSERT INTO public.hub_staff_credential_reset_challenges (
        reset_code_id, request_id, request_digest, source_hash, device_hash,
        hub_device_id, business_id, branch_id, staff_id,
        nonce_base64, nonce_sha256, expires_at
    ) VALUES (
        v_code.reset_code_id, p_request_id, p_request_digest, p_source_hash, p_device_hash,
        v_device.id, v_device.business_id, v_device.branch_id, v_staff.id,
        v_nonce_base64, private.r003_sha256(v_nonce), now() + interval '5 minutes'
    ) RETURNING * INTO v_existing;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, entity_id, event_type, details
    ) VALUES (
        'evt-hub-credential-reset-challenge-' || encode(private.r002_random_bytes(16), 'hex'),
        v_existing.business_id,
        v_existing.branch_id,
        v_device.device_id,
        v_existing.staff_id::text,
        'HUB_STAFF_CREDENTIAL_RESET_CHALLENGE_ISSUED',
        jsonb_build_object('challenge_id', v_existing.challenge_id, 'expires_at', v_existing.expires_at)
    );

    RETURN jsonb_build_object(
        'ok', true,
        'challengeId', v_existing.challenge_id::text,
        'nonce', v_existing.nonce_base64,
        'expiresAt', private.r003_canonical_utc(v_existing.expires_at),
        'completed', false
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r012_get_hub_staff_credential_reset_context(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_staff_credential_reset_challenges%ROWTYPE;
    v_code public.hub_staff_credential_reset_codes%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_staff_credential_reset_challenges
    WHERE challenge_id = p_challenge_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE id = v_challenge.hub_device_id;

    IF v_challenge.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'state', 'COMPLETE',
            'requestId', v_challenge.request_id::text,
            'nonce', v_challenge.nonce_base64,
            'hubDeviceId', v_device.device_id,
            'hubSigningPublicKeyBase64', v_device.signing_public_key_base64,
            'staffId', v_challenge.staff_id::text
        );
    END IF;

    IF v_challenge.expires_at <= now() THEN
        RETURN jsonb_build_object('state', 'EXPIRED');
    END IF;

    SELECT * INTO v_code
    FROM public.hub_staff_credential_reset_codes
    WHERE reset_code_id = v_challenge.reset_code_id;

    SELECT * INTO v_staff
    FROM public.staff_members
    WHERE id = v_challenge.staff_id
      AND business_id = v_challenge.business_id
      AND branch_id = v_challenge.branch_id
      AND status = 'ACTIVE';

    IF NOT FOUND OR v_code.reset_code_id IS NULL OR v_device.id IS NULL
       OR v_device.status <> 'ACTIVE'
       OR v_device.revoked_at IS NOT NULL
       OR v_device.operational_role <> 'CASHIER_HUB'
       OR v_code.used_at IS NOT NULL
       OR v_code.revoked_at IS NOT NULL
       OR v_code.expires_at <= now()
       OR NOT EXISTS (
           SELECT 1
           FROM public.hub_branch_authority authority
           WHERE authority.business_id = v_challenge.business_id
             AND authority.branch_id = v_challenge.branch_id
             AND authority.active_hub_device_id = v_challenge.hub_device_id
       ) THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    RETURN jsonb_build_object(
        'state', 'PENDING',
        'requestId', v_challenge.request_id::text,
        'nonce', v_challenge.nonce_base64,
        'hubDeviceId', v_device.device_id,
        'hubSigningPublicKeyBase64', v_device.signing_public_key_base64,
        'staffId', v_staff.id::text,
        'staffName', v_staff.name,
        'staffRole', v_staff.role,
        'expiresAt', private.r003_canonical_utc(v_challenge.expires_at)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r012_complete_hub_staff_credential_reset(
    p_challenge_id uuid,
    p_pin text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_staff_credential_reset_challenges%ROWTYPE;
    v_code public.hub_staff_credential_reset_codes%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_revocation_version bigint;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_staff_credential_reset_challenges
    WHERE challenge_id = p_challenge_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT revocation_version INTO v_revocation_version
        FROM public.hub_branch_authority
        WHERE branch_id = v_challenge.branch_id
          AND business_id = v_challenge.business_id;
        RETURN jsonb_build_object(
            'ok', true,
            'state', 'COMPLETE',
            'staffId', v_challenge.staff_id::text,
            'revocationVersion', v_revocation_version
        );
    END IF;

    IF p_pin IS NULL
       OR btrim(p_pin) !~ '^\d{4,8}$'
       OR v_challenge.expires_at <= now() THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_code
    FROM public.hub_staff_credential_reset_codes
    WHERE reset_code_id = v_challenge.reset_code_id
    FOR UPDATE;

    SELECT * INTO v_device
    FROM public.devices
    WHERE id = v_challenge.hub_device_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_challenge.branch_id
      AND business_id = v_challenge.business_id
      AND active_hub_device_id = v_challenge.hub_device_id
    FOR UPDATE;

    SELECT * INTO v_staff
    FROM public.staff_members
    WHERE id = v_challenge.staff_id
      AND business_id = v_challenge.business_id
      AND branch_id = v_challenge.branch_id
      AND status = 'ACTIVE'
    FOR UPDATE;

    IF NOT FOUND OR v_code.reset_code_id IS NULL OR v_device.id IS NULL
       OR v_authority.branch_id IS NULL
       OR v_device.operational_role <> 'CASHIER_HUB'
       OR v_code.used_at IS NOT NULL
       OR v_code.revoked_at IS NOT NULL
       OR v_code.expires_at <= now()
       OR v_code.business_id <> v_challenge.business_id
       OR v_code.branch_id <> v_challenge.branch_id
       OR v_code.staff_id <> v_challenge.staff_id
       OR v_code.hub_device_id <> v_challenge.hub_device_id THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    INSERT INTO public.staff_credentials (
        staff_id, business_id, pin_hash, failed_attempts, locked_until, updated_at
    ) VALUES (
        v_staff.id,
        v_staff.business_id,
        private.r002_crypt(btrim(p_pin), private.r002_gen_salt('bf', 8)),
        0,
        NULL,
        now()
    ) ON CONFLICT (staff_id) DO UPDATE SET
        business_id = EXCLUDED.business_id,
        pin_hash = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = now();

    -- A credential reset advances the branch-wide authority revision. Revoke
    -- every currently issued local continuation in the branch in the same
    -- transaction so no stale bundle can retain an apparently usable session.
    UPDATE public.staff_security_sessions
    SET revoked_at = now()
    WHERE staff_id = v_staff.id
      AND business_id = v_staff.business_id
      AND branch_id = v_staff.branch_id
      AND revoked_at IS NULL;

    UPDATE public.hub_staff_sessions
    SET status = 'REVOKED',
        revoked_at = now()
    WHERE business_id = v_staff.business_id
      AND branch_id = v_staff.branch_id
      AND status IN ('PENDING', 'ACTIVE');

    UPDATE public.hub_branch_authority
    SET revocation_version = revocation_version + 1
    WHERE branch_id = v_authority.branch_id
      AND business_id = v_authority.business_id
    RETURNING revocation_version INTO v_revocation_version;

    UPDATE public.hub_staff_credential_reset_codes
    SET used_at = now()
    WHERE reset_code_id = v_code.reset_code_id;

    UPDATE public.hub_staff_credential_reset_challenges
    SET completed_at = now()
    WHERE challenge_id = v_challenge.challenge_id;

    -- R001A is optional for future clean installations.  When it exists, mark
    -- the reset requirement complete without coupling R012's parser to it.
    IF to_regclass('private.r001a_legacy_credential_resets') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE private.r001a_legacy_credential_resets
            SET reset_completed_at = now()
            WHERE staff_id = $1
              AND business_id = $2
              AND branch_id = $3
              AND reset_completed_at IS NULL
        $sql$
        USING v_staff.id, v_staff.business_id, v_staff.branch_id;
    END IF;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details
    ) VALUES (
        'evt-hub-credential-reset-complete-' || encode(private.r002_random_bytes(16), 'hex'),
        v_challenge.business_id,
        v_challenge.branch_id,
        v_device.device_id,
        v_code.owner_user_id::text,
        v_staff.id::text,
        'HUB_STAFF_CREDENTIAL_RESET_COMPLETED',
        jsonb_build_object(
            'hub_device_id', v_device.device_id,
            'revocation_version', v_revocation_version,
            'credential_value_retained', false
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'state', 'COMPLETE',
        'staffId', v_staff.id::text,
        'revocationVersion', v_revocation_version
    );
END;
$function$;

-- =========================================================
-- 4. EXECUTE PRIVILEGE BOUNDARY
-- =========================================================

REVOKE ALL ON FUNCTION private.r012_reset_code_fingerprint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_consume_rate_limit(text, text, integer, interval) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.r012_issue_staff_credential_reset_code(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r012_begin_hub_staff_credential_reset(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r012_get_hub_staff_credential_reset_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r012_complete_hub_staff_credential_reset(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r012_issue_staff_credential_reset_code(uuid, uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r012_begin_hub_staff_credential_reset(text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r012_get_hub_staff_credential_reset_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r012_complete_hub_staff_credential_reset(uuid, text) TO service_role;
