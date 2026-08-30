-- QUARANTINED — NOT A DEPLOYMENT INPUT
--
-- This file is a historical browser-prototype schema recovered with the
-- redesign archive. It contradicts the canonical ordered migrations under
-- `supabase/migrations/` and the verified R001 production foundation (text
-- IDs, JSON order items, broad browser-era policies, and obsolete device
-- records). It must never be run in Supabase SQL Editor, the Supabase CLI, or
-- a release workflow.
--
-- Retained only for forensic comparison. The release authority is:
--   1. docs/operations/RELEASE_STATUS.md
--   2. supabase/migrations/001_mvp_core.sql, then ordered migrations
--   3. preflight/validation scripts and an accepted staging evidence record
--
-- ThePlugOS historical browser-prototype schema (forensic reference only)

CREATE TABLE IF NOT EXISTS public.businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT,
    phone TEXT,
    type TEXT DEFAULT 'FASTFOOD',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.branches (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT,
    domain TEXT DEFAULT 'fastfood-domain',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.staff_members (
    id TEXT PRIMARY KEY,
    auth_id TEXT,
    business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id TEXT,
    branch_name TEXT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'CASHIER',
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.catalog_products (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    category TEXT DEFAULT 'General',
    sku TEXT,
    in_stock BOOLEAN DEFAULT TRUE,
    image_url TEXT,
    tax_rate NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.device_pairing_codes (
    id TEXT PRIMARY KEY,
    pairing_code TEXT NOT NULL,
    code TEXT NOT NULL,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'Owner',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'USED', 'EXPIRED', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_pairing_code_lookup ON public.device_pairing_codes(pairing_code, status);
CREATE INDEX IF NOT EXISTS idx_pairing_code_synonym ON public.device_pairing_codes(code, status);
CREATE INDEX IF NOT EXISTS idx_pairing_branch ON public.device_pairing_codes(branch_id, status);

CREATE TABLE IF NOT EXISTS public.devices (
    device_id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'CASHIER',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    cert_fingerprint TEXT,
    connection_type TEXT DEFAULT 'LAN_WIFI',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.device_records (
    device_id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'CASHIER',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    items JSONB DEFAULT '[]'::jsonb,
    total NUMERIC(10,2) DEFAULT 0.00,
    tax NUMERIC(10,2) DEFAULT 0.00,
    status TEXT DEFAULT 'COMPLETED',
    cashier_id TEXT,
    cashier_name TEXT,
    payment_method TEXT DEFAULT 'CASH',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    business_id TEXT,
    branch_id TEXT,
    event_type TEXT NOT NULL,
    actor_id TEXT,
    entity_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) Enablement & Policies
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for read/write on pairing and device registration
DROP POLICY IF EXISTS "Anon device_pairing_codes policy" ON public.device_pairing_codes;
CREATE POLICY "Anon device_pairing_codes policy" ON public.device_pairing_codes
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon devices policy" ON public.devices;
CREATE POLICY "Anon devices policy" ON public.devices
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon device_records policy" ON public.device_records;
CREATE POLICY "Anon device_records policy" ON public.device_records
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon businesses policy" ON public.businesses;
CREATE POLICY "Anon businesses policy" ON public.businesses
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon branches policy" ON public.branches;
CREATE POLICY "Anon branches policy" ON public.branches
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon staff_members policy" ON public.staff_members;
CREATE POLICY "Anon staff_members policy" ON public.staff_members
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon catalog_products policy" ON public.catalog_products;
CREATE POLICY "Anon catalog_products policy" ON public.catalog_products
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon orders policy" ON public.orders;
CREATE POLICY "Anon orders policy" ON public.orders
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon audit_logs policy" ON public.audit_logs;
CREATE POLICY "Anon audit_logs policy" ON public.audit_logs
    FOR ALL USING (true) WITH CHECK (true);
