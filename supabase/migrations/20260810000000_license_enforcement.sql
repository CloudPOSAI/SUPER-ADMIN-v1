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

COMMIT;
