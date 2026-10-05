-- =========================================================
-- R006: LOCAL-FIRST CASH SHIFT CLOSE
-- =========================================================
--
-- Source-only migration. It extends the accepted R005 cash-custody ledger
-- with one Manager-recorded physical count. No deployment or live mutation is
-- performed merely by adding this source file.

DO $r006_preflight$
BEGIN
    IF to_regclass('public.cash_shifts') IS NULL
       OR to_regclass('public.hub_payments') IS NULL
       OR to_regclass('public.hub_events') IS NULL
       OR to_regprocedure('public.r005_ingest_hub_financial_events(text,uuid,jsonb)') IS NULL
       OR to_regprocedure('private.r005_validate_hub_event_cash_authority()') IS NULL THEN
        RAISE EXCEPTION 'R006_REQUIRES_ACCEPTED_R005';
    END IF;
END;
$r006_preflight$;

ALTER TABLE public.hub_events
    DROP CONSTRAINT IF EXISTS hub_events_action_check;
ALTER TABLE public.hub_events
    ADD CONSTRAINT hub_events_action_check
    CHECK (action IN (
        'ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'SHIFT_OPENED',
        'PAYMENT_CAPTURED', 'SHIFT_CLOSED'
    ));

ALTER TABLE public.cash_shifts
    DROP CONSTRAINT IF EXISTS cash_shifts_status_check;
ALTER TABLE public.cash_shifts
    ADD CONSTRAINT cash_shifts_status_check
    CHECK (status IN ('OPEN', 'CLOSED'));

ALTER TABLE public.cash_shifts
    ADD COLUMN IF NOT EXISTS closing_event_id uuid REFERENCES public.hub_events(event_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS closed_by_staff_id uuid REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS closed_by_session_id uuid REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS counted_cash numeric(14,2),
    ADD COLUMN IF NOT EXISTS cash_variance numeric(14,2),
    ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_closing_event_unique
    ON public.cash_shifts (closing_event_id)
    WHERE closing_event_id IS NOT NULL;

ALTER TABLE public.cash_shifts
    DROP CONSTRAINT IF EXISTS cash_shifts_close_facts_check;
ALTER TABLE public.cash_shifts
    ADD CONSTRAINT cash_shifts_close_facts_check CHECK (
        (
            status = 'OPEN'
            AND closing_event_id IS NULL
            AND closed_by_staff_id IS NULL
            AND closed_by_session_id IS NULL
            AND counted_cash IS NULL
            AND cash_variance IS NULL
            AND closed_at IS NULL
        )
        OR
        (
            status = 'CLOSED'
            AND closing_event_id IS NOT NULL
            AND closed_by_staff_id IS NOT NULL
            AND closed_by_session_id IS NOT NULL
            AND counted_cash IS NOT NULL
            AND counted_cash >= 0
            AND cash_variance IS NOT NULL
            AND cash_variance = counted_cash - expected_cash
            AND closed_at IS NOT NULL
        )
    );

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS cash_shift_id uuid REFERENCES public.cash_shifts(shift_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS orders_cash_shift_pending
    ON public.orders (cash_shift_id, payment_status, status)
    WHERE cash_shift_id IS NOT NULL;

-- R003 projects a Hub order after its immutable placement event has entered
-- the ledger. Bind only that projection to the one verified open shift; a
-- generic browser-created order is deliberately not assigned a cash drawer.
CREATE OR REPLACE FUNCTION private.r006_bind_hub_order_to_active_cash_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_shift_id uuid;
BEGIN
    SELECT shift_row.shift_id INTO v_shift_id
    FROM public.hub_events event_row
    JOIN public.cash_shifts shift_row
      ON shift_row.business_id = event_row.business_id
     AND shift_row.branch_id = event_row.branch_id
     AND shift_row.hub_device_id = event_row.hub_device_id
     AND shift_row.status = 'OPEN'
    WHERE event_row.aggregate_type = 'order'
      AND event_row.action = 'ORDER_PLACED'
      AND event_row.aggregate_id = NEW.id::text
      AND event_row.business_id = NEW.business_id
      AND event_row.branch_id = NEW.branch_id
    ORDER BY event_row.occurred_at DESC
    LIMIT 1;

    IF FOUND THEN
        NEW.cash_shift_id := v_shift_id;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r006_orders_bind_hub_cash_shift ON public.orders;
CREATE TRIGGER r006_orders_bind_hub_cash_shift
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION private.r006_bind_hub_order_to_active_cash_shift();

CREATE OR REPLACE FUNCTION private.r006_json_signed_money(
    p_payload jsonb,
    p_field text
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $function$
DECLARE
    v_value numeric;
BEGIN
    v_value := private.r003_json_number(p_payload, p_field);
    IF v_value <> round(v_value, 2)
       OR v_value < -999999999999.99
       OR v_value > 999999999999.99 THEN
        RAISE EXCEPTION 'R006_EVENT_SIGNED_MONEY_INVALID: %', p_field;
    END IF;
    RETURN v_value;
END;
$function$;

-- An independent before-insert authority gate ensures a direct service path
-- cannot turn any authenticated session into a drawer-close authority.
CREATE OR REPLACE FUNCTION private.r006_validate_hub_event_shift_close_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_shift_id uuid;
    v_shift public.cash_shifts%ROWTYPE;
    v_hub_device_id text;
BEGIN
    IF NEW.action <> 'SHIFT_CLOSED' THEN
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
        RAISE EXCEPTION 'R006_EVENT_SESSION_SCOPE_INVALID';
    END IF;
    IF NEW.aggregate_type <> 'shift' OR v_role <> 'MANAGER' THEN
        RAISE EXCEPTION 'R006_SHIFT_CLOSE_ROLE_OR_SCOPE_FORBIDDEN';
    END IF;
    BEGIN
        v_shift_id := NEW.aggregate_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R006_SHIFT_CLOSE_ID_INVALID';
    END;
    SELECT * INTO v_shift
    FROM public.cash_shifts shift_row
    WHERE shift_row.shift_id = v_shift_id
      AND shift_row.business_id = NEW.business_id
      AND shift_row.branch_id = NEW.branch_id
      AND shift_row.hub_device_id = NEW.hub_device_id
      AND shift_row.status = 'OPEN'
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R006_SHIFT_CLOSE_ACTIVE_SHIFT_REQUIRED';
    END IF;
    SELECT device_id INTO v_hub_device_id FROM public.devices WHERE id = NEW.hub_device_id;
    IF EXISTS (
        SELECT 1
        FROM public.orders order_row
        WHERE order_row.business_id = NEW.business_id
          AND order_row.branch_id = NEW.branch_id
          AND order_row.payment_status = 'PENDING'
          AND order_row.status IN ('PLACED', 'PREPARING', 'READY')
          AND (
              order_row.cash_shift_id = v_shift.shift_id
              OR (
                  order_row.cash_shift_id IS NULL
                  AND order_row.device_id = v_hub_device_id
                  AND order_row.created_at >= v_shift.opened_at
              )
          )
    ) THEN
        RAISE EXCEPTION 'R006_SHIFT_PENDING_ORDERS';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r006_hub_events_shift_close_authority ON public.hub_events;
CREATE TRIGGER r006_hub_events_shift_close_authority
    BEFORE INSERT ON public.hub_events
    FOR EACH ROW
    EXECUTE FUNCTION private.r006_validate_hub_event_shift_close_authority();

CREATE OR REPLACE FUNCTION private.r006_project_cash_shift_close_event(
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
    v_shift_id uuid;
    v_shift public.cash_shifts%ROWTYPE;
    v_expected_cash numeric;
    v_counted_cash numeric;
    v_cash_variance numeric;
    v_occurred_at timestamptz;
    v_hub_device_id text;
BEGIN
    IF (p_payload - ARRAY[
            'id', 'shiftId', 'status', 'currency', 'expectedCash',
            'countedCash', 'cashVariance'
        ]) <> '{}'::jsonb
       OR p_payload->>'id' <> p_aggregate_id
       OR p_payload->>'shiftId' <> p_aggregate_id
       OR p_payload->>'status' <> 'CLOSED'
       OR p_payload->>'currency' <> 'ZAR' THEN
        RAISE EXCEPTION 'R006_SHIFT_CLOSE_PAYLOAD_INVALID';
    END IF;
    BEGIN
        v_shift_id := p_aggregate_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R006_SHIFT_CLOSE_ID_INVALID';
    END;
    v_expected_cash := private.r005_json_money(p_payload, 'expectedCash');
    v_counted_cash := private.r005_json_money(p_payload, 'countedCash');
    v_cash_variance := private.r006_json_signed_money(p_payload, 'cashVariance');
    IF v_cash_variance <> v_counted_cash - v_expected_cash THEN
        RAISE EXCEPTION 'R006_SHIFT_CLOSE_VARIANCE_INVALID';
    END IF;
    SELECT * INTO v_shift
    FROM public.cash_shifts shift_row
    WHERE shift_row.shift_id = v_shift_id
      AND shift_row.business_id = p_business_id
      AND shift_row.branch_id = p_branch_id
      AND shift_row.hub_device_id = p_hub_device_id
      AND shift_row.status = 'OPEN'
    FOR UPDATE;
    IF NOT FOUND OR v_shift.expected_cash <> v_expected_cash THEN
        RAISE EXCEPTION 'R006_SHIFT_CLOSE_ACTIVE_SHIFT_INVALID';
    END IF;
    SELECT device_id INTO v_hub_device_id FROM public.devices WHERE id = p_hub_device_id;
    IF EXISTS (
        SELECT 1
        FROM public.orders order_row
        WHERE order_row.business_id = p_business_id
          AND order_row.branch_id = p_branch_id
          AND order_row.payment_status = 'PENDING'
          AND order_row.status IN ('PLACED', 'PREPARING', 'READY')
          AND (
              order_row.cash_shift_id = v_shift_id
              OR (
                  order_row.cash_shift_id IS NULL
                  AND order_row.device_id = v_hub_device_id
                  AND order_row.created_at >= v_shift.opened_at
              )
          )
    ) THEN
        RAISE EXCEPTION 'R006_SHIFT_PENDING_ORDERS';
    END IF;
    SELECT occurred_at INTO v_occurred_at FROM public.hub_events WHERE event_id = p_event_id;
    UPDATE public.cash_shifts
    SET status = 'CLOSED',
        closing_event_id = p_event_id,
        closed_by_staff_id = p_staff_id,
        closed_by_session_id = p_staff_session_id,
        counted_cash = v_counted_cash,
        cash_variance = v_cash_variance,
        closed_at = v_occurred_at
    WHERE shift_id = v_shift_id;
END;
$function$;

-- The endpoint has already verified the Hub signature. This receiver repeats
-- the bundle, session, scope, idempotency, and event-time checks on the narrow
-- close family before a cash-count fact reaches the durable cloud ledger.
CREATE OR REPLACE FUNCTION public.r006_ingest_hub_shift_close_events(
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
        RAISE EXCEPTION 'R006_EVENT_BATCH_INVALID';
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R006_EVENT_HUB_INVALID';
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
        RAISE EXCEPTION 'R006_EVENT_BUNDLE_INVALID';
    END IF;
    v_recovery_mode := NOT v_bundle.is_active OR v_bundle.expires_at <= v_now;

    FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
        IF jsonb_typeof(v_event) <> 'object'
           OR v_event::text ~* '"(pin|password|passwordhash|token|accesstoken|refreshtoken|credential|privatekey)"[[:space:]]*:' THEN
            RAISE EXCEPTION 'R006_EVENT_PAYLOAD_INVALID';
        END IF;
        BEGIN
            v_event_id := (v_event->>'eventId')::uuid;
            v_command_id := (v_event->>'commandId')::uuid;
            v_staff_id := (v_event->>'staffId')::uuid;
            v_session_id := (v_event->>'staffSessionId')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R006_EVENT_IDENTIFIER_INVALID';
        END;
        v_aggregate_id := trim(v_event->>'entityId');
        v_aggregate_type := trim(v_event->>'entityType');
        v_action := trim(v_event->>'action');
        v_occurred_at_text := v_event->>'timestamp';
        v_payload := v_event->'payload';
        IF v_aggregate_id = '' OR length(v_aggregate_id) > 200
           OR v_aggregate_type <> 'shift'
           OR v_action <> 'SHIFT_CLOSED'
           OR v_event->>'businessId' <> v_device.business_id::text
           OR v_event->>'branchId' <> v_device.branch_id::text
           OR v_event->>'deviceId' <> v_device.device_id
           OR jsonb_typeof(v_payload) <> 'object'
           OR octet_length(convert_to(v_payload::text, 'UTF8')) > 65536
           OR coalesce((v_event->>'schemaVersion')::integer, -1) <> 1 THEN
            RAISE EXCEPTION 'R006_EVENT_SCOPE_INVALID';
        END IF;
        BEGIN
            v_sequence := (v_event->>'sequence')::bigint;
            v_event_ordinal := (v_event->>'eventOrdinal')::integer;
            v_occurred_at := v_occurred_at_text::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R006_EVENT_SHAPE_INVALID';
        END;
        IF v_sequence < 0 OR v_event_ordinal NOT BETWEEN 0 AND 99
           OR v_occurred_at_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
           OR private.r003_canonical_utc(v_occurred_at) <> v_occurred_at_text
           OR v_occurred_at < v_now - interval '35 days'
           OR v_occurred_at > v_now + interval '5 minutes'
           OR (v_recovery_mode AND v_occurred_at > v_bundle.expires_at) THEN
            RAISE EXCEPTION 'R006_EVENT_TIMESTAMP_OR_SEQUENCE_INVALID';
        END IF;

        v_event_digest := private.r003_sha256(convert_to(v_event::text, 'UTF8'));
        SELECT content_sha256 INTO v_existing_digest
        FROM public.hub_events
        WHERE event_id = v_event_id
        FOR UPDATE;
        IF FOUND THEN
            IF v_existing_digest <> v_event_digest THEN
                RAISE EXCEPTION 'R006_EVENT_ID_COLLISION';
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
            RAISE EXCEPTION 'R006_EVENT_STAFF_SESSION_INVALID';
        END IF;
        SELECT event_id INTO v_existing_event_id
        FROM public.hub_events
        WHERE staff_session_id = v_session_id
          AND sequence = v_sequence
          AND event_ordinal = v_event_ordinal;
        IF FOUND THEN
            RAISE EXCEPTION 'R006_EVENT_SEQUENCE_COLLISION';
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
        PERFORM private.r006_project_cash_shift_close_event(
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

REVOKE ALL ON FUNCTION private.r006_bind_hub_order_to_active_cash_shift() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r006_json_signed_money(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r006_validate_hub_event_shift_close_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r006_project_cash_shift_close_event(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r006_ingest_hub_shift_close_events(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r006_ingest_hub_shift_close_events(text, uuid, jsonb) TO service_role;
