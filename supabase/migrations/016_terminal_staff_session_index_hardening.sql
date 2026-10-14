-- Supabase Migration: 016_terminal_staff_session_index_hardening.sql
-- Description: Add covering indexes for the R014 terminal staff-session
--              challenge foreign keys identified by the live Supabase
--              performance advisor after the R001-R015 staging rehearsal.
--
-- This migration is intentionally additive. It changes no RLS policy,
-- privilege, trigger, function, session rule, or operational authority fact.

DO $r016_preflight$
BEGIN
    IF to_regclass('public.hub_terminal_staff_session_challenges') IS NULL
       OR to_regclass('public.branches') IS NULL
       OR to_regclass('public.businesses') IS NULL
       OR to_regclass('public.devices') IS NULL
       OR to_regclass('public.hub_staff_sessions') IS NULL
       OR to_regclass('public.staff_members') IS NULL THEN
        RAISE EXCEPTION 'R016_REQUIRES_COMPLETE_R014_BASELINE';
    END IF;
END;
$r016_preflight$;

CREATE INDEX IF NOT EXISTS idx_hub_terminal_staff_session_challenges_branch_id
    ON public.hub_terminal_staff_session_challenges (branch_id);

CREATE INDEX IF NOT EXISTS idx_hub_terminal_staff_session_challenges_business_id
    ON public.hub_terminal_staff_session_challenges (business_id);

CREATE INDEX IF NOT EXISTS idx_hub_terminal_staff_session_challenges_hub_device_id
    ON public.hub_terminal_staff_session_challenges (hub_device_id);

CREATE INDEX IF NOT EXISTS idx_hub_terminal_staff_session_challenges_prepared_session_id
    ON public.hub_terminal_staff_session_challenges (prepared_session_id);

CREATE INDEX IF NOT EXISTS idx_hub_terminal_staff_session_challenges_staff_id
    ON public.hub_terminal_staff_session_challenges (staff_id);
