-- Supabase Migration: 001a_retire_unsupported_legacy_staff_pins.sql
-- Description: Explicit owner-authorized retirement of legacy staff PIN values
--              whose format is not safe for R002 to interpret. This is a
--              one-way credential reset preparation, never a conversion.
--
-- This file intentionally stores no raw PIN or legacy hash. It is an ordered
-- pre-R002 release gate for the accepted R001 production baseline only.

DO $r001a_preflight$
DECLARE
    v_missing_tables text;
    v_partial_r002 text;
BEGIN
    SELECT string_agg(required_table, ', ' ORDER BY required_table)
    INTO v_missing_tables
    FROM (VALUES
        ('public.staff_members'),
        ('public.businesses'),
        ('public.branches'),
        ('public.audit_logs')
    ) AS required(required_table)
    WHERE to_regclass(required_table) IS NULL;

    IF v_missing_tables IS NOT NULL OR to_regnamespace('private') IS NULL THEN
        RAISE EXCEPTION 'R001A_REQUIRES_CANONICAL_R001'
            USING HINT = 'Run only against the accepted R001 baseline with the private schema present.';
    END IF;

    SELECT string_agg(object_name, ', ' ORDER BY object_name)
    INTO v_partial_r002
    FROM (VALUES
        ('public.staff_credentials'),
        ('public.staff_security_sessions'),
        ('public.device_pairing_attempts')
    ) AS existing(object_name)
    WHERE to_regclass(object_name) IS NOT NULL;

    IF v_partial_r002 IS NOT NULL THEN
        RAISE EXCEPTION 'R001A_R002_ALREADY_PRESENT: %', v_partial_r002
            USING HINT = 'Do not retire legacy values after R002 has begun. Restore or complete the reviewed recovery path.';
    END IF;
END;
$r001a_preflight$;

CREATE TABLE IF NOT EXISTS private.r001a_legacy_credential_resets (
    reset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id uuid NOT NULL UNIQUE REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    reset_reason text NOT NULL CHECK (reset_reason = 'UNSUPPORTED_LEGACY_CREDENTIAL'),
    reset_required_at timestamptz NOT NULL DEFAULT now(),
    reset_completed_at timestamptz,
    authorization_reference text NOT NULL CHECK (authorization_reference = 'OWNER_AUTHORIZED_PRODUCTION_RESET'),
    CHECK (reset_completed_at IS NULL OR reset_completed_at >= reset_required_at)
);

ALTER TABLE private.r001a_legacy_credential_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.r001a_legacy_credential_resets FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS r001a_legacy_credential_resets_scope_idx
    ON private.r001a_legacy_credential_resets (business_id, branch_id, reset_required_at DESC);

CREATE INDEX IF NOT EXISTS r001a_legacy_credential_resets_branch_idx
    ON private.r001a_legacy_credential_resets (branch_id, reset_required_at DESC);

WITH candidates AS (
    SELECT id, business_id, branch_id
    FROM public.staff_members
    WHERE pin_hash IS NOT NULL
      AND btrim(pin_hash) <> ''
      AND pin_hash !~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
), recorded AS (
    INSERT INTO private.r001a_legacy_credential_resets (
        staff_id, business_id, branch_id, reset_reason, authorization_reference
    )
    SELECT id, business_id, branch_id, 'UNSUPPORTED_LEGACY_CREDENTIAL', 'OWNER_AUTHORIZED_PRODUCTION_RESET'
    FROM candidates
    ON CONFLICT (staff_id) DO NOTHING
    RETURNING staff_id, business_id, branch_id
)
INSERT INTO public.audit_logs (
    event_id, business_id, branch_id, actor_id, entity_id, event_type, details
)
SELECT
    'evt-r001a-credential-reset-required-' || replace(gen_random_uuid()::text, '-', ''),
    business_id,
    branch_id,
    NULL,
    staff_id::text,
    'LEGACY_STAFF_CREDENTIAL_RESET_REQUIRED',
    jsonb_build_object('migration', 'R001A', 'credential_value_retained', false)
FROM recorded;

UPDATE public.staff_members
SET pin_hash = NULL
WHERE pin_hash IS NOT NULL
  AND btrim(pin_hash) <> ''
  AND pin_hash !~ '^\$2[ab]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$';
