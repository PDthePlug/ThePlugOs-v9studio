-- Supabase Migration: 015_owner_control_plane_rls_hardening.sql
-- Description: Narrow browser control-plane writes for staff directory and
--              catalog administration to the authenticated business owner.
--
-- This is additive hardening. It intentionally preserves business-member
-- SELECT policies while replacing the original broad member INSERT/UPDATE
-- policies for staff_members and catalog_products.

DO $r015_preflight$
BEGIN
    IF to_regclass('public.businesses') IS NULL
       OR to_regclass('public.business_memberships') IS NULL
       OR to_regclass('public.branches') IS NULL
       OR to_regclass('public.staff_members') IS NULL
       OR to_regclass('public.catalog_products') IS NULL
       OR to_regprocedure('private.is_business_owner(uuid)') IS NULL THEN
        RAISE EXCEPTION 'R015_REQUIRES_OWNER_CONTROL_PLANE_BASELINE';
    END IF;
END;
$r015_preflight$;

-- Remove the R001 policies that allowed any authenticated business member to
-- administer staff or catalog metadata. Read access remains unchanged.
DROP POLICY IF EXISTS "Users can manage staff for their businesses" ON public.staff_members;
DROP POLICY IF EXISTS "Users can update staff for their businesses" ON public.staff_members;
DROP POLICY IF EXISTS "Users can manage products for their businesses" ON public.catalog_products;
DROP POLICY IF EXISTS "Users can update products for their businesses" ON public.catalog_products;

CREATE POLICY "Owners can create staff profiles for their businesses"
    ON public.staff_members FOR INSERT TO authenticated
    WITH CHECK (
        private.is_business_owner(business_id)
        AND EXISTS (
            SELECT 1
            FROM public.branches branch
            WHERE branch.id = staff_members.branch_id
              AND branch.business_id = staff_members.business_id
              AND branch.is_active
        )
        AND role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')
    );

CREATE POLICY "Owners can update staff profiles for their businesses"
    ON public.staff_members FOR UPDATE TO authenticated
    USING (private.is_business_owner(business_id))
    WITH CHECK (
        private.is_business_owner(business_id)
        AND EXISTS (
            SELECT 1
            FROM public.branches branch
            WHERE branch.id = staff_members.branch_id
              AND branch.business_id = staff_members.business_id
              AND branch.is_active
        )
    );

CREATE POLICY "Owners can create catalog products for their businesses"
    ON public.catalog_products FOR INSERT TO authenticated
    WITH CHECK (
        private.is_business_owner(business_id)
        AND (
            branch_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.branches branch
                WHERE branch.id = catalog_products.branch_id
                  AND branch.business_id = catalog_products.business_id
                  AND branch.is_active
            )
        )
    );

CREATE POLICY "Owners can update catalog products for their businesses"
    ON public.catalog_products FOR UPDATE TO authenticated
    USING (private.is_business_owner(business_id))
    WITH CHECK (
        private.is_business_owner(business_id)
        AND (
            branch_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.branches branch
                WHERE branch.id = catalog_products.branch_id
                  AND branch.business_id = catalog_products.business_id
                  AND branch.is_active
            )
        )
    );

COMMENT ON POLICY "Owners can create staff profiles for their businesses" ON public.staff_members IS
    'Browser owner control-plane directory creation only; credentials and staff sessions remain native/server authority.';
COMMENT ON POLICY "Owners can create catalog products for their businesses" ON public.catalog_products IS
    'Owner catalog metadata administration. Physical stock mutations remain Hub/Manager operational authority.';
