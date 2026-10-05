-- Supabase Migration: 010_device_pairing_and_local_links.sql
-- Description: owner-controlled terminal enrollment, admission records, and
--              Hub-bundle reconciliation for the native local-link contract.
--
-- This migration depends on the accepted R002/R003 contracts. It intentionally
-- exposes no pairing-code hashes, private keys, session bearer, or device
-- secret through the Data API.

DO $r010_preflight$
BEGIN
    IF to_regclass('public.devices') IS NULL
       OR to_regclass('public.device_pairing_codes') IS NULL
       OR to_regclass('public.hub_branch_authority') IS NULL
       OR to_regclass('public.hub_authorization_bundles') IS NULL
       OR to_regclass('public.hub_enrollment_challenges') IS NULL
       OR to_regprocedure('private.r002_crypt(text,text)') IS NULL
       OR to_regprocedure('private.r002_random_bytes(integer)') IS NULL
       OR to_regprocedure('private.r003_hub_bundle_context(uuid,uuid,text,text,text,text,bigint,uuid)') IS NULL
       OR to_regprocedure('private.r003_consume_rate_limit(text,text,integer,interval)') IS NULL THEN
        RAISE EXCEPTION 'R010_REQUIRES_COMPLETE_R002_R003';
    END IF;
END;
$r010_preflight$;

ALTER TABLE public.device_pairing_codes
    ADD COLUMN IF NOT EXISTS pairing_purpose text NOT NULL DEFAULT 'HUB_ENROLLMENT',
    ADD COLUMN IF NOT EXISTS requested_terminal_name text,
    ADD COLUMN IF NOT EXISTS requested_terminal_role text;

DO $r010_pairing_code_constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'device_pairing_codes_pairing_purpose_check'
          AND conrelid = 'public.device_pairing_codes'::regclass
    ) THEN
        ALTER TABLE public.device_pairing_codes
            ADD CONSTRAINT device_pairing_codes_pairing_purpose_check
            CHECK (pairing_purpose IN ('HUB_ENROLLMENT', 'TERMINAL_ENROLLMENT'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'device_pairing_codes_requested_terminal_role_check'
          AND conrelid = 'public.device_pairing_codes'::regclass
    ) THEN
        ALTER TABLE public.device_pairing_codes
            ADD CONSTRAINT device_pairing_codes_requested_terminal_role_check
            CHECK (
                requested_terminal_role IS NULL
                OR requested_terminal_role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')
            );
    END IF;
END;
$r010_pairing_code_constraints$;

ALTER TABLE public.devices
    ADD COLUMN IF NOT EXISTS terminal_role text,
    ADD COLUMN IF NOT EXISTS local_link_preference text NOT NULL DEFAULT 'LAN_WIFI';

DO $r010_device_constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'devices_terminal_role_check'
          AND conrelid = 'public.devices'::regclass
    ) THEN
        ALTER TABLE public.devices
            ADD CONSTRAINT devices_terminal_role_check
            CHECK (terminal_role IS NULL OR terminal_role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'devices_local_link_preference_check'
          AND conrelid = 'public.devices'::regclass
    ) THEN
        ALTER TABLE public.devices
            ADD CONSTRAINT devices_local_link_preference_check
            CHECK (local_link_preference IN ('LAN_WIFI', 'WIFI_DIRECT', 'BLE_PROXIMITY'));
    END IF;
END;
$r010_device_constraints$;

CREATE INDEX IF NOT EXISTS idx_devices_active_terminal_branch
    ON public.devices (business_id, branch_id, terminal_role, name)
    WHERE operational_role = 'TERMINAL' AND status = 'ACTIVE' AND revoked_at IS NULL;

CREATE TABLE public.hub_terminal_enrollment_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pairing_code_id uuid NOT NULL UNIQUE REFERENCES public.device_pairing_codes(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL UNIQUE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
    source_hash text NOT NULL CHECK (source_hash ~ '^[A-Za-z0-9_-]{43}$'),
    device_hash text NOT NULL CHECK (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    terminal_device_id text NOT NULL CHECK (terminal_device_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
    terminal_name text NOT NULL CHECK (length(trim(terminal_name)) BETWEEN 1 AND 120),
    terminal_role text NOT NULL CHECK (terminal_role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')),
    signing_public_key_base64 text NOT NULL CHECK (signing_public_key_base64 ~ '^[A-Za-z0-9_-]{64,4096}$'),
    nonce_base64 text NOT NULL CHECK (nonce_base64 ~ '^[A-Za-z0-9_-]{43}$'),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    completed_admission_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_hub_terminal_enrollment_challenges_pending
    ON public.hub_terminal_enrollment_challenges (branch_id, expires_at)
    WHERE completed_at IS NULL;

CREATE TABLE public.hub_terminal_admissions (
    admission_id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    terminal_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    issuer_key_id text NOT NULL CHECK (issuer_key_id ~ '^[A-Za-z0-9._-]{1,128}$'),
    payload_base64 text NOT NULL CHECK (payload_base64 ~ '^[A-Za-z0-9_-]{2,350000}$'),
    signature_base64 text NOT NULL CHECK (signature_base64 ~ '^[A-Za-z0-9_-]{8,256}$'),
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revocation_version bigint NOT NULL CHECK (revocation_version >= 1),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX idx_hub_terminal_admissions_active_terminal
    ON public.hub_terminal_admissions (terminal_device_id)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_hub_terminal_admissions_active_branch
    ON public.hub_terminal_admissions (branch_id, revocation_version DESC)
    WHERE revoked_at IS NULL;

ALTER TABLE public.hub_terminal_enrollment_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_terminal_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_terminal_enrollment_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.hub_terminal_admissions FROM PUBLIC, anon, authenticated;

-- Replace R003's Hub bundle context builder with an extension that includes
-- only active, cloud-enrolled terminal public keys. This still returns the
-- Hub's own device first and keeps its existing function signature intact.
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
    v_catalog jsonb;
    v_staff_count integer;
    v_staff_directory jsonb;
    v_sessions jsonb;
    v_paired_terminals jsonb;
    v_vat_enabled boolean;
    v_vat_rate numeric;
BEGIN
    SELECT business_id INTO v_branch_business_id
    FROM public.branches
    WHERE id = p_branch_id;

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
        SELECT 1 FROM public.catalog_products p
        WHERE p.business_id = p_business_id
          AND (p.branch_id IS NULL OR p.branch_id = p_branch_id)
          AND p.status NOT IN ('ACTIVE', 'ARCHIVED')
    ) THEN
        RAISE EXCEPTION 'R003_UNSUPPORTED_CATALOG_STATUS';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.catalog_products p
        LEFT JOIN public.inventory_branch_balances balance
          ON balance.product_id = p.id
         AND balance.branch_id = p_branch_id
         AND balance.business_id = p_business_id
        WHERE p.business_id = p_business_id
          AND (p.branch_id IS NULL OR p.branch_id = p_branch_id)
          AND balance.product_id IS NULL
    ) THEN
        RAISE EXCEPTION 'R003_CATALOG_BALANCE_MISSING';
    END IF;

    SELECT count(*)::integer INTO v_catalog_count
    FROM public.catalog_products p
    WHERE p.business_id = p_business_id
      AND (p.branch_id IS NULL OR p.branch_id = p_branch_id);
    IF v_catalog_count > 5000 THEN RAISE EXCEPTION 'R003_CATALOG_SNAPSHOT_TOO_LARGE'; END IF;

    SELECT count(*)::integer INTO v_staff_count
    FROM public.staff_members s
    WHERE s.business_id = p_business_id AND s.branch_id = p_branch_id
      AND s.status = 'ACTIVE'
      AND s.role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR');
    IF v_staff_count > 256 THEN RAISE EXCEPTION 'R003_STAFF_DIRECTORY_TOO_LARGE'; END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('staffId', s.id::text, 'name', s.name, 'role', s.role) ORDER BY s.name, s.id), '[]'::jsonb)
    INTO v_staff_directory
    FROM public.staff_members s
    WHERE s.business_id = p_business_id AND s.branch_id = p_branch_id
      AND s.status = 'ACTIVE'
      AND s.role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR');

    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', p.id::text, 'name', p.name, 'category', p.category, 'price', p.price,
        'stockQuantity', balance.quantity, 'unit', p.unit_of_measure,
        'branchId', p.branch_id::text, 'status', p.status
    )) ORDER BY p.name, p.id), '[]'::jsonb)
    INTO v_catalog
    FROM public.catalog_products p
    JOIN public.inventory_branch_balances balance
      ON balance.product_id = p.id AND balance.branch_id = p_branch_id AND balance.business_id = p_business_id
    WHERE p.business_id = p_business_id AND (p.branch_id IS NULL OR p.branch_id = p_branch_id);

    SELECT coalesce(c.vat_enabled, false), coalesce(c.vat_rate, 0)
    INTO v_vat_enabled, v_vat_rate
    FROM public.hub_branch_configuration c
    WHERE c.branch_id = p_branch_id AND c.business_id = p_business_id;
    IF NOT FOUND THEN v_vat_enabled := false; v_vat_rate := 0; END IF;

    WITH pending_session AS (
        SELECT staff_id, hub_device_id FROM public.hub_staff_sessions WHERE session_id = p_pending_session_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'sessionId', s.session_id::text,
        'staffId', s.staff_id::text,
        'deviceId', d.device_id,
        'role', s.role,
        'expiresAt', private.r003_canonical_utc(s.expires_at),
        'revocationVersion', s.revocation_version
    ) ORDER BY s.created_at, s.session_id), '[]'::jsonb)
    INTO v_sessions
    FROM public.hub_staff_sessions s
    JOIN public.devices d ON d.id = s.hub_device_id
    LEFT JOIN pending_session ps ON true
    WHERE s.business_id = p_business_id AND s.branch_id = p_branch_id
      AND d.status = 'ACTIVE' AND d.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.revocation_version = p_revocation_version
      AND (
        (s.status = 'ACTIVE' AND (ps.staff_id IS NULL OR s.staff_id <> ps.staff_id OR s.hub_device_id <> ps.hub_device_id))
        OR (s.status = 'PENDING' AND s.session_id = p_pending_session_id)
      );

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'deviceId', d.device_id,
        'name', d.name,
        'role', d.terminal_role,
        'publicKeyBase64', d.signing_public_key_base64,
        'connectionType', 'LAN_WIFI'
    ) ORDER BY d.name, d.id), '[]'::jsonb)
    INTO v_paired_terminals
    FROM public.devices d
    WHERE d.business_id = p_business_id AND d.branch_id = p_branch_id
      AND d.operational_role = 'TERMINAL' AND d.status = 'ACTIVE' AND d.revoked_at IS NULL
      AND d.terminal_role IS NOT NULL AND d.signing_public_key_base64 IS NOT NULL;

    IF jsonb_array_length(v_paired_terminals) > 63 THEN
        RAISE EXCEPTION 'R010_TERMINAL_SNAPSHOT_TOO_LARGE';
    END IF;

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

CREATE OR REPLACE FUNCTION private.r010_validate_terminal_admission_envelope(
    p_admission_id uuid,
    p_business_id uuid,
    p_branch_id uuid,
    p_hub_device_id text,
    p_hub_tls_certificate_sha256 text,
    p_terminal_device_id text,
    p_terminal_signing_public_key_base64 text,
    p_terminal_role text,
    p_revocation_version bigint,
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
    IF p_hub_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
       OR p_hub_tls_certificate_sha256 !~ '^[0-9a-f]{64}$'
       OR p_terminal_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
       OR p_terminal_signing_public_key_base64 !~ '^[A-Za-z0-9_-]{64,4096}$'
       OR p_terminal_role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')
       OR p_revocation_version < 1
       OR p_issuer_key_id !~ '^[A-Za-z0-9._-]{1,128}$'
       OR p_payload_base64 !~ '^[A-Za-z0-9_-]{2,350000}$'
       OR p_signature_base64 !~ '^[A-Za-z0-9_-]{8,256}$'
       OR p_issued_at < now() - interval '5 minutes'
       OR p_issued_at > now() + interval '5 minutes'
       OR p_expires_at <= p_issued_at
       OR p_expires_at > p_issued_at + interval '12 hours' THEN
        RAISE EXCEPTION 'R010_INVALID_TERMINAL_ADMISSION_ENVELOPE';
    END IF;
    BEGIN
        v_decoded_payload := convert_from(private.r003_base64url_decode(p_payload_base64), 'UTF8')::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R010_INVALID_TERMINAL_ADMISSION_PAYLOAD';
    END;
    IF v_decoded_payload <> p_payload
       OR p_payload->>'schemaVersion' <> '1'
       OR p_payload->>'admissionId' <> p_admission_id::text
       OR p_payload->>'businessId' <> p_business_id::text
       OR p_payload->>'branchId' <> p_branch_id::text
       OR p_payload->>'hubDeviceId' <> p_hub_device_id
       OR p_payload->>'hubTlsCertificateSha256' <> p_hub_tls_certificate_sha256
       OR p_payload->>'terminalDeviceId' <> p_terminal_device_id
       OR p_payload->>'terminalSigningPublicKeyBase64' <> p_terminal_signing_public_key_base64
       OR p_payload->>'terminalRole' <> p_terminal_role
       OR p_payload->>'revocationVersion' <> p_revocation_version::text
       OR p_payload->>'issuedAt' <> private.r003_canonical_utc(p_issued_at)
       OR p_payload->>'expiresAt' <> private.r003_canonical_utc(p_expires_at)
       OR jsonb_typeof(p_payload->'allowedTransports') <> 'array'
       OR NOT (p_payload->'allowedTransports' ? 'LAN_WIFI')
       OR NOT (p_payload->'allowedTransports' ? 'WIFI_DIRECT')
       OR NOT (p_payload->'allowedTransports' ? 'BLE_PROXIMITY') THEN
        RAISE EXCEPTION 'R010_TERMINAL_ADMISSION_SCOPE_MISMATCH';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.r010_issue_terminal_pairing_code(
    p_business_id uuid,
    p_branch_id uuid,
    p_owner_user_id uuid,
    p_terminal_name text,
    p_terminal_role text,
    p_request_digest text,
    p_owner_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_raw_code text;
    v_candidate_available boolean := false;
    v_expires_at timestamptz;
    v_attempt integer;
BEGIN
    IF p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR p_owner_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR p_terminal_name IS NULL OR length(trim(p_terminal_name)) NOT BETWEEN 1 AND 120
       OR p_terminal_role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')
       OR NOT private.r003_consume_rate_limit('owner_terminal_pairing', p_owner_hash, 6, interval '10 minutes') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.businesses business
        JOIN public.branches branch ON branch.id = p_branch_id
        JOIN public.hub_branch_authority authority ON authority.branch_id = branch.id
        JOIN public.devices hub ON hub.id = authority.active_hub_device_id
        WHERE business.id = p_business_id AND business.owner_id = p_owner_user_id
          AND branch.business_id = business.id AND branch.is_active
          AND hub.operational_role = 'CASHIER_HUB' AND hub.status = 'ACTIVE' AND hub.revoked_at IS NULL
    ) THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(847010001::bigint);
    UPDATE public.device_pairing_codes
    SET status = 'REVOKED'
    WHERE branch_id = p_branch_id AND status = 'WAITING' AND pairing_purpose = 'TERMINAL_ENROLLMENT';

    FOR v_attempt IN 1..32 LOOP
        v_raw_code := lpad((((('x' || encode(private.r002_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 900000) + 100000)::text, 6, '0');
        SELECT NOT EXISTS (
            SELECT 1 FROM public.device_pairing_codes code
            WHERE code.status = 'WAITING' AND code.expires_at > now()
              AND code.pairing_code_hash = private.r002_crypt(v_raw_code, code.pairing_code_hash)
        ) INTO v_candidate_available;
        EXIT WHEN v_candidate_available;
    END LOOP;
    IF NOT v_candidate_available THEN RAISE EXCEPTION 'R010_PAIRING_CODE_SPACE_EXHAUSTED'; END IF;

    v_expires_at := now() + interval '10 minutes';
    INSERT INTO public.device_pairing_codes (
        pairing_code_hash, business_id, branch_id, created_by_user_id,
        status, expires_at, pairing_purpose, requested_terminal_name, requested_terminal_role
    ) VALUES (
        private.r002_crypt(v_raw_code, private.r002_gen_salt('bf', 8)),
        p_business_id, p_branch_id, p_owner_user_id,
        'WAITING', v_expires_at, 'TERMINAL_ENROLLMENT', trim(p_terminal_name), p_terminal_role
    );
    INSERT INTO public.audit_logs (event_id, business_id, branch_id, actor_id, event_type, details)
    VALUES (
        'evt-terminal-pairing-code-' || encode(private.r002_random_bytes(16), 'hex'),
        p_business_id, p_branch_id, p_owner_user_id::text, 'TERMINAL_PAIRING_CODE_ISSUED',
        jsonb_build_object('terminal_name', trim(p_terminal_name), 'terminal_role', p_terminal_role, 'expires_at', v_expires_at)
    );
    RETURN jsonb_build_object('ok', true, 'pairingCode', v_raw_code, 'expiresAt', private.r003_canonical_utc(v_expires_at));
END;
$function$;

CREATE OR REPLACE FUNCTION public.r010_begin_terminal_enrollment(
    p_pairing_code text,
    p_request_id uuid,
    p_request_digest text,
    p_source_hash text,
    p_device_hash text,
    p_terminal_device_id text,
    p_terminal_name text,
    p_terminal_role text,
    p_signing_public_key_base64 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.hub_terminal_enrollment_challenges%ROWTYPE;
    v_code public.device_pairing_codes%ROWTYPE;
    v_nonce text;
BEGIN
    IF p_pairing_code !~ '^\d{6}$'
       OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR p_source_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR p_device_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR p_terminal_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
       OR p_terminal_name IS NULL OR length(trim(p_terminal_name)) NOT BETWEEN 1 AND 120
       OR p_terminal_role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')
       OR p_signing_public_key_base64 !~ '^[A-Za-z0-9_-]{64,4096}$'
       OR NOT private.r003_consume_rate_limit('terminal_enrollment_source', p_source_hash, 20, interval '10 minutes')
       OR NOT private.r003_consume_rate_limit('terminal_enrollment_device', p_device_hash, 8, interval '10 minutes') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_existing
    FROM public.hub_terminal_enrollment_challenges
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF v_existing.request_digest <> p_request_digest
           OR v_existing.terminal_device_id <> p_terminal_device_id
           OR v_existing.signing_public_key_base64 <> p_signing_public_key_base64 THEN
            RETURN jsonb_build_object('ok', false);
        END IF;
        IF v_existing.completed_at IS NOT NULL THEN
            RETURN jsonb_build_object('ok', true, 'challengeId', v_existing.challenge_id::text,
                'nonce', v_existing.nonce_base64, 'expiresAt', private.r003_canonical_utc(v_existing.expires_at), 'completed', true);
        END IF;
        IF v_existing.expires_at > now() THEN
            RETURN jsonb_build_object('ok', true, 'challengeId', v_existing.challenge_id::text,
                'nonce', v_existing.nonce_base64, 'expiresAt', private.r003_canonical_utc(v_existing.expires_at), 'completed', false);
        END IF;
        RETURN jsonb_build_object('ok', false);
    END IF;

    DELETE FROM public.hub_terminal_enrollment_challenges
    WHERE completed_at IS NULL
      AND expires_at <= now()
      AND pairing_code_id IN (
          SELECT id
          FROM public.device_pairing_codes
          WHERE status = 'WAITING'
            AND pairing_purpose = 'TERMINAL_ENROLLMENT'
            AND expires_at > now()
      );

    SELECT * INTO v_code
    FROM public.device_pairing_codes code
    WHERE code.status = 'WAITING' AND code.pairing_purpose = 'TERMINAL_ENROLLMENT'
      AND code.expires_at > now()
      AND code.pairing_code_hash = private.r002_crypt(p_pairing_code, code.pairing_code_hash)
    ORDER BY code.created_at DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
    IF v_code.requested_terminal_role <> p_terminal_role THEN RETURN jsonb_build_object('ok', false); END IF;
    IF EXISTS (
        SELECT 1 FROM public.devices d
        WHERE d.device_id = p_terminal_device_id AND d.status = 'ACTIVE' AND d.revoked_at IS NULL
    ) THEN RETURN jsonb_build_object('ok', false); END IF;

    v_nonce := private.r003_base64url_encode(private.r002_random_bytes(32));
    INSERT INTO public.hub_terminal_enrollment_challenges (
        pairing_code_id, request_id, request_digest, source_hash, device_hash,
        business_id, branch_id, terminal_device_id, terminal_name, terminal_role,
        signing_public_key_base64, nonce_base64, expires_at
    ) VALUES (
        v_code.id, p_request_id, p_request_digest, p_source_hash, p_device_hash,
        v_code.business_id, v_code.branch_id, p_terminal_device_id,
        trim(p_terminal_name), p_terminal_role, p_signing_public_key_base64, v_nonce, now() + interval '5 minutes'
    ) RETURNING * INTO v_existing;
    RETURN jsonb_build_object('ok', true, 'challengeId', v_existing.challenge_id::text,
        'nonce', v_existing.nonce_base64, 'expiresAt', private.r003_canonical_utc(v_existing.expires_at), 'completed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.r010_get_terminal_enrollment_context(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_terminal_enrollment_challenges%ROWTYPE;
    v_admission public.hub_terminal_admissions%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_hub public.devices%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_enrollment_challenges WHERE challenge_id = p_challenge_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_admission FROM public.hub_terminal_admissions WHERE admission_id = v_challenge.completed_admission_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'R010_TERMINAL_ADMISSION_MISSING'; END IF;
        RETURN jsonb_build_object('state', 'COMPLETE', 'requestId', v_challenge.request_id::text,
            'nonce', v_challenge.nonce_base64, 'terminalDeviceId', v_challenge.terminal_device_id,
            'terminalSigningPublicKeyBase64', v_challenge.signing_public_key_base64,
            'envelope', jsonb_build_object('schemaVersion', 1, 'issuerKeyId', v_admission.issuer_key_id,
                'payloadBase64', v_admission.payload_base64, 'signature', v_admission.signature_base64));
    END IF;
    IF v_challenge.expires_at <= now() THEN RETURN jsonb_build_object('state', 'EXPIRED'); END IF;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE branch_id = v_challenge.branch_id AND business_id = v_challenge.business_id;
    SELECT * INTO v_hub FROM public.devices WHERE id = v_authority.active_hub_device_id
      AND operational_role = 'CASHIER_HUB' AND status = 'ACTIVE' AND revoked_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    RETURN jsonb_build_object(
        'state', 'PENDING', 'requestId', v_challenge.request_id::text, 'nonce', v_challenge.nonce_base64,
        'businessId', v_challenge.business_id::text, 'branchId', v_challenge.branch_id::text,
        'terminalDeviceId', v_challenge.terminal_device_id,
        'terminalName', v_challenge.terminal_name,
        'terminalRole', v_challenge.terminal_role,
        'terminalSigningPublicKeyBase64', v_challenge.signing_public_key_base64,
        'hubDeviceId', v_hub.device_id,
        'hubTlsCertificateSha256', v_hub.hub_tls_certificate_sha256,
        'revocationVersion', v_authority.revocation_version + 1
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r010_finalize_terminal_enrollment(
    p_challenge_id uuid,
    p_admission_id uuid,
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
    v_challenge public.hub_terminal_enrollment_challenges%ROWTYPE;
    v_code public.device_pairing_codes%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_hub public.devices%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_existing_admission public.hub_terminal_admissions%ROWTYPE;
    v_terminal_device_pk uuid;
    v_revision bigint;
    v_rows_updated integer;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_enrollment_challenges
    WHERE challenge_id = p_challenge_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'R010_TERMINAL_CHALLENGE_INVALID'; END IF;
    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_existing_admission FROM public.hub_terminal_admissions WHERE admission_id = v_challenge.completed_admission_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'R010_TERMINAL_ADMISSION_MISSING'; END IF;
        RETURN jsonb_build_object('schemaVersion', 1, 'issuerKeyId', v_existing_admission.issuer_key_id,
            'payloadBase64', v_existing_admission.payload_base64, 'signature', v_existing_admission.signature_base64);
    END IF;
    IF v_challenge.expires_at <= now() THEN RAISE EXCEPTION 'R010_TERMINAL_CHALLENGE_EXPIRED'; END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_challenge.branch_id::text, 3003003));
    SELECT * INTO v_code FROM public.device_pairing_codes WHERE id = v_challenge.pairing_code_id FOR UPDATE;
    IF NOT FOUND OR v_code.status <> 'WAITING' OR v_code.expires_at <= now()
       OR v_code.pairing_purpose <> 'TERMINAL_ENROLLMENT' THEN
        RAISE EXCEPTION 'R010_TERMINAL_CODE_INVALID';
    END IF;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE branch_id = v_challenge.branch_id AND business_id = v_challenge.business_id FOR UPDATE;
    SELECT * INTO v_hub FROM public.devices WHERE id = v_authority.active_hub_device_id
      AND operational_role = 'CASHIER_HUB' AND status = 'ACTIVE' AND revoked_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'R010_TERMINAL_ACTIVE_HUB_MISSING'; END IF;
    v_revision := v_authority.revocation_version + 1;
    PERFORM private.r010_validate_terminal_admission_envelope(
        p_admission_id, v_challenge.business_id, v_challenge.branch_id,
        v_hub.device_id, v_hub.hub_tls_certificate_sha256,
        v_challenge.terminal_device_id, v_challenge.signing_public_key_base64,
        v_challenge.terminal_role, v_revision, p_issuer_key_id,
        p_payload_base64, p_signature_base64, p_payload, p_issued_at, p_expires_at
    );

    SELECT * INTO v_terminal FROM public.devices WHERE device_id = v_challenge.terminal_device_id FOR UPDATE;
    IF FOUND AND v_terminal.status = 'ACTIVE' AND v_terminal.revoked_at IS NULL THEN
        RAISE EXCEPTION 'R010_TERMINAL_DEVICE_ID_ALREADY_ACTIVE';
    END IF;
    IF FOUND THEN
        UPDATE public.devices SET business_id = v_challenge.business_id, branch_id = v_challenge.branch_id,
            name = v_challenge.terminal_name, type = 'TERMINAL', status = 'ACTIVE', last_seen = now(),
            operational_role = 'TERMINAL', terminal_role = v_challenge.terminal_role,
            local_link_preference = 'LAN_WIFI', signing_public_key_base64 = v_challenge.signing_public_key_base64,
            tls_certificate_base64 = NULL, hub_tls_certificate_sha256 = v_hub.hub_tls_certificate_sha256,
            identity_registered_at = now(), revoked_at = NULL, updated_at = now()
        WHERE id = v_terminal.id RETURNING id INTO v_terminal_device_pk;
    ELSE
        INSERT INTO public.devices (
            device_id, business_id, branch_id, name, type, status, last_seen,
            operational_role, terminal_role, local_link_preference, signing_public_key_base64,
            hub_tls_certificate_sha256, identity_registered_at, revoked_at, updated_at
        ) VALUES (
            v_challenge.terminal_device_id, v_challenge.business_id, v_challenge.branch_id,
            v_challenge.terminal_name, 'TERMINAL', 'ACTIVE', now(),
            'TERMINAL', v_challenge.terminal_role, 'LAN_WIFI', v_challenge.signing_public_key_base64,
            v_hub.hub_tls_certificate_sha256, now(), NULL, now()
        ) RETURNING id INTO v_terminal_device_pk;
    END IF;

    UPDATE public.hub_terminal_admissions SET revoked_at = now()
    WHERE terminal_device_id = v_terminal_device_pk AND revoked_at IS NULL;
    INSERT INTO public.hub_terminal_admissions (
        admission_id, business_id, branch_id, hub_device_id, terminal_device_id,
        issuer_key_id, payload_base64, signature_base64, payload_sha256,
        issued_at, expires_at, revocation_version
    ) VALUES (
        p_admission_id, v_challenge.business_id, v_challenge.branch_id, v_hub.id, v_terminal_device_pk,
        p_issuer_key_id, p_payload_base64, p_signature_base64,
        private.r003_sha256(private.r003_base64url_decode(p_payload_base64)),
        p_issued_at, p_expires_at, v_revision
    );
    UPDATE public.hub_branch_authority
    SET revocation_version = v_revision, changed_at = now()
    WHERE branch_id = v_challenge.branch_id;
    UPDATE public.device_pairing_codes SET status = 'CONSUMED', used_at = now()
    WHERE id = v_code.id AND status = 'WAITING';
    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated <> 1 THEN RAISE EXCEPTION 'R010_TERMINAL_CODE_RACE'; END IF;
    UPDATE public.hub_terminal_enrollment_challenges
    SET completed_at = now(), completed_admission_id = p_admission_id
    WHERE challenge_id = v_challenge.challenge_id;
    INSERT INTO public.audit_logs (event_id, business_id, branch_id, device_id, event_type, details)
    VALUES (
        'evt-terminal-enrolled-' || encode(private.r002_random_bytes(16), 'hex'),
        v_challenge.business_id, v_challenge.branch_id, v_challenge.terminal_device_id,
        'TERMINAL_ENROLLED', jsonb_build_object(
            'terminal_device_id', v_challenge.terminal_device_id,
            'terminal_role', v_challenge.terminal_role, 'admission_id', p_admission_id,
            'revocation_version', v_revision
        )
    );
    RETURN jsonb_build_object('schemaVersion', 1, 'issuerKeyId', p_issuer_key_id,
        'payloadBase64', p_payload_base64, 'signature', p_signature_base64);
END;
$function$;

CREATE OR REPLACE FUNCTION public.r010_get_hub_authority_status(
    p_hub_device_id text,
    p_bundle_id uuid,
    p_device_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hub public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_bundle public.hub_authorization_bundles%ROWTYPE;
BEGIN
    IF p_device_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR NOT private.r003_consume_rate_limit('authority_status_device', p_device_hash, 120, interval '5 minutes') THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;
    SELECT * INTO v_hub FROM public.devices
    WHERE device_id = p_hub_device_id AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE' AND revoked_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE branch_id = v_hub.branch_id AND business_id = v_hub.business_id AND active_hub_device_id = v_hub.id;
    SELECT * INTO v_bundle FROM public.hub_authorization_bundles
    WHERE bundle_id = p_bundle_id AND hub_device_id = v_hub.id AND branch_id = v_hub.branch_id
      AND is_active AND revoked_at IS NULL;
    IF NOT FOUND OR v_authority.branch_id IS NULL THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    RETURN jsonb_build_object(
        'state', CASE WHEN v_bundle.revocation_version = v_authority.revocation_version THEN 'UNCHANGED' ELSE 'CHANGED' END,
        'hubSigningPublicKeyBase64', v_hub.signing_public_key_base64
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r010_list_branch_terminals(
    p_business_id uuid,
    p_branch_id uuid,
    p_owner_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.businesses b JOIN public.branches branch ON branch.id = p_branch_id
        WHERE b.id = p_business_id AND b.owner_id = p_owner_user_id AND branch.business_id = b.id
    ) THEN RETURN jsonb_build_object('ok', false); END IF;
    RETURN jsonb_build_object('ok', true, 'terminals', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'deviceId', d.device_id, 'name', d.name, 'role', d.terminal_role,
            'status', d.status, 'lastSeen', d.last_seen, 'revokedAt', d.revoked_at,
            'localLinkPreference', d.local_link_preference
        ) ORDER BY d.name, d.id)
        FROM public.devices d
        WHERE d.business_id = p_business_id AND d.branch_id = p_branch_id AND d.operational_role = 'TERMINAL'
    ), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.r010_revoke_terminal(
    p_business_id uuid,
    p_branch_id uuid,
    p_owner_user_id uuid,
    p_terminal_device_id text,
    p_request_digest text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_terminal public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
BEGIN
    IF p_request_digest !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('ok', false); END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.businesses b JOIN public.branches branch ON branch.id = p_branch_id
        WHERE b.id = p_business_id AND b.owner_id = p_owner_user_id AND branch.business_id = b.id
    ) THEN RETURN jsonb_build_object('ok', false); END IF;
    SELECT * INTO v_terminal FROM public.devices
    WHERE device_id = p_terminal_device_id AND business_id = p_business_id AND branch_id = p_branch_id
      AND operational_role = 'TERMINAL' FOR UPDATE;
    IF NOT FOUND OR v_terminal.status <> 'ACTIVE' OR v_terminal.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false);
    END IF;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE branch_id = p_branch_id AND business_id = p_business_id FOR UPDATE;
    UPDATE public.devices SET status = 'REVOKED', revoked_at = now(), updated_at = now() WHERE id = v_terminal.id;
    UPDATE public.hub_terminal_admissions SET revoked_at = now() WHERE terminal_device_id = v_terminal.id AND revoked_at IS NULL;
    UPDATE public.hub_branch_authority SET revocation_version = v_authority.revocation_version + 1, changed_at = now()
    WHERE branch_id = p_branch_id;
    INSERT INTO public.audit_logs (event_id, business_id, branch_id, device_id, actor_id, event_type, details)
    VALUES ('evt-terminal-revoked-' || encode(private.r002_random_bytes(16), 'hex'),
        p_business_id, p_branch_id, p_terminal_device_id, p_owner_user_id::text,
        'TERMINAL_REVOKED', jsonb_build_object('terminal_device_id', p_terminal_device_id));
    RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION private.r010_validate_terminal_admission_envelope(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text,jsonb,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r010_issue_terminal_pairing_code(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r010_begin_terminal_enrollment(text,uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r010_get_terminal_enrollment_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r010_finalize_terminal_enrollment(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r010_get_hub_authority_status(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r010_list_branch_terminals(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r010_revoke_terminal(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r010_issue_terminal_pairing_code(uuid,uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r010_begin_terminal_enrollment(text,uuid,text,text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r010_get_terminal_enrollment_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r010_finalize_terminal_enrollment(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.r010_get_hub_authority_status(text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r010_list_branch_terminals(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r010_revoke_terminal(uuid,uuid,uuid,text,text) TO service_role;
