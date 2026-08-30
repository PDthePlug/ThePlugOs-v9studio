-- =========================================================
-- R007: LOCAL-FIRST INVENTORY RECEIPT
-- =========================================================
--
-- Source-only migration. It adds one Manager-held, counted stock-receipt
-- event to the accepted R003 inventory ledger. It must not be applied to a
-- live project until the ordered R001-R006 staging gates have evidence.

DO $r007_preflight$
BEGIN
    IF to_regclass('public.inventory_branch_balances') IS NULL
       OR to_regclass('public.inventory_movements') IS NULL
       OR to_regclass('public.hub_events') IS NULL
       OR to_regprocedure('public.r006_ingest_hub_shift_close_events(text,uuid,jsonb)') IS NULL
       OR to_regprocedure('private.r006_validate_hub_event_shift_close_authority()') IS NULL THEN
        RAISE EXCEPTION 'R007_REQUIRES_ACCEPTED_R006';
    END IF;
END;
$r007_preflight$;

ALTER TABLE public.hub_events
    DROP CONSTRAINT IF EXISTS hub_events_aggregate_type_check;
ALTER TABLE public.hub_events
    ADD CONSTRAINT hub_events_aggregate_type_check
    CHECK (aggregate_type IN ('order', 'shift', 'payment', 'inventory_receipt'));

ALTER TABLE public.hub_events
    DROP CONSTRAINT IF EXISTS hub_events_action_check;
ALTER TABLE public.hub_events
    ADD CONSTRAINT hub_events_action_check
    CHECK (action IN (
        'ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'SHIFT_OPENED',
        'PAYMENT_CAPTURED', 'SHIFT_CLOSED', 'INVENTORY_RECEIVED'
    ));

-- An inventory receipt is a physical-count fact. It is intentionally not a
-- supplier invoice, purchase-order, cost, or accounts-payable record.
CREATE TABLE public.inventory_receipts (
    receipt_id uuid PRIMARY KEY,
    event_id uuid NOT NULL UNIQUE REFERENCES public.hub_events(event_id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    received_by_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    received_by_session_id uuid NOT NULL REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status = 'RECEIVED'),
    received_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_receipts_business_branch_received
    ON public.inventory_receipts (business_id, branch_id, received_at DESC);
CREATE INDEX inventory_receipts_received_by_staff
    ON public.inventory_receipts (received_by_staff_id, received_at DESC);

CREATE TABLE public.inventory_receipt_lines (
    receipt_id uuid NOT NULL REFERENCES public.inventory_receipts(receipt_id) ON DELETE RESTRICT,
    product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    quantity numeric(14,3) NOT NULL CHECK (quantity > 0 AND quantity = round(quantity, 3)),
    balance_before numeric(14,3) NOT NULL CHECK (balance_before >= 0 AND balance_before = round(balance_before, 3)),
    balance_after numeric(14,3) NOT NULL CHECK (balance_after >= 0 AND balance_after = round(balance_after, 3)),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (receipt_id, product_id),
    FOREIGN KEY (branch_id, product_id)
        REFERENCES public.inventory_branch_balances(branch_id, product_id)
        ON DELETE RESTRICT,
    CHECK (balance_after = balance_before + quantity)
);

CREATE INDEX inventory_receipt_lines_business_branch_product
    ON public.inventory_receipt_lines (business_id, branch_id, product_id, receipt_id);
CREATE INDEX inventory_receipt_lines_product
    ON public.inventory_receipt_lines (product_id, created_at DESC);

-- R003's original movement table represents order reservations/releases. A
-- receipt extends that one immutable branch ledger instead of maintaining a
-- second, divergent stock total.
ALTER TABLE public.inventory_movements
    ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.inventory_movements
    ADD COLUMN receipt_id uuid REFERENCES public.inventory_receipts(receipt_id) ON DELETE RESTRICT;

CREATE INDEX inventory_movements_receipt
    ON public.inventory_movements (receipt_id, occurred_at ASC)
    WHERE receipt_id IS NOT NULL;

DO $r007_replace_inventory_movement_checks$
DECLARE
    v_constraint record;
    v_replaced_count integer := 0;
BEGIN
    -- R003 creates two anonymous checks: one limits the movement type and
    -- another limits the allowed direction. Both must be replaced together;
    -- retaining the latter would reject a positive MANAGER_RECEIPT movement.
    FOR v_constraint IN
        SELECT constraint_row.conname
        FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'public.inventory_movements'::regclass
          AND constraint_row.contype = 'c'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%ORDER_RESERVATION%'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%ORDER_CANCELLATION_RELEASE%'
    LOOP
        EXECUTE format('ALTER TABLE public.inventory_movements DROP CONSTRAINT %I', v_constraint.conname);
        v_replaced_count := v_replaced_count + 1;
    END LOOP;
    IF v_replaced_count <> 2 THEN
        RAISE EXCEPTION 'R007_INVENTORY_MOVEMENT_TYPE_CHECK_MISSING';
    END IF;
END;
$r007_replace_inventory_movement_checks$;

ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN ('ORDER_RESERVATION', 'ORDER_CANCELLATION_RELEASE', 'MANAGER_RECEIPT'));
ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_quantity_delta_direction_check
    CHECK (
        (movement_type = 'ORDER_RESERVATION' AND quantity_delta < 0)
        OR (movement_type IN ('ORDER_CANCELLATION_RELEASE', 'MANAGER_RECEIPT') AND quantity_delta > 0)
    );
ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_origin_check;
ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_origin_check CHECK (
        (
            movement_type IN ('ORDER_RESERVATION', 'ORDER_CANCELLATION_RELEASE')
            AND order_id IS NOT NULL
            AND receipt_id IS NULL
        )
        OR
        (
            movement_type = 'MANAGER_RECEIPT'
            AND order_id IS NULL
            AND receipt_id IS NOT NULL
        )
    );

ALTER TABLE public.inventory_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipt_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_receipt_lines FROM PUBLIC, anon, authenticated;

-- A direct service path still cannot treat its own claimed role as receipt
-- authority. This independent gate runs before every event insert.
CREATE OR REPLACE FUNCTION private.r007_validate_hub_event_inventory_receipt_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
BEGIN
    IF NEW.action <> 'INVENTORY_RECEIVED' THEN
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
        RAISE EXCEPTION 'R007_EVENT_SESSION_SCOPE_INVALID';
    END IF;
    IF NEW.aggregate_type <> 'inventory_receipt' OR v_role <> 'MANAGER' THEN
        RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_ROLE_OR_SCOPE_FORBIDDEN';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r007_hub_events_inventory_receipt_authority ON public.hub_events;
CREATE TRIGGER r007_hub_events_inventory_receipt_authority
    BEFORE INSERT ON public.hub_events
    FOR EACH ROW
    EXECUTE FUNCTION private.r007_validate_hub_event_inventory_receipt_authority();

CREATE OR REPLACE FUNCTION private.r007_project_inventory_receipt_event(
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
    v_receipt_id uuid;
    v_occurred_at timestamptz;
    v_item jsonb;
    v_product_id uuid;
    v_seen_product_ids uuid[] := ARRAY[]::uuid[];
    v_product public.catalog_products%ROWTYPE;
    v_balance public.inventory_branch_balances%ROWTYPE;
    v_quantity numeric;
    v_stock_before numeric;
    v_stock_after numeric;
    v_line_count integer := 0;
BEGIN
    IF (p_payload - ARRAY['id', 'receiptId', 'status', 'items']) <> '{}'::jsonb
       OR p_payload->>'id' <> p_aggregate_id
       OR p_payload->>'receiptId' <> p_aggregate_id
       OR p_payload->>'status' <> 'RECEIVED'
       OR jsonb_typeof(p_payload->'items') <> 'array'
       OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_PAYLOAD_INVALID';
    END IF;
    BEGIN
        v_receipt_id := p_aggregate_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_ID_INVALID';
    END;

    SELECT occurred_at INTO v_occurred_at
    FROM public.hub_events
    WHERE event_id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_EVENT_MISSING';
    END IF;

    INSERT INTO public.inventory_receipts (
        receipt_id, event_id, business_id, branch_id, hub_device_id,
        received_by_staff_id, received_by_session_id, status, received_at
    ) VALUES (
        v_receipt_id, p_event_id, p_business_id, p_branch_id, p_hub_device_id,
        p_staff_id, p_staff_session_id, 'RECEIVED', v_occurred_at
    );

    -- Product IDs are processed in one deterministic order. This keeps
    -- receipt lock acquisition consistent even if a future topology admits
    -- separately submitted receipts for the same branch.
    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_payload->'items')
        ORDER BY value->>'productId'
    LOOP
        IF jsonb_typeof(v_item) <> 'object'
           OR (v_item - ARRAY['productId', 'quantity', 'stockBefore', 'stockAfter']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_LINE_INVALID';
        END IF;
        BEGIN
            v_product_id := (v_item->>'productId')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_PRODUCT_ID_INVALID';
        END;
        IF v_product_id = ANY(v_seen_product_ids) THEN
            RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_DUPLICATE_PRODUCT';
        END IF;
        v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);

        v_quantity := private.r003_json_number(v_item, 'quantity');
        v_stock_before := private.r003_json_number(v_item, 'stockBefore');
        v_stock_after := private.r003_json_number(v_item, 'stockAfter');
        IF v_quantity <= 0
           OR v_quantity > 99999999999.999
           OR v_quantity <> round(v_quantity, 3)
           OR v_stock_before < 0
           OR v_stock_after < 0
           OR v_stock_before > 99999999999.999
           OR v_stock_after > 99999999999.999
           OR v_stock_before <> round(v_stock_before, 3)
           OR v_stock_after <> round(v_stock_after, 3)
           OR v_stock_after <> v_stock_before + v_quantity THEN
            RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_STOCK_FACTS_INVALID';
        END IF;

        SELECT * INTO v_product
        FROM public.catalog_products product
        WHERE product.id = v_product_id
          AND product.business_id = p_business_id
          AND (product.branch_id IS NULL OR product.branch_id = p_branch_id)
          AND product.status = 'ACTIVE'
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_CATALOG_INVALID';
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
            RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_STOCK_BALANCE_MISMATCH';
        END IF;

        UPDATE public.inventory_branch_balances
        SET quantity = v_stock_after,
            updated_at = now()
        WHERE branch_id = v_balance.branch_id
          AND product_id = v_balance.product_id;

        INSERT INTO public.inventory_receipt_lines (
            receipt_id, product_id, business_id, branch_id, quantity,
            balance_before, balance_after
        ) VALUES (
            v_receipt_id, v_product.id, p_business_id, p_branch_id, v_quantity,
            v_stock_before, v_stock_after
        );

        INSERT INTO public.inventory_movements (
            event_id, business_id, branch_id, product_id, order_id, receipt_id,
            staff_id, staff_session_id, movement_type, quantity_delta,
            balance_before, balance_after, occurred_at
        ) VALUES (
            p_event_id, p_business_id, p_branch_id, v_product.id, NULL, v_receipt_id,
            p_staff_id, p_staff_session_id, 'MANAGER_RECEIPT', v_quantity,
            v_stock_before, v_stock_after, v_occurred_at
        );
        v_line_count := v_line_count + 1;
    END LOOP;

    IF v_line_count = 0 THEN
        RAISE EXCEPTION 'R007_INVENTORY_RECEIPT_LINES_MISSING';
    END IF;
END;
$function$;

-- The HTTP endpoint verifies the outer Hub signature before calling this
-- receiver. It still repeats server-side bundle, session, scope, timestamp,
-- idempotency, role, and payload checks before any inventory fact persists.
CREATE OR REPLACE FUNCTION public.r007_ingest_hub_inventory_events(
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
        RAISE EXCEPTION 'R007_EVENT_BATCH_INVALID';
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R007_EVENT_HUB_INVALID';
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
        RAISE EXCEPTION 'R007_EVENT_BUNDLE_INVALID';
    END IF;
    v_recovery_mode := NOT v_bundle.is_active OR v_bundle.expires_at <= v_now;

    FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
        IF jsonb_typeof(v_event) <> 'object'
           OR v_event::text ~* '"(pin|password|passwordhash|token|accesstoken|refreshtoken|credential|privatekey)"[[:space:]]*:' THEN
            RAISE EXCEPTION 'R007_EVENT_PAYLOAD_INVALID';
        END IF;
        BEGIN
            v_event_id := (v_event->>'eventId')::uuid;
            v_command_id := (v_event->>'commandId')::uuid;
            v_staff_id := (v_event->>'staffId')::uuid;
            v_session_id := (v_event->>'staffSessionId')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R007_EVENT_IDENTIFIER_INVALID';
        END;
        v_aggregate_id := trim(v_event->>'entityId');
        v_aggregate_type := trim(v_event->>'entityType');
        v_action := trim(v_event->>'action');
        v_occurred_at_text := v_event->>'timestamp';
        v_payload := v_event->'payload';
        IF v_aggregate_id = '' OR length(v_aggregate_id) > 200
           OR v_aggregate_type <> 'inventory_receipt'
           OR v_action <> 'INVENTORY_RECEIVED'
           OR v_event->>'businessId' <> v_device.business_id::text
           OR v_event->>'branchId' <> v_device.branch_id::text
           OR v_event->>'deviceId' <> v_device.device_id
           OR jsonb_typeof(v_payload) <> 'object'
           OR octet_length(convert_to(v_payload::text, 'UTF8')) > 65536
           OR coalesce((v_event->>'schemaVersion')::integer, -1) <> 1 THEN
            RAISE EXCEPTION 'R007_EVENT_SCOPE_INVALID';
        END IF;
        BEGIN
            v_sequence := (v_event->>'sequence')::bigint;
            v_event_ordinal := (v_event->>'eventOrdinal')::integer;
            v_occurred_at := v_occurred_at_text::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R007_EVENT_SHAPE_INVALID';
        END;
        IF v_sequence < 0 OR v_event_ordinal NOT BETWEEN 0 AND 99
           OR v_occurred_at_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
           OR private.r003_canonical_utc(v_occurred_at) <> v_occurred_at_text
           OR v_occurred_at < v_now - interval '35 days'
           OR v_occurred_at > v_now + interval '5 minutes'
           OR (v_recovery_mode AND v_occurred_at > v_bundle.expires_at) THEN
            RAISE EXCEPTION 'R007_EVENT_TIMESTAMP_OR_SEQUENCE_INVALID';
        END IF;

        v_event_digest := private.r003_sha256(convert_to(v_event::text, 'UTF8'));
        SELECT content_sha256 INTO v_existing_digest
        FROM public.hub_events
        WHERE event_id = v_event_id
        FOR UPDATE;
        IF FOUND THEN
            IF v_existing_digest <> v_event_digest THEN
                RAISE EXCEPTION 'R007_EVENT_ID_COLLISION';
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
            RAISE EXCEPTION 'R007_EVENT_STAFF_SESSION_INVALID';
        END IF;
        SELECT event_id INTO v_existing_event_id
        FROM public.hub_events
        WHERE staff_session_id = v_session_id
          AND sequence = v_sequence
          AND event_ordinal = v_event_ordinal;
        IF FOUND THEN
            RAISE EXCEPTION 'R007_EVENT_SEQUENCE_COLLISION';
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
        PERFORM private.r007_project_inventory_receipt_event(
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

REVOKE ALL ON FUNCTION private.r007_validate_hub_event_inventory_receipt_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r007_project_inventory_receipt_event(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r007_ingest_hub_inventory_events(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r007_ingest_hub_inventory_events(text, uuid, jsonb) TO service_role;
