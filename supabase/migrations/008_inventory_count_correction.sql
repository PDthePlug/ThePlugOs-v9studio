-- =========================================================
-- R008: LOCAL-FIRST INVENTORY COUNT CORRECTION
-- =========================================================
--
-- Source-only migration. It adds one Manager-recorded physical-count
-- correction to the accepted R007 stock ledger. It is not a supplier, loss,
-- cost, cash, approval, or financial-posting system and must not be applied
-- to a live project without the ordered R001-R007 acceptance evidence.

DO $r008_preflight$
BEGIN
    IF to_regclass('public.inventory_receipts') IS NULL
       OR to_regclass('public.inventory_movements') IS NULL
       OR to_regclass('public.hub_events') IS NULL
       OR to_regprocedure('public.r007_ingest_hub_inventory_events(text,uuid,jsonb)') IS NULL
       OR to_regprocedure('private.r007_validate_hub_event_inventory_receipt_authority()') IS NULL THEN
        RAISE EXCEPTION 'R008_REQUIRES_ACCEPTED_R007';
    END IF;
END;
$r008_preflight$;

ALTER TABLE public.hub_events
    DROP CONSTRAINT IF EXISTS hub_events_aggregate_type_check;
ALTER TABLE public.hub_events
    ADD CONSTRAINT hub_events_aggregate_type_check
    CHECK (aggregate_type IN ('order', 'shift', 'payment', 'inventory_receipt', 'inventory_adjustment'));

ALTER TABLE public.hub_events
    DROP CONSTRAINT IF EXISTS hub_events_action_check;
ALTER TABLE public.hub_events
    ADD CONSTRAINT hub_events_action_check
    CHECK (action IN (
        'ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'SHIFT_OPENED',
        'PAYMENT_CAPTURED', 'SHIFT_CLOSED', 'INVENTORY_RECEIVED',
        'INVENTORY_ADJUSTED'
    ));

-- A count correction records an observed final quantity. It intentionally
-- does not assign blame, value stock, receive supplier goods, or settle money.
CREATE TABLE public.inventory_adjustments (
    adjustment_id uuid PRIMARY KEY,
    event_id uuid NOT NULL UNIQUE REFERENCES public.hub_events(event_id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    adjusted_by_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    adjusted_by_session_id uuid NOT NULL REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status = 'ADJUSTED'),
    reason text NOT NULL CHECK (reason = 'COUNT_CORRECTION'),
    adjusted_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_adjustments_business_branch_adjusted
    ON public.inventory_adjustments (business_id, branch_id, adjusted_at DESC);
CREATE INDEX inventory_adjustments_adjusted_by_staff
    ON public.inventory_adjustments (adjusted_by_staff_id, adjusted_at DESC);

CREATE TABLE public.inventory_adjustment_lines (
    adjustment_id uuid NOT NULL REFERENCES public.inventory_adjustments(adjustment_id) ON DELETE RESTRICT,
    product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0 AND quantity_delta = round(quantity_delta, 3)),
    balance_before numeric(14,3) NOT NULL CHECK (balance_before >= 0 AND balance_before = round(balance_before, 3)),
    balance_after numeric(14,3) NOT NULL CHECK (balance_after >= 0 AND balance_after = round(balance_after, 3)),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (adjustment_id, product_id),
    FOREIGN KEY (branch_id, product_id)
        REFERENCES public.inventory_branch_balances(branch_id, product_id)
        ON DELETE RESTRICT,
    CHECK (balance_after = balance_before + quantity_delta)
);

CREATE INDEX inventory_adjustment_lines_business_branch_product
    ON public.inventory_adjustment_lines (business_id, branch_id, product_id, adjustment_id);
CREATE INDEX inventory_adjustment_lines_product
    ON public.inventory_adjustment_lines (product_id, created_at DESC);

ALTER TABLE public.inventory_movements
    ADD COLUMN adjustment_id uuid REFERENCES public.inventory_adjustments(adjustment_id) ON DELETE RESTRICT;

CREATE INDEX inventory_movements_adjustment
    ON public.inventory_movements (adjustment_id, occurred_at ASC)
    WHERE adjustment_id IS NOT NULL;

ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN (
        'ORDER_RESERVATION', 'ORDER_CANCELLATION_RELEASE', 'MANAGER_RECEIPT',
        'MANAGER_COUNT_CORRECTION'
    ));
ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_quantity_delta_direction_check;
ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_quantity_delta_direction_check
    CHECK (
        (movement_type = 'ORDER_RESERVATION' AND quantity_delta < 0)
        OR (movement_type IN ('ORDER_CANCELLATION_RELEASE', 'MANAGER_RECEIPT') AND quantity_delta > 0)
        OR (movement_type = 'MANAGER_COUNT_CORRECTION' AND quantity_delta <> 0)
    );
ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_origin_check;
ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_origin_check CHECK (
        (
            movement_type IN ('ORDER_RESERVATION', 'ORDER_CANCELLATION_RELEASE')
            AND order_id IS NOT NULL
            AND receipt_id IS NULL
            AND adjustment_id IS NULL
        )
        OR
        (
            movement_type = 'MANAGER_RECEIPT'
            AND order_id IS NULL
            AND receipt_id IS NOT NULL
            AND adjustment_id IS NULL
        )
        OR
        (
            movement_type = 'MANAGER_COUNT_CORRECTION'
            AND order_id IS NULL
            AND receipt_id IS NULL
            AND adjustment_id IS NOT NULL
        )
    );

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustment_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_adjustments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_adjustment_lines FROM PUBLIC, anon, authenticated;

-- A direct service path cannot elevate an arbitrary staff session to a stock
-- correction. Authority is checked independently before every ledger event.
CREATE OR REPLACE FUNCTION private.r008_validate_hub_event_inventory_adjustment_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
BEGIN
    IF NEW.action <> 'INVENTORY_ADJUSTED' THEN
        RETURN NEW;
    END IF;

    SELECT session.role INTO v_role
    FROM public.hub_staff_sessions session
    WHERE session.session_id = NEW.staff_session_id
      AND session.staff_id = NEW.staff_id
      AND session.business_id = NEW.business_id
      AND session.branch_id = NEW.branch_id
      AND session.hub_device_id = NEW.hub_device_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R008_EVENT_SESSION_SCOPE_INVALID';
    END IF;
    IF NEW.aggregate_type <> 'inventory_adjustment' OR v_role <> 'MANAGER' THEN
        RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_ROLE_OR_SCOPE_FORBIDDEN';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r008_hub_events_inventory_adjustment_authority ON public.hub_events;
CREATE TRIGGER r008_hub_events_inventory_adjustment_authority
    BEFORE INSERT ON public.hub_events
    FOR EACH ROW
    EXECUTE FUNCTION private.r008_validate_hub_event_inventory_adjustment_authority();

CREATE OR REPLACE FUNCTION private.r008_project_inventory_adjustment_event(
    p_event_id uuid,
    p_business_id uuid,
    p_branch_id uuid,
    p_hub_device_id uuid,
    p_staff_id uuid,
    p_staff_session_id uuid,
    p_aggregate_id text,
    p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_adjustment_id uuid;
    v_occurred_at timestamptz;
    v_item jsonb;
    v_product_id uuid;
    v_seen_product_ids uuid[] := ARRAY[]::uuid[];
    v_product public.catalog_products%ROWTYPE;
    v_balance public.inventory_branch_balances%ROWTYPE;
    v_quantity_delta numeric;
    v_stock_before numeric;
    v_stock_after numeric;
    v_line_count integer := 0;
BEGIN
    IF (p_payload - ARRAY['id', 'adjustmentId', 'status', 'reason', 'items']) <> '{}'::jsonb
       OR p_payload->>'id' <> p_aggregate_id
       OR p_payload->>'adjustmentId' <> p_aggregate_id
       OR p_payload->>'status' <> 'ADJUSTED'
       OR p_payload->>'reason' <> 'COUNT_CORRECTION'
       OR jsonb_typeof(p_payload->'items') <> 'array'
       OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_PAYLOAD_INVALID';
    END IF;
    BEGIN
        v_adjustment_id := p_aggregate_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_ID_INVALID';
    END;

    SELECT occurred_at INTO v_occurred_at
    FROM public.hub_events
    WHERE event_id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_EVENT_MISSING';
    END IF;

    INSERT INTO public.inventory_adjustments (
        adjustment_id, event_id, business_id, branch_id, hub_device_id,
        adjusted_by_staff_id, adjusted_by_session_id, status, reason, adjusted_at
    ) VALUES (
        v_adjustment_id, p_event_id, p_business_id, p_branch_id, p_hub_device_id,
        p_staff_id, p_staff_session_id, 'ADJUSTED', 'COUNT_CORRECTION', v_occurred_at
    );

    -- Product locks follow one deterministic order so two count-correction
    -- events cannot acquire the same branch balances in opposite directions.
    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_payload->'items')
        ORDER BY value->>'productId'
    LOOP
        IF jsonb_typeof(v_item) <> 'object'
           OR (v_item - ARRAY['productId', 'stockBefore', 'stockAfter', 'quantityDelta']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_LINE_INVALID';
        END IF;
        BEGIN
            v_product_id := (v_item->>'productId')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_PRODUCT_ID_INVALID';
        END;
        IF v_product_id = ANY(v_seen_product_ids) THEN
            RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_DUPLICATE_PRODUCT';
        END IF;
        v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);

        v_quantity_delta := private.r003_json_number(v_item, 'quantityDelta');
        v_stock_before := private.r003_json_number(v_item, 'stockBefore');
        v_stock_after := private.r003_json_number(v_item, 'stockAfter');
        IF v_quantity_delta = 0
           OR abs(v_quantity_delta) > 99999999999.999
           OR v_quantity_delta <> round(v_quantity_delta, 3)
           OR v_stock_before < 0
           OR v_stock_after < 0
           OR v_stock_before > 99999999999.999
           OR v_stock_after > 99999999999.999
           OR v_stock_before <> round(v_stock_before, 3)
           OR v_stock_after <> round(v_stock_after, 3)
           OR v_stock_after <> v_stock_before + v_quantity_delta THEN
            RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_STOCK_FACTS_INVALID';
        END IF;

        SELECT * INTO v_product
        FROM public.catalog_products product
        WHERE product.id = v_product_id
          AND product.business_id = p_business_id
          AND (product.branch_id IS NULL OR product.branch_id = p_branch_id)
          AND product.status = 'ACTIVE'
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_CATALOG_INVALID';
        END IF;

        SELECT * INTO v_balance
        FROM public.inventory_branch_balances balance
        WHERE balance.branch_id = p_branch_id
          AND balance.business_id = p_business_id
          AND balance.product_id = v_product.id
        FOR UPDATE;
        IF NOT FOUND
           OR v_balance.quantity < 0
           OR v_balance.quantity <> v_stock_before THEN
            RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_STOCK_BALANCE_MISMATCH';
        END IF;

        UPDATE public.inventory_branch_balances
        SET quantity = v_stock_after,
            updated_at = now()
        WHERE branch_id = v_balance.branch_id
          AND product_id = v_balance.product_id;

        INSERT INTO public.inventory_adjustment_lines (
            adjustment_id, product_id, business_id, branch_id, quantity_delta,
            balance_before, balance_after
        ) VALUES (
            v_adjustment_id, v_product.id, p_business_id, p_branch_id, v_quantity_delta,
            v_stock_before, v_stock_after
        );

        INSERT INTO public.inventory_movements (
            event_id, business_id, branch_id, product_id, order_id, receipt_id, adjustment_id,
            staff_id, staff_session_id, movement_type, quantity_delta,
            balance_before, balance_after, occurred_at
        ) VALUES (
            p_event_id, p_business_id, p_branch_id, v_product.id, NULL, NULL, v_adjustment_id,
            p_staff_id, p_staff_session_id, 'MANAGER_COUNT_CORRECTION', v_quantity_delta,
            v_stock_before, v_stock_after, v_occurred_at
        );
        v_line_count := v_line_count + 1;
    END LOOP;

    IF v_line_count = 0 THEN
        RAISE EXCEPTION 'R008_INVENTORY_ADJUSTMENT_LINES_MISSING';
    END IF;
END;
$function$;

-- The HTTP endpoint verifies the outer Hub signature before calling this
-- receiver. It still repeats server-side bundle, session, scope, timestamp,
-- idempotency, role, and payload checks before any count-correction fact
-- persists.
CREATE OR REPLACE FUNCTION public.r008_ingest_hub_inventory_adjustment_events(
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
        RAISE EXCEPTION 'R008_EVENT_BATCH_INVALID';
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R008_EVENT_HUB_INVALID';
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
      AND (is_active OR (superseded_at IS NOT NULL AND superseded_at > v_now - interval '7 days'))
      AND expires_at > v_now - interval '7 days'
    FOR UPDATE;
    IF NOT FOUND OR v_authority.active_hub_device_id IS NULL
       OR v_bundle.revocation_version <> v_authority.revocation_version THEN
        RAISE EXCEPTION 'R008_EVENT_BUNDLE_INVALID';
    END IF;
    v_recovery_mode := NOT v_bundle.is_active OR v_bundle.expires_at <= v_now;

    FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
        IF jsonb_typeof(v_event) <> 'object'
           OR v_event::text ~* '"(pin|password|passwordhash|token|accesstoken|refreshtoken|credential|privatekey)"[[:space:]]*:' THEN
            RAISE EXCEPTION 'R008_EVENT_PAYLOAD_INVALID';
        END IF;
        BEGIN
            v_event_id := (v_event->>'eventId')::uuid;
            v_command_id := (v_event->>'commandId')::uuid;
            v_staff_id := (v_event->>'staffId')::uuid;
            v_session_id := (v_event->>'staffSessionId')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R008_EVENT_IDENTIFIER_INVALID';
        END;
        v_aggregate_id := trim(v_event->>'entityId');
        v_aggregate_type := trim(v_event->>'entityType');
        v_action := trim(v_event->>'action');
        v_occurred_at_text := v_event->>'timestamp';
        v_payload := v_event->'payload';
        IF v_aggregate_id = '' OR length(v_aggregate_id) > 200
           OR v_aggregate_type <> 'inventory_adjustment'
           OR v_action <> 'INVENTORY_ADJUSTED'
           OR v_event->>'businessId' <> v_device.business_id::text
           OR v_event->>'branchId' <> v_device.branch_id::text
           OR v_event->>'deviceId' <> v_device.device_id
           OR jsonb_typeof(v_payload) <> 'object'
           OR octet_length(convert_to(v_payload::text, 'UTF8')) > 65536
           OR coalesce((v_event->>'schemaVersion')::integer, -1) <> 1 THEN
            RAISE EXCEPTION 'R008_EVENT_SCOPE_INVALID';
        END IF;
        BEGIN
            v_sequence := (v_event->>'sequence')::bigint;
            v_event_ordinal := (v_event->>'eventOrdinal')::integer;
            v_occurred_at := v_occurred_at_text::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R008_EVENT_SHAPE_INVALID';
        END;
        IF v_sequence < 0 OR v_event_ordinal NOT BETWEEN 0 AND 99
           OR v_occurred_at_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
           OR private.r003_canonical_utc(v_occurred_at) <> v_occurred_at_text
           OR v_occurred_at < v_now - interval '35 days'
           OR v_occurred_at > v_now + interval '5 minutes'
           OR (v_recovery_mode AND v_occurred_at > v_bundle.expires_at) THEN
            RAISE EXCEPTION 'R008_EVENT_TIMESTAMP_OR_SEQUENCE_INVALID';
        END IF;

        v_event_digest := private.r003_sha256(convert_to(v_event::text, 'UTF8'));
        SELECT content_sha256 INTO v_existing_digest
        FROM public.hub_events
        WHERE event_id = v_event_id
        FOR UPDATE;
        IF FOUND THEN
            IF v_existing_digest <> v_event_digest THEN
                RAISE EXCEPTION 'R008_EVENT_ID_COLLISION';
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
            RAISE EXCEPTION 'R008_EVENT_STAFF_SESSION_INVALID';
        END IF;
        SELECT event_id INTO v_existing_event_id
        FROM public.hub_events
        WHERE staff_session_id = v_session_id
          AND sequence = v_sequence
          AND event_ordinal = v_event_ordinal;
        IF FOUND THEN
            RAISE EXCEPTION 'R008_EVENT_SEQUENCE_COLLISION';
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
        PERFORM private.r008_project_inventory_adjustment_event(
            v_event_id, v_device.business_id, v_device.branch_id, v_device.id,
            v_staff_id, v_session_id, v_aggregate_id, v_payload
        );
        INSERT INTO public.audit_logs (
            event_id, business_id, branch_id, device_id, actor_id, entity_id, event_type, details
        ) VALUES (
            v_event_id::text, v_device.business_id, v_device.branch_id, v_device.device_id,
            v_staff_id::text, v_aggregate_id, v_action,
            jsonb_build_object('command_id', v_command_id, 'staff_session_id', v_session_id, 'sequence', v_sequence)
        );
        v_acknowledged := v_acknowledged || to_jsonb(v_event_id::text);
    END LOOP;

    UPDATE public.devices SET last_seen = now(), updated_at = now() WHERE id = v_device.id;
    RETURN jsonb_build_object('acknowledgedEventIds', v_acknowledged);
END;
$function$;

REVOKE ALL ON FUNCTION private.r008_validate_hub_event_inventory_adjustment_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r008_project_inventory_adjustment_event(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r008_ingest_hub_inventory_adjustment_events(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r008_ingest_hub_inventory_adjustment_events(text, uuid, jsonb) TO service_role;
