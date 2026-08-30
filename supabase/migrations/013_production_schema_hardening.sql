-- Supabase Migration: 013_production_schema_hardening.sql
-- Description: Production hardening for the accepted R001A -> R012 baseline.
--   * fixes the final mutable search_path advisor warning;
--   * makes the two businesses RLS policies use initplan-safe auth lookups;
--   * covers every advisor-identified foreign key with an index.
--
-- This is additive and idempotent. It does not grant public data access and
-- does not alter business, credential, or Hub authority facts.

DO $r013_preflight$
BEGIN
    IF to_regclass('public.businesses') IS NULL
       OR to_regclass('public.staff_credentials') IS NULL
       OR to_regclass('public.hub_staff_credential_reset_codes') IS NULL
       OR to_regclass('public.hub_staff_credential_reset_challenges') IS NULL
       OR to_regnamespace('private') IS NULL THEN
        RAISE EXCEPTION 'R013_REQUIRES_COMPLETE_R001A_TO_R012_BASELINE';
    END IF;
END;
$r013_preflight$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.is_business_member(biz_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.business_memberships
        WHERE business_id = biz_id
          AND user_id = (SELECT auth.uid())
    );
END;
$function$;

CREATE OR REPLACE FUNCTION private.is_business_owner(biz_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.business_memberships
        WHERE business_id = biz_id
          AND user_id = (SELECT auth.uid())
          AND role = 'OWNER'
    );
END;
$function$;

DROP POLICY IF EXISTS "Users can view businesses they belong to" ON public.businesses;
CREATE POLICY "Users can view businesses they belong to"
    ON public.businesses FOR SELECT TO authenticated
    USING ((SELECT private.is_business_member(id)) OR owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owners can update their businesses" ON public.businesses;
CREATE POLICY "Owners can update their businesses"
    ON public.businesses FOR UPDATE TO authenticated
    USING (owner_id = (SELECT auth.uid()))
    WITH CHECK (owner_id = (SELECT auth.uid()));

-- Foreign key indexes: generated from the accepted R001A -> R012 schema and
-- kept explicit so clean deployments receive the same index set.
CREATE INDEX IF NOT EXISTS idx_audit_logs_branch_id ON public.audit_logs (branch_id);
CREATE INDEX IF NOT EXISTS idx_businesses_owner_id ON public.businesses (owner_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_closed_by_session_id ON public.cash_shifts (closed_by_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_closed_by_staff_id ON public.cash_shifts (closed_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_hub_device_id ON public.cash_shifts (hub_device_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_opened_by_session_id ON public.cash_shifts (opened_by_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_opened_by_staff_id ON public.cash_shifts (opened_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_branch_id ON public.catalog_products (branch_id);
CREATE INDEX IF NOT EXISTS idx_device_pairing_codes_branch_id ON public.device_pairing_codes (branch_id);
CREATE INDEX IF NOT EXISTS idx_device_pairing_codes_created_by_staff_id ON public.device_pairing_codes (created_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_device_pairing_codes_created_by_user_id ON public.device_pairing_codes (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_financial_postings_branch_id ON public.financial_postings (branch_id);
CREATE INDEX IF NOT EXISTS idx_financial_postings_shift_id ON public.financial_postings (shift_id);
CREATE INDEX IF NOT EXISTS idx_hub_authorization_bundles_business_id ON public.hub_authorization_bundles (business_id);
CREATE INDEX IF NOT EXISTS idx_hub_branch_authority_active_hub_device_id ON public.hub_branch_authority (active_hub_device_id);
CREATE INDEX IF NOT EXISTS idx_hub_branch_authority_business_id ON public.hub_branch_authority (business_id);
CREATE INDEX IF NOT EXISTS idx_hub_branch_configuration_business_id ON public.hub_branch_configuration (business_id);
CREATE INDEX IF NOT EXISTS idx_hub_bundle_renewal_requests_completed_bundle_id ON public.hub_bundle_renewal_requests (completed_bundle_id);
CREATE INDEX IF NOT EXISTS idx_hub_bundle_renewal_requests_previous_bundle_id ON public.hub_bundle_renewal_requests (previous_bundle_id);
CREATE INDEX IF NOT EXISTS idx_hub_enrollment_challenges_business_id ON public.hub_enrollment_challenges (business_id);
CREATE INDEX IF NOT EXISTS idx_hub_enrollment_challenges_completed_bundle_id ON public.hub_enrollment_challenges (completed_bundle_id);
CREATE INDEX IF NOT EXISTS idx_hub_enrollment_challenges_pairing_code_id ON public.hub_enrollment_challenges (pairing_code_id);
CREATE INDEX IF NOT EXISTS idx_hub_events_branch_id ON public.hub_events (branch_id);
CREATE INDEX IF NOT EXISTS idx_hub_events_hub_device_id ON public.hub_events (hub_device_id);
CREATE INDEX IF NOT EXISTS idx_hub_events_staff_id ON public.hub_events (staff_id);
CREATE INDEX IF NOT EXISTS idx_hub_payments_branch_id ON public.hub_payments (branch_id);
CREATE INDEX IF NOT EXISTS idx_hub_payments_hub_device_id ON public.hub_payments (hub_device_id);
CREATE INDEX IF NOT EXISTS idx_hub_payments_staff_id ON public.hub_payments (staff_id);
CREATE INDEX IF NOT EXISTS idx_hub_payments_staff_session_id ON public.hub_payments (staff_session_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_credential_reset_challenges_staff_id ON public.hub_staff_credential_reset_challenges (staff_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_session_challenges_branch_id ON public.hub_staff_session_challenges (branch_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_session_challenges_business_id ON public.hub_staff_session_challenges (business_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_session_challenges_completed_bundle_id ON public.hub_staff_session_challenges (completed_bundle_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_session_challenges_prepared_session_id ON public.hub_staff_session_challenges (prepared_session_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_session_challenges_staff_id ON public.hub_staff_session_challenges (staff_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_sessions_branch_id ON public.hub_staff_sessions (branch_id);
CREATE INDEX IF NOT EXISTS idx_hub_staff_sessions_staff_id ON public.hub_staff_sessions (staff_id);
CREATE INDEX IF NOT EXISTS idx_hub_terminal_admissions_business_id ON public.hub_terminal_admissions (business_id);
CREATE INDEX IF NOT EXISTS idx_hub_terminal_admissions_hub_device_id ON public.hub_terminal_admissions (hub_device_id);
CREATE INDEX IF NOT EXISTS idx_hub_terminal_enrollment_challenges_business_id ON public.hub_terminal_enrollment_challenges (business_id);
CREATE INDEX IF NOT EXISTS idx_hub_terminal_renewal_challenges_completed_admission_id ON public.hub_terminal_renewal_challenges (completed_admission_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_lines_branch_id ON public.inventory_adjustment_lines (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_lines_branch_id_product_id ON public.inventory_adjustment_lines (branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_adjusted_by_session_id ON public.inventory_adjustments (adjusted_by_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_branch_id ON public.inventory_adjustments (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_hub_device_id ON public.inventory_adjustments (hub_device_id);
CREATE INDEX IF NOT EXISTS idx_inventory_branch_balances_product_id ON public.inventory_branch_balances (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_id ON public.inventory_movements (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_id_product_id ON public.inventory_movements (branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON public.inventory_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_staff_id ON public.inventory_movements (staff_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_staff_session_id ON public.inventory_movements (staff_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipt_lines_branch_id ON public.inventory_receipt_lines (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipt_lines_branch_id_product_id ON public.inventory_receipt_lines (branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_branch_id ON public.inventory_receipts (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_hub_device_id ON public.inventory_receipts (hub_device_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_received_by_session_id ON public.inventory_receipts (received_by_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_waste_branch_id ON public.inventory_waste (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_waste_hub_device_id ON public.inventory_waste (hub_device_id);
CREATE INDEX IF NOT EXISTS idx_inventory_waste_recorded_by_session_id ON public.inventory_waste (recorded_by_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_waste_lines_branch_id ON public.inventory_waste_lines (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_waste_lines_branch_id_product_id ON public.inventory_waste_lines (branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON public.orders (branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_cashier_id ON public.orders (cashier_id);
CREATE INDEX IF NOT EXISTS idx_orders_device_id ON public.orders (device_id);
CREATE INDEX IF NOT EXISTS idx_staff_credentials_business_id ON public.staff_credentials (business_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_branch_id ON public.staff_members (branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_security_sessions_branch_id ON public.staff_security_sessions (branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_security_sessions_staff_id ON public.staff_security_sessions (staff_id);
