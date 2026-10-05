-- Supabase Migration: 011_terminal_admission_renewal.sql
-- Description: native proof-of-possession renewal for an existing branch
--              terminal admission. No owner browser session, raw code, or
--              bearer token is accepted by this lifecycle path.

DO $r011_preflight$
BEGIN
    IF to_regclass('public.hub_terminal_admissions') IS NULL
       OR to_regclass('public.hub_branch_authority') IS NULL
       OR to_regprocedure('private.r010_validate_terminal_admission_envelope(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text,jsonb,timestamptz,timestamptz)') IS NULL
       OR to_regprocedure('private.r003_consume_rate_limit(text,text,integer,interval)') IS NULL THEN
        RAISE EXCEPTION 'R011_REQUIRES_COMPLETE_R010';
    END IF;
END;
$r011_preflight$;

CREATE TABLE public.hub_terminal_renewal_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL UNIQUE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
    device_hash text NOT NULL CHECK (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
    terminal_device_id text NOT NULL CHECK (terminal_device_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
    signing_public_key_base64 text NOT NULL CHECK (signing_public_key_base64 ~ '^[A-Za-z0-9_-]{64,4096}$'),
    nonce_base64 text NOT NULL CHECK (nonce_base64 ~ '^[A-Za-z0-9_-]{43}$'),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    completed_admission_id uuid REFERENCES public.hub_terminal_admissions(admission_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_hub_terminal_renewal_challenges_pending
    ON public.hub_terminal_renewal_challenges (terminal_device_id, expires_at)
    WHERE completed_at IS NULL;

ALTER TABLE public.hub_terminal_renewal_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_terminal_renewal_challenges FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.r011_begin_terminal_admission_renewal(
    p_terminal_device_id text,
    p_signing_public_key_base64 text,
    p_request_id uuid,
    p_request_digest text,
    p_device_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.hub_terminal_renewal_challenges%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_nonce text;
BEGIN
    IF p_terminal_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
       OR p_signing_public_key_base64 !~ '^[A-Za-z0-9_-]{64,4096}$'
       OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR p_device_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR NOT private.r003_consume_rate_limit('terminal_admission_renewal_device', p_device_hash, 20, interval '5 minutes') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_existing
    FROM public.hub_terminal_renewal_challenges
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF v_existing.request_digest <> p_request_digest
           OR v_existing.terminal_device_id <> p_terminal_device_id
           OR v_existing.signing_public_key_base64 <> p_signing_public_key_base64 THEN
            RETURN jsonb_build_object('ok', false);
        END IF;
        IF v_existing.expires_at <= now() AND v_existing.completed_at IS NULL THEN
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

    SELECT * INTO v_terminal
    FROM public.devices
    WHERE device_id = p_terminal_device_id
      AND operational_role = 'TERMINAL'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
      AND signing_public_key_base64 = p_signing_public_key_base64;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;

    v_nonce := private.r003_base64url_encode(private.r002_random_bytes(32));
    INSERT INTO public.hub_terminal_renewal_challenges (
        request_id, request_digest, device_hash, terminal_device_id,
        signing_public_key_base64, nonce_base64, expires_at
    ) VALUES (
        p_request_id, p_request_digest, p_device_hash, p_terminal_device_id,
        p_signing_public_key_base64, v_nonce, now() + interval '5 minutes'
    ) RETURNING * INTO v_existing;
    RETURN jsonb_build_object(
        'ok', true,
        'challengeId', v_existing.challenge_id::text,
        'nonce', v_existing.nonce_base64,
        'expiresAt', private.r003_canonical_utc(v_existing.expires_at),
        'completed', false
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r011_get_terminal_admission_renewal_context(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_terminal_renewal_challenges%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_hub public.devices%ROWTYPE;
    v_admission public.hub_terminal_admissions%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_renewal_challenges
    WHERE challenge_id = p_challenge_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_admission FROM public.hub_terminal_admissions
        WHERE admission_id = v_challenge.completed_admission_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'R011_TERMINAL_ADMISSION_MISSING'; END IF;
        RETURN jsonb_build_object(
            'state', 'COMPLETE',
            'requestId', v_challenge.request_id::text,
            'nonce', v_challenge.nonce_base64,
            'terminalDeviceId', v_challenge.terminal_device_id,
            'terminalSigningPublicKeyBase64', v_challenge.signing_public_key_base64,
            'envelope', jsonb_build_object(
                'schemaVersion', 1,
                'issuerKeyId', v_admission.issuer_key_id,
                'payloadBase64', v_admission.payload_base64,
                'signature', v_admission.signature_base64
            )
        );
    END IF;
    IF v_challenge.expires_at <= now() THEN RETURN jsonb_build_object('state', 'EXPIRED'); END IF;

    SELECT * INTO v_terminal FROM public.devices
    WHERE device_id = v_challenge.terminal_device_id
      AND operational_role = 'TERMINAL'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
      AND signing_public_key_base64 = v_challenge.signing_public_key_base64;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE branch_id = v_terminal.branch_id
      AND business_id = v_terminal.business_id;
    SELECT * INTO v_hub FROM public.devices
    WHERE id = v_authority.active_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID'); END IF;
    RETURN jsonb_build_object(
        'state', 'PENDING',
        'requestId', v_challenge.request_id::text,
        'nonce', v_challenge.nonce_base64,
        'businessId', v_terminal.business_id::text,
        'branchId', v_terminal.branch_id::text,
        'terminalDeviceId', v_terminal.device_id,
        'terminalName', v_terminal.name,
        'terminalRole', v_terminal.terminal_role,
        'terminalSigningPublicKeyBase64', v_terminal.signing_public_key_base64,
        'hubDeviceId', v_hub.device_id,
        'hubTlsCertificateSha256', v_hub.hub_tls_certificate_sha256,
        'revocationVersion', v_authority.revocation_version
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r011_finalize_terminal_admission_renewal(
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
    v_challenge public.hub_terminal_renewal_challenges%ROWTYPE;
    v_terminal public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_hub public.devices%ROWTYPE;
    v_existing public.hub_terminal_admissions%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge FROM public.hub_terminal_renewal_challenges
    WHERE challenge_id = p_challenge_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'R011_TERMINAL_RENEWAL_CHALLENGE_INVALID'; END IF;
    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.hub_terminal_admissions
        WHERE admission_id = v_challenge.completed_admission_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'R011_TERMINAL_ADMISSION_MISSING'; END IF;
        RETURN jsonb_build_object('schemaVersion', 1, 'issuerKeyId', v_existing.issuer_key_id,
            'payloadBase64', v_existing.payload_base64, 'signature', v_existing.signature_base64);
    END IF;
    IF v_challenge.expires_at <= now() THEN RAISE EXCEPTION 'R011_TERMINAL_RENEWAL_CHALLENGE_EXPIRED'; END IF;

    SELECT * INTO v_terminal FROM public.devices
    WHERE device_id = v_challenge.terminal_device_id
      AND operational_role = 'TERMINAL'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
      AND signing_public_key_base64 = v_challenge.signing_public_key_base64
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'R011_TERMINAL_RENEWAL_DEVICE_INVALID'; END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_terminal.branch_id::text, 3003004));
    SELECT * INTO v_authority FROM public.hub_branch_authority
    WHERE branch_id = v_terminal.branch_id AND business_id = v_terminal.business_id FOR UPDATE;
    SELECT * INTO v_hub FROM public.devices
    WHERE id = v_authority.active_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'R011_TERMINAL_RENEWAL_ACTIVE_HUB_MISSING'; END IF;

    PERFORM private.r010_validate_terminal_admission_envelope(
        p_admission_id, v_terminal.business_id, v_terminal.branch_id,
        v_hub.device_id, v_hub.hub_tls_certificate_sha256,
        v_terminal.device_id, v_terminal.signing_public_key_base64,
        v_terminal.terminal_role, v_authority.revocation_version, p_issuer_key_id,
        p_payload_base64, p_signature_base64, p_payload, p_issued_at, p_expires_at
    );

    UPDATE public.hub_terminal_admissions
    SET revoked_at = now()
    WHERE terminal_device_id = v_terminal.id AND revoked_at IS NULL;
    INSERT INTO public.hub_terminal_admissions (
        admission_id, business_id, branch_id, hub_device_id, terminal_device_id,
        issuer_key_id, payload_base64, signature_base64, payload_sha256,
        issued_at, expires_at, revocation_version
    ) VALUES (
        p_admission_id, v_terminal.business_id, v_terminal.branch_id, v_hub.id, v_terminal.id,
        p_issuer_key_id, p_payload_base64, p_signature_base64,
        private.r003_sha256(private.r003_base64url_decode(p_payload_base64)),
        p_issued_at, p_expires_at, v_authority.revocation_version
    );
    UPDATE public.hub_terminal_renewal_challenges
    SET completed_at = now(), completed_admission_id = p_admission_id
    WHERE challenge_id = v_challenge.challenge_id;
    INSERT INTO public.audit_logs (event_id, business_id, branch_id, device_id, event_type, details)
    VALUES (
        'evt-terminal-admission-renewed-' || encode(private.r002_random_bytes(16), 'hex'),
        v_terminal.business_id, v_terminal.branch_id, v_terminal.device_id,
        'TERMINAL_ADMISSION_RENEWED', jsonb_build_object(
            'terminal_device_id', v_terminal.device_id,
            'admission_id', p_admission_id,
            'revocation_version', v_authority.revocation_version
        )
    );
    RETURN jsonb_build_object('schemaVersion', 1, 'issuerKeyId', p_issuer_key_id,
        'payloadBase64', p_payload_base64, 'signature', p_signature_base64);
END;
$function$;

REVOKE ALL ON FUNCTION public.r011_begin_terminal_admission_renewal(text,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r011_get_terminal_admission_renewal_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r011_finalize_terminal_admission_renewal(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r011_begin_terminal_admission_renewal(text,text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r011_get_terminal_admission_renewal_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r011_finalize_terminal_admission_renewal(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz) TO service_role;
