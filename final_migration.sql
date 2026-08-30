-- Supabase Migration: 001_mvp_core.sql
-- Description: Canonical MVP Database Contract for ThePlugOS - R001B Final

-- Helper function to automatically update `updated_at`
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 1. Businesses
CREATE TABLE public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    onboarding_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (onboarding_status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_businesses_updated_at
    BEFORE UPDATE ON public.businesses
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Business Memberships
CREATE TABLE public.business_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, user_id)
);

-- 3. Branches
CREATE TABLE public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_branches_updated_at
    BEFORE UPDATE ON public.branches
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Devices (Canonical)
CREATE TABLE public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL UNIQUE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_devices_updated_at
    BEFORE UPDATE ON public.devices
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Staff Members
CREATE TABLE public.staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    pin_hash TEXT,
    active_shift BOOLEAN NOT NULL DEFAULT false,
    performance_score INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_staff_members_updated_at
    BEFORE UPDATE ON public.staff_members
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Catalog Products
CREATE TABLE public.catalog_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price NUMERIC(14,2) NOT NULL,
    description TEXT,
    stock_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
    unit_of_measure TEXT NOT NULL,
    cost_price NUMERIC(14,2),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_catalog_products_updated_at
    BEFORE UPDATE ON public.catalog_products
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Orders
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    device_id TEXT REFERENCES public.devices(device_id),
    cashier_id UUID REFERENCES public.staff_members(id),
    cashier_name TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    subtotal NUMERIC(14,2) NOT NULL,
    tax NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(14,2) NOT NULL,
    status TEXT NOT NULL,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'PENDING',
    cash_tendered NUMERIC(14,2),
    change_due NUMERIC(14,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Order Items
CREATE TABLE public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.catalog_products(id),
    name TEXT NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL,
    quantity NUMERIC(14,3) NOT NULL,
    line_total NUMERIC(14,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Device Pairing Codes
CREATE TABLE public.device_pairing_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pairing_code TEXT NOT NULL UNIQUE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id),
    status TEXT NOT NULL DEFAULT 'WAITING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

-- 10. Audit Logs (Append-only)
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    device_id TEXT,
    actor_id TEXT,
    entity_id TEXT,
    event_type TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_business_memberships_user_id ON public.business_memberships(user_id);
CREATE INDEX idx_business_memberships_business_id ON public.business_memberships(business_id);
CREATE INDEX idx_branches_business_id ON public.branches(business_id);
CREATE INDEX idx_devices_business_id ON public.devices(business_id);
CREATE INDEX idx_devices_branch_id ON public.devices(branch_id);
CREATE INDEX idx_staff_members_bus_branch ON public.staff_members(business_id, branch_id);
CREATE INDEX idx_catalog_products_bus_branch ON public.catalog_products(business_id, branch_id);
CREATE INDEX idx_orders_bus_branch_created ON public.orders(business_id, branch_id, created_at);
CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_device_pairing_codes_bus_branch ON public.device_pairing_codes(business_id, branch_id);
CREATE INDEX idx_audit_logs_bus_created ON public.audit_logs(business_id, created_at);

-- =========================================================
-- SECURE INITIALIZATION RPC & HELPERS
-- =========================================================

-- Create a secure schema for internal helpers
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_business_member(biz_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.business_memberships
    WHERE business_id = biz_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Revoke all execute rights from public and anon on the private function
REVOKE ALL ON FUNCTION private.is_business_member(UUID) FROM PUBLIC, anon;
-- Grant execute to authenticated users so policies can use it
GRANT EXECUTE ON FUNCTION private.is_business_member(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION private.is_business_owner(biz_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.business_memberships
    WHERE business_id = biz_id AND user_id = auth.uid() AND role = 'OWNER'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Revoke all execute rights from public and anon on the private function
REVOKE ALL ON FUNCTION private.is_business_owner(UUID) FROM PUBLIC, anon;
-- Grant execute to authenticated users so policies can use it
GRANT EXECUTE ON FUNCTION private.is_business_owner(UUID) TO authenticated;

-- Initialization RPC for atomic business + membership + branch
CREATE OR REPLACE FUNCTION public.create_business_with_owner_and_branch(
    business_name TEXT,
    branch_name TEXT,
    branch_location TEXT DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    new_business_id UUID;
    new_branch_id UUID;
    clean_business_name TEXT;
    clean_branch_name TEXT;
    current_uid UUID;
BEGIN
    current_uid := auth.uid();
    
    -- Ensure user is authenticated
    IF current_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    clean_business_name := trim(business_name);
    clean_branch_name := trim(branch_name);

    IF clean_business_name = '' OR clean_business_name IS NULL THEN
        RAISE EXCEPTION 'Business name cannot be empty';
    END IF;

    IF clean_branch_name = '' OR clean_branch_name IS NULL THEN
        RAISE EXCEPTION 'Branch name cannot be empty';
    END IF;

    -- 1. Create Business
    INSERT INTO public.businesses (name, owner_id, onboarding_status)
    VALUES (clean_business_name, current_uid, 'NOT_STARTED')
    RETURNING id INTO new_business_id;

    -- 2. Create Owner Membership
    INSERT INTO public.business_memberships (business_id, user_id, role)
    VALUES (new_business_id, current_uid, 'OWNER');

    -- 3. Create First Branch
    INSERT INTO public.branches (business_id, name, location)
    VALUES (new_business_id, clean_branch_name, branch_location)
    RETURNING id INTO new_branch_id;

    RETURN jsonb_build_object(
        'business_id', new_business_id,
        'branch_id', new_branch_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Revoke from public and anon, grant to authenticated only
REVOKE ALL ON FUNCTION public.create_business_with_owner_and_branch(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner_and_branch(TEXT, TEXT, TEXT) TO authenticated;

-- =========================================================
-- ENABLE RLS
-- =========================================================

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- GRANTS & REVOKES
-- =========================================================

REVOKE ALL ON TABLE public.businesses FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.businesses TO authenticated;

REVOKE ALL ON TABLE public.business_memberships FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_memberships TO authenticated;

REVOKE ALL ON TABLE public.branches FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branches TO authenticated;

REVOKE ALL ON TABLE public.devices FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.devices TO authenticated;

REVOKE ALL ON TABLE public.staff_members FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_members TO authenticated;

REVOKE ALL ON TABLE public.catalog_products FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.catalog_products TO authenticated;

REVOKE ALL ON TABLE public.orders FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO authenticated;

REVOKE ALL ON TABLE public.order_items FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_items TO authenticated;

REVOKE ALL ON TABLE public.device_pairing_codes FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_pairing_codes TO authenticated;

REVOKE ALL ON TABLE public.audit_logs FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_logs TO authenticated;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- Businesses
CREATE POLICY "Users can view businesses they belong to"
    ON public.businesses FOR SELECT TO authenticated
    USING (private.is_business_member(id) OR owner_id = auth.uid());

CREATE POLICY "Owners can update their businesses"
    ON public.businesses FOR UPDATE TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Business Memberships
CREATE POLICY "Users can view memberships for their businesses"
    ON public.business_memberships FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Owners can manage memberships"
    ON public.business_memberships FOR INSERT TO authenticated
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can update memberships"
    ON public.business_memberships FOR UPDATE TO authenticated
    USING (private.is_business_owner(business_id))
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can delete memberships"
    ON public.business_memberships FOR DELETE TO authenticated
    USING (private.is_business_owner(business_id));

-- Branches
CREATE POLICY "Users can view branches for their businesses"
    ON public.branches FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Owners can insert branches for their businesses"
    ON public.branches FOR INSERT TO authenticated
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can update branches for their businesses"
    ON public.branches FOR UPDATE TO authenticated
    USING (private.is_business_owner(business_id))
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can delete branches for their businesses"
    ON public.branches FOR DELETE TO authenticated
    USING (private.is_business_owner(business_id));

-- Devices
CREATE POLICY "Users can view devices for their businesses"
    ON public.devices FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Owners can manage devices for their businesses"
    ON public.devices FOR INSERT TO authenticated
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can update devices for their businesses"
    ON public.devices FOR UPDATE TO authenticated
    USING (private.is_business_owner(business_id))
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can delete devices for their businesses"
    ON public.devices FOR DELETE TO authenticated
    USING (private.is_business_owner(business_id));

-- Staff Members
CREATE POLICY "Users can view staff for their businesses"
    ON public.staff_members FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Users can manage staff for their businesses"
    ON public.staff_members FOR INSERT TO authenticated
    WITH CHECK (private.is_business_member(business_id));

CREATE POLICY "Users can update staff for their businesses"
    ON public.staff_members FOR UPDATE TO authenticated
    USING (private.is_business_member(business_id))
    WITH CHECK (private.is_business_member(business_id));

CREATE POLICY "Users can delete staff for their businesses"
    ON public.staff_members FOR DELETE TO authenticated
    USING (private.is_business_member(business_id));

-- Catalog Products
CREATE POLICY "Users can view products for their businesses"
    ON public.catalog_products FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Users can manage products for their businesses"
    ON public.catalog_products FOR INSERT TO authenticated
    WITH CHECK (private.is_business_member(business_id));

CREATE POLICY "Users can update products for their businesses"
    ON public.catalog_products FOR UPDATE TO authenticated
    USING (private.is_business_member(business_id))
    WITH CHECK (private.is_business_member(business_id));

CREATE POLICY "Users can delete products for their businesses"
    ON public.catalog_products FOR DELETE TO authenticated
    USING (private.is_business_member(business_id));

-- Orders
CREATE POLICY "Users can view orders for their businesses"
    ON public.orders FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Users can insert orders for their businesses"
    ON public.orders FOR INSERT TO authenticated
    WITH CHECK (private.is_business_member(business_id));

CREATE POLICY "Users can update orders for their businesses"
    ON public.orders FOR UPDATE TO authenticated
    USING (private.is_business_member(business_id))
    WITH CHECK (private.is_business_member(business_id));
-- Intentionally NO delete policy for orders

-- Order Items
CREATE POLICY "Users can view order items via parent order"
    ON public.order_items FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.orders WHERE public.orders.id = public.order_items.order_id AND private.is_business_member(public.orders.business_id)
    ));

CREATE POLICY "Users can insert order items via parent order"
    ON public.order_items FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.orders WHERE public.orders.id = public.order_items.order_id AND private.is_business_member(public.orders.business_id)
    ));

CREATE POLICY "Users can update order items via parent order"
    ON public.order_items FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.orders WHERE public.orders.id = public.order_items.order_id AND private.is_business_member(public.orders.business_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.orders WHERE public.orders.id = public.order_items.order_id AND private.is_business_member(public.orders.business_id)
    ));

-- Device Pairing Codes
CREATE POLICY "Users can view pairing codes for their businesses"
    ON public.device_pairing_codes FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Owners can manage pairing codes for their businesses"
    ON public.device_pairing_codes FOR INSERT TO authenticated
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can update pairing codes for their businesses"
    ON public.device_pairing_codes FOR UPDATE TO authenticated
    USING (private.is_business_owner(business_id))
    WITH CHECK (private.is_business_owner(business_id));

CREATE POLICY "Owners can delete pairing codes for their businesses"
    ON public.device_pairing_codes FOR DELETE TO authenticated
    USING (private.is_business_owner(business_id));

-- Audit Logs
CREATE POLICY "Users can view audit logs for their businesses"
    ON public.audit_logs FOR SELECT TO authenticated
    USING (private.is_business_member(business_id));

CREATE POLICY "Users can insert audit logs for their businesses"
    ON public.audit_logs FOR INSERT TO authenticated
    WITH CHECK (private.is_business_member(business_id));

