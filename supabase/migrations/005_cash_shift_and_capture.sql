-- =========================================================
-- R005: LOCAL-FIRST CASH SHIFT AND CASH CAPTURE
-- =========================================================
--
-- Source-only migration. Apply only after accepted R001 -> R002 -> R003 ->
-- R004 staging evidence. R005 retains R003's existing order receiver and
-- adds a separate, identically authenticated receiver for the new cash-shift
-- and payment event families.

DO $r005_preflight$
BEGIN
    IF to_regclass('public.hub_events') IS NULL
       OR to_regclass('public.hub_staff_sessions') IS NULL
       OR to_regclass('public.hub_branch_authority') IS NULL
       OR to_regclass('public.hub_authorization_bundles') IS NULL
       OR to_regprocedure('public.r003_ingest_hub_events(text,uuid,jsonb)') IS NULL
       OR to_regprocedure('private.r004_validate_hub_event_order_authority()') IS NULL THEN
        RAISE EXCEPTION 'R005_REQUIRES_ACCEPTED_R003_R004';
    END IF;
END;
$r005_preflight$;

-- R003's event envelope remains canonical. Expand its enumerations before a
-- financial event can be admitted; browser roles retain no table privileges.
ALTER TABLE public.hub_events
    DROP CONSTRAINT IF EXISTS hub_events_aggregate_type_check;
ALTER TABLE public.hub_events
    ADD CONSTRAINT hub_events_aggregate_type_check
    CHECK (aggregate_type IN ('order', 'shift', 'payment'));

ALTER TABLE public.hub_events
    DROP CONSTRAINT IF EXISTS hub_events_action_check;
ALTER TABLE public.hub_events
    ADD CONSTRAINT hub_events_action_check
    CHECK (action IN ('ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'SHIFT_OPENED', 'PAYMENT_CAPTURED'));

CREATE TABLE public.cash_shifts (
    shift_id uuid PRIMARY KEY,
    opening_event_id uuid NOT NULL UNIQUE REFERENCES public.hub_events(event_id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    opened_by_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    opened_by_session_id uuid NOT NULL REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status IN ('OPEN')),
    currency char(3) NOT NULL CHECK (currency = 'ZAR'),
    opening_float numeric(14,2) NOT NULL CHECK (opening_float >= 0),
    cash_sales_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_sales_total >= 0),
    cash_tendered_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_tendered_total >= 0),
    cash_change_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_change_total >= 0),
    expected_cash numeric(14,2) NOT NULL CHECK (expected_cash >= 0),
    opened_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expected_cash = opening_float + cash_sales_total),
    CHECK (cash_tendered_total - cash_change_total = cash_sales_total)
);

CREATE UNIQUE INDEX cash_shifts_one_open_branch
    ON public.cash_shifts (branch_id)
    WHERE status = 'OPEN';
CREATE INDEX cash_shifts_hub_branch
    ON public.cash_shifts (business_id, branch_id, hub_device_id, opened_at DESC);

CREATE TABLE public.hub_payments (
    payment_id uuid PRIMARY KEY,
    event_id uuid NOT NULL UNIQUE REFERENCES public.hub_events(event_id) ON DELETE RESTRICT,
    order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
    shift_id uuid NOT NULL REFERENCES public.cash_shifts(shift_id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    hub_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    staff_session_id uuid NOT NULL REFERENCES public.hub_staff_sessions(session_id) ON DELETE RESTRICT,
    tender text NOT NULL CHECK (tender IN ('CASH')),
    status text NOT NULL CHECK (status IN ('CAPTURED')),
    currency char(3) NOT NULL CHECK (currency = 'ZAR'),
    amount numeric(14,2) NOT NULL CHECK (amount >= 0),
    cash_tendered numeric(14,2) NOT NULL CHECK (cash_tendered >= amount),
    change_due numeric(14,2) NOT NULL CHECK (change_due >= 0),
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (change_due = cash_tendered - amount)
);

CREATE INDEX hub_payments_branch_captured
    ON public.hub_payments (business_id, branch_id, captured_at DESC);
CREATE INDEX hub_payments_shift
    ON public.hub_payments (shift_id, captured_at ASC);

CREATE TABLE public.financial_postings (
    posting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.hub_events(event_id) ON DELETE RESTRICT,
    payment_id uuid NOT NULL REFERENCES public.hub_payments(payment_id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    shift_id uuid NOT NULL REFERENCES public.cash_shifts(shift_id) ON DELETE RESTRICT,
    account text NOT NULL CHECK (account IN ('CASH_DRAWER', 'ORDER_SETTLEMENT_CLEARING')),
    debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
    UNIQUE (event_id, account)
);

CREATE INDEX financial_postings_branch_occurred
    ON public.financial_postings (business_id, branch_id, occurred_at DESC);
CREATE INDEX financial_postings_payment
    ON public.financial_postings (payment_id);

ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_shifts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hub_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.financial_postings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.r005_json_money(
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
    IF v_value < 0 OR v_value <> round(v_value, 2) OR v_value > 999999999999.99 THEN
        RAISE EXCEPTION 'R005_EVENT_MONEY_INVALID: %', p_field;
    END IF;
    RETURN v_value;
END;
$function$;

-- Independent receiver-side guard. It covers R003 order placement as well as
-- R005 cash events, so a Hub cannot create an order without an open cash
-- custody period even if the caller bypasses its local router.
CREATE OR REPLACE FUNCTION private.r005_validate_hub_event_cash_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_shift_id uuid;
BEGIN
    SELECT session.role INTO v_role
    FROM public.hub_staff_sessions session
    WHERE session.session_id = NEW.staff_session_id
      AND session.staff_id = NEW.staff_id
      AND session.business_id = NEW.business_id
      AND session.branch_id = NEW.branch_id
      AND session.hub_device_id = NEW.hub_device_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R005_EVENT_SESSION_SCOPE_INVALID';
    END IF;

    IF NEW.action = 'ORDER_PLACED' THEN
        IF v_role <> 'CASHIER' THEN
            RAISE EXCEPTION 'R005_ORDER_CREATE_ROLE_FORBIDDEN';
        END IF;
        SELECT shift_id INTO v_shift_id
        FROM public.cash_shifts
        WHERE business_id = NEW.business_id
          AND branch_id = NEW.branch_id
          AND hub_device_id = NEW.hub_device_id
          AND status = 'OPEN'
        FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'R005_ORDER_ACTIVE_SHIFT_REQUIRED';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.action = 'SHIFT_OPENED' THEN
        IF NEW.aggregate_type <> 'shift' OR v_role <> 'MANAGER' THEN
            RAISE EXCEPTION 'R005_SHIFT_OPEN_ROLE_OR_SCOPE_FORBIDDEN';
        END IF;
        SELECT shift_id INTO v_shift_id
        FROM public.cash_shifts
        WHERE branch_id = NEW.branch_id AND status = 'OPEN'
        FOR KEY SHARE;
        IF FOUND THEN
            RAISE EXCEPTION 'R005_SHIFT_ALREADY_OPEN';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.action = 'PAYMENT_CAPTURED' THEN
        IF NEW.aggregate_type <> 'payment' OR v_role <> 'CASHIER' THEN
            RAISE EXCEPTION 'R005_PAYMENT_CAPTURE_ROLE_OR_SCOPE_FORBIDDEN';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS r005_hub_events_cash_authority ON public.hub_events;
CREATE TRIGGER r005_hub_events_cash_authority
    BEFORE INSERT ON public.hub_events
    FOR EACH ROW
    EXECUTE FUNCTION private.r005_validate_hub_event_cash_authority();

CREATE OR REPLACE FUNCTION private.r005_project_cash_shift_event(
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
    v_opening_float numeric;
    v_cash_sales numeric;
    v_cash_tendered numeric;
    v_cash_change numeric;
    v_expected_cash numeric;
    v_occurred_at timestamptz;
BEGIN
    IF (p_payload - ARRAY[
            'id', 'shiftId', 'status', 'currency', 'openingFloat',
            'cashSalesTotal', 'cashTenderedTotal', 'cashChangeTotal', 'expectedCash'
        ]) <> '{}'::jsonb
       OR p_payload->>'id' <> p_aggregate_id
       OR p_payload->>'shiftId' <> p_aggregate_id
       OR p_payload->>'status' <> 'OPEN'
       OR p_payload->>'currency' <> 'ZAR' THEN
        RAISE EXCEPTION 'R005_SHIFT_PAYLOAD_INVALID';
    END IF;
    BEGIN
        v_shift_id := p_aggregate_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R005_SHIFT_ID_INVALID';
    END;
    v_opening_float := private.r005_json_money(p_payload, 'openingFloat');
    v_cash_sales := private.r005_json_money(p_payload, 'cashSalesTotal');
    v_cash_tendered := private.r005_json_money(p_payload, 'cashTenderedTotal');
    v_cash_change := private.r005_json_money(p_payload, 'cashChangeTotal');
    v_expected_cash := private.r005_json_money(p_payload, 'expectedCash');
    IF v_cash_sales <> 0 OR v_cash_tendered <> 0 OR v_cash_change <> 0
       OR v_expected_cash <> v_opening_float THEN
        RAISE EXCEPTION 'R005_SHIFT_OPENING_TOTALS_INVALID';
    END IF;
    SELECT occurred_at INTO v_occurred_at FROM public.hub_events WHERE event_id = p_event_id;
    INSERT INTO public.cash_shifts (
        shift_id, opening_event_id, business_id, branch_id, hub_device_id,
        opened_by_staff_id, opened_by_session_id, status, currency,
        opening_float, cash_sales_total, cash_tendered_total, cash_change_total,
        expected_cash, opened_at
    ) VALUES (
        v_shift_id, p_event_id, p_business_id, p_branch_id, p_hub_device_id,
        p_staff_id, p_staff_session_id, 'OPEN', 'ZAR', v_opening_float, 0, 0, 0,
        v_opening_float, v_occurred_at
    );
END;
$function$;

CREATE OR REPLACE FUNCTION private.r005_project_cash_payment_event(
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
    v_payment_id uuid;
    v_order_id uuid;
    v_shift_id uuid;
    v_order public.orders%ROWTYPE;
    v_shift public.cash_shifts%ROWTYPE;
    v_amount numeric;
    v_cash_tendered numeric;
    v_change_due numeric;
    v_postings jsonb;
    v_debit numeric;
    v_credit numeric;
    v_next_sales numeric;
    v_next_tendered numeric;
    v_next_change numeric;
    v_next_expected numeric;
    v_occurred_at timestamptz;
BEGIN
    IF (p_payload - ARRAY[
            'id', 'paymentId', 'orderId', 'shiftId', 'tender', 'status',
            'currency', 'amount', 'cashTendered', 'changeDue', 'financialPostings'
        ]) <> '{}'::jsonb
       OR p_payload->>'id' <> p_aggregate_id
       OR p_payload->>'paymentId' <> p_aggregate_id
       OR p_payload->>'tender' <> 'CASH'
       OR p_payload->>'status' <> 'CAPTURED'
       OR p_payload->>'currency' <> 'ZAR'
       OR jsonb_typeof(p_payload->'financialPostings') <> 'array'
       OR jsonb_array_length(p_payload->'financialPostings') <> 2 THEN
        RAISE EXCEPTION 'R005_PAYMENT_PAYLOAD_INVALID';
    END IF;
    BEGIN
        v_payment_id := p_aggregate_id::uuid;
        v_order_id := (p_payload->>'orderId')::uuid;
        v_shift_id := (p_payload->>'shiftId')::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'R005_PAYMENT_IDENTIFIER_INVALID';
    END;
    v_amount := private.r005_json_money(p_payload, 'amount');
    v_cash_tendered := private.r005_json_money(p_payload, 'cashTendered');
    v_change_due := private.r005_json_money(p_payload, 'changeDue');
    IF v_cash_tendered < v_amount OR v_change_due <> v_cash_tendered - v_amount THEN
        RAISE EXCEPTION 'R005_PAYMENT_CASH_FACTS_INVALID';
    END IF;

    SELECT * INTO v_order
    FROM public.orders order_row
    WHERE order_row.id = v_order_id
      AND order_row.business_id = p_business_id
      AND order_row.branch_id = p_branch_id
    FOR UPDATE;
    IF NOT FOUND OR v_order.status NOT IN ('PLACED', 'PREPARING', 'READY')
       OR v_order.payment_status <> 'PENDING'
       OR v_order.payment_method <> 'CASH'
       OR v_order.total_amount <> v_amount THEN
        RAISE EXCEPTION 'R005_PAYMENT_ORDER_INVALID';
    END IF;
    IF EXISTS (SELECT 1 FROM public.hub_payments WHERE order_id = v_order_id) THEN
        RAISE EXCEPTION 'R005_PAYMENT_ORDER_ALREADY_CAPTURED';
    END IF;

    SELECT * INTO v_shift
    FROM public.cash_shifts shift_row
    WHERE shift_row.shift_id = v_shift_id
      AND shift_row.business_id = p_business_id
      AND shift_row.branch_id = p_branch_id
      AND shift_row.hub_device_id = p_hub_device_id
      AND shift_row.status = 'OPEN'
    FOR UPDATE;
    IF NOT FOUND
       OR v_shift.expected_cash <> v_shift.opening_float + v_shift.cash_sales_total
       OR v_shift.cash_tendered_total - v_shift.cash_change_total <> v_shift.cash_sales_total THEN
        RAISE EXCEPTION 'R005_PAYMENT_SHIFT_INVALID';
    END IF;

    v_postings := p_payload->'financialPostings';
    IF jsonb_typeof(v_postings -> 0) <> 'object'
       OR jsonb_typeof(v_postings -> 1) <> 'object'
       OR ((v_postings -> 0) - ARRAY['account', 'debit', 'credit']) <> '{}'::jsonb
       OR ((v_postings -> 1) - ARRAY['account', 'debit', 'credit']) <> '{}'::jsonb
       OR (v_postings -> 0) ->> 'account' <> 'CASH_DRAWER'
       OR (v_postings -> 1) ->> 'account' <> 'ORDER_SETTLEMENT_CLEARING' THEN
        RAISE EXCEPTION 'R005_PAYMENT_POSTINGS_INVALID';
    END IF;
    v_debit := private.r005_json_money(v_postings->0, 'debit');
    v_credit := private.r005_json_money(v_postings->0, 'credit');
    IF v_debit <> v_amount OR v_credit <> 0 THEN
        RAISE EXCEPTION 'R005_PAYMENT_CASH_DRAWER_POSTING_INVALID';
    END IF;
    v_debit := private.r005_json_money(v_postings->1, 'debit');
    v_credit := private.r005_json_money(v_postings->1, 'credit');
    IF v_debit <> 0 OR v_credit <> v_amount THEN
        RAISE EXCEPTION 'R005_PAYMENT_CLEARING_POSTING_INVALID';
    END IF;

    v_next_sales := v_shift.cash_sales_total + v_amount;
    v_next_tendered := v_shift.cash_tendered_total + v_cash_tendered;
    v_next_change := v_shift.cash_change_total + v_change_due;
    v_next_expected := v_shift.opening_float + v_next_sales;
    IF v_next_sales > 999999999999.99 OR v_next_tendered > 999999999999.99
       OR v_next_change > 999999999999.99 OR v_next_expected > 999999999999.99
       OR v_next_tendered - v_next_change <> v_next_sales THEN
        RAISE EXCEPTION 'R005_PAYMENT_SHIFT_TOTALS_INVALID';
    END IF;
    SELECT occurred_at INTO v_occurred_at FROM public.hub_events WHERE event_id = p_event_id;

    INSERT INTO public.hub_payments (
        payment_id, event_id, order_id, shift_id, business_id, branch_id,
        hub_device_id, staff_id, staff_session_id, tender, status, currency,
        amount, cash_tendered, change_due, captured_at
    ) VALUES (
        v_payment_id, p_event_id, v_order_id, v_shift_id, p_business_id, p_branch_id,
        p_hub_device_id, p_staff_id, p_staff_session_id, 'CASH', 'CAPTURED', 'ZAR',
        v_amount, v_cash_tendered, v_change_due, v_occurred_at
    );
    INSERT INTO public.financial_postings (
        event_id, payment_id, business_id, branch_id, shift_id, account, debit, credit, occurred_at
    ) VALUES
        (p_event_id, v_payment_id, p_business_id, p_branch_id, v_shift_id, 'CASH_DRAWER', v_amount, 0, v_occurred_at),
        (p_event_id, v_payment_id, p_business_id, p_branch_id, v_shift_id, 'ORDER_SETTLEMENT_CLEARING', 0, v_amount, v_occurred_at);
    UPDATE public.orders
    SET payment_status = 'CAPTURED',
        cash_tendered = v_cash_tendered,
        change_due = v_change_due,
        updated_at = now()
    WHERE id = v_order_id;
    UPDATE public.cash_shifts
    SET cash_sales_total = v_next_sales,
        cash_tendered_total = v_next_tendered,
        cash_change_total = v_next_change,
        expected_cash = v_next_expected
    WHERE shift_id = v_shift_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.r005_ingest_hub_financial_events(
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
        RAISE EXCEPTION 'R005_EVENT_BATCH_INVALID';
    END IF;

    SELECT * INTO v_device
    FROM public.devices
    WHERE device_id = p_hub_device_id
      AND operational_role = 'CASHIER_HUB'
      AND status = 'ACTIVE'
      AND revoked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'R005_EVENT_HUB_INVALID';
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
        RAISE EXCEPTION 'R005_EVENT_BUNDLE_INVALID';
    END IF;
    v_recovery_mode := NOT v_bundle.is_active OR v_bundle.expires_at <= v_now;

    FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
        IF jsonb_typeof(v_event) <> 'object'
           OR v_event::text ~* '"(pin|password|passwordhash|token|accesstoken|refreshtoken|credential|privatekey)"[[:space:]]*:' THEN
            RAISE EXCEPTION 'R005_EVENT_PAYLOAD_INVALID';
        END IF;
        BEGIN
            v_event_id := (v_event->>'eventId')::uuid;
            v_command_id := (v_event->>'commandId')::uuid;
            v_staff_id := (v_event->>'staffId')::uuid;
            v_session_id := (v_event->>'staffSessionId')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R005_EVENT_IDENTIFIER_INVALID';
        END;
        v_aggregate_id := trim(v_event->>'entityId');
        v_aggregate_type := trim(v_event->>'entityType');
        v_action := trim(v_event->>'action');
        v_occurred_at_text := v_event->>'timestamp';
        v_payload := v_event->'payload';
        IF v_aggregate_id = '' OR length(v_aggregate_id) > 200
           OR NOT ((v_aggregate_type = 'shift' AND v_action = 'SHIFT_OPENED')
                   OR (v_aggregate_type = 'payment' AND v_action = 'PAYMENT_CAPTURED'))
           OR v_event->>'businessId' <> v_device.business_id::text
           OR v_event->>'branchId' <> v_device.branch_id::text
           OR v_event->>'deviceId' <> v_device.device_id
           OR jsonb_typeof(v_payload) <> 'object'
           OR octet_length(convert_to(v_payload::text, 'UTF8')) > 65536
           OR coalesce((v_event->>'schemaVersion')::integer, -1) <> 1 THEN
            RAISE EXCEPTION 'R005_EVENT_SCOPE_INVALID';
        END IF;
        BEGIN
            v_sequence := (v_event->>'sequence')::bigint;
            v_event_ordinal := (v_event->>'eventOrdinal')::integer;
            v_occurred_at := v_occurred_at_text::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'R005_EVENT_SHAPE_INVALID';
        END;
        IF v_sequence < 0 OR v_event_ordinal NOT BETWEEN 0 AND 99
           OR v_occurred_at_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
           OR private.r003_canonical_utc(v_occurred_at) <> v_occurred_at_text
           OR v_occurred_at < v_now - interval '35 days'
           OR v_occurred_at > v_now + interval '5 minutes'
           OR (v_recovery_mode AND v_occurred_at > v_bundle.expires_at) THEN
            RAISE EXCEPTION 'R005_EVENT_TIMESTAMP_OR_SEQUENCE_INVALID';
        END IF;

        v_event_digest := private.r003_sha256(convert_to(v_event::text, 'UTF8'));
        SELECT content_sha256 INTO v_existing_digest
        FROM public.hub_events
        WHERE event_id = v_event_id
        FOR UPDATE;
        IF FOUND THEN
            IF v_existing_digest <> v_event_digest THEN
                RAISE EXCEPTION 'R005_EVENT_ID_COLLISION';
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
            RAISE EXCEPTION 'R005_EVENT_STAFF_SESSION_INVALID';
        END IF;
        SELECT event_id INTO v_existing_event_id
        FROM public.hub_events
        WHERE staff_session_id = v_session_id
          AND sequence = v_sequence
          AND event_ordinal = v_event_ordinal;
        IF FOUND THEN
            RAISE EXCEPTION 'R005_EVENT_SEQUENCE_COLLISION';
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
        IF v_action = 'SHIFT_OPENED' THEN
            PERFORM private.r005_project_cash_shift_event(
                v_event_id, v_device.business_id, v_device.branch_id, v_device.id,
                v_staff_id, v_session_id, v_aggregate_id, v_payload
            );
        ELSE
            PERFORM private.r005_project_cash_payment_event(
                v_event_id, v_device.business_id, v_device.branch_id, v_device.id,
                v_staff_id, v_session_id, v_aggregate_id, v_payload
            );
        END IF;
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

REVOKE ALL ON FUNCTION private.r005_json_money(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r005_validate_hub_event_cash_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r005_project_cash_shift_event(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.r005_project_cash_payment_event(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r005_ingest_hub_financial_events(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r005_ingest_hub_financial_events(text, uuid, jsonb) TO service_role;
