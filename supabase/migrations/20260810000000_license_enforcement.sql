-- =============================================================================
-- Migration: License Enforcement & Super Admin Infrastructure
-- Description: Adds license-based access control to organizations, creates
--              super_admins registry, license enforcement helper function,
--              and automated pg_cron expiry job.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add License Tracking Columns to public.organizations
-- ---------------------------------------------------------------------------
-- Note: organizations already has status CHECK ('active', 'suspended', 'closed')
-- We add separate license_status columns without altering the existing status
-- constraint. The org status represents business state; license_status
-- represents SaaS subscription state.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS license_status text NOT NULL DEFAULT 'active'
    CHECK (license_status IN ('active', 'expired', 'suspended', 'grace_period')),
  ADD COLUMN IF NOT EXISTS license_starts_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS license_expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 year'),
  ADD COLUMN IF NOT EXISTS license_grace_ends_at timestamptz DEFAULT (now() + interval '1 year' + interval '30 days');

-- Composite index for the cron job and license enforcement queries
CREATE INDEX IF NOT EXISTS idx_organizations_license_expiry
  ON public.organizations (license_expires_at, license_status);

-- Backfill existing organizations with a 1-year license from now
-- (They were created before licensing existed, so we grant them a fresh year)
UPDATE public.organizations
SET license_starts_at = now(),
    license_expires_at = now() + interval '1 year',
    license_grace_ends_at = now() + interval '1 year' + interval '30 days',
    license_status = 'active'
WHERE license_status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Super Admin Registry Table
-- ---------------------------------------------------------------------------
-- A dedicated table to track which users have super admin privileges.
-- Protected by RLS: only existing super admins can view/modify.

CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

-- Only super admins (identified via app_metadata) can access this table
CREATE POLICY super_admin_select_policy ON public.super_admins
  FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

CREATE POLICY super_admin_insert_policy ON public.super_admins
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

CREATE POLICY super_admin_delete_policy ON public.super_admins
  FOR DELETE TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

-- Organizations RLS: Allow super admins to view and manage all tenant organizations
DROP POLICY IF EXISTS "Super admins can select all organizations" ON public.organizations;
CREATE POLICY "Super admins can select all organizations" ON public.organizations
  FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

DROP POLICY IF EXISTS "Super admins can update all organizations" ON public.organizations;
CREATE POLICY "Super admins can update all organizations" ON public.organizations
  FOR UPDATE TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

-- Branches, Memberships, & Users RLS: Allow super admins to view all tenant records
DROP POLICY IF EXISTS "Super admins can select all branches" ON public.branches;
CREATE POLICY "Super admins can select all branches" ON public.branches
  FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

DROP POLICY IF EXISTS "Super admins can select all organization memberships" ON public.organization_memberships;
CREATE POLICY "Super admins can select all organization memberships" ON public.organization_memberships
  FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

DROP POLICY IF EXISTS "Super admins can select all user profiles" ON public.users;
CREATE POLICY "Super admins can select all user profiles" ON public.users
  FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');

-- ---------------------------------------------------------------------------
-- 3. License Enforcement Helper Function
-- ---------------------------------------------------------------------------
-- IMPORTANT: We do NOT modify the existing is_org_member() function.
-- is_org_member has a session-cache optimization (app.current_organization_id)
-- and an overload. Modifying it risks breaking all existing RLS policies.
-- Instead, we create a separate helper for write-path enforcement only.

CREATE OR REPLACE FUNCTION public.is_org_licensed_for_writes(p_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $$
BEGIN
  -- Service role bypass (NULL uid means service_role or internal call)
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Super admin bypass via app_metadata claim
  IF (SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true' THEN
    RETURN TRUE;
  END IF;

  -- Check organization has an active or grace-period license
  RETURN EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id
      AND license_status IN ('active', 'grace_period')
      AND license_expires_at >= (now() - interval '30 days')
  );
END;
$$;

COMMENT ON FUNCTION public.is_org_licensed_for_writes(uuid) IS
  'Returns TRUE if the organization has a valid license for write operations. '
  'Used by RLS policies to block INSERT/UPDATE when license is expired. '
  'Super admins and service_role bypass this check.';

-- ---------------------------------------------------------------------------
-- 4. Automated License Expiry Cron Job (pg_cron)
-- ---------------------------------------------------------------------------
-- Runs daily at midnight UTC to transition license statuses:
--   active -> grace_period (when license_expires_at < now())
--   grace_period -> expired (when 30-day grace window has passed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.schedule(
    'expire-licenses',
    '0 0 * * *',
    'UPDATE public.organizations SET license_status = CASE WHEN license_expires_at < now() - interval ''30 days'' THEN ''expired'' WHEN license_expires_at < now() THEN ''grace_period'' ELSE license_status END, updated_at = now() WHERE license_status IN (''active'', ''grace_period'') AND license_expires_at < now();'
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling could not be initialized (error: %); skipping automated cron creation.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Seed Default License Plan
-- ---------------------------------------------------------------------------
-- The public.plans table exists but is empty in PROD.
-- Insert the standard annual enterprise plan.

INSERT INTO public.plans (id, name, code, price_monthly, features, is_active)
VALUES (
  gen_random_uuid(),
  'CloudPOS Enterprise Annual',
  'enterprise_annual',
  0.00, -- Price managed externally; this is the plan reference
  '{"max_branches": 50, "max_users": 200, "max_terminals": 100, "includes": ["pos", "admin", "ims"], "license_duration_days": 365}'::jsonb,
  true
)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Atomic Tenant Provisioning Procedure
-- ---------------------------------------------------------------------------
-- Called by onboard-tenant Edge Function to execute all database insertions
-- within a single atomic transaction.

CREATE OR REPLACE FUNCTION public.provision_tenant_atomic(
  p_user_id uuid,
  p_user_email text,
  p_user_name text,
  p_legal_name text,
  p_trade_name text,
  p_country_code text,
  p_license_days int,
  p_branch_name text,
  p_branch_code text,
  p_stock_code text,
  p_stock_name text,
  p_stock_kind text,
  p_member_type text,
  p_role_name text,
  p_terminal_code text,
  p_device_type text,
  p_printer_name text,
  p_printer_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ims
AS $$
DECLARE
  v_org_id uuid := gen_random_uuid();
  v_branch_id uuid := gen_random_uuid();
  v_stock_loc_id uuid := gen_random_uuid();
  v_terminal_id uuid := gen_random_uuid();
  v_printer_id uuid := gen_random_uuid();
  v_role_id uuid;
  v_plan_id uuid;
  v_result jsonb;
BEGIN
  -- 1. Lookup app role
  SELECT id INTO v_role_id FROM public.app_roles WHERE name = p_role_name LIMIT 1;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'App role "%" not found in public.app_roles', p_role_name;
  END IF;

  -- 2. Lookup default plan
  SELECT id INTO v_plan_id FROM public.plans WHERE code = 'enterprise_annual' AND is_active = true LIMIT 1;

  -- 3. Create application user profile
  INSERT INTO public.users (id, email, name, is_active)
  VALUES (p_user_id, p_user_email, p_user_name, true)
  ON CONFLICT (id) DO UPDATE SET is_active = true, name = EXCLUDED.name;

  -- 4. Create organization with license
  INSERT INTO public.organizations (
    id, legal_name, trade_name, country_code, status,
    license_status, license_starts_at, license_expires_at, license_grace_ends_at
  ) VALUES (
    v_org_id, p_legal_name, COALESCE(p_trade_name, p_legal_name), p_country_code, 'active',
    'active', now(), now() + (p_license_days || ' days')::interval, now() + (p_license_days || ' days')::interval + interval '30 days'
  );

  -- 5. Create subscription if plan exists
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (organization_id, plan_id, status, current_period_end)
    VALUES (v_org_id, v_plan_id, 'active', now() + (p_license_days || ' days')::interval);
  END IF;

  -- 6. Create branch
  INSERT INTO public.branches (id, organization_id, name, branch_code, status)
  VALUES (v_branch_id, v_org_id, p_branch_name, p_branch_code, 'active');

  -- 7. Create stock location
  INSERT INTO ims.stock_locations (id, organization_id, branch_id, code, name, kind, is_active)
  VALUES (v_stock_loc_id, v_org_id, v_branch_id, p_stock_code, p_stock_name, p_stock_kind, true);

  -- 8. Create organization membership
  INSERT INTO public.organization_memberships (organization_id, user_id, member_type, role_id, status)
  VALUES (v_org_id, p_user_id, p_member_type, v_role_id, 'active');

  -- 9. Create staff branch access (for staff members)
  IF p_member_type = 'staff' THEN
    INSERT INTO public.staff_branch_access (organization_id, user_id, branch_id, status)
    VALUES (v_org_id, p_user_id, v_branch_id, 'active');
  END IF;

  -- 10. Create POS terminal
  INSERT INTO public.terminals (id, organization_id, branch_id, terminal_code, device_type, status)
  VALUES (v_terminal_id, v_org_id, v_branch_id, p_terminal_code, p_device_type, 'active');

  -- 11. Create receipt printer
  INSERT INTO public.printers (id, organization_id, branch_id, name, type, status, is_default)
  VALUES (v_printer_id, v_org_id, v_branch_id, p_printer_name, p_printer_type, 'connected', true);

  -- Build return JSON
  v_result := jsonb_build_object(
    'org_id', v_org_id,
    'branch_id', v_branch_id,
    'stock_loc_id', v_stock_loc_id,
    'terminal_id', v_terminal_id,
    'printer_id', v_printer_id
  );

  RETURN v_result;
END;
$$;

COMMIT;
