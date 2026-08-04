# License-Based Access Control & Super Admin Onboarding App

This implementation plan details the technical architecture and execution steps for introducing **license-based tenant access with automated expiration enforcement (1 year from onboarding date)** and developing a **Super Admin Web Application** to streamline multi-tenant provisioning across CloudPOS (`POS-v2` and `ADMIN-v2`).

---

## User Review Required

> [!IMPORTANT]
> **RLS Helper Function Augmentation**
> To enforce license expiration uniformly across all POS terminals and admin panels without relying solely on client-side checks, we propose augmenting the existing database RLS helper function `public.is_org_member(p_organization_id uuid)`. It will verify both user membership AND ensure that the organization's license has not expired (`license_expires_at >= now()` or `status = 'active'`). 
> * **Impact:** When a license expires, queries to POS orders, products, and admin reports will immediately return empty results or permission failures for normal users until renewed.

> [!WARNING]
> **Super Admin Authorization Strategy**
> In compliance with Supabase Security Best Practices, super admin authorization will **NEVER** use editable user metadata (`raw_user_meta_data`). We will implement Super Admin identification via `auth.users.raw_app_meta_data ->> 'is_super_admin' = 'true'` and backed by a dedicated `public.super_admins` registry table protected by RLS.

---

## Resolved Design Decisions

> [!NOTE]
> **Grace Period & Read-Only Expiry Behavior (Approved)**
> A **7-day warning banner** will be displayed in both POS and Admin apps leading up to license expiration. After expiry, **INSERT/UPDATE operations will be blocked via RLS**, while **SELECT (read-only) access will remain available for 30 days** to allow admin historical exports before full lockout.

> [!NOTE]
> **Super Admin App Housing (Approved)**
> The Super Admin Onboarding UI will be built as a **standalone web application (`SUPER-ADMIN-v1`)** using Vite + React + TypeScript + Vanilla CSS, isolated from standard staff codebases to maintain a clean security boundary for service-role operations and billing features.

---

## Proposed Changes

### Component 1: Database Schema & Licensing Architecture (Supabase Migrations)

We will standardize license management using direct tenant licensing attributes combined with the existing `public.subscriptions` and `public.plans` structures.

#### [NEW] [20260810000000_license_enforcement.sql](file:///c:/Users/shadh/.gemini/antigravity/scratch/CloudPOS/supabase/migrations/20260810000000_license_enforcement.sql)
* **Add License Tracking Columns to Organizations:**
  ```sql
  -- Note: organizations already has status CHECK ('active', 'suspended', 'closed')
  -- We add license-specific columns without altering the existing status constraint.
  ALTER TABLE public.organizations 
  ADD COLUMN license_status text NOT NULL DEFAULT 'active' 
    CHECK (license_status IN ('active', 'expired', 'suspended', 'grace_period')),
  ADD COLUMN license_starts_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN license_expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '1 year'),
  ADD COLUMN license_grace_ends_at timestamp with time zone 
    GENERATED ALWAYS AS (license_expires_at + interval '30 days') STORED;
  
  CREATE INDEX idx_organizations_license_expiry 
    ON public.organizations(license_expires_at, license_status);
  ```
* **Create Super Admin Registry & RLS Protection:**
  ```sql
  CREATE TABLE public.super_admins (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
  );
  ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
  
  -- Only existing super admins can view or modify super admins
  CREATE POLICY super_admin_policy ON public.super_admins
  FOR ALL TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true');
  ```
* **Create License Enforcement Helper (new function, not modifying existing `is_org_member`):**
  ```sql
  -- IMPORTANT: We do NOT modify is_org_member directly.
  -- is_org_member has a session-cache optimization (app.current_organization_id)
  -- and an overload. Modifying it risks breaking all existing RLS policies.
  -- Instead, we create a separate helper for write-path enforcement.
  CREATE OR REPLACE FUNCTION public.is_org_licensed_for_writes(p_organization_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY INVOKER
  AS $$
  BEGIN
    -- Service role bypass
    IF auth.uid() IS NULL THEN RETURN TRUE; END IF;
    
    -- Super admin bypass
    IF (SELECT auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true' THEN
      RETURN TRUE;
    END IF;

    RETURN EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = p_organization_id
        AND license_status IN ('active', 'grace_period')
        AND license_expires_at >= (now() - interval '30 days')
    );
  END;
  $$;
  ```
* **Automated License Expiry Cron (via pg_cron):**
  ```sql
  -- Runs daily at midnight UTC to flip expired licenses
  SELECT cron.schedule('expire-licenses', '0 0 * * *', $$
    UPDATE public.organizations
    SET license_status = CASE
      WHEN license_expires_at < now() - interval '30 days' THEN 'expired'
      WHEN license_expires_at < now() THEN 'grace_period'
      ELSE license_status
    END,
    updated_at = now()
    WHERE license_status IN ('active', 'grace_period')
      AND license_expires_at < now();
  $$);
  ```
* **Seed Standard 1-Year License Plan:**
  * Insert default commercial plan into `public.plans` (table exists but is currently empty in PROD): `'CloudPOS Enterprise Annual'`.

---

### Component 2: Automated Provisioning & License Engine (Supabase Edge Functions)

Creating authentication users, assigning passwords/OTPs, and writing across 8 core multi-tenant tables requires elevated atomic execution to prevent partial onboarding failures.

#### [NEW] [onboard-tenant/index.ts](file:///c:/Users/shadh/.gemini/antigravity/scratch/CloudPOS/supabase/functions/onboard-tenant/index.ts)
* Create an atomic Deno Edge Function executed with the `service_role` key (callable exclusively by verified Super Admins via JWT inspection).
* **Workflow:**
  1. Validates caller's JWT `app_metadata.is_super_admin === 'true'`.
  2. Creates target tenant Auth User in Supabase Auth using `auth.admin.createUser()`.
  3. Executes an atomic SQL transaction (via RPC or sequential verified inserts):
     * Inserts `public.users` profile (id, email, name, is_active).
     * Inserts `public.organizations` with `license_expires_at = now() + 365 days` and `license_status = 'active'`.
     * Inserts `public.subscriptions` linking the org to the Annual Plan.
     * Inserts `public.branches` and `ims.stock_locations`.
     * Inserts `public.organization_memberships` with valid `member_type` (`'owner'` for the first user) and assigned `role_id` from `public.app_roles`. **Note:** Must respect the CHECK constraint: `member_type IN ('staff', 'owner', 'partner', 'investor', 'auditor')`.
     * Inserts `public.staff_branch_access` (only required if `member_type = 'staff'`).
     * Inserts default terminal and receipt printer records in `public.terminals` & `public.printers`.
  4. Returns credentials, org ID, and onboarding summary.
* **Rollback & Safety:** If any step fails (e.g., duplicate email or `(organization_id, user_id)` unique constraint violation on `organization_memberships`), deletes the auth user and rolls back all db edits.

---

### Component 3: Super Admin Onboarding Web Application (`SUPER-ADMIN-v1`)

A stunning, responsive web application designed for operations teams to provision and monitor tenants in real-time without running manual scripts or touching SQL.

#### [NEW] `SUPER-ADMIN-v1` Project Structure
* Built using Vite + React + TypeScript + Vanilla CSS (with sleek dark mode, vibrant gradients, glassmorphism card layouts, and micro-animations for an executive-grade UI).
* **Core Views:**
  1. **Secure Login Screen:** Restricts entry strictly to accounts with verified Super Admin claims.
  2. **Tenant Discovery & License Dashboard:**
     * Data table listing all Organizations with real-time status pills (`Active`, `Expiring Soon`, `Expired`).
     * Progress bars representing license expiration timelines (days remaining out of 365).
     * 1-Click "Extend License (1 Year)" quick action modal.
  3. **Multi-Step 1-Click Onboarding Wizard:**
     * **Step 1: Tenant Details:** Legal Name, Trade Name, Country, Annual License validity toggle.
     * **Step 2: Flagship Branch & Inventory:** Branch Name, Code, Main Stock Warehouse Name.
     * **Step 3: Initial Staff & Roles:** Owner/Manager Admin email, Full Name, Initial Password / Email Invite toggle.
     * **Step 4: POS Terminal & Printer Config:** Default POS Terminal Code, Printer designation.
     * **Step 5: Review & Provision:** Displays a comprehensive verification summary, invokes `onboard-tenant` Edge Function, and renders a celebratory success report with downloadable PDF / Clipboard credentials.
  4. **Tenant Detail View:** Allows viewing and editing existing branches, users, and renewing subscriptions for any client organization.

---

### Component 4: POS-v2 & ADMIN-v2 Client License Enforcement & UI Notice

Update existing client applications to interpret license states and provide user-friendly alerts.

#### [MODIFY] [OrganizationContext.tsx](file:///c:/Users/shadh/.gemini/antigravity/scratch/CloudPOS/POS-v2/src/contexts/OrganizationContext.tsx) & [OrganizationContext.tsx](file:///c:/Users/shadh/.gemini/antigravity/scratch/CloudPOS/ADMIN-v2/src/contexts/OrganizationContext.tsx)
* Expand the query to fetch `license_status` and `license_expires_at` alongside organization details.
* Export license health attributes in the Context provider: `isExpired`, `daysUntilExpiry`, `licenseExpiryDate`.

#### [NEW] `LicenseStatusBanner.tsx` (In both POS-v2 and ADMIN-v2)
* Render a non-intrusive warning banner at the top of the screen when `daysUntilExpiry <= 7` (7-day grace warning window, per approved design).
* Display escalating urgency: amber at 7 days, red at 3 days, with countdown text (e.g., *"⚠️ Your organization's annual license will expire in 3 days. Please contact your account manager to renew."*).
* If `license_status === 'grace_period'`, render a persistent red banner: *"Your license has expired. New orders and modifications are disabled. You have X days of read-only access remaining."*
* If `license_status === 'expired'` (past 30-day grace), render a full-screen locking modal preventing all app usage while directing administrators to support channels.

---

## Verification Plan

### Automated & Database Tests
1. **RLS & Expiry Validation Script:**
   * Run test queries via Node/PostgreSQL directly against staging/test instances to verify that queries with an expired org (`license_expires_at < now()`) correctly block write modifications while adhering to grace period rules.
2. **Edge Function Atomicity Test:**
   * Invoke `onboard-tenant` with mock payload; verify all 8 database tables receive matching `organization_id` and `branch_id` records, and confirm license expiry timestamp is accurately computed to +365 days.
   * Attempt invocation with a regular user JWT to confirm a HTTP `403 Forbidden` rejection.

### Manual & UI Verification
1. **End-to-End Super Admin Provisioning:**
   * Launch `SUPER-ADMIN-v1` locally (`npm run dev`).
   * Log in with Super Admin credentials, navigate to the Onboarding Wizard, and submit a complete new tenant setup ("Apex Retail Group").
   * Verify instant feedback and proper card rendering on the Tenant Dashboard showing 365 days remaining.
2. **POS Terminal & Back-Office Login:**
   * Open `POS-v2` and log in using the newly generated cashier/manager credentials from the wizard.
   * Verify zero "Required field: Branch" errors, successful branch context initialization, and immediate access to order screens.
   * Simulate license expiration by altering `license_expires_at` in the DB to yesterday, refresh `POS-v2`, and visually verify the Lockout / License Expired screen.
