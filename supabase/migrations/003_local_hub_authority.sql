-- Supabase Migration: 003_local_hub_authority.sql
-- Description: Local-first Cashier Hub authority, signed bundles, native-only
--              staff sessions, and immutable cloud event reception.
--
-- Gate: STAGING ONLY after an accepted, byte-for-byte R001 clone and accepted
-- R002 rehearsal. This migration is intentionally not a production command.

-- =========================================================
-- 0. FAIL-CLOSED R002 PREREQUISITE
-- =========================================================

DO $r003_preflight$
BEGIN
    IF to_regclass('public.staff_credentials') IS NULL
       OR to_regclass('public.staff_security_sessions') IS NULL
       OR to_regclass('public.device_pairing_attempts') IS NULL
       OR to_regclass('public.device_pairing_codes') IS NULL THEN
        RAISE EXCEPTION 'R003_REQUIRES_ACCEPTED_R002_TABLES'
            USING HINT = 'Run this only after the complete R002 staging rehearsal has been accepted.';
    END IF;

    IF to_regprocedure('private.r002_crypt(text,text)') IS NULL
       OR to_regprocedure('private.r002_random_bytes(integer)') IS NULL
       OR to_regprocedure('public.verify_staff_pin(uuid,uuid,uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'R003_REQUIRES_ACCEPTED_R002_FUNCTIONS'
            USING HINT = 'Do not recreate R002 helpers ad hoc. Restore the accepted R002 contract first.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'device_pairing_codes'
          AND column_name = 'pairing_code'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'device_pairing_codes'
          AND column_name = 'pairing_code_hash'
    ) THEN
        RAISE EXCEPTION 'R003_REQUIRES_R002_PAIRING_CODE_ISOLATION';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.staff_members
        WHERE pin_hash IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'R003_REQUIRES_R002_CREDENTIAL_ISOLATION'
            USING HINT = 'R001 staff_members.pin_hash must be empty after accepted R002.';
    END IF;
END;
$r003_preflight$;

-- R002 deliberately discovers the pgcrypto schema. Reuse that discipline for
-- SHA-256 wrappers so function bodies never depend on a deployment-specific
-- extensions schema being on search_path.
DO $r003_pgcrypto$
DECLARE
    v_pgcrypto_schema name;
BEGIN
    SELECT n.nspname
    INTO v_pgcrypto_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto';

    IF v_pgcrypto_schema IS NULL THEN
        RAISE EXCEPTION 'R003_PGCRYPTO_NOT_INSTALLED';
    END IF;

    EXECUTE format($wrapper$
        CREATE OR REPLACE FUNCTION private.r003_sha256(p_value bytea)
        RETURNS bytea
        LANGUAGE sql
        IMMUTABLE STRICT PARALLEL SAFE
        SET search_path = pg_catalog
        AS $function$ SELECT %I.digest($1, 'sha256') $function$
    $wrapper$, v_pgcrypto_schema);
END;
$r003_pgcrypto$;

CREATE OR REPLACE FUNCTION private.r003_base64url_encode(p_value bytea)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
    SELECT translate(replace(rtrim(encode($1, 'base64'), '='), E'\n', ''), '+/', '-_')
$function$;

CREATE OR REPLACE FUNCTION private.r003_base64url_decode(p_value text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $function$
BEGIN
    IF p_value !~ '^[A-Za-z0-9_-]+$' OR length(p_value) % 4 = 1 THEN
        RAISE EXCEPTION 'R003_INVALID_BASE64URL';
    END IF;
    RETURN pg_catalog.decode(
        translate(p_value, '-_', '+/') || repeat('=', (4 - length(p_value) % 4) % 4),
        'base64'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION private.r003_canonical_utc(p_value timestamptz)
RETURNS text
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
    SELECT to_char($1 AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

-- =========================================================
-- 1. CLOUD-OWNED HUB FACTS
-- =========================================================

ALTER TABLE public.devices
    ADD COLUMN IF NOT EXISTS operational_role text NOT NULL DEFAULT 'TERMINAL',
    ADD COLUMN IF NOT EXISTS signing_public_key_base64 text,
    ADD COLUMN IF NOT EXISTS tls_certificate_base64 text,
    ADD COLUMN IF NOT EXISTS hub_tls_certificate_sha256 text,
    ADD COLUMN IF NOT EXISTS identity_registered_at timestamptz,
    ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE public.devices
    ADD CONSTRAINT devices_operational_role_check
    CHECK (operational_role IN ('TERMINAL', 'CASHIER_HUB'));

ALTER TABLE public.devices
    ADD CONSTRAINT devices_signing_public_key_base64_check
    CHECK (
        signing_public_key_base64 IS NULL
        OR signing_public_key_base64 ~ '^[A-Za-z0-9_-]{64,4096}$'
    );

ALTER TABLE public.devices
    ADD CONSTRAINT devices_tls_certificate_base64_check
    CHECK (
        tls_certificate_base64 IS NULL
        OR tls_certificate_base64 ~ '^[A-Za-z0-9_-]{128,32768}$'
    );

ALTER TABLE public.devices
    ADD CONSTRAINT devices_hub_tls_certificate_sha256_check
    CHECK (
        hub_tls_certificate_sha256 IS NULL
        OR hub_tls_certificate_sha256 ~ '^[0-9a-f]{64}$'
    );

CREATE UNIQUE INDEX idx_devices_active_hub_key
    ON public.devices (signing_public_key_base64)
    WHERE signing_public_key_base64 IS NOT NULL
      AND status = 'ACTIVE';

CREATE TABLE public.hub_branch_configuration (
    branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    vat_enabled boolean NOT NULL DEFAULT false,
    vat_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_branch_authority (
    branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    active_hub_device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT,
    revocation_version bigint NOT NULL DEFAULT 0 CHECK (revocation_version >= 0),
    changed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_authorization_bundles (
    bundle_id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    issuer_key_id text NOT NULL CHECK (issuer_key_id ~ '^[A-Za-z0-9._-]{1,128}$'),
    payload_base64 text NOT NULL CHECK (payload_base64 ~ '^[A-Za-z0-9_-]{2,350000}$'),
    signature_base64 text NOT NULL CHECK (signature_base64 ~ '^[A-Za-z0-9_-]{8,256}$'),
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revocation_version bigint NOT NULL CHECK (revocation_version >= 0),
    is_active boolean NOT NULL DEFAULT true,
    superseded_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX idx_hub_authorization_bundles_one_active_branch
    ON public.hub_authorization_bundles (branch_id)
    WHERE is_active AND revoked_at IS NULL;

CREATE INDEX idx_hub_authorization_bundles_active_hub
    ON public.hub_authorization_bundles (hub_device_id, expires_at DESC)
    WHERE is_active AND revoked_at IS NULL;

CREATE INDEX idx_hub_authorization_bundles_delivery_bridge
    ON public.hub_authorization_bundles (hub_device_id, branch_id, superseded_at DESC)
    WHERE superseded_at IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE public.hub_bundle_renewal_requests (
    request_id uuid PRIMARY KEY,
    request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    previous_bundle_id uuid NOT NULL REFERENCES public.hub_authorization_bundles(bundle_id) ON DELETE RESTRICT,
    completed_bundle_id uuid REFERENCES public.hub_authorization_bundles(bundle_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE INDEX idx_hub_bundle_renewal_requests_pending
    ON public.hub_bundle_renewal_requests (hub_device_id, created_at)
    WHERE completed_at IS NULL;

CREATE TABLE public.hub_enrollment_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL UNIQUE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
    source_hash text NOT NULL CHECK (source_hash ~ '^[A-Za-z0-9_-]{43}$'),
    device_hash text NOT NULL CHECK (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
    pairing_code_id uuid NOT NULL REFERENCES public.device_pairing_codes(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    hub_device_id text NOT NULL CHECK (hub_device_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
    hub_name text NOT NULL CHECK (length(hub_name) BETWEEN 1 AND 120),
    signing_public_key_base64 text NOT NULL CHECK (signing_public_key_base64 ~ '^[A-Za-z0-9_-]{64,4096}$'),
    tls_certificate_base64 text NOT NULL CHECK (tls_certificate_base64 ~ '^[A-Za-z0-9_-]{128,32768}$'),
    tls_certificate_sha256 text NOT NULL CHECK (tls_certificate_sha256 ~ '^[0-9a-f]{64}$'),
    nonce_base64 text NOT NULL CHECK (nonce_base64 ~ '^[A-Za-z0-9_-]{43}$'),
    nonce_sha256 bytea NOT NULL CHECK (octet_length(nonce_sha256) = 32),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    completed_bundle_id uuid REFERENCES public.hub_authorization_bundles(bundle_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_hub_enrollment_challenges_pending
    ON public.hub_enrollment_challenges (branch_id, expires_at)
    WHERE completed_at IS NULL;

CREATE TABLE public.hub_staff_session_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
    pin_verified_at timestamptz,
    prepared_session_id uuid,
    completed_at timestamptz,
    completed_bundle_id uuid REFERENCES public.hub_authorization_bundles(bundle_id) ON DELETE RESTRICT,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_hub_staff_session_challenges_pending
    ON public.hub_staff_session_challenges (hub_device_id, staff_id, expires_at)
    WHERE completed_at IS NULL;

CREATE TABLE public.hub_staff_sessions (
    session_id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR')),
    revocation_version bigint NOT NULL CHECK (revocation_version >= 0),
    status text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX idx_hub_staff_sessions_one_active_staff_hub
    ON public.hub_staff_sessions (hub_device_id, staff_id)
    WHERE status = 'ACTIVE';

CREATE INDEX idx_hub_staff_sessions_bundle_facts
    ON public.hub_staff_sessions (business_id, branch_id, hub_device_id, expires_at)
    WHERE status = 'ACTIVE';

ALTER TABLE public.hub_staff_session_challenges
    ADD CONSTRAINT hub_staff_session_challenges_prepared_session_fkey
    FOREIGN KEY (prepared_session_id)
    REFERENCES public.hub_staff_sessions(session_id)
    ON DELETE RESTRICT;

CREATE TABLE public.hub_events (
    event_id uuid PRIMARY KEY,
    command_id uuid NOT NULL,
    aggregate_id text NOT NULL CHECK (length(aggregate_id) BETWEEN 1 AND 200),
    aggregate_type text NOT NULL CHECK (aggregate_type IN ('order')),
    action text NOT NULL CHECK (action IN ('ORDER_PLACED', 'ORDER_STATUS_CHANGED')),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    staff_session_id uuid NOT NULL REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    sequence bigint NOT NULL CHECK (sequence >= 0),
    event_ordinal integer NOT NULL CHECK (event_ordinal >= 0 AND event_ordinal < 100),
    occurred_at timestamptz NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version = 1),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (staff_session_id, sequence, event_ordinal)
);

CREATE INDEX idx_hub_events_branch_occurred
    ON public.hub_events (business_id, branch_id, occurred_at DESC);

-- R001 stores a compatibility quantity on a catalog product, but a product
-- may be business-wide. Operational stock must never become a shared
-- cross-branch value, so R003 introduces an explicit branch balance.
CREATE TABLE public.inventory_branch_balances (
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0 AND quantity = round(quantity, 3)),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (branch_id, product_id)
);

CREATE INDEX idx_inventory_branch_balances_business_branch
    ON public.inventory_branch_balances (business_id, branch_id, product_id);

-- The cloud-side companion to the Hub's local stock projection. Event ID is
-- the idempotency boundary: one replicated event can create at most one stock
-- movement for a product, even when the Hub retries the same signed batch.
CREATE TABLE public.inventory_movements (
    movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.hub_events(event_id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
    FOREIGN KEY (branch_id, product_id)
        REFERENCES public.inventory_branch_balances(branch_id, product_id)
        ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    staff_session_id uuid NOT NULL REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    movement_type text NOT NULL CHECK (movement_type IN ('ORDER_RESERVATION', 'ORDER_CANCELLATION_RELEASE')),
    quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),
    balance_before numeric(14,3) NOT NULL CHECK (balance_before >= 0),
    balance_after numeric(14,3) NOT NULL CHECK (balance_after >= 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (balance_after = balance_before + quantity_delta),
    CHECK (
        (movement_type = 'ORDER_RESERVATION' AND quantity_delta < 0)
        OR (movement_type = 'ORDER_CANCELLATION_RELEASE' AND quantity_delta > 0)
    ),
    UNIQUE (event_id, product_id)
);

CREATE INDEX idx_inventory_movements_branch_product_occurred
    ON public.inventory_movements (business_id, branch_id, product_id, occurred_at DESC);

CREATE INDEX idx_inventory_movements_order
    ON public.inventory_movements (order_id, occurred_at ASC);

CREATE TABLE public.hub_rate_limit_windows (
    scope text NOT NULL CHECK (scope IN ('owner_pairing', 'enrollment_source', 'enrollment_device', 'staff_source', 'staff_device', 'sync_device')),
    subject_hash text NOT NULL CHECK (subject_hash ~ '^[A-Za-z0-9_-]{43}$'),
    failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    window_started_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, subject_hash)
);

ALTER TABLE public.hub_branch_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_branch_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_authorization_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_bundle_renewal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_enrollment_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_staff_session_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_branch_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_rate_limit_windows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hub_branch_configuration FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_branch_authority FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_authorization_bundles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_bundle_renewal_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_enrollment_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_staff_session_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_staff_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_branch_balances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_rate_limit_windows FROM PUBLIC, anon, authenticated;

-- One authority row must always describe the branch's own active Hub.
CREATE OR REPLACE FUNCTION private.r003_validate_hub_branch_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_branch_business_id uuid;
    v_device public.devices%ROWTYPE;
BEGIN
    SELECT business_id INTO v_branch_business_id
    FROM public.branches
    WHERE id = NEW.branch_id;

    IF NOT FOUND OR v_branch_business_id <> NEW.business_id THEN
        RAISE EXCEPTION 'R003_HUB_AUTHORITY_BRANCH_SCOPE_MISMATCH';
    END IF;

    IF NEW.active_hub_device_id IS NOT NULL THEN
        SELECT * INTO v_device
        FROM public.devices
        WHERE id = NEW.active_hub_device_id;

        IF NOT FOUND
           OR v_device.business_id <> NEW.business_id
           OR v_device.branch_id <> NEW.branch_id
           OR v_device.operational_role <> 'CASHIER_HUB'
           OR v_device.status <> 'ACTIVE'
           OR v_device.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'R003_HUB_AUTHORITY_DEVICE_SCOPE_MISMATCH';
        END IF;
    END IF;

    NEW.changed_at := now();
    RETURN NEW;
END;
$function$;

CREATE TRIGGER validate_hub_branch_authority
    BEFORE INSERT OR UPDATE ON public.hub_branch_authority
    FOR EACH ROW
    EXECUTE FUNCTION private.r003_validate_hub_branch_authority();

-- Every operational balance must name one branch, one product visible to that
-- branch, and the same business. R001 has no composite product/branch key, so
-- this trigger is the explicit tenant/branch integrity boundary.
CREATE OR REPLACE FUNCTION private.r003_validate_inventory_branch_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_branch_business_id uuid;
    v_product public.catalog_products%ROWTYPE;
BEGIN
    SELECT business_id INTO v_branch_business_id
    FROM public.branches
    WHERE id = NEW.branch_id;
    IF NOT FOUND OR v_branch_business_id <> NEW.business_id THEN
        RAISE EXCEPTION 'R003_INVENTORY_BALANCE_BRANCH_SCOPE_MISMATCH';
    END IF;

    SELECT * INTO v_product
    FROM public.catalog_products
    WHERE id = NEW.product_id;
    IF NOT FOUND
       OR v_product.business_id <> NEW.business_id
       OR (v_product.branch_id IS NOT NULL AND v_product.branch_id <> NEW.branch_id) THEN
        RAISE EXCEPTION 'R003_INVENTORY_BALANCE_PRODUCT_SCOPE_MISMATCH';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

CREATE TRIGGER validate_inventory_branch_balance
    BEFORE INSERT OR UPDATE ON public.inventory_branch_balances
    FOR EACH ROW
    EXECUTE FUNCTION private.r003_validate_inventory_branch_balance();

-- Preserve a branch-specific R001 quantity exactly once. A business-wide R001
-- product has no unambiguous per-branch allocation, so every branch starts at
-- zero rather than duplicating stock. A later approved inventory-allocation
-- command is required before that item can be sold from a branch.
INSERT INTO public.inventory_branch_balances (branch_id, product_id, business_id, quantity)
SELECT
    branch.id,
    product.id,
    product.business_id,
    CASE WHEN product.branch_id = branch.id THEN product.stock_quantity ELSE 0 END
FROM public.catalog_products product
JOIN public.branches branch
  ON branch.business_id = product.business_id
 AND (product.branch_id = branch.id OR product.branch_id IS NULL)
ON CONFLICT (branch_id, product_id) DO NOTHING;

-- A durable source/device throttle. It intentionally receives only HMACed
-- values computed in the Edge Function, never an IP address or raw device ID.
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
    IF p_scope NOT IN ('owner_pairing', 'enrollment_source', 'enrollment_device', 'staff_source', 'staff_device', 'sync_device')
       OR p_subject_hash !~ '^[A-Za-z0-9_-]{43}$'
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

REVOKE ALL ON FUNCTION private.r003_sha256(bytea) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_base64url_encode(bytea) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_base64url_decode(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_canonical_utc(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_validate_hub_branch_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_validate_inventory_branch_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_consume_rate_limit(text, text, integer, interval) FROM PUBLIC, anon, authenticated;

-- Build a strictly branch-scoped bundle snapshot. This helper produces data
-- only; the Edge issuer assigns timestamps/IDs and signs the raw UTF-8 JSON.
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
        SELECT 1
        FROM public.catalog_products p
        WHERE p.business_id = p_business_id
          AND (p.branch_id IS NULL OR p.branch_id = p_branch_id)
          AND p.status NOT IN ('ACTIVE', 'ARCHIVED')
    ) THEN
        RAISE EXCEPTION 'R003_UNSUPPORTED_CATALOG_STATUS'
            USING HINT = 'Normalize catalog statuses to ACTIVE or ARCHIVED before issuing Hub authority.';
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
        RAISE EXCEPTION 'R003_CATALOG_BALANCE_MISSING'
            USING HINT = 'Every Hub catalog product requires a branch inventory balance.';
    END IF;

    SELECT count(*)::integer INTO v_catalog_count
    FROM public.catalog_products p
    WHERE p.business_id = p_business_id
      AND (p.branch_id IS NULL OR p.branch_id = p_branch_id);

    IF v_catalog_count > 5000 THEN
        RAISE EXCEPTION 'R003_CATALOG_SNAPSHOT_TOO_LARGE';
    END IF;

    SELECT count(*)::integer INTO v_staff_count
    FROM public.staff_members s
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.status = 'ACTIVE'
      AND s.role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR');
    IF v_staff_count > 256 THEN
        RAISE EXCEPTION 'R003_STAFF_DIRECTORY_TOO_LARGE';
    END IF;

    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'staffId', s.id::text,
                'name', s.name,
                'role', s.role
            ) ORDER BY s.name, s.id
        ),
        '[]'::jsonb
    ) INTO v_staff_directory
    FROM public.staff_members s
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.status = 'ACTIVE'
      AND s.role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR');

    SELECT coalesce(
        jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
                'id', p.id::text,
                'name', p.name,
                'category', p.category,
                'price', p.price,
                'stockQuantity', balance.quantity,
                'unit', p.unit_of_measure,
                'branchId', p.branch_id::text,
                'status', p.status
            )) ORDER BY p.name, p.id
        ),
        '[]'::jsonb
    ) INTO v_catalog
    FROM public.catalog_products p
    JOIN public.inventory_branch_balances balance
      ON balance.product_id = p.id
     AND balance.branch_id = p_branch_id
     AND balance.business_id = p_business_id
    WHERE p.business_id = p_business_id
      AND (p.branch_id IS NULL OR p.branch_id = p_branch_id);

    SELECT coalesce(c.vat_enabled, false), coalesce(c.vat_rate, 0)
    INTO v_vat_enabled, v_vat_rate
    FROM public.hub_branch_configuration c
    WHERE c.branch_id = p_branch_id
      AND c.business_id = p_business_id;

    IF NOT FOUND THEN
        v_vat_enabled := false;
        v_vat_rate := 0;
    END IF;

    WITH pending_session AS (
        SELECT staff_id, hub_device_id
        FROM public.hub_staff_sessions
        WHERE session_id = p_pending_session_id
    )
    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'sessionId', s.session_id::text,
                'staffId', s.staff_id::text,
                'deviceId', p_hub_device_id,
                'role', s.role,
                'expiresAt', private.r003_canonical_utc(s.expires_at),
                'revocationVersion', s.revocation_version
            ) ORDER BY s.created_at, s.session_id
        ),
        '[]'::jsonb
    ) INTO v_sessions
    FROM public.hub_staff_sessions s
    LEFT JOIN pending_session ps ON true
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.hub_device_id = (SELECT d.id FROM public.devices d WHERE d.device_id = p_hub_device_id)
      AND s.expires_at > now()
      AND (
          s.status = 'ACTIVE'
          AND (ps.staff_id IS NULL OR s.staff_id <> ps.staff_id OR s.hub_device_id <> ps.hub_device_id)
          OR s.status = 'PENDING' AND s.session_id = p_pending_session_id
      );

    RETURN jsonb_build_object(
        'businessId', p_business_id::text,
        'branchId', p_branch_id::text,
        'hubDeviceId', p_hub_device_id,
        'hubSigningPublicKeyBase64', p_hub_signing_public_key_base64,
        'hubTlsCertificateSha256', p_hub_tls_certificate_sha256,
        'revocationVersion', p_revocation_version,
        'pairedDevices', jsonb_build_array(jsonb_build_object(
            'deviceId', p_hub_device_id,
            'name', trim(p_hub_name),
            'role', 'ADMINISTRATOR',
            'publicKeyBase64', p_hub_signing_public_key_base64,
            'connectionType', 'LAN_WIFI'
        )),
        'staffDirectory', v_staff_directory,
        'staffSessions', v_sessions,
        'configuration', jsonb_build_object(
            'vat', jsonb_build_object('enabled', v_vat_enabled, 'rate', v_vat_rate),
            'catalogProducts', v_catalog
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION private.r003_validate_bundle_envelope(
    p_bundle_id uuid,
    p_business_id uuid,
    p_branch_id uuid,
    p_hub_device_id text,
    p_hub_signing_public_key_base64 text,
    p_hub_tls_certificate_sha256 text,
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
    IF p_issuer_key_id !~ '^[A-Za-z0-9._-]{1,128}$'
       OR p_payload_base64 !~ '^[A-Za-z0-9_-]{2,350000}$'
       OR p_signature_base64 !~ '^[A-Za-z0-9_-]{8,256}$'
       OR p_issued_at < now() - interval '5 minutes'
       OR p_issued_at > now() + interval '5 minutes'
       OR p_expires_at <= p_issued_at
       OR p_expires_at > p_issued_at + interval '12 hours' THEN
        RAISE EXCEPTION 'R003_INVALID_BUNDLE_ENVELOPE';
    END IF;

    BEGIN
        v_decoded_payload := convert_from(private.r003_base64url_decode(p_payload_base64), 'UTF8')::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R003_INVALID_BUNDLE_PAYLOAD';
    END;

    IF v_decoded_payload <> p_payload
       OR p_payload->>'schemaVersion' <> '1'
       OR p_payload->>'bundleId' <> p_bundle_id::text
       OR p_payload->>'businessId' <> p_business_id::text
       OR p_payload->>'branchId' <> p_branch_id::text
       OR p_payload->>'hubDeviceId' <> p_hub_device_id
       OR p_payload->>'hubSigningPublicKeyBase64' <> p_hub_signing_public_key_base64
       OR p_payload->>'hubTlsCertificateSha256' <> p_hub_tls_certificate_sha256
       OR p_payload->>'revocationVersion' <> p_revocation_version::text
       OR p_payload->>'issuedAt' <> private.r003_canonical_utc(p_issued_at)
       OR p_payload->>'expiresAt' <> private.r003_canonical_utc(p_expires_at)
       OR jsonb_typeof(p_payload->'pairedDevices') <> 'array'
       OR jsonb_typeof(p_payload->'staffDirectory') <> 'array'
       OR jsonb_typeof(p_payload->'staffSessions') <> 'array'
       OR jsonb_typeof(p_payload->'configuration') <> 'object'
       OR NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_payload->'pairedDevices') AS device(value)
           WHERE device.value->>'deviceId' = p_hub_device_id
             AND device.value->>'publicKeyBase64' = p_hub_signing_public_key_base64
             AND device.value->>'connectionType' = 'LAN_WIFI'
       ) THEN
        RAISE EXCEPTION 'R003_BUNDLE_PAYLOAD_SCOPE_MISMATCH';
    END IF;
END;
$function$;

-- =========================================================
-- 2. HUB ENROLLMENT AND BUNDLE RENEWAL (SERVICE ONLY)
-- =========================================================

-- A browser owner may request a short-lived Cashier-Hub enrollment code only
-- through the authenticated owner Edge endpoint. This function never grants
-- browser roles table access and never stores the raw code.
CREATE OR REPLACE FUNCTION public.r003_issue_hub_pairing_code(
    p_business_id uuid,
    p_branch_id uuid,
    p_owner_user_id uuid,
    p_request_digest text,
    p_owner_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_raw_code text;
    v_code_hash text;
    v_expires_at timestamptz;
    v_candidate_available boolean := false;
    v_generation_attempt integer;
BEGIN
    IF p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR p_owner_hash !~ '^[A-Za-z0-9_-]{43}$'
       OR NOT private.r003_consume_rate_limit('owner_pairing', p_owner_hash, 6, interval '10 minutes') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.businesses business
        JOIN public.branches branch ON branch.id = p_branch_id
        WHERE business.id = p_business_id
          AND business.owner_id = p_owner_user_id
          AND branch.business_id = business.id
          AND branch.is_active
    ) THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    -- The code is entered before a Hub identity exists. Serialize generation
    -- across branches to prevent a rare active-code collision from yielding a
    -- code that could resolve to two tenants.
    PERFORM pg_catalog.pg_advisory_xact_lock(847003001::bigint);
    UPDATE public.device_pairing_codes
    SET status = 'REVOKED'
    WHERE branch_id = p_branch_id
      AND status = 'WAITING';

    FOR v_generation_attempt IN 1..32 LOOP
        v_raw_code := lpad((((('x' || encode(private.r002_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 900000) + 100000)::text, 6, '0');
        SELECT NOT EXISTS (
            SELECT 1
            FROM public.device_pairing_codes code
            WHERE code.status = 'WAITING'
              AND code.expires_at > now()
              AND code.pairing_code_hash = private.r002_crypt(v_raw_code, code.pairing_code_hash)
        ) INTO v_candidate_available;
        EXIT WHEN v_candidate_available;
    END LOOP;

    IF NOT v_candidate_available THEN
        RAISE EXCEPTION 'R003_HUB_PAIRING_CODE_SPACE_EXHAUSTED';
    END IF;

    v_code_hash := private.r002_crypt(v_raw_code, private.r002_gen_salt('bf', 8));
    v_expires_at := now() + interval '10 minutes';
    INSERT INTO public.device_pairing_codes (
        pairing_code_hash, business_id, branch_id, created_by_user_id,
        created_by_staff_id, status, expires_at
    ) VALUES (
        v_code_hash, p_business_id, p_branch_id, p_owner_user_id,
        NULL, 'WAITING', v_expires_at
    );

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, actor_id, event_type, details
    ) VALUES (
        'evt-hub-enroll-code-' || encode(private.r002_random_bytes(16), 'hex'),
        p_business_id, p_branch_id, p_owner_user_id::text,
        'HUB_ENROLLMENT_CODE_ISSUED',
        jsonb_build_object('branch_id', p_branch_id, 'expires_at', v_expires_at)
    );

    RETURN jsonb_build_object(
        'ok', true,
        'pairingCode', v_raw_code,
        'expiresAt', private.r003_canonical_utc(v_expires_at)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_begin_hub_enrollment(
    p_pairing_code text,
    p_request_id uuid,
    p_request_digest text,
    p_source_hash text,
    p_device_hash text,
    p_hub_device_id text,
    p_hub_name text,
    p_signing_public_key_base64 text,
    p_tls_certificate_base64 text,
    p_tls_certificate_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.hub_enrollment_challenges%ROWTYPE;
    v_code public.device_pairing_codes%ROWTYPE;
    v_nonce bytea;
    v_nonce_base64 text;
    v_hub_name text;
BEGIN
    IF NOT private.r003_consume_rate_limit('enrollment_source', p_source_hash, 20, interval '10 minutes')
       OR NOT private.r003_consume_rate_limit('enrollment_device', p_device_hash, 10, interval '10 minutes') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    IF p_pairing_code !~ '^\d{6}$'
       OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
       OR p_hub_device_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
       OR p_signing_public_key_base64 !~ '^[A-Za-z0-9_-]{64,4096}$'
       OR p_tls_certificate_base64 !~ '^[A-Za-z0-9_-]{128,32768}$'
       OR p_tls_certificate_sha256 !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    v_hub_name := coalesce(nullif(trim(p_hub_name), ''), 'Cashier Hub');
    IF length(v_hub_name) > 120 THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_existing
    FROM public.hub_enrollment_challenges
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.request_digest <> p_request_digest
           OR v_existing.hub_device_id <> p_hub_device_id
           OR v_existing.signing_public_key_base64 <> p_signing_public_key_base64
           OR v_existing.tls_certificate_sha256 <> p_tls_certificate_sha256 THEN
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

    SELECT * INTO v_code
    FROM public.device_pairing_codes code
    WHERE code.status = 'WAITING'
      AND code.expires_at > now()
      AND code.pairing_code_hash = private.r002_crypt(p_pairing_code, code.pairing_code_hash)
    ORDER BY code.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR EXISTS (
        SELECT 1 FROM public.devices device
        WHERE device.device_id = p_hub_device_id
          AND device.status = 'ACTIVE'
    ) THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    v_nonce := private.r002_random_bytes(32);
    v_nonce_base64 := private.r003_base64url_encode(v_nonce);

    INSERT INTO public.hub_enrollment_challenges (
        request_id, request_digest, source_hash, device_hash,
        pairing_code_id, business_id, branch_id,
        hub_device_id, hub_name, signing_public_key_base64,
        tls_certificate_base64, tls_certificate_sha256,
        nonce_base64, nonce_sha256, expires_at
    ) VALUES (
        p_request_id, p_request_digest, p_source_hash, p_device_hash,
        v_code.id, v_code.business_id, v_code.branch_id,
        p_hub_device_id, v_hub_name, p_signing_public_key_base64,
        p_tls_certificate_base64, p_tls_certificate_sha256,
        v_nonce_base64, private.r003_sha256(v_nonce), now() + interval '5 minutes'
    ) RETURNING * INTO v_existing;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, event_type, details
    ) VALUES (
        'evt-hub-challenge-' || encode(private.r002_random_bytes(16), 'hex'),
        v_existing.business_id,
        v_existing.branch_id,
        v_existing.hub_device_id,
        'HUB_ENROLLMENT_CHALLENGE_ISSUED',
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

CREATE OR REPLACE FUNCTION public.r003_get_hub_enrollment_context(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_enrollment_challenges%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_bundle public.hub_authorization_bundles%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_enrollment_challenges
    WHERE challenge_id = p_challenge_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_bundle
        FROM public.hub_authorization_bundles
        WHERE bundle_id = v_challenge.completed_bundle_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_ENROLLMENT_COMPLETION_MISSING_BUNDLE';
        END IF;
        RETURN jsonb_build_object(
            'state', 'COMPLETE',
            'requestId', v_challenge.request_id::text,
            'nonce', v_challenge.nonce_base64,
            'hubDeviceId', v_challenge.hub_device_id,
            'hubSigningPublicKeyBase64', v_challenge.signing_public_key_base64,
            'hubTlsCertificateSha256', v_challenge.tls_certificate_sha256,
            'envelope', jsonb_build_object(
                'schemaVersion', 1,
                'issuerKeyId', v_bundle.issuer_key_id,
                'payloadBase64', v_bundle.payload_base64,
                'signature', v_bundle.signature_base64
            )
        );
    END IF;

    IF v_challenge.expires_at <= now() THEN
        RETURN jsonb_build_object('state', 'EXPIRED');
    END IF;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_challenge.branch_id;

    RETURN jsonb_build_object(
        'state', 'PENDING',
        'requestId', v_challenge.request_id::text,
        'nonce', v_challenge.nonce_base64,
        'businessId', v_challenge.business_id::text,
        'branchId', v_challenge.branch_id::text,
        'hubDeviceId', v_challenge.hub_device_id,
        'hubName', v_challenge.hub_name,
        'hubSigningPublicKeyBase64', v_challenge.signing_public_key_base64,
        'hubTlsCertificateSha256', v_challenge.tls_certificate_sha256,
        'revocationVersion', coalesce(v_authority.revocation_version, 0) + 1,
        'bundleContext', private.r003_hub_bundle_context(
            v_challenge.business_id,
            v_challenge.branch_id,
            v_challenge.hub_device_id,
            v_challenge.hub_name,
            v_challenge.signing_public_key_base64,
            v_challenge.tls_certificate_sha256,
            coalesce(v_authority.revocation_version, 0) + 1,
            NULL
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_finalize_hub_enrollment(
    p_challenge_id uuid,
    p_bundle_id uuid,
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
    v_challenge public.hub_enrollment_challenges%ROWTYPE;
    v_code public.device_pairing_codes%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_existing_bundle public.hub_authorization_bundles%ROWTYPE;
    v_hub_device_pk uuid;
    v_revocation_version bigint;
    v_rows_updated integer;
    v_context jsonb;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_enrollment_challenges
    WHERE challenge_id = p_challenge_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'R003_ENROLLMENT_CHALLENGE_INVALID';
    END IF;

    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_existing_bundle
        FROM public.hub_authorization_bundles
        WHERE bundle_id = v_challenge.completed_bundle_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_ENROLLMENT_COMPLETION_MISSING_BUNDLE';
        END IF;
        RETURN jsonb_build_object(
            'schemaVersion', 1,
            'issuerKeyId', v_existing_bundle.issuer_key_id,
            'payloadBase64', v_existing_bundle.payload_base64,
            'signature', v_existing_bundle.signature_base64
        );
    END IF;

    IF v_challenge.expires_at <= now() THEN
        RAISE EXCEPTION 'R003_ENROLLMENT_CHALLENGE_EXPIRED';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_challenge.branch_id::text, 3003003)
    );

    SELECT * INTO v_code
    FROM public.device_pairing_codes
    WHERE id = v_challenge.pairing_code_id
    FOR UPDATE;

    IF NOT FOUND OR v_code.status <> 'WAITING' OR v_code.expires_at <= now() THEN
        RAISE EXCEPTION 'R003_ENROLLMENT_CODE_INVALID';
    END IF;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_challenge.branch_id
    FOR UPDATE;

    v_revocation_version := coalesce(v_authority.revocation_version, 0) + 1;
    PERFORM private.r003_validate_bundle_envelope(
        p_bundle_id,
        v_challenge.business_id,
        v_challenge.branch_id,
        v_challenge.hub_device_id,
        v_challenge.signing_public_key_base64,
        v_challenge.tls_certificate_sha256,
        v_revocation_version,
        p_issuer_key_id,
        p_payload_base64,
        p_signature_base64,
        p_payload,
        p_issued_at,
        p_expires_at
    );

    v_context := private.r003_hub_bundle_context(
        v_challenge.business_id,
        v_challenge.branch_id,
        v_challenge.hub_device_id,
        v_challenge.hub_name,
        v_challenge.signing_public_key_base64,
        v_challenge.tls_certificate_sha256,
        v_revocation_version,
        NULL
    );
    IF p_payload->'pairedDevices' <> v_context->'pairedDevices'
       OR p_payload->'staffDirectory' <> v_context->'staffDirectory'
       OR p_payload->'staffSessions' <> v_context->'staffSessions'
       OR p_payload->'configuration' <> v_context->'configuration' THEN
        RAISE EXCEPTION 'R003_ENROLLMENT_BUNDLE_CONTEXT_MISMATCH';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.devices
        WHERE device_id = v_challenge.hub_device_id
    ) THEN
        RAISE EXCEPTION 'R003_HUB_DEVICE_ID_ALREADY_REGISTERED';
    END IF;

    -- Replacing a Hub is an audited failover. Revoking the old device,
    -- sessions, and bundle happens in the same transaction as authority swap.
    IF v_authority.active_hub_device_id IS NOT NULL THEN
        UPDATE public.devices
        SET status = 'REVOKED',
            revoked_at = now(),
            updated_at = now()
        WHERE id = v_authority.active_hub_device_id;

        UPDATE public.hub_authorization_bundles
        SET is_active = false,
            revoked_at = now()
        WHERE branch_id = v_challenge.branch_id
          AND is_active
          AND revoked_at IS NULL;

        UPDATE public.hub_staff_sessions
        SET status = 'REVOKED',
            revoked_at = now()
        WHERE branch_id = v_challenge.branch_id
          AND status IN ('PENDING', 'ACTIVE');
    END IF;

    INSERT INTO public.devices (
        device_id, business_id, branch_id, name, type, status, last_seen,
        operational_role, signing_public_key_base64, tls_certificate_base64,
        hub_tls_certificate_sha256, identity_registered_at, revoked_at, updated_at
    ) VALUES (
        v_challenge.hub_device_id, v_challenge.business_id, v_challenge.branch_id,
        v_challenge.hub_name, 'CASHIER_HUB', 'ACTIVE', now(),
        'CASHIER_HUB', v_challenge.signing_public_key_base64, v_challenge.tls_certificate_base64,
        v_challenge.tls_certificate_sha256, now(), NULL, now()
    ) RETURNING id INTO v_hub_device_pk;

    INSERT INTO public.hub_branch_configuration (branch_id, business_id)
    VALUES (v_challenge.branch_id, v_challenge.business_id)
    ON CONFLICT (branch_id) DO NOTHING;

    IF v_authority.branch_id IS NOT NULL THEN
        UPDATE public.hub_branch_authority
        SET active_hub_device_id = v_hub_device_pk,
            revocation_version = v_revocation_version
        WHERE branch_id = v_challenge.branch_id;
    ELSE
        INSERT INTO public.hub_branch_authority (
            branch_id, business_id, active_hub_device_id, revocation_version
        ) VALUES (
            v_challenge.branch_id, v_challenge.business_id, v_hub_device_pk, v_revocation_version
        );
    END IF;

    INSERT INTO public.hub_authorization_bundles (
        bundle_id, business_id, branch_id, hub_device_id, issuer_key_id,
        payload_base64, signature_base64, payload_sha256,
        issued_at, expires_at, revocation_version, is_active
    ) VALUES (
        p_bundle_id, v_challenge.business_id, v_challenge.branch_id, v_hub_device_pk, p_issuer_key_id,
        p_payload_base64, p_signature_base64,
        private.r003_sha256(private.r003_base64url_decode(p_payload_base64)),
        p_issued_at, p_expires_at, v_revocation_version, true
    );

    UPDATE public.device_pairing_codes
    SET status = 'CONSUMED', used_at = now()
    WHERE id = v_code.id AND status = 'WAITING';
    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated <> 1 THEN
        RAISE EXCEPTION 'R003_ENROLLMENT_CODE_RACE';
    END IF;

    UPDATE public.hub_enrollment_challenges
    SET completed_at = now(),
        completed_bundle_id = p_bundle_id
    WHERE challenge_id = v_challenge.challenge_id;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, event_type, details
    ) VALUES (
        'evt-hub-enrolled-' || encode(private.r002_random_bytes(16), 'hex'),
        v_challenge.business_id,
        v_challenge.branch_id,
        v_challenge.hub_device_id,
        'CASHIER_HUB_ENROLLED',
        jsonb_build_object(
            'hub_device_id', v_challenge.hub_device_id,
            'bundle_id', p_bundle_id,
            'revocation_version', v_revocation_version
        )
    );

    RETURN jsonb_build_object(
        'schemaVersion', 1,
        'issuerKeyId', p_issuer_key_id,
        'payloadBase64', p_payload_base64,
        'signature', p_signature_base64
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_get_hub_renewal_context(
    p_hub_device_id text,
    p_bundle_id uuid,
    p_request_id uuid,
    p_request_digest text,
    p_device_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_device public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_bundle public.hub_authorization_bundles%ROWTYPE;
    v_current_bundle public.hub_authorization_bundles%ROWTYPE;
    v_request public.hub_bundle_renewal_requests%ROWTYPE;
    v_completed_bundle public.hub_authorization_bundles%ROWTYPE;
BEGIN
    IF p_request_digest !~ '^[A-Za-z0-9_-]{43}$' THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;
    IF NOT private.r003_consume_rate_limit('sync_device', p_device_hash, 120, interval '5 minutes') THEN
        RETURN jsonb_build_object('state', 'RATE_LIMITED');
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    SELECT * INTO v_request
    FROM public.hub_bundle_renewal_requests
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF FOUND THEN
        IF v_request.request_digest <> p_request_digest
           OR v_request.hub_device_id <> v_device.id
           OR v_request.previous_bundle_id <> p_bundle_id THEN
            RETURN jsonb_build_object('state', 'INVALID');
        END IF;
        IF v_request.completed_at IS NOT NULL THEN
            SELECT * INTO v_completed_bundle
            FROM public.hub_authorization_bundles
            WHERE bundle_id = v_request.completed_bundle_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'R003_RENEWAL_COMPLETION_MISSING_BUNDLE';
            END IF;
            RETURN jsonb_build_object(
                'state', 'COMPLETE',
                'envelope', jsonb_build_object(
                    'schemaVersion', 1,
                    'issuerKeyId', v_completed_bundle.issuer_key_id,
                    'payloadBase64', v_completed_bundle.payload_base64,
                    'signature', v_completed_bundle.signature_base64
                ),
                'hubSigningPublicKeyBase64', v_device.signing_public_key_base64
            );
        END IF;
    END IF;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_device.branch_id
      AND business_id = v_device.business_id
      AND active_hub_device_id = v_device.id;

    SELECT * INTO v_bundle
    FROM public.hub_authorization_bundles
    WHERE bundle_id = p_bundle_id
      AND hub_device_id = v_device.id
      AND branch_id = v_device.branch_id
      AND revoked_at IS NULL
      AND (
          is_active
          OR (superseded_at IS NOT NULL AND superseded_at > now() - interval '7 days')
      );

    IF NOT FOUND OR v_device.id IS NULL OR v_authority.active_hub_device_id IS NULL THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    -- Cloud issuance can complete before Android has persisted the returned
    -- envelope. A recent predecessor may prove possession of the same active
    -- Hub key to retrieve the current bundle, but it cannot create another
    -- authority chain or bypass a revocation.
    SELECT * INTO v_current_bundle
    FROM public.hub_authorization_bundles
    WHERE hub_device_id = v_device.id
      AND branch_id = v_device.branch_id
      AND is_active
      AND revoked_at IS NULL
    ORDER BY issued_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    IF NOT v_bundle.is_active THEN
        RETURN jsonb_build_object(
            'state', 'COMPLETE',
            'envelope', jsonb_build_object(
                'schemaVersion', 1,
                'issuerKeyId', v_current_bundle.issuer_key_id,
                'payloadBase64', v_current_bundle.payload_base64,
                'signature', v_current_bundle.signature_base64
            ),
            'hubSigningPublicKeyBase64', v_device.signing_public_key_base64
        );
    END IF;

    IF v_request.request_id IS NULL THEN
        INSERT INTO public.hub_bundle_renewal_requests (
            request_id, request_digest, hub_device_id, previous_bundle_id
        ) VALUES (
            p_request_id, p_request_digest, v_device.id, v_bundle.bundle_id
        );
    END IF;

    RETURN jsonb_build_object(
        'state', 'ACTIVE',
        'hubSigningPublicKeyBase64', v_device.signing_public_key_base64,
        'bundleContext', private.r003_hub_bundle_context(
            v_device.business_id,
            v_device.branch_id,
            v_device.device_id,
            v_device.name,
            v_device.signing_public_key_base64,
            v_device.hub_tls_certificate_sha256,
            v_authority.revocation_version,
            NULL
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_finalize_hub_renewal(
    p_request_id uuid,
    p_hub_device_id text,
    p_current_bundle_id uuid,
    p_bundle_id uuid,
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
    v_device public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_current_bundle public.hub_authorization_bundles%ROWTYPE;
    v_request public.hub_bundle_renewal_requests%ROWTYPE;
    v_existing_bundle public.hub_authorization_bundles%ROWTYPE;
    v_context jsonb;
BEGIN
    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'R003_HUB_RENEWAL_INVALID_DEVICE';
    END IF;

    SELECT * INTO v_request
    FROM public.hub_bundle_renewal_requests
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF NOT FOUND OR v_request.hub_device_id <> v_device.id
       OR v_request.previous_bundle_id <> p_current_bundle_id THEN
        RAISE EXCEPTION 'R003_HUB_RENEWAL_REQUEST_INVALID';
    END IF;
    IF v_request.completed_at IS NOT NULL THEN
        SELECT * INTO v_existing_bundle
        FROM public.hub_authorization_bundles
        WHERE bundle_id = v_request.completed_bundle_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_RENEWAL_COMPLETION_MISSING_BUNDLE';
        END IF;
        RETURN jsonb_build_object(
            'schemaVersion', 1,
            'issuerKeyId', v_existing_bundle.issuer_key_id,
            'payloadBase64', v_existing_bundle.payload_base64,
            'signature', v_existing_bundle.signature_base64
        );
    END IF;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_device.branch_id
      AND active_hub_device_id = v_device.id
    FOR UPDATE;

    SELECT * INTO v_current_bundle
    FROM public.hub_authorization_bundles
    WHERE bundle_id = p_current_bundle_id
      AND hub_device_id = v_device.id
      AND branch_id = v_device.branch_id
      AND is_active
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND OR v_authority.active_hub_device_id IS NULL THEN
        RAISE EXCEPTION 'R003_HUB_RENEWAL_INVALID_BUNDLE';
    END IF;

    PERFORM private.r003_validate_bundle_envelope(
        p_bundle_id,
        v_device.business_id,
        v_device.branch_id,
        v_device.device_id,
        v_device.signing_public_key_base64,
        v_device.hub_tls_certificate_sha256,
        v_authority.revocation_version,
        p_issuer_key_id,
        p_payload_base64,
        p_signature_base64,
        p_payload,
        p_issued_at,
        p_expires_at
    );

    v_context := private.r003_hub_bundle_context(
        v_device.business_id,
        v_device.branch_id,
        v_device.device_id,
        v_device.name,
        v_device.signing_public_key_base64,
        v_device.hub_tls_certificate_sha256,
        v_authority.revocation_version,
        NULL
    );
    IF p_payload->'pairedDevices' <> v_context->'pairedDevices'
       OR p_payload->'staffDirectory' <> v_context->'staffDirectory'
       OR p_payload->'staffSessions' <> v_context->'staffSessions'
       OR p_payload->'configuration' <> v_context->'configuration' THEN
        RAISE EXCEPTION 'R003_RENEWAL_BUNDLE_CONTEXT_MISMATCH';
    END IF;

    UPDATE public.hub_authorization_bundles
    SET is_active = false,
        superseded_at = now()
    WHERE bundle_id = v_current_bundle.bundle_id;

    INSERT INTO public.hub_authorization_bundles (
        bundle_id, business_id, branch_id, hub_device_id, issuer_key_id,
        payload_base64, signature_base64, payload_sha256,
        issued_at, expires_at, revocation_version, is_active
    ) VALUES (
        p_bundle_id, v_device.business_id, v_device.branch_id, v_device.id, p_issuer_key_id,
        p_payload_base64, p_signature_base64,
        private.r003_sha256(private.r003_base64url_decode(p_payload_base64)),
        p_issued_at, p_expires_at, v_authority.revocation_version, true
    );

    UPDATE public.hub_bundle_renewal_requests
    SET completed_at = now(),
        completed_bundle_id = p_bundle_id
    WHERE request_id = v_request.request_id;

    UPDATE public.devices
    SET last_seen = now(), updated_at = now()
    WHERE id = v_device.id;

    RETURN jsonb_build_object(
        'schemaVersion', 1,
        'issuerKeyId', p_issuer_key_id,
        'payloadBase64', p_payload_base64,
        'signature', p_signature_base64
    );
END;
$function$;

-- =========================================================
-- 3. NATIVE-ONLY FRESH STAFF SESSIONS (SERVICE ONLY)
-- =========================================================

CREATE OR REPLACE FUNCTION public.r003_begin_hub_staff_session(
    p_request_id uuid,
    p_request_digest text,
    p_source_hash text,
    p_device_hash text,
    p_hub_device_id text,
    p_staff_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.hub_staff_session_challenges%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_nonce bytea;
    v_nonce_base64 text;
BEGIN
    IF NOT private.r003_consume_rate_limit('staff_source', p_source_hash, 12, interval '10 minutes')
       OR NOT private.r003_consume_rate_limit('staff_device', p_device_hash, 8, interval '10 minutes')
       OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$' THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_existing
    FROM public.hub_staff_session_challenges
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.request_digest <> p_request_digest
           OR v_existing.staff_id <> p_staff_id
           OR v_existing.device_hash <> p_device_hash THEN
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

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_device.branch_id
      AND business_id = v_device.business_id
      AND active_hub_device_id = v_device.id;

    SELECT * INTO v_staff
    FROM public.staff_members
    WHERE id = p_staff_id
      AND business_id = v_device.business_id
      AND branch_id = v_device.branch_id
      AND status = 'ACTIVE';

    IF NOT FOUND OR v_authority.active_hub_device_id IS NULL
       OR v_staff.role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR') THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    v_nonce := private.r002_random_bytes(32);
    v_nonce_base64 := private.r003_base64url_encode(v_nonce);

    INSERT INTO public.hub_staff_session_challenges (
        request_id, request_digest, source_hash, device_hash,
        hub_device_id, business_id, branch_id, staff_id,
        nonce_base64, nonce_sha256, expires_at
    ) VALUES (
        p_request_id, p_request_digest, p_source_hash, p_device_hash,
        v_device.id, v_device.business_id, v_device.branch_id, v_staff.id,
        v_nonce_base64, private.r003_sha256(v_nonce), now() + interval '5 minutes'
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

CREATE OR REPLACE FUNCTION public.r003_get_hub_staff_session_context(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_staff_session_challenges%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_bundle public.hub_authorization_bundles%ROWTYPE;
    v_session public.hub_staff_sessions%ROWTYPE;
    v_current_bundle public.hub_authorization_bundles%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_staff_session_challenges
    WHERE challenge_id = p_challenge_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_bundle
        FROM public.hub_authorization_bundles
        WHERE bundle_id = v_challenge.completed_bundle_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_STAFF_SESSION_COMPLETION_MISSING_BUNDLE';
        END IF;
        RETURN jsonb_build_object(
            'state', 'COMPLETE',
            'requestId', v_challenge.request_id::text,
            'nonce', v_challenge.nonce_base64,
            'hubDeviceId', (
                SELECT device_id FROM public.devices WHERE id = v_challenge.hub_device_id
            ),
            'staffId', v_challenge.staff_id::text,
            'hubSigningPublicKeyBase64', (
                SELECT signing_public_key_base64 FROM public.devices WHERE id = v_challenge.hub_device_id
            ),
            'activeStaffSessionId', v_challenge.prepared_session_id::text,
            'envelope', jsonb_build_object(
                'schemaVersion', 1,
                'issuerKeyId', v_bundle.issuer_key_id,
                'payloadBase64', v_bundle.payload_base64,
                'signature', v_bundle.signature_base64
            )
        );
    END IF;

    IF v_challenge.expires_at <= now() THEN
        RETURN jsonb_build_object('state', 'EXPIRED');
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE id = v_challenge.hub_device_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_challenge.branch_id
      AND active_hub_device_id = v_challenge.hub_device_id;

    IF NOT FOUND OR v_device.id IS NULL OR v_authority.active_hub_device_id IS NULL THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    IF v_challenge.prepared_session_id IS NULL THEN
        RETURN jsonb_build_object(
            'state', 'PENDING',
            'requestId', v_challenge.request_id::text,
            'nonce', v_challenge.nonce_base64,
            'hubDeviceId', v_device.device_id,
            'staffId', v_challenge.staff_id::text,
            'hubSigningPublicKeyBase64', v_device.signing_public_key_base64
        );
    END IF;

    SELECT * INTO v_session
    FROM public.hub_staff_sessions
    WHERE session_id = v_challenge.prepared_session_id;

    IF NOT FOUND OR v_session.status <> 'PENDING' THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    SELECT * INTO v_current_bundle
    FROM public.hub_authorization_bundles
    WHERE hub_device_id = v_challenge.hub_device_id
      AND branch_id = v_challenge.branch_id
      AND is_active
      AND revoked_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    RETURN jsonb_build_object(
        'state', 'PREPARED',
        'requestId', v_challenge.request_id::text,
        'nonce', v_challenge.nonce_base64,
        'hubDeviceId', v_device.device_id,
        'staffId', v_challenge.staff_id::text,
        'hubSigningPublicKeyBase64', v_device.signing_public_key_base64,
        'currentBundleId', v_current_bundle.bundle_id::text,
        'sessionId', v_session.session_id::text,
        'expiresAt', private.r003_canonical_utc(v_session.expires_at),
        'bundleContext', private.r003_hub_bundle_context(
            v_challenge.business_id,
            v_challenge.branch_id,
            v_device.device_id,
            v_device.name,
            v_device.signing_public_key_base64,
            v_device.hub_tls_certificate_sha256,
            v_authority.revocation_version,
            v_session.session_id
        )
    );
END;
$function$;

-- This uses the accepted R002 credential table and its five-failure/five-
-- minute semantics, but deliberately does not mint the legacy bearer token
-- returned by public.verify_staff_pin. The native PIN is never returned to a
-- browser bridge, audit record, or authorization bundle.
CREATE OR REPLACE FUNCTION public.r003_verify_hub_staff_pin(
    p_challenge_id uuid,
    p_pin text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_staff_session_challenges%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_credential public.staff_credentials%ROWTYPE;
    v_new_attempts integer;
    v_lock_until timestamptz;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_staff_session_challenges
    WHERE challenge_id = p_challenge_id
    FOR UPDATE;

    IF NOT FOUND OR v_challenge.completed_at IS NOT NULL OR v_challenge.expires_at <= now()
       OR p_pin IS NULL OR trim(p_pin) !~ '^\d{4,8}$' THEN
        RETURN jsonb_build_object('authenticated', false);
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE id = v_challenge.hub_device_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.hub_branch_authority authority
        WHERE authority.branch_id = v_challenge.branch_id
          AND authority.business_id = v_challenge.business_id
          AND authority.active_hub_device_id = v_challenge.hub_device_id
    ) THEN
        RETURN jsonb_build_object('authenticated', false);
    END IF;

    SELECT s.* INTO v_staff
    FROM public.staff_members s
    WHERE s.id = v_challenge.staff_id
      AND s.business_id = v_challenge.business_id
      AND s.branch_id = v_challenge.branch_id
      AND s.status = 'ACTIVE';

    SELECT c.* INTO v_credential
    FROM public.staff_credentials c
    WHERE c.staff_id = v_challenge.staff_id
      AND c.business_id = v_challenge.business_id
    FOR UPDATE;

    IF NOT FOUND OR v_staff.id IS NULL
       OR v_staff.role NOT IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR') THEN
        RETURN jsonb_build_object('authenticated', false);
    END IF;

    IF v_challenge.pin_verified_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'authenticated', true,
            'staff', jsonb_build_object('id', v_staff.id::text, 'role', v_staff.role)
        );
    END IF;

    IF v_credential.locked_until IS NOT NULL AND v_credential.locked_until > now() THEN
        RETURN jsonb_build_object('authenticated', false, 'locked', true);
    END IF;

    IF v_credential.pin_hash = private.r002_crypt(trim(p_pin), v_credential.pin_hash) THEN
        UPDATE public.staff_credentials
        SET failed_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE staff_id = v_staff.id;

        UPDATE public.hub_staff_session_challenges
        SET pin_verified_at = now()
        WHERE challenge_id = v_challenge.challenge_id;

        INSERT INTO public.audit_logs (
            event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details
        ) VALUES (
            'evt-hub-login-ok-' || encode(private.r002_random_bytes(16), 'hex'),
            v_challenge.business_id,
            v_challenge.branch_id,
            v_device.device_id,
            v_staff.id::text,
            v_staff.id::text,
            'HUB_STAFF_LOGIN_SUCCESS',
            jsonb_build_object('staff_id', v_staff.id, 'hub_device_id', v_device.device_id)
        );

        RETURN jsonb_build_object(
            'authenticated', true,
            'staff', jsonb_build_object('id', v_staff.id::text, 'role', v_staff.role)
        );
    END IF;

    v_new_attempts := coalesce(v_credential.failed_attempts, 0) + 1;
    v_lock_until := CASE
        WHEN v_new_attempts >= 5 THEN now() + interval '5 minutes'
        ELSE NULL
    END;

    UPDATE public.staff_credentials
    SET failed_attempts = v_new_attempts,
        locked_until = v_lock_until,
        updated_at = now()
    WHERE staff_id = v_staff.id;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details
    ) VALUES (
        'evt-hub-login-fail-' || encode(private.r002_random_bytes(16), 'hex'),
        v_challenge.business_id,
        v_challenge.branch_id,
        v_device.device_id,
        v_staff.id::text,
        v_staff.id::text,
        CASE WHEN v_new_attempts >= 5 THEN 'HUB_STAFF_LOGIN_LOCKED' ELSE 'HUB_STAFF_LOGIN_FAILURE' END,
        jsonb_build_object('staff_id', v_staff.id, 'attempts', v_new_attempts)
    );

    RETURN jsonb_strip_nulls(jsonb_build_object(
        'authenticated', false,
        'locked', CASE WHEN v_new_attempts >= 5 THEN true ELSE NULL END
    ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_prepare_hub_staff_session(
    p_challenge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_challenge public.hub_staff_session_challenges%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_session public.hub_staff_sessions%ROWTYPE;
    v_current_bundle public.hub_authorization_bundles%ROWTYPE;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_staff_session_challenges
    WHERE challenge_id = p_challenge_id
    FOR UPDATE;

    IF NOT FOUND OR v_challenge.completed_at IS NOT NULL OR v_challenge.expires_at <= now()
       OR v_challenge.pin_verified_at IS NULL THEN
        RAISE EXCEPTION 'R003_STAFF_SESSION_NOT_VERIFIED';
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE id = v_challenge.hub_device_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;

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
      AND status = 'ACTIVE';

    IF NOT FOUND OR v_device.id IS NULL OR v_authority.active_hub_device_id IS NULL THEN
        RAISE EXCEPTION 'R003_STAFF_SESSION_HUB_NOT_ACTIVE';
    END IF;

    IF v_challenge.prepared_session_id IS NULL THEN
        UPDATE public.hub_staff_sessions
        SET status = 'REVOKED', revoked_at = now()
        WHERE hub_device_id = v_challenge.hub_device_id
          AND staff_id = v_challenge.staff_id
          AND status = 'PENDING';

        INSERT INTO public.hub_staff_sessions (
            session_id, business_id, branch_id, hub_device_id, staff_id,
            role, revocation_version, status, expires_at
        ) VALUES (
            gen_random_uuid(), v_challenge.business_id, v_challenge.branch_id,
            v_challenge.hub_device_id, v_challenge.staff_id,
            v_staff.role, v_authority.revocation_version, 'PENDING', now() + interval '12 hours'
        ) RETURNING * INTO v_session;

        UPDATE public.hub_staff_session_challenges
        SET prepared_session_id = v_session.session_id
        WHERE challenge_id = v_challenge.challenge_id;
    ELSE
        SELECT * INTO v_session
        FROM public.hub_staff_sessions
        WHERE session_id = v_challenge.prepared_session_id;
        IF NOT FOUND OR v_session.status <> 'PENDING' THEN
            RAISE EXCEPTION 'R003_STAFF_SESSION_PREPARATION_INVALID';
        END IF;
    END IF;

    SELECT * INTO v_current_bundle
    FROM public.hub_authorization_bundles
    WHERE hub_device_id = v_challenge.hub_device_id
      AND branch_id = v_challenge.branch_id
      AND is_active
      AND revoked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R003_STAFF_SESSION_CURRENT_BUNDLE_MISSING';
    END IF;

    RETURN jsonb_build_object(
        'state', 'PREPARED',
        'hubSigningPublicKeyBase64', v_device.signing_public_key_base64,
        'currentBundleId', v_current_bundle.bundle_id::text,
        'sessionId', v_session.session_id::text,
        'expiresAt', private.r003_canonical_utc(v_session.expires_at),
        'bundleContext', private.r003_hub_bundle_context(
            v_challenge.business_id,
            v_challenge.branch_id,
            v_device.device_id,
            v_device.name,
            v_device.signing_public_key_base64,
            v_device.hub_tls_certificate_sha256,
            v_authority.revocation_version,
            v_session.session_id
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_finalize_hub_staff_session(
    p_challenge_id uuid,
    p_current_bundle_id uuid,
    p_bundle_id uuid,
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
    v_challenge public.hub_staff_session_challenges%ROWTYPE;
    v_device public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_session public.hub_staff_sessions%ROWTYPE;
    v_current_bundle public.hub_authorization_bundles%ROWTYPE;
    v_existing_bundle public.hub_authorization_bundles%ROWTYPE;
    v_context jsonb;
BEGIN
    SELECT * INTO v_challenge
    FROM public.hub_staff_session_challenges
    WHERE challenge_id = p_challenge_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'R003_STAFF_SESSION_CHALLENGE_INVALID';
    END IF;

    IF v_challenge.completed_at IS NOT NULL THEN
        SELECT * INTO v_existing_bundle
        FROM public.hub_authorization_bundles
        WHERE bundle_id = v_challenge.completed_bundle_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_STAFF_SESSION_COMPLETION_MISSING_BUNDLE';
        END IF;
        RETURN jsonb_build_object(
            'schemaVersion', 1,
            'issuerKeyId', v_existing_bundle.issuer_key_id,
            'payloadBase64', v_existing_bundle.payload_base64,
            'signature', v_existing_bundle.signature_base64
        );
    END IF;

    IF v_challenge.expires_at <= now() OR v_challenge.pin_verified_at IS NULL
       OR v_challenge.prepared_session_id IS NULL THEN
        RAISE EXCEPTION 'R003_STAFF_SESSION_NOT_PREPARED';
    END IF;

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

    SELECT * INTO v_session
    FROM public.hub_staff_sessions
    WHERE session_id = v_challenge.prepared_session_id
      AND status = 'PENDING'
      AND expires_at > now()
    FOR UPDATE;

    SELECT * INTO v_current_bundle
    FROM public.hub_authorization_bundles
    WHERE bundle_id = p_current_bundle_id
      AND hub_device_id = v_challenge.hub_device_id
      AND branch_id = v_challenge.branch_id
      AND is_active
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND OR v_device.id IS NULL OR v_authority.active_hub_device_id IS NULL
       OR v_session.session_id IS NULL
       OR v_session.revocation_version <> v_authority.revocation_version THEN
        RAISE EXCEPTION 'R003_STAFF_SESSION_AUTHORITY_CHANGED';
    END IF;

    v_context := private.r003_hub_bundle_context(
        v_challenge.business_id,
        v_challenge.branch_id,
        v_device.device_id,
        v_device.name,
        v_device.signing_public_key_base64,
        v_device.hub_tls_certificate_sha256,
        v_authority.revocation_version,
        v_session.session_id
    );

    PERFORM private.r003_validate_bundle_envelope(
        p_bundle_id,
        v_challenge.business_id,
        v_challenge.branch_id,
        v_device.device_id,
        v_device.signing_public_key_base64,
        v_device.hub_tls_certificate_sha256,
        v_authority.revocation_version,
        p_issuer_key_id,
        p_payload_base64,
        p_signature_base64,
        p_payload,
        p_issued_at,
        p_expires_at
    );

    IF p_payload->'pairedDevices' <> v_context->'pairedDevices'
       OR p_payload->'staffDirectory' <> v_context->'staffDirectory'
       OR p_payload->'staffSessions' <> v_context->'staffSessions'
       OR p_payload->'configuration' <> v_context->'configuration' THEN
        RAISE EXCEPTION 'R003_STAFF_SESSION_BUNDLE_CONTEXT_MISMATCH';
    END IF;

    -- The pending session deliberately replaced a same-staff active session
    -- in the signed context. Revoke that predecessor before activating the
    -- new one so one staff identity cannot retain two offline continuations.
    UPDATE public.hub_staff_sessions
    SET status = 'REVOKED', revoked_at = now()
    WHERE hub_device_id = v_challenge.hub_device_id
      AND staff_id = v_session.staff_id
      AND status = 'ACTIVE';

    UPDATE public.hub_staff_sessions
    SET status = 'ACTIVE', activated_at = now()
    WHERE session_id = v_session.session_id
      AND status = 'PENDING';

    UPDATE public.hub_authorization_bundles
    SET is_active = false,
        superseded_at = now()
    WHERE bundle_id = v_current_bundle.bundle_id;

    INSERT INTO public.hub_authorization_bundles (
        bundle_id, business_id, branch_id, hub_device_id, issuer_key_id,
        payload_base64, signature_base64, payload_sha256,
        issued_at, expires_at, revocation_version, is_active
    ) VALUES (
        p_bundle_id, v_challenge.business_id, v_challenge.branch_id, v_challenge.hub_device_id,
        p_issuer_key_id, p_payload_base64, p_signature_base64,
        private.r003_sha256(private.r003_base64url_decode(p_payload_base64)),
        p_issued_at, p_expires_at, v_authority.revocation_version, true
    );

    UPDATE public.hub_staff_session_challenges
    SET completed_at = now(),
        completed_bundle_id = p_bundle_id
    WHERE challenge_id = v_challenge.challenge_id;

    INSERT INTO public.audit_logs (
        event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details
    ) VALUES (
        'evt-hub-session-issued-' || encode(private.r002_random_bytes(16), 'hex'),
        v_challenge.business_id,
        v_challenge.branch_id,
        v_device.device_id,
        v_session.staff_id::text,
        v_session.session_id::text,
        'HUB_STAFF_SESSION_ISSUED',
        jsonb_build_object(
            'staff_id', v_session.staff_id,
            'session_id', v_session.session_id,
            'expires_at', v_session.expires_at
        )
    );

    RETURN jsonb_build_object(
        'schemaVersion', 1,
        'issuerKeyId', p_issuer_key_id,
        'payloadBase64', p_payload_base64,
        'signature', p_signature_base64
    );
END;
$function$;

-- =========================================================
-- 4. IMMUTABLE EVENT REPLICATION AND ORDER PROJECTION
-- =========================================================

CREATE OR REPLACE FUNCTION private.r003_json_number(
    p_value jsonb,
    p_field text
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $function$
DECLARE
    v_number numeric;
BEGIN
    IF jsonb_typeof(p_value -> p_field) <> 'number' THEN
        RAISE EXCEPTION 'R003_EVENT_FIELD_NOT_NUMERIC: %', p_field;
    END IF;
    BEGIN
        v_number := (p_value ->> p_field)::numeric;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R003_EVENT_FIELD_NOT_NUMERIC: %', p_field;
    END;
    IF v_number <> v_number OR abs(v_number) > 999999999999.99 THEN
        RAISE EXCEPTION 'R003_EVENT_FIELD_OUT_OF_RANGE: %', p_field;
    END IF;
    RETURN v_number;
END;
$function$;

CREATE OR REPLACE FUNCTION private.r003_project_hub_order_event(
    p_event_id uuid,
    p_command_id uuid,
    p_business_id uuid,
    p_branch_id uuid,
    p_hub_device_id text,
    p_staff_id uuid,
    p_staff_session_id uuid,
    p_aggregate_id text,
    p_action text,
    p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_order_id uuid;
    v_existing_status text;
    v_next_status text;
    v_subtotal numeric;
    v_tax numeric;
    v_total numeric;
    v_calculated_subtotal numeric := 0;
    v_payment_method text;
    v_cashier_name text;
    v_item jsonb;
    v_product_id uuid;
    v_product public.catalog_products%ROWTYPE;
    v_balance public.inventory_branch_balances%ROWTYPE;
    v_quantity numeric;
    v_unit_price numeric;
    v_stock_before numeric;
    v_stock_after numeric;
    v_line_total numeric;
    v_item_name text;
    v_order_line record;
    v_cancelled_line_count integer := 0;
BEGIN
    BEGIN
        v_order_id := p_aggregate_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R003_ORDER_ID_INVALID';
    END;

    IF p_payload->>'id' <> p_aggregate_id
       OR coalesce(p_payload->>'orderId', p_aggregate_id) <> p_aggregate_id THEN
        RAISE EXCEPTION 'R003_ORDER_PAYLOAD_ID_MISMATCH';
    END IF;

    IF p_action = 'ORDER_PLACED' THEN
        -- The first native order slice intentionally contains only the
        -- server-verifiable tender intent and signed catalog facts. Customer
        -- details, cash counts, free-form notes, discounts, and payment
        -- capture are separate contracts; accepting them here would make an
        -- unimplemented browser/task payload part of the financial record.
        IF (p_payload - ARRAY[
                'id', 'orderId', 'status', 'items', 'subtotal', 'tax',
                'totalAmount', 'paymentMethod', 'paymentType'
            ]) <> '{}'::jsonb
           OR p_payload->>'status' <> 'PLACED' THEN
            RAISE EXCEPTION 'R003_ORDER_UNSUPPORTED_PAYLOAD';
        END IF;
        IF jsonb_typeof(p_payload->'items') <> 'array'
           OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 100 THEN
            RAISE EXCEPTION 'R003_ORDER_ITEMS_INVALID';
        END IF;

        v_subtotal := private.r003_json_number(p_payload, 'subtotal');
        v_tax := private.r003_json_number(p_payload, 'tax');
        v_total := private.r003_json_number(p_payload, 'totalAmount');
        IF v_subtotal < 0 OR v_tax < 0 OR v_total < 0
           OR v_subtotal <> round(v_subtotal, 2)
           OR v_tax <> round(v_tax, 2)
           OR v_total <> round(v_total, 2)
           OR abs(v_total - v_subtotal - v_tax) > 0.005 THEN
            RAISE EXCEPTION 'R003_ORDER_TOTALS_INVALID';
        END IF;

        v_payment_method := nullif(trim(p_payload->>'paymentMethod'), '');
        IF v_payment_method IS NULL
           OR v_payment_method <> nullif(trim(p_payload->>'paymentType'), '')
           OR v_payment_method NOT IN ('CASH', 'CARD', 'SPAZAPAY_QR') THEN
            RAISE EXCEPTION 'R003_ORDER_PAYMENT_METHOD_INVALID';
        END IF;

        SELECT name INTO v_cashier_name
        FROM public.staff_members
        WHERE id = p_staff_id
          AND business_id = p_business_id
          AND branch_id = p_branch_id
          AND status = 'ACTIVE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_ORDER_STAFF_SCOPE_INVALID';
        END IF;

        -- Insert the parent first so the item rows satisfy the R001 foreign
        -- key. Any later validation failure rolls this entire event ingest
        -- transaction back, including this provisional parent row.
        INSERT INTO public.orders (
            id, business_id, branch_id, device_id, cashier_id, cashier_name,
            customer_name, customer_phone, subtotal, tax, total_amount,
            status, payment_method, payment_status, cash_tendered, change_due
        ) VALUES (
            v_order_id, p_business_id, p_branch_id, p_hub_device_id, p_staff_id, v_cashier_name,
            NULL, NULL, v_subtotal, v_tax, v_total,
            'PLACED', v_payment_method, 'PENDING', NULL, NULL
        ) ON CONFLICT (id) DO NOTHING;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_ORDER_ALREADY_EXISTS';
        END IF;

        FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
            IF jsonb_typeof(v_item) <> 'object'
               OR (v_item - ARRAY['productId', 'name', 'price', 'quantity', 'stockBefore', 'stockAfter']) <> '{}'::jsonb THEN
                RAISE EXCEPTION 'R003_ORDER_ITEM_INVALID';
            END IF;
            BEGIN
                v_product_id := (v_item->>'productId')::uuid;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'R003_ORDER_PRODUCT_ID_INVALID';
            END;
            v_quantity := private.r003_json_number(v_item, 'quantity');
            IF v_quantity <= 0 OR v_quantity > 99999999999.999
               OR v_quantity <> round(v_quantity, 3) THEN
                RAISE EXCEPTION 'R003_ORDER_QUANTITY_INVALID';
            END IF;
            v_unit_price := private.r003_json_number(v_item, 'price');
            IF v_unit_price < 0 OR v_unit_price <> round(v_unit_price, 2) THEN
                RAISE EXCEPTION 'R003_ORDER_PRICE_INVALID';
            END IF;
            v_stock_before := private.r003_json_number(v_item, 'stockBefore');
            v_stock_after := private.r003_json_number(v_item, 'stockAfter');
            IF v_stock_before < 0 OR v_stock_after < 0
               OR v_stock_before > 99999999999.999 OR v_stock_after > 99999999999.999
               OR v_stock_before <> round(v_stock_before, 3)
               OR v_stock_after <> round(v_stock_after, 3)
               OR abs(v_stock_after - (v_stock_before - v_quantity)) > 0.0005 THEN
                RAISE EXCEPTION 'R003_ORDER_STOCK_FACTS_INVALID';
            END IF;

            SELECT * INTO v_product
            FROM public.catalog_products product
            WHERE product.id = v_product_id
              AND product.business_id = p_business_id
              AND (product.branch_id IS NULL OR product.branch_id = p_branch_id)
              AND product.status = 'ACTIVE'
            FOR UPDATE;
            IF NOT FOUND OR v_product.price < 0
               OR abs(v_product.price - v_unit_price) > 0.005 THEN
                RAISE EXCEPTION 'R003_ORDER_CATALOG_MISMATCH';
            END IF;

            SELECT * INTO v_balance
            FROM public.inventory_branch_balances balance
            WHERE balance.branch_id = p_branch_id
              AND balance.business_id = p_business_id
              AND balance.product_id = v_product.id
            FOR UPDATE;
            IF NOT FOUND OR v_balance.quantity < 0
               OR abs(v_balance.quantity - v_stock_before) > 0.0005 THEN
                RAISE EXCEPTION 'R003_ORDER_STOCK_BALANCE_MISMATCH';
            END IF;

            v_item_name := v_product.name;
            IF v_item->>'name' IS DISTINCT FROM v_item_name OR length(v_item_name) > 500 THEN
                RAISE EXCEPTION 'R003_ORDER_ITEM_NAME_INVALID';
            END IF;
            v_line_total := round(v_unit_price * v_quantity, 2);
            v_calculated_subtotal := v_calculated_subtotal + v_line_total;

            INSERT INTO public.order_items (
                order_id, product_id, name, unit_price, quantity, line_total, notes
            ) VALUES (
                v_order_id, v_product_id, v_item_name, v_unit_price, v_quantity, v_line_total,
                NULL
            );

            UPDATE public.inventory_branch_balances
            SET quantity = v_stock_after,
                updated_at = now()
            WHERE branch_id = v_balance.branch_id
              AND product_id = v_balance.product_id;

            INSERT INTO public.inventory_movements (
                event_id, business_id, branch_id, product_id, order_id, staff_id,
                staff_session_id, movement_type, quantity_delta, balance_before,
                balance_after, occurred_at
            ) VALUES (
                p_event_id, p_business_id, p_branch_id, v_product.id, v_order_id, p_staff_id,
                p_staff_session_id, 'ORDER_RESERVATION', -v_quantity, v_stock_before,
                v_stock_after, (SELECT occurred_at FROM public.hub_events WHERE event_id = p_event_id)
            );
        END LOOP;

        IF abs(v_calculated_subtotal - v_subtotal) > 0.005 THEN
            RAISE EXCEPTION 'R003_ORDER_SUBTOTAL_INVALID';
        END IF;
        RETURN;
    END IF;

    IF p_action <> 'ORDER_STATUS_CHANGED' THEN
        RAISE EXCEPTION 'R003_ORDER_EVENT_ACTION_INVALID';
    END IF;

    IF (p_payload - ARRAY['id', 'orderId', 'status', 'previousStatus']) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'R003_ORDER_UNSUPPORTED_STATUS_PAYLOAD';
    END IF;

    v_next_status := trim(p_payload->>'status');
    IF v_next_status NOT IN ('PREPARING', 'READY', 'COLLECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'R003_ORDER_STATUS_INVALID';
    END IF;

    SELECT status INTO v_existing_status
    FROM public.orders
    WHERE id = v_order_id
      AND business_id = p_business_id
      AND branch_id = p_branch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'R003_ORDER_NOT_FOUND';
    END IF;

    IF p_payload->>'previousStatus' IS DISTINCT FROM v_existing_status THEN
        RAISE EXCEPTION 'R003_ORDER_PREVIOUS_STATUS_INVALID';
    END IF;

    IF NOT (
        (v_existing_status = 'PLACED' AND v_next_status IN ('PREPARING', 'CANCELLED'))
        OR (v_existing_status = 'PREPARING' AND v_next_status IN ('READY', 'CANCELLED'))
        OR (v_existing_status = 'READY' AND v_next_status = 'COLLECTED')
    ) THEN
        RAISE EXCEPTION 'R003_ORDER_STATUS_TRANSITION_INVALID';
    END IF;

    IF v_next_status = 'CANCELLED' THEN
        FOR v_order_line IN
            SELECT item.product_id, item.quantity
            FROM public.order_items item
            WHERE item.order_id = v_order_id
            ORDER BY item.product_id
        LOOP
            IF v_order_line.product_id IS NULL THEN
                RAISE EXCEPTION 'R003_ORDER_CANCELLATION_ITEM_INVALID';
            END IF;
            v_product_id := v_order_line.product_id;
            v_quantity := v_order_line.quantity;
            IF v_quantity <= 0 OR v_quantity <> round(v_quantity, 3) THEN
                RAISE EXCEPTION 'R003_ORDER_CANCELLATION_QUANTITY_INVALID';
            END IF;

            SELECT * INTO v_product
            FROM public.catalog_products product
            WHERE product.id = v_product_id
              AND product.business_id = p_business_id
              AND (product.branch_id IS NULL OR product.branch_id = p_branch_id)
            FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'R003_ORDER_CANCELLATION_CATALOG_INVALID';
            END IF;
            SELECT * INTO v_balance
            FROM public.inventory_branch_balances balance
            WHERE balance.branch_id = p_branch_id
              AND balance.business_id = p_business_id
              AND balance.product_id = v_product.id
            FOR UPDATE;
            IF NOT FOUND OR v_balance.quantity < 0 THEN
                RAISE EXCEPTION 'R003_ORDER_CANCELLATION_BALANCE_INVALID';
            END IF;
            v_stock_before := v_balance.quantity;
            v_stock_after := v_stock_before + v_quantity;
            IF v_stock_after > 99999999999.999
               OR v_stock_after <> round(v_stock_after, 3) THEN
                RAISE EXCEPTION 'R003_ORDER_CANCELLATION_STOCK_INVALID';
            END IF;

            UPDATE public.inventory_branch_balances
            SET quantity = v_stock_after,
                updated_at = now()
            WHERE branch_id = v_balance.branch_id
              AND product_id = v_balance.product_id;

            INSERT INTO public.inventory_movements (
                event_id, business_id, branch_id, product_id, order_id, staff_id,
                staff_session_id, movement_type, quantity_delta, balance_before,
                balance_after, occurred_at
            ) VALUES (
                p_event_id, p_business_id, p_branch_id, v_product.id, v_order_id, p_staff_id,
                p_staff_session_id, 'ORDER_CANCELLATION_RELEASE', v_quantity, v_stock_before,
                v_stock_after, (SELECT occurred_at FROM public.hub_events WHERE event_id = p_event_id)
            );
            v_cancelled_line_count := v_cancelled_line_count + 1;
        END LOOP;
        IF v_cancelled_line_count = 0 THEN
            RAISE EXCEPTION 'R003_ORDER_CANCELLATION_ITEMS_MISSING';
        END IF;
    END IF;

    UPDATE public.orders
    SET status = v_next_status,
        updated_at = now()
    WHERE id = v_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_get_hub_sync_context(
    p_hub_device_id text,
    p_bundle_id uuid,
    p_device_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_device public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_bundle public.hub_authorization_bundles%ROWTYPE;
BEGIN
    IF NOT private.r003_consume_rate_limit('sync_device', p_device_hash, 120, interval '5 minutes') THEN
        RETURN jsonb_build_object('state', 'RATE_LIMITED');
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_device.branch_id
      AND business_id = v_device.business_id
      AND active_hub_device_id = v_device.id;

    SELECT * INTO v_bundle
    FROM public.hub_authorization_bundles
    WHERE bundle_id = p_bundle_id
      AND hub_device_id = v_device.id
      AND branch_id = v_device.branch_id
      AND revoked_at IS NULL
      AND (
          is_active
          OR (superseded_at IS NOT NULL AND superseded_at > now() - interval '7 days')
      )
      AND expires_at > now() - interval '7 days';

    IF NOT FOUND OR v_authority.active_hub_device_id IS NULL THEN
        RETURN jsonb_build_object('state', 'INVALID');
    END IF;

    RETURN jsonb_build_object(
        'state', CASE WHEN v_bundle.is_active AND v_bundle.expires_at > now() THEN 'ACTIVE' ELSE 'RECOVERY' END,
        'hubSigningPublicKeyBase64', v_device.signing_public_key_base64
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.r003_ingest_hub_events(
    p_hub_device_id text,
    p_bundle_id uuid,
    p_events jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_device public.devices%ROWTYPE;
    v_authority public.hub_branch_authority%ROWTYPE;
    v_bundle public.hub_authorization_bundles%ROWTYPE;
    v_session public.hub_staff_sessions%ROWTYPE;
    v_event jsonb;
    v_event_id uuid;
    v_command_id uuid;
    v_staff_id uuid;
    v_session_id uuid;
    v_event_digest bytea;
    v_existing_digest bytea;
    v_existing_event_id uuid;
    v_aggregate_id text;
    v_aggregate_type text;
    v_action text;
    v_sequence bigint;
    v_event_ordinal integer;
    v_occurred_at_text text;
    v_occurred_at timestamptz;
    v_payload jsonb;
    v_now timestamptz := now();
    v_recovery_mode boolean := false;
    v_acknowledged jsonb := '[]'::jsonb;
BEGIN
    IF jsonb_typeof(p_events) <> 'array'
       OR jsonb_array_length(p_events) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'R003_EVENT_BATCH_INVALID';
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'R003_EVENT_HUB_INVALID';
    END IF;

    SELECT * INTO v_authority
    FROM public.hub_branch_authority
    WHERE branch_id = v_device.branch_id
      AND business_id = v_device.business_id
      AND active_hub_device_id = v_device.id
    FOR UPDATE;

    SELECT * INTO v_bundle
    FROM public.hub_authorization_bundles
    WHERE bundle_id = p_bundle_id
      AND hub_device_id = v_device.id
      AND branch_id = v_device.branch_id
      AND revoked_at IS NULL
      AND (
          is_active
          OR (superseded_at IS NOT NULL AND superseded_at > v_now - interval '7 days')
      )
      AND expires_at > v_now - interval '7 days'
    FOR UPDATE;

    IF NOT FOUND OR v_authority.active_hub_device_id IS NULL
       OR v_bundle.revocation_version <> v_authority.revocation_version THEN
        RAISE EXCEPTION 'R003_EVENT_BUNDLE_INVALID';
    END IF;

    v_recovery_mode := NOT v_bundle.is_active OR v_bundle.expires_at <= v_now;

    FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
        IF jsonb_typeof(v_event) <> 'object'
           OR v_event::text ~* '"(pin|password|passwordhash|token|accesstoken|refreshtoken|credential|privatekey)"[[:space:]]*:' THEN
            RAISE EXCEPTION 'R003_EVENT_PAYLOAD_INVALID';
        END IF;

        BEGIN
            v_event_id := (v_event->>'eventId')::uuid;
            v_command_id := (v_event->>'commandId')::uuid;
            v_staff_id := (v_event->>'staffId')::uuid;
            v_session_id := (v_event->>'staffSessionId')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R003_EVENT_IDENTIFIER_INVALID';
        END;

        v_aggregate_id := trim(v_event->>'entityId');
        v_aggregate_type := trim(v_event->>'entityType');
        v_action := trim(v_event->>'action');
        v_occurred_at_text := v_event->>'timestamp';
        v_payload := v_event->'payload';
        IF v_aggregate_id = '' OR length(v_aggregate_id) > 200
           OR v_aggregate_type <> 'order'
           OR v_action NOT IN ('ORDER_PLACED', 'ORDER_STATUS_CHANGED')
           OR v_event->>'businessId' <> v_device.business_id::text
           OR v_event->>'branchId' <> v_device.branch_id::text
           OR v_event->>'deviceId' <> v_device.device_id
           OR jsonb_typeof(v_payload) <> 'object'
           OR octet_length(convert_to(v_payload::text, 'UTF8')) > 65536
           OR coalesce((v_event->>'schemaVersion')::integer, -1) <> 1 THEN
            RAISE EXCEPTION 'R003_EVENT_SCOPE_INVALID';
        END IF;

        BEGIN
            v_sequence := (v_event->>'sequence')::bigint;
            v_event_ordinal := (v_event->>'eventOrdinal')::integer;
            v_occurred_at := v_occurred_at_text::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R003_EVENT_SHAPE_INVALID';
        END;
        IF v_sequence < 0 OR v_event_ordinal NOT BETWEEN 0 AND 99
           OR v_occurred_at_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
           OR private.r003_canonical_utc(v_occurred_at) <> v_occurred_at_text
           OR v_occurred_at < v_now - interval '35 days'
           OR v_occurred_at > v_now + interval '5 minutes'
           OR (v_recovery_mode AND v_occurred_at > v_bundle.expires_at) THEN
            RAISE EXCEPTION 'R003_EVENT_TIMESTAMP_OR_SEQUENCE_INVALID';
        END IF;

        v_event_digest := private.r003_sha256(convert_to(v_event::text, 'UTF8'));
        SELECT content_sha256 INTO v_existing_digest
        FROM public.hub_events
        WHERE event_id = v_event_id
        FOR UPDATE;
        IF FOUND THEN
            IF v_existing_digest <> v_event_digest THEN
                RAISE EXCEPTION 'R003_EVENT_ID_COLLISION';
            END IF;
            v_acknowledged := v_acknowledged || to_jsonb(v_event_id::text);
            CONTINUE;
        END IF;

        SELECT * INTO v_session
        FROM public.hub_staff_sessions
        WHERE session_id = v_session_id
          AND staff_id = v_staff_id
          AND hub_device_id = v_device.id
          AND business_id = v_device.business_id
          AND branch_id = v_device.branch_id
          AND status IN ('ACTIVE', 'REVOKED')
          AND (revoked_at IS NULL OR revoked_at >= v_occurred_at)
          AND expires_at >= v_occurred_at
          AND revocation_version = v_authority.revocation_version;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R003_EVENT_STAFF_SESSION_INVALID';
        END IF;

        SELECT event_id INTO v_existing_event_id
        FROM public.hub_events
        WHERE staff_session_id = v_session_id
          AND sequence = v_sequence
          AND event_ordinal = v_event_ordinal;
        IF FOUND THEN
            RAISE EXCEPTION 'R003_EVENT_SEQUENCE_COLLISION';
        END IF;

        INSERT INTO public.hub_events (
            event_id, command_id, aggregate_id, aggregate_type, action,
            business_id, branch_id, hub_device_id, staff_id, staff_session_id,
            sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
        ) VALUES (
            v_event_id, v_command_id, v_aggregate_id, v_aggregate_type, v_action,
            v_device.business_id, v_device.branch_id, v_device.id, v_staff_id, v_session_id,
            v_sequence, v_event_ordinal, v_occurred_at, 1, v_payload, v_event_digest
        );

        PERFORM private.r003_project_hub_order_event(
            v_event_id, v_command_id, v_device.business_id, v_device.branch_id,
            v_device.device_id, v_staff_id, v_session_id, v_aggregate_id, v_action, v_payload
        );

        INSERT INTO public.audit_logs (
            event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details
        ) VALUES (
            v_event_id::text,
            v_device.business_id,
            v_device.branch_id,
            v_device.device_id,
            v_staff_id::text,
            v_aggregate_id,
            v_action,
            jsonb_build_object('command_id', v_command_id, 'staff_session_id', v_session_id, 'sequence', v_sequence)
        );

        v_acknowledged := v_acknowledged || to_jsonb(v_event_id::text);
    END LOOP;

    UPDATE public.devices
    SET last_seen = now(), updated_at = now()
    WHERE id = v_device.id;

    RETURN jsonb_build_object('acknowledgedEventIds', v_acknowledged);
END;
$function$;

-- =========================================================
-- 5. EXECUTE PRIVILEGE BOUNDARY
-- =========================================================

-- R003 keeps the R001 owner-account bootstrap RPC, but retires every R002
-- device/PIN RPC from browser roles. The native HTTPS functions use only the
-- service role and their own proof/rate-limit boundary.
REVOKE ALL ON FUNCTION public.set_staff_pin(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_staff_security_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_device_pairing_code(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pair_device_with_code(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_device_status(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_device(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_device_bootstrap(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_staff_pin(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_staff_security_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_device_pairing_code(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pair_device_with_code(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_device_status(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_device(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_device_bootstrap(text) TO service_role;

REVOKE ALL ON FUNCTION private.r003_hub_bundle_context(uuid, uuid, text, text, text, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_validate_bundle_envelope(uuid, uuid, uuid, text, text, text, bigint, text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_json_number(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r003_project_hub_order_event(uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.r003_begin_hub_enrollment(text, uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_issue_hub_pairing_code(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_get_hub_enrollment_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_finalize_hub_enrollment(uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_get_hub_renewal_context(text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_finalize_hub_renewal(uuid, text, uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_begin_hub_staff_session(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_get_hub_staff_session_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_verify_hub_staff_pin(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_prepare_hub_staff_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_finalize_hub_staff_session(uuid, uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_get_hub_sync_context(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r003_ingest_hub_events(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r003_begin_hub_enrollment(text, uuid, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_issue_hub_pairing_code(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_get_hub_enrollment_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_finalize_hub_enrollment(uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_get_hub_renewal_context(text, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_finalize_hub_renewal(uuid, text, uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_begin_hub_staff_session(uuid, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_get_hub_staff_session_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_verify_hub_staff_pin(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_prepare_hub_staff_session(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_finalize_hub_staff_session(uuid, uuid, uuid, text, text, text, jsonb, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_get_hub_sync_context(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r003_ingest_hub_events(text, uuid, jsonb) TO service_role;
