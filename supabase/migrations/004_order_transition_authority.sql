-- =========================================================
-- R004: LOCAL-FIRST ORDER TRANSITION AUTHORITY
-- =========================================================
--
-- Source-only migration. Apply only after the accepted R001 -> R002 -> R003
-- staging path has produced the required evidence. This migration deliberately
-- leaves the immutable R003 event schema and projector intact; it adds an
-- independent receiver-side authority gate before a new event can enter that
-- ledger.

CREATE OR REPLACE FUNCTION private.r004_validate_hub_event_order_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_order public.orders%ROWTYPE;
    v_order_id uuid;
    v_previous_status text;
    v_next_status text;
BEGIN
    -- R003 independently verifies session expiry, revocation version, and
    -- event-time validity. This trigger binds the role and tenancy facts
    -- again so a future receiver or direct service path cannot bypass order
    -- transition ownership.
    SELECT session.role INTO v_role
    FROM public.hub_staff_sessions session
    WHERE session.session_id = NEW.staff_session_id
      AND session.staff_id = NEW.staff_id
      AND session.business_id = NEW.business_id
      AND session.branch_id = NEW.branch_id
      AND session.hub_device_id = NEW.hub_device_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'R004_EVENT_SESSION_SCOPE_INVALID';
    END IF;

    -- R005 expands the immutable envelope with shift/payment aggregates.
    -- This order-specific guard must leave those later families to their own
    -- receiver-side authority trigger rather than blocking a valid extension.
    IF NEW.aggregate_type <> 'order' THEN
        RETURN NEW;
    END IF;

    IF NEW.action = 'ORDER_PLACED' THEN
        IF v_role <> 'CASHIER' THEN
            RAISE EXCEPTION 'R004_ORDER_CREATE_ROLE_FORBIDDEN';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.action <> 'ORDER_STATUS_CHANGED' THEN
        RAISE EXCEPTION 'R004_ORDER_ACTION_INVALID';
    END IF;

    IF NEW.payload->>'id' IS DISTINCT FROM NEW.aggregate_id
       OR coalesce(NEW.payload->>'orderId', NEW.aggregate_id) <> NEW.aggregate_id THEN
        RAISE EXCEPTION 'R004_ORDER_PAYLOAD_ID_MISMATCH';
    END IF;

    v_previous_status := nullif(trim(NEW.payload->>'previousStatus'), '');
    v_next_status := nullif(trim(NEW.payload->>'status'), '');
    IF v_previous_status IS NULL OR v_next_status IS NULL THEN
        RAISE EXCEPTION 'R004_ORDER_STATUS_PAYLOAD_INVALID';
    END IF;

    BEGIN
        v_order_id := NEW.aggregate_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R004_ORDER_ID_INVALID';
    END;

    SELECT * INTO v_order
    FROM public.orders order_row
    WHERE order_row.id = v_order_id
      AND order_row.business_id = NEW.business_id
      AND order_row.branch_id = NEW.branch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'R004_ORDER_NOT_FOUND';
    END IF;

    IF v_order.status IS DISTINCT FROM v_previous_status THEN
        RAISE EXCEPTION 'R004_ORDER_PREVIOUS_STATUS_INVALID';
    END IF;

    IF v_role = 'KITCHEN_STAFF' THEN
        IF NOT (
            (v_previous_status = 'PLACED' AND v_next_status = 'PREPARING')
            OR (v_previous_status = 'PREPARING' AND v_next_status = 'READY')
        ) THEN
            RAISE EXCEPTION 'R004_ORDER_KITCHEN_TRANSITION_FORBIDDEN';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'CASHIER' THEN
        IF v_previous_status = 'PLACED'
           AND v_next_status = 'CANCELLED'
           AND v_order.payment_status = 'PENDING' THEN
            RETURN NEW;
        END IF;
        IF v_previous_status = 'READY'
           AND v_next_status = 'COLLECTED'
           AND v_order.payment_status = 'CAPTURED' THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'R004_ORDER_CASHIER_TRANSITION_FORBIDDEN';
    END IF;

    IF v_role = 'MANAGER' THEN
        IF v_previous_status IN ('PLACED', 'PREPARING')
           AND v_next_status = 'CANCELLED'
           AND v_order.payment_status = 'PENDING' THEN
            RETURN NEW;
        END IF;
        IF v_previous_status = 'READY'
           AND v_next_status = 'COLLECTED'
           AND v_order.payment_status = 'CAPTURED' THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'R004_ORDER_MANAGER_TRANSITION_FORBIDDEN';
    END IF;

    RAISE EXCEPTION 'R004_ORDER_ROLE_FORBIDDEN';
END;
$function$;

DROP TRIGGER IF EXISTS r004_hub_events_order_authority ON public.hub_events;

CREATE TRIGGER r004_hub_events_order_authority
    BEFORE INSERT ON public.hub_events
    FOR EACH ROW
    EXECUTE FUNCTION private.r004_validate_hub_event_order_authority();

REVOKE ALL ON FUNCTION private.r004_validate_hub_event_order_authority() FROM PUBLIC, anon, authenticated;
