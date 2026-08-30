-- Supabase Migration: 014_terminal_staff_session_and_command_authority.sql
-- Description: native-only staff-session issuance for an already admitted
--              terminal. A terminal remains a signed local command client;
--              it never receives browser, BLE, or bearer authority.

DO $r014_preflight$
BEGIN
    IF to_regclass('public.hub_staff_sessions') IS NULL
       OR to_regclass('public.hub_terminal_admissions') IS NULL
       OR to_regclass('public.hub_authorization_bundles') IS NULL
       OR to_regclass('public.hub_branch_authority') IS NULL
       OR to_regclass('public.hub_rate_limit_windows') IS NULL
       OR to_regprocedure('private.r003_hub_bundle_context(uuid,uuid,text,text,text,text,bigint,uuid)') IS NULL
       OR to_regprocedure('private.r003_consume_rate_limit(text,text,integer,interval)') IS NULL
       OR to_regprocedure('private.r003_base64url_decode(text)') IS NULL
       OR to_regprocedure('private.r003_canonical_utc(timestamp with time zone)') IS NULL THEN
        RAISE EXCEPTION 'R014_REQUIRES_COMPLETE_R003_R013';
    END IF;
END;
$r014_preflight$;

-- R012's narrowed list inadvertently omitted the existing R010/R011 scopes.
-- Keep the single durable throttle table, but make every native receiver's
-- namespaced subject explicit before adding this terminal-session receiver.
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
            'owner_terminal_pairing',
            'terminal_enrollment_source',
            'terminal_enrollment_device',
            'authority_status_device',
            'terminal_admission_renewal_device',
            'owner_credential_reset',
            'credential_reset_source',
            'credential_reset_device',
            'terminal_staff_session_source',
            'terminal_staff_session_device'
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
        'owner_terminal_pairing',
        'terminal_enrollment_source',
        'terminal_enrollment_device',
        'authority_status_device',
        'terminal_admission_renewal_device',
        'owner_credential_reset',
        'credential_reset_source',
        'credential_reset_device',
        'terminal_staff_session_source',
        'terminal_staff_session_device'
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
        SET failed_attempts = 1, window_started_at = now(), locked_until = NULL, updated_at = now()
        WHERE scope = p_scope AND subject_hash = p_subject_hash;
        RETURN true;
    END IF;
    IF v_window.failed_attempts >= p_max_attempts - 1 THEN
        UPDATE public.hub_rate_limit_windows
        SET failed_attempts = failed_attempts + 1, locked_until = now() + p_window, updated_at = now()
        WHERE scope = p_scope AND subject_hash = p_subject_hash;
        RETURN false;
    END IF;
    UPDATE public.hub_rate_limit_windows
    SET failed_attempts = failed_attempts + 1, updated_at = now()
    WHERE scope = p_scope AND subject_hash = p_subject_hash;
    RETURN true;
END;
$function$;

-- A staff session remains Hub-scoped for immutable cloud replication, while
-- this field records the only device permitted to sign its local commands.
ALTER TABLE public.hub_staff_sessions
    ADD COLUMN IF NOT EXISTS command_device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT;

UPDATE public.hub_staff_sessions
SET command_device_id = hub_device_id
WHERE command_device_id IS NULL;

ALTER TABLE public.hub_staff_sessions
    ALTER COLUMN command_device_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hub_staff_sessions_command_device_active
    ON public.hub_staff_sessions (command_device_id, expires_at)
    WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_staff_sessions_one_active_terminal
    ON public.hub_staff_sessions (command_device_id)
    WHERE status = 'ACTIVE' AND command_device_id <> hub_device_id;

CREATE OR REPLACE FUNCTION private.r014_validate_hub_staff_command_device()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hub public.devices%ROWTYPE;
    v_command_device public.devices%ROWTYPE;
BEGIN
    IF NEW.command_device_id IS NULL THEN
        RAISE EXCEPTION 'R014_COMMAND_DEVICE_REQUIRED';
    END IF;

    -- Historical revoked rows must remain representable for audit and event
    -- foreign keys. Only a session that could be issued/used is constrained
    -- to the current active Hub and command device.
    IF NEW.status NOT IN ('PENDING', 'ACTIVE') THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_hub
    FROM public.devices
    WHERE id = NEW.hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;
    IF NOT FOUND
       OR v_hub.business_id IS DISTINCT FROM NEW.business_id
       OR v_hub.branch_id IS DISTINCT FROM NEW.branch_id
       OR NOT EXISTS (
           SELECT 1
           FROM public.hub_branch_authority authority
           WHERE authority.business_id = NEW.business_id
             AND authority.branch_id = NEW.branch_id
             AND authority.active_hub_device_id = NEW.hub_device_id
             AND authority.revocation_version = NEW.revocation_version
       ) THEN
        RAISE EXCEPTION 'R014_SESSION_HUB_SCOPE_INVALID';
    END IF;

    SELECT * INTO v_command_device
    FROM public.devices
    WHERE id = NEW.command_device_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;
    IF NOT FOUND
       OR v_command_device.business_id IS DISTINCT FROM NEW.business_id
       OR v_command_device.branch_id IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION 'R014_SESSION_COMMAND_DEVICE_SCOPE_INVALID';
    END IF;

    IF NEW.command_device_id = NEW.hub_device_id THEN
        RETURN NEW;
    END IF;

    IF v_command_device.operational_role IS DISTINCT FROM 'TERMINAL'
       OR v_command_device.terminal_role IS DISTINCT FROM NEW.role
       OR NEW.role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')
       OR NOT EXISTS (
           SELECT 1
           FROM public.hub_terminal_admissions admission
           WHERE admission.terminal_device_id = NEW.command_device_id
             AND admission.hub_device_id = NEW.hub_device_id
             AND admission.revocation_version = NEW.revocation_version
             AND admission.revoked_at IS NULL
             AND admission.expires_at > now()
       ) THEN
        RAISE EXCEPTION 'R014_TERMINAL_SESSION_BINDING_INVALID';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r014_validate_hub_staff_command_device ON public.hub_staff_sessions;
CREATE TRIGGER r014_validate_hub_staff_command_device
BEFORE INSERT OR UPDATE OF business_id, branch_id, hub_device_id, command_device_id, role, revocation_version, status
ON public.hub_staff_sessions
FOR EACH ROW EXECUTE FUNCTION private.r014_validate_hub_staff_command_device();

CREATE TABLE public.hub_terminal_staff_session_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL UNIQUE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
    source_hash text NOT NULL CHECK (source_hash ~ '^[A-Za-z0-9_-]{43}$'),
    device_hash text NOT NULL CHECK (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
    terminal_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    nonce_base64 text NOT NULL CHECK (nonce_base64 ~ '^[A-Za-z0-9_-]{43}$'),
    pin_verified_at timestamptz,
    prepared_session_id uuid REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    completed_at timestamptz,
    issuer_key_id text CHECK (issuer_key_id ~ '^[A-Za-z0-9._-]{1,128}$'),
    payload_base64 text CHECK (payload_base64 ~ '^[A-Za-z0-9_-]{2,350000}$'),
    signature_base64 text CHECK (signature_base64 ~ '^[A-Za-z0-9_-]{8,256}$'),
    issued_at timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at),
    CHECK ((completed_at IS NULL) = (issuer_key_id IS NULL)),
    CHECK ((completed_at IS NULL) = (payload_base64 IS NULL)),
    CHECK ((completed_at IS NULL) = (signature_base64 IS NULL)),
    CHECK ((completed_at IS NULL) = (issued_at IS NULL))
);

CREATE INDEX idx_hub_terminal_staff_session_challenges_pending
    ON public.hub_terminal_staff_session_challenges (terminal_device_id, staff_id, expires_at)
    WHERE completed_at IS NULL;

ALTER TABLE public.hub_terminal_staff_session_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_terminal_staff_session_challenges FROM PUBLIC, anon, authenticated;

-- Replaces R010's bundle context builder so a signed Hub reconciliation also
-- carries active terminal sessions bound to the correct command device.
CREATE OR REPLACE FUNCTION private.r003_hub_bundle_context(
    p_business_id uuid,
    p_branch_id uuid,
    p_hub_device_id text,
    p_hub_name text,
    p_hub_signing_public_key_base64 text,
    p_hub_tls_certificate_sha256 text,
    p_revocation_version bigint,
    p_pending_session_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_branch_business_id uuid;
    v_catalog_count integer;
    v_staff_count integer;
    v_session_count integer;
    v_catalog jsonb;
    v_staff_directory jsonb;
    v_sessions jsonb;
    v_paired_terminals jsonb;
    v_vat_enabled boolean;
    v_vat_rate numeric;
BEGIN
    SELECT business_id INTO v_branch_business_id
    FROM public.branches WHERE id = p_branch_id;
    IF NOT FOUND OR v_branch_business_id <> p_business_id THEN
        RAISE EXCEPTION 'R003_BUNDLE_BRANCH_SCOPE_MISMATCH';
    END IF;
    IF p_revocation_version < 1
       OR p_hub_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
       OR p_hub_name IS NULL OR length(trim(p_hub_name)) NOT BETWEEN 1 AND 120
       OR p_hub_signing_public_key_base64 !~ '^[A-Za-z0-9_-]{64,4096}$'
       OR p_hub_tls_certificate_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'R003_INVALID_BUNDLE_CONTEXT';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.catalog_products product
        WHERE product.business_id = p_business_id
          AND (product.branch_id IS NULL OR product.branch_id = p_branch_id)
          AND product.status NOT IN ('ACTIVE', 'ARCHIVED')
    ) THEN RAISE EXCEPTION 'R003_UNSUPPORTED_CATALOG_STATUS'; END IF;
    IF EXISTS (
        SELECT 1
        FROM public.catalog_products product
        LEFT JOIN public.inventory_branch_balances balance
          ON balance.product_id = product.id AND balance.branch_id = p_branch_id AND balance.business_id = p_business_id
        WHERE product.business_id = p_business_id
          AND (product.branch_id IS NULL OR product.branch_id = p_branch_id)
          AND balance.product_id IS NULL
    ) THEN RAISE EXCEPTION 'R003_CATALOG_BALANCE_MISSING'; END IF;

    SELECT count(*)::integer INTO v_catalog_count
    FROM public.catalog_products product
    WHERE product.business_id = p_business_id AND (product.branch_id IS NULL OR product.branch_id = p_branch_id);
    IF v_catalog_count > 5000 THEN RAISE EXCEPTION 'R003_CATALOG_SNAPSHOT_TOO_LARGE'; END IF;
    SELECT count(*)::integer INTO v_staff_count
    FROM public.staff_members staff
    WHERE staff.business_id = p_business_id AND staff.branch_id = p_branch_id
      AND staff.status = 'ACTIVE'
      AND staff.role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR');
    IF v_staff_count > 256 THEN RAISE EXCEPTION 'R003_STAFF_DIRECTORY_TOO_LARGE'; END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('staffId', staff.id::text, 'name', staff.name, 'role', staff.role) ORDER BY staff.name, staff.id), '[]'::jsonb)
    INTO v_staff_directory
    FROM public.staff_members staff
    WHERE staff.business_id = p_business_id AND staff.branch_id = p_branch_id
      AND staff.status = 'ACTIVE'
      AND staff.role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR');

    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', product.id::text, 'name', product.name, 'category', product.category, 'price', product.price,
        'stockQuantity', balance.quantity, 'unit', product.unit_of_measure,
        'branchId', product.branch_id::text, 'status', product.status
    )) ORDER BY product.name, product.id), '[]'::jsonb)
    INTO v_catalog
    FROM public.catalog_products product
    JOIN public.inventory_branch_balances balance
      ON balance.product_id = product.id AND balance.branch_id = p_branch_id AND balance.business_id = p_business_id
    WHERE product.business_id = p_business_id AND (product.branch_id IS NULL OR product.branch_id = p_branch_id);

    SELECT coalesce(configuration.vat_enabled, false), coalesce(configuration.vat_rate, 0)
    INTO v_vat_enabled, v_vat_rate
    FROM public.hub_branch_configuration configuration
    WHERE configuration.branch_id = p_branch_id AND configuration.business_id = p_business_id;
    IF NOT FOUND THEN v_vat_enabled := false; v_vat_rate := 0; END IF;

    WITH pending_session AS (
        SELECT staff_id, hub_device_id FROM public.hub_staff_sessions WHERE session_id = p_pending_session_id
    )
    SELECT count(*)::integer INTO v_session_count
    FROM public.hub_staff_sessions session
    JOIN public.devices command_device ON command_device.id = session.command_device_id
    LEFT JOIN pending_session pending ON true
    WHERE session.business_id = p_business_id AND session.branch_id = p_branch_id
      AND session.hub_device_id = (SELECT device.id FROM public.devices device WHERE device.device_id = p_hub_device_id)
      AND command_device.status = 'ACTIVE' AND command_device.revoked_at IS NULL
      AND session.expires_at > now() AND session.revocation_version = p_revocation_version
      AND ((session.status = 'ACTIVE' AND (pending.staff_id IS NULL OR session.staff_id <> pending.staff_id OR session.hub_device_id <> pending.hub_device_id))
        OR (session.status = 'PENDING' AND session.session_id = p_pending_session_id));
    IF v_session_count > 256 THEN RAISE EXCEPTION 'R014_STAFF_SESSION_SNAPSHOT_TOO_LARGE'; END IF;

    WITH pending_session AS (
        SELECT staff_id, hub_device_id FROM public.hub_staff_sessions WHERE session_id = p_pending_session_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'sessionId', session.session_id::text,
        'staffId', session.staff_id::text,
        'deviceId', command_device.device_id,
        'role', session.role,
        'expiresAt', private.r003_canonical_utc(session.expires_at),
        'revocationVersion', session.revocation_version
    ) ORDER BY session.created_at, session.session_id), '[]'::jsonb)
    INTO v_sessions
    FROM public.hub_staff_sessions session
    JOIN public.devices command_device ON command_device.id = session.command_device_id
    LEFT JOIN pending_session pending ON true
    WHERE session.business_id = p_business_id AND session.branch_id = p_branch_id
      AND session.hub_device_id = (SELECT device.id FROM public.devices device WHERE device.device_id = p_hub_device_id)
      AND command_device.status = 'ACTIVE' AND command_device.revoked_at IS NULL
      AND session.expires_at > now() AND session.revocation_version = p_revocation_version
      AND ((session.status = 'ACTIVE' AND (pending.staff_id IS NULL OR session.staff_id <> pending.staff_id OR session.hub_device_id <> pending.hub_device_id))
        OR (session.status = 'PENDING' AND session.session_id = p_pending_session_id));

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'deviceId', device.device_id, 'name', device.name, 'role', device.terminal_role,
        'publicKeyBase64', device.signing_public_key_base64, 'connectionType', 'LAN_WIFI'
    ) ORDER BY device.name, device.id), '[]'::jsonb)
    INTO v_paired_terminals
    FROM public.devices device
    WHERE device.business_id = p_business_id AND device.branch_id = p_branch_id
      AND device.operational_role = 'TERMINAL' AND device.status = 'ACTIVE' AND device.revoked_at IS NULL
      AND device.terminal_role IS NOT NULL AND device.signing_public_key_base64 IS NOT NULL;
    IF jsonb_array_length(v_paired_terminals) > 63 THEN RAISE EXCEPTION 'R010_TERMINAL_SNAPSHOT_TOO_LARGE'; END IF;

    RETURN jsonb_build_object(
        'businessId', p_business_id::text,
        'branchId', p_branch_id::text,
        'hubDeviceId', p_hub_device_id,
        'hubSigningPublicKeyBase64', p_hub_signing_public_key_base64,
        'hubTlsCertificateSha256', p_hub_tls_certificate_sha256,
        'revocationVersion', p_revocation_version,
        'pairedDevices', jsonb_build_array(jsonb_build_object(
            'deviceId', p_hub_device_id, 'name', trim(p_hub_name), 'role', 'ADMINISTRATOR',
            'publicKeyBase64', p_hub_signing_public_key_base64, 'connectionType', 'LAN_WIFI'
        )) || v_paired_terminals,
        'staffDirectory', v_staff_directory,
        'staffSessions', v_sessions,
        'configuration', jsonb_build_object(
            'vat', jsonb_build_object('enabled', v_vat_enabled, 'rate', v_vat_rate),
            'catalogProducts', v_catalog
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r014_begin_terminal_staff_session(
    p_request_id uuid,
    p_request_digest text,
    p_source_hash text,
    p_device_hash text,
    p_terminal_device_id text,
    p_staff_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.hub_terminal_staff_session_challenges%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_hub public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_nonce text;
BEGIN
    IF p_terminal_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
       OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR NOT private.r003_consume_rate_limit('terminal_staff_session_source', p_source_hash, 12, interval '10 minutes')
       OR NOT private.r003_consume_rate_limit('terminal_staff_session_device', p_device_hash, 8, interval '10 minutes') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;
    SELECT * INTO v_existing FROM public.hub_terminal_staff_session_challenges
    WHERE request_id = p_request_id FOR UPDATE;
    IF FOUND THEN
        IF v_existing.request_digest IS DISTINCT FROM p_request_digest
           OR v_existing.staff_id IS DISTINCT FROM p_staff_id
           OR v_existing.device_hash IS DISTINCT FROM p_device_hash
           OR v_existing.terminal_device_id IS DISTINCT FROM (SELECT id FROM public.devices WHERE device_id = p_terminal_device_id) THEN
            RETURN jsonb_build_object('ok', false);
        END IF;
        IF v_existing.completed_at IS NULL AND v_existing.expires_at <= now() THEN RETURN jsonb_build_object('ok', false); END IF;
        RETURN jsonb_build_object('ok', true, 'challengeId', v_existing.challenge_id::text,
            'nonce', v_existing.nonce_base64, 'expiresAt', private.r003_canonical_utc(v_existing.expires_at),
            'completed', v_existing.completed_at IS NOT NULL);
    END IF;

    SELECT * INTO v_terminal FROM public.devices
    WHERE device_id = p_terminal_device_id AND operational_role = 'TERMINAL'
      AND status = 'ACTIVE' AND revoked_at IS NULL;
    IF NOT FOUND OR v_terminal.terminal_role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE business_id = v_terminal.business_id AND branch_id = v_terminal.branch_id;
    SELECT * INTO v_hub FROM public.devices
    WHERE id = v_authority.active_hub_device_id AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE' AND revoked_at IS NULL;
    SELECT * INTO v_staff FROM public.staff_members
    WHERE id = p_staff_id AND business_id = v_terminal.business_id AND branch_id = v_terminal.branch_id
      AND status = 'ACTIVE';
    IF NOT FOUND OR v_hub.id IS NULL OR v_authority.active_hub_device_id IS NULL
       OR v_staff.role IS DISTINCT FROM v_terminal.terminal_role
       OR NOT EXISTS (
           SELECT 1 FROM public.hub_terminal_admissions admission
           WHERE admission.terminal_device_id = v_terminal.id AND admission.hub_device_id = v_hub.id
             AND admission.revocation_version = v_authority.revocation_version
             AND admission.revoked_at IS NULL AND admission.expires_at > now()
       ) THEN
        RETURN jsonb_build_object('ok', false);
    END IF;
    v_nonce := private.r003_base64url_encode(private.r002_random_bytes(32));
    INSERT INTO public.hub_terminal_staff_session_challenges (
        request_id, request_digest, source_hash, device_hash, terminal_device_id, hub_device_id,
        business_id, branch_id, staff_id, nonce_base64, expires_at
    ) VALUES (
        p_request_id, p_request_digest, p_source_hash, p_device_hash, v_terminal.id, v_hub.id,
        v_terminal.business_id, v_terminal.branch_id, v_staff.id, v_nonce, now() + interval '5 minutes'
    ) RETURNING * INTO v_existing;
    RETURN jsonb_build_object('ok', true, 'challengeId', v_existing.challenge_id::text,
        'nonce', v_existing.nonce_base64, 'expiresAt', private.r003_canonical_utc(v_existing.expires_at), 'completed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.r014_get_terminal_staff_session_context(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_terminal_staff_session_challenges%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_hub public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_session public.hub_staff_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_staff_session_challenges WHERE challenge_id = p_challenge_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    IF v_challenge.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'state', 'COMPLETE', 'requestId', v_challenge.request_id::text, 'nonce', v_challenge.nonce_base64,
            'terminalDeviceId', (SELECT device_id FROM public.devices WHERE id = v_challenge.terminal_device_id),
            'hubDeviceId', (SELECT device_id FROM public.devices WHERE id = v_challenge.hub_device_id),
            'staffId', v_challenge.staff_id::text,
            'terminalSigningPublicKeyBase64', (SELECT signing_public_key_base64 FROM public.devices WHERE id = v_challenge.terminal_device_id),
            'activeStaffSessionId', v_challenge.prepared_session_id::text,
            'envelope', jsonb_build_object('schemaVersion', 1, 'issuerKeyId', v_challenge.issuer_key_id,
                'payloadBase64', v_challenge.payload_base64, 'signature', v_challenge.signature_base64)
        );
    END IF;
    IF v_challenge.expires_at <= now() THEN RETURN jsonb_build_object('state', 'EXPIRED'); END IF;
    SELECT * INTO v_terminal FROM public.devices WHERE id = v_challenge.terminal_device_id AND status = 'ACTIVE' AND revoked_at IS NULL;
    SELECT * INTO v_hub FROM public.devices WHERE id = v_challenge.hub_device_id AND operational_role = 'CASHIER_HUB' AND status = 'ACTIVE' AND revoked_at IS NULL;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE business_id = v_challenge.business_id AND branch_id = v_challenge.branch_id AND active_hub_device_id = v_challenge.hub_device_id;
    IF NOT FOUND OR v_terminal.id IS NULL OR v_hub.id IS NULL
       OR NOT EXISTS (
           SELECT 1 FROM public.hub_terminal_admissions admission
           WHERE admission.terminal_device_id = v_terminal.id AND admission.hub_device_id = v_hub.id
             AND admission.revocation_version = v_authority.revocation_version
             AND admission.revoked_at IS NULL AND admission.expires_at > now()
       ) THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    IF v_challenge.prepared_session_id IS NULL THEN
        RETURN jsonb_build_object('state', 'PENDING', 'requestId', v_challenge.request_id::text,
            'nonce', v_challenge.nonce_base64, 'terminalDeviceId', v_terminal.device_id,
            'hubDeviceId', v_hub.device_id, 'staffId', v_challenge.staff_id::text,
            'terminalSigningPublicKeyBase64', v_terminal.signing_public_key_base64);
    END IF;
    SELECT * INTO v_session FROM public.hub_staff_sessions WHERE session_id = v_challenge.prepared_session_id;
    IF NOT FOUND OR v_session.status IS DISTINCT FROM 'PENDING' OR v_session.command_device_id IS DISTINCT FROM v_terminal.id THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;
    RETURN jsonb_build_object('state', 'PREPARED', 'requestId', v_challenge.request_id::text,
        'nonce', v_challenge.nonce_base64, 'terminalDeviceId', v_terminal.device_id,
        'hubDeviceId', v_hub.device_id, 'staffId', v_challenge.staff_id::text,
        'terminalSigningPublicKeyBase64', v_terminal.signing_public_key_base64,
        'sessionId', v_session.session_id::text,
        'expiresAt', private.r003_canonical_utc(v_session.expires_at),
        'sessionContext', jsonb_build_object(
            'sessionId', v_session.session_id::text,
            'staffId', v_session.staff_id::text,
            'businessId', v_session.business_id::text,
            'branchId', v_session.branch_id::text,
            'hubDeviceId', v_hub.device_id,
            'terminalDeviceId', v_terminal.device_id,
            'terminalSigningPublicKeyBase64', v_terminal.signing_public_key_base64,
            'role', v_session.role,
            'revocationVersion', v_session.revocation_version,
            'expiresAt', private.r003_canonical_utc(v_session.expires_at)
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r014_verify_terminal_staff_pin(
    p_challenge_id uuid,
    p_pin text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_terminal_staff_session_challenges%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_credential public.staff_credentials%ROWTYPE;
    v_new_attempts integer;
    v_lock_until timestamptz;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_staff_session_challenges
    WHERE challenge_id = p_challenge_id FOR UPDATE;
    IF NOT FOUND OR v_challenge.completed_at IS NOT NULL OR v_challenge.expires_at <= now()
       OR p_pin IS NULL OR trim(p_pin) !~ '^\\d{4,8}$' THEN RETURN jsonb_build_object('authenticated', false); END IF;
    SELECT * INTO v_terminal FROM public.devices WHERE id = v_challenge.terminal_device_id AND status = 'ACTIVE' AND revoked_at IS NULL;
    SELECT * INTO v_staff FROM public.staff_members WHERE id = v_challenge.staff_id
      AND business_id = v_challenge.business_id AND branch_id = v_challenge.branch_id AND status = 'ACTIVE';
    SELECT * INTO v_credential FROM public.staff_credentials WHERE staff_id = v_challenge.staff_id
      AND business_id = v_challenge.business_id FOR UPDATE;
    IF NOT FOUND OR v_terminal.id IS NULL OR v_staff.id IS NULL
       OR v_staff.role IS DISTINCT FROM v_terminal.terminal_role
       OR v_staff.role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER') THEN RETURN jsonb_build_object('authenticated', false); END IF;
    IF v_challenge.pin_verified_at IS NOT NULL THEN RETURN jsonb_build_object('authenticated', true); END IF;
    IF v_credential.locked_until IS NOT NULL AND v_credential.locked_until > now() THEN RETURN jsonb_build_object('authenticated', false, 'locked', true); END IF;
    IF v_credential.pin_hash = private.r002_crypt(trim(p_pin), v_credential.pin_hash) THEN
        UPDATE public.staff_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE staff_id = v_staff.id;
        UPDATE public.hub_terminal_staff_session_challenges SET pin_verified_at = now() WHERE challenge_id = v_challenge.challenge_id;
        INSERT INTO public.audit_logs (event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details)
        VALUES ('evt-terminal-staff-login-ok-' || encode(private.r002_random_bytes(16), 'hex'),
            v_challenge.business_id, v_challenge.branch_id, v_terminal.device_id, v_staff.id::text, v_staff.id::text,
            'TERMINAL_STAFF_LOGIN_SUCCESS', jsonb_build_object('terminal_device_id', v_terminal.device_id, 'staff_id', v_staff.id));
        RETURN jsonb_build_object('authenticated', true);
    END IF;
    v_new_attempts := coalesce(v_credential.failed_attempts, 0) + 1;
    v_lock_until := CASE WHEN v_new_attempts >= 5 THEN now() + interval '5 minutes' ELSE NULL END;
    UPDATE public.staff_credentials SET failed_attempts = v_new_attempts, locked_until = v_lock_until, updated_at = now()
    WHERE staff_id = v_staff.id;
    INSERT INTO public.audit_logs (event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details)
    VALUES ('evt-terminal-staff-login-fail-' || encode(private.r002_random_bytes(16), 'hex'),
        v_challenge.business_id, v_challenge.branch_id, v_terminal.device_id, v_staff.id::text, v_staff.id::text,
        CASE WHEN v_new_attempts >= 5 THEN 'TERMINAL_STAFF_LOGIN_LOCKED' ELSE 'TERMINAL_STAFF_LOGIN_FAILURE' END,
        jsonb_build_object('terminal_device_id', v_terminal.device_id, 'staff_id', v_staff.id, 'attempts', v_new_attempts));
    RETURN jsonb_strip_nulls(jsonb_build_object('authenticated', false, 'locked', CASE WHEN v_new_attempts >= 5 THEN true ELSE NULL END));
END;
$function$;

CREATE OR REPLACE FUNCTION public.r014_prepare_terminal_staff_session(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_terminal_staff_session_challenges%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_hub public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_bundle public.hub_authorization_bundles%ROWTYPE;
    v_session public.hub_staff_sessions%ROWTYPE;
    v_session_expiry timestamptz;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_staff_session_challenges
    WHERE challenge_id = p_challenge_id FOR UPDATE;
    IF NOT FOUND OR v_challenge.completed_at IS NOT NULL OR v_challenge.expires_at <= now() OR v_challenge.pin_verified_at IS NULL THEN
        RAISE EXCEPTION 'R014_TERMINAL_STAFF_SESSION_NOT_VERIFIED';
    END IF;
    SELECT * INTO v_terminal FROM public.devices WHERE id = v_challenge.terminal_device_id
      AND operational_role = 'TERMINAL' AND status = 'ACTIVE' AND revoked_at IS NULL;
    SELECT * INTO v_hub FROM public.devices WHERE id = v_challenge.hub_device_id
      AND operational_role = 'CASHIER_HUB' AND status = 'ACTIVE' AND revoked_at IS NULL;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE business_id = v_challenge.business_id AND branch_id = v_challenge.branch_id
      AND active_hub_device_id = v_challenge.hub_device_id FOR UPDATE;
    SELECT * INTO v_staff FROM public.staff_members WHERE id = v_challenge.staff_id
      AND business_id = v_challenge.business_id AND branch_id = v_challenge.branch_id AND status = 'ACTIVE';
    SELECT * INTO v_bundle FROM public.hub_authorization_bundles
    WHERE hub_device_id = v_challenge.hub_device_id AND branch_id = v_challenge.branch_id
      AND is_active AND revoked_at IS NULL AND expires_at > now() FOR UPDATE;
    IF NOT FOUND OR v_terminal.id IS NULL OR v_hub.id IS NULL OR v_authority.active_hub_device_id IS NULL
       OR v_staff.role IS DISTINCT FROM v_terminal.terminal_role
       OR NOT EXISTS (
           SELECT 1 FROM public.hub_terminal_admissions admission
           WHERE admission.terminal_device_id = v_terminal.id AND admission.hub_device_id = v_hub.id
             AND admission.revocation_version = v_authority.revocation_version
             AND admission.revoked_at IS NULL AND admission.expires_at > now()
       ) THEN RAISE EXCEPTION 'R014_TERMINAL_STAFF_SESSION_SCOPE_INVALID'; END IF;
    IF v_challenge.prepared_session_id IS NULL THEN
        UPDATE public.hub_staff_sessions SET status = 'REVOKED', revoked_at = now()
        WHERE command_device_id = v_terminal.id AND status = 'PENDING';
        v_session_expiry := least(now() + interval '12 hours', v_bundle.expires_at);
        IF v_session_expiry <= now() + interval '1 minute' THEN RAISE EXCEPTION 'R014_TERMINAL_SESSION_BUNDLE_NEAR_EXPIRY'; END IF;
        INSERT INTO public.hub_staff_sessions (
            session_id, business_id, branch_id, hub_device_id, command_device_id, staff_id,
            role, revocation_version, status, expires_at
        ) VALUES (
            gen_random_uuid(), v_challenge.business_id, v_challenge.branch_id, v_hub.id, v_terminal.id, v_staff.id,
            v_staff.role, v_authority.revocation_version, 'PENDING', v_session_expiry
        ) RETURNING * INTO v_session;
        UPDATE public.hub_terminal_staff_session_challenges
        SET prepared_session_id = v_session.session_id WHERE challenge_id = v_challenge.challenge_id;
    ELSE
        SELECT * INTO v_session FROM public.hub_staff_sessions
        WHERE session_id = v_challenge.prepared_session_id AND status = 'PENDING' AND command_device_id = v_terminal.id;
        IF NOT FOUND THEN RAISE EXCEPTION 'R014_TERMINAL_STAFF_SESSION_PREPARATION_INVALID'; END IF;
    END IF;
    RETURN jsonb_build_object('state', 'PREPARED', 'sessionId', v_session.session_id::text,
        'expiresAt', private.r003_canonical_utc(v_session.expires_at),
        'sessionContext', jsonb_build_object(
            'sessionId', v_session.session_id::text, 'staffId', v_session.staff_id::text,
            'businessId', v_session.business_id::text, 'branchId', v_session.branch_id::text,
            'hubDeviceId', v_hub.device_id, 'terminalDeviceId', v_terminal.device_id,
            'terminalSigningPublicKeyBase64', v_terminal.signing_public_key_base64,
            'role', v_session.role, 'revocationVersion', v_session.revocation_version,
            'expiresAt', private.r003_canonical_utc(v_session.expires_at)
        ));
END;
$function$;

CREATE OR REPLACE FUNCTION private.r014_validate_terminal_staff_session_assertion(
    p_session public.hub_staff_sessions,
    p_terminal public.devices,
    p_hub public.devices,
    p_issuer_key_id text,
    p_payload_base64 text,
    p_signature_base64 text,
    p_payload jsonb,
    p_issued_at timestamptz,
    p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_decoded_payload jsonb;
BEGIN
    IF p_issuer_key_id !~ '^[A-Za-z0-9._-]{1,128}$'
       OR p_payload_base64 !~ '^[A-Za-z0-9_-]{2,350000}$'
       OR p_signature_base64 !~ '^[A-Za-z0-9_-]{8,256}$'
       OR p_issued_at < now() - interval '5 minutes' OR p_issued_at > now() + interval '5 minutes'
       OR p_expires_at IS DISTINCT FROM p_session.expires_at OR p_expires_at <= p_issued_at
       OR p_expires_at > p_issued_at + interval '12 hours' THEN
        RAISE EXCEPTION 'R014_INVALID_TERMINAL_SESSION_ASSERTION';
    END IF;
    BEGIN
        v_decoded_payload := convert_from(private.r003_base64url_decode(p_payload_base64), 'UTF8')::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R014_INVALID_TERMINAL_SESSION_PAYLOAD';
    END;
    IF v_decoded_payload IS DISTINCT FROM p_payload
       OR (p_payload->>'schemaVersion') IS DISTINCT FROM '1'
       OR (p_payload->>'sessionId') IS DISTINCT FROM p_session.session_id::text
       OR (p_payload->>'staffId') IS DISTINCT FROM p_session.staff_id::text
       OR (p_payload->>'businessId') IS DISTINCT FROM p_session.business_id::text
       OR (p_payload->>'branchId') IS DISTINCT FROM p_session.branch_id::text
       OR (p_payload->>'hubDeviceId') IS DISTINCT FROM p_hub.device_id
       OR (p_payload->>'terminalDeviceId') IS DISTINCT FROM p_terminal.device_id
       OR (p_payload->>'terminalSigningPublicKeyBase64') IS DISTINCT FROM p_terminal.signing_public_key_base64
       OR (p_payload->>'role') IS DISTINCT FROM p_session.role
       OR (p_payload->>'revocationVersion') IS DISTINCT FROM p_session.revocation_version::text
       OR (p_payload->>'issuedAt') IS DISTINCT FROM private.r003_canonical_utc(p_issued_at)
       OR (p_payload->>'expiresAt') IS DISTINCT FROM private.r003_canonical_utc(p_expires_at) THEN
        RAISE EXCEPTION 'R014_TERMINAL_SESSION_ASSERTION_SCOPE_MISMATCH';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.r014_finalize_terminal_staff_session(
    p_challenge_id uuid,
    p_session_id uuid,
    p_issuer_key_id text,
    p_payload_base64 text,
    p_signature_base64 text,
    p_payload jsonb,
    p_issued_at timestamptz,
    p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_terminal_staff_session_challenges%ROWTYPE;
    v_session public.hub_staff_sessions%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_hub public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_staff_session_challenges
    WHERE challenge_id = p_challenge_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'R014_TERMINAL_STAFF_SESSION_CHALLENGE_INVALID'; END IF;
    IF v_challenge.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('schemaVersion', 1, 'issuerKeyId', v_challenge.issuer_key_id,
            'payloadBase64', v_challenge.payload_base64, 'signature', v_challenge.signature_base64);
    END IF;
    IF v_challenge.expires_at <= now() OR v_challenge.pin_verified_at IS NULL
       OR v_challenge.prepared_session_id IS DISTINCT FROM p_session_id THEN
        RAISE EXCEPTION 'R014_TERMINAL_STAFF_SESSION_NOT_PREPARED';
    END IF;
    SELECT * INTO v_session FROM public.hub_staff_sessions
    WHERE session_id = p_session_id AND status = 'PENDING' FOR UPDATE;
    SELECT * INTO v_terminal FROM public.devices WHERE id = v_challenge.terminal_device_id
      AND operational_role = 'TERMINAL' AND status = 'ACTIVE' AND revoked_at IS NULL FOR UPDATE;
    SELECT * INTO v_hub FROM public.devices WHERE id = v_challenge.hub_device_id
      AND operational_role = 'CASHIER_HUB' AND status = 'ACTIVE' AND revoked_at IS NULL FOR UPDATE;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE business_id = v_challenge.business_id AND branch_id = v_challenge.branch_id
      AND active_hub_device_id = v_challenge.hub_device_id FOR UPDATE;
    IF NOT FOUND OR v_session.session_id IS NULL OR v_terminal.id IS NULL OR v_hub.id IS NULL
       OR v_session.command_device_id IS DISTINCT FROM v_terminal.id
       OR v_session.revocation_version IS DISTINCT FROM v_authority.revocation_version THEN
        RAISE EXCEPTION 'R014_TERMINAL_STAFF_SESSION_SCOPE_INVALID';
    END IF;
    PERFORM private.r014_validate_terminal_staff_session_assertion(
        v_session, v_terminal, v_hub, p_issuer_key_id, p_payload_base64, p_signature_base64,
        p_payload, p_issued_at, p_expires_at
    );
    UPDATE public.hub_staff_sessions SET status = 'REVOKED', revoked_at = now()
    WHERE status = 'ACTIVE'
      AND session_id <> v_session.session_id
      AND (command_device_id = v_terminal.id OR (hub_device_id = v_hub.id AND staff_id = v_session.staff_id));
    UPDATE public.hub_staff_sessions SET status = 'ACTIVE', activated_at = now()
    WHERE session_id = v_session.session_id;
    UPDATE public.hub_terminal_staff_session_challenges
    SET completed_at = now(), issuer_key_id = p_issuer_key_id, payload_base64 = p_payload_base64,
        signature_base64 = p_signature_base64, issued_at = p_issued_at
    WHERE challenge_id = v_challenge.challenge_id;
    INSERT INTO public.audit_logs (event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details)
    VALUES ('evt-terminal-staff-session-issued-' || encode(private.r002_random_bytes(16), 'hex'),
        v_session.business_id, v_session.branch_id, v_terminal.device_id, v_session.staff_id::text, v_session.session_id::text,
        'TERMINAL_STAFF_SESSION_ISSUED', jsonb_build_object(
            'terminal_device_id', v_terminal.device_id, 'hub_device_id', v_hub.device_id,
            'staff_session_id', v_session.session_id, 'role', v_session.role,
            'revocation_version', v_session.revocation_version
        ));
    RETURN jsonb_build_object('schemaVersion', 1, 'issuerKeyId', p_issuer_key_id,
        'payloadBase64', p_payload_base64, 'signature', p_signature_base64);
END;
$function$;

REVOKE ALL ON FUNCTION private.r003_consume_rate_limit(text, text, integer, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r014_validate_hub_staff_command_device() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r014_validate_terminal_staff_session_assertion(public.hub_staff_sessions, public.devices, public.devices, text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r014_begin_terminal_staff_session(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r014_get_terminal_staff_session_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r014_verify_terminal_staff_pin(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r014_prepare_terminal_staff_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r014_finalize_terminal_staff_session(uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r014_begin_terminal_staff_session(uuid, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r014_get_terminal_staff_session_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r014_verify_terminal_staff_pin(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r014_prepare_terminal_staff_session(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r014_finalize_terminal_staff_session(uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) TO service_role;
