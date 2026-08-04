// =============================================================================
// Edge Function: onboard-tenant
// Description: Atomic tenant provisioning callable exclusively by verified
//              Super Admins. Creates auth user, profile, org, branch,
//              membership, stock location, terminal, and printer in a single
//              atomic transaction with full rollback on failure.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface OnboardRequest {
  // Tenant Details
  legal_name: string;
  trade_name: string;
  country_code?: string; // Default: 'AE'
  license_duration_days?: number; // Default: 365

  // Branch Details
  branch_name: string;
  branch_code: string;

  // Stock Location
  stock_location_code: string;
  stock_location_name?: string;
  stock_location_kind?: "store" | "warehouse"; // Default: 'store'

  // Initial User
  user_email: string;
  user_name: string;
  user_phone?: string;
  user_password: string;
  member_type?: "owner" | "staff" | "partner" | "investor" | "auditor"; // Default: 'owner'
  role_name?: string; // Default: 'Owner' for first user

  // Terminal & Printer
  terminal_code: string;
  terminal_device_type?: string; // Default: 'POS Desktop'
  printer_name?: string; // Default: 'Receipt Printer'
  printer_type?: "receipt" | "kitchen"; // Default: 'receipt'
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Validate Super Admin Authorization
    // -----------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    // Create a client with the caller's JWT to verify identity
    const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callerUser },
      error: callerError,
    } = await callerClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    // Verify super admin claim in app_metadata
    const isSuperAdmin =
      callerUser.app_metadata?.is_super_admin === true ||
      callerUser.app_metadata?.is_super_admin === "true";

    if (!isSuperAdmin) {
      return new Response(
        JSON.stringify({
          error: "Forbidden: Super Admin privileges required",
        }),
        {
          status: 403,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    // -----------------------------------------------------------------------
    // 2. Parse & Validate Request Body
    // -----------------------------------------------------------------------
    const body: OnboardRequest = await req.json();

    const requiredFields = [
      "legal_name",
      "branch_name",
      "branch_code",
      "stock_location_code",
      "user_email",
      "user_name",
      "user_password",
      "terminal_code",
    ];

    for (const field of requiredFields) {
      if (!body[field as keyof OnboardRequest]) {
        return new Response(
          JSON.stringify({ error: `Missing required field: ${field}` }),
          {
            status: 400,
            headers: { ...corsHeaders(), "Content-Type": "application/json" },
          }
        );
      }
    }

    // Apply defaults
    const countryCode = body.country_code || "AE";
    const licenseDays = body.license_duration_days || 365;
    const memberType = body.member_type || "owner";
    const roleName = body.role_name || "Owner";
    const stockKind = body.stock_location_kind || "store";
    const stockName =
      body.stock_location_name || `${body.branch_name} - Main Store`;
    const deviceType = body.terminal_device_type || "POS Desktop";
    const printerName = body.printer_name || "Receipt Printer";
    const printerType = body.printer_type || "receipt";

    // -----------------------------------------------------------------------
    // 3. Create Service Role Client for Privileged Operations
    // -----------------------------------------------------------------------
    const adminClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // -----------------------------------------------------------------------
    // 4. Create Auth User via Admin API
    // -----------------------------------------------------------------------
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email: body.user_email,
        password: body.user_password,
        phone: body.user_phone || undefined,
        email_confirm: true,
        phone_confirm: body.user_phone ? true : false,
        user_metadata: { name: body.user_name },
      });

    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({
          error: `Auth user creation failed: ${authError?.message}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    const userId = authData.user.id;

    // -----------------------------------------------------------------------
    // 5. Atomic Database Provisioning via SQL Transaction
    // -----------------------------------------------------------------------
    // Using a single SQL transaction via RPC to ensure atomicity.
    // If any step fails, everything rolls back including the auth user cleanup.

    const provisionSQL = `
      DO $$
      DECLARE
        v_user_id uuid := '${userId}'::uuid;
        v_org_id uuid := gen_random_uuid();
        v_branch_id uuid := gen_random_uuid();
        v_stock_loc_id uuid := gen_random_uuid();
        v_terminal_id uuid := gen_random_uuid();
        v_printer_id uuid := gen_random_uuid();
        v_role_id uuid;
        v_plan_id uuid;
      BEGIN
        -- Lookup app role
        SELECT id INTO v_role_id FROM public.app_roles
          WHERE name = '${roleName}' LIMIT 1;
        IF v_role_id IS NULL THEN
          RAISE EXCEPTION 'App role "%" not found in public.app_roles', '${roleName}';
        END IF;

        -- Lookup default plan (optional, may not exist)
        SELECT id INTO v_plan_id FROM public.plans
          WHERE code = 'enterprise_annual' AND is_active = true LIMIT 1;

        -- (a) Create application user profile
        INSERT INTO public.users (id, email, name, is_active, totp_enabled, failed_auth_attempts)
        VALUES (v_user_id, '${body.user_email}', '${body.user_name}', true, false, 0);

        -- (b) Create organization with license
        INSERT INTO public.organizations (
          id, legal_name, trade_name, country_code, status,
          license_status, license_starts_at, license_expires_at
        ) VALUES (
          v_org_id,
          '${body.legal_name}',
          '${body.trade_name || body.legal_name}',
          '${countryCode}',
          'active',
          'active',
          now(),
          now() + interval '${licenseDays} days'
        );

        -- (c) Create subscription if plan exists
        IF v_plan_id IS NOT NULL THEN
          INSERT INTO public.subscriptions (organization_id, plan_id, status, current_period_end)
          VALUES (v_org_id, v_plan_id, 'active', now() + interval '${licenseDays} days');
        END IF;

        -- (d) Create branch
        INSERT INTO public.branches (id, organization_id, name, branch_code, status)
        VALUES (v_branch_id, v_org_id, '${body.branch_name}', '${body.branch_code}', 'active');

        -- (e) Create stock location
        INSERT INTO ims.stock_locations (id, organization_id, branch_id, code, name, kind, is_active)
        VALUES (v_stock_loc_id, v_org_id, v_branch_id, '${body.stock_location_code}', '${stockName}', '${stockKind}', true);

        -- (f) Create organization membership
        INSERT INTO public.organization_memberships (organization_id, user_id, member_type, role_id, status)
        VALUES (v_org_id, v_user_id, '${memberType}', v_role_id, 'active');

        -- (g) Create staff branch access (required for 'staff' member_type)
        ${memberType === "staff" ? `INSERT INTO public.staff_branch_access (organization_id, user_id, branch_id, status) VALUES (v_org_id, v_user_id, v_branch_id, 'active');` : "-- Owner/auditor bypass branch access check"}

        -- (h) Create POS terminal
        INSERT INTO public.terminals (id, organization_id, branch_id, terminal_code, device_type, status)
        VALUES (v_terminal_id, v_org_id, v_branch_id, '${body.terminal_code}', '${deviceType}', 'active');

        -- (i) Create receipt printer
        INSERT INTO public.printers (id, organization_id, branch_id, name, type, status, is_default)
        VALUES (v_printer_id, v_org_id, v_branch_id, '${printerName}', '${printerType}', 'connected', true);

        -- Return IDs via RAISE NOTICE (captured in logs)
        RAISE NOTICE 'ONBOARD_SUCCESS: org=%, branch=%, user=%, terminal=%, printer=%',
          v_org_id, v_branch_id, v_user_id, v_terminal_id, v_printer_id;
      END $$;
    `;

    const { error: provisionError } = await adminClient.rpc("", {}).then(
      () => ({ error: null }),
      (err: Error) => ({ error: err })
    );

    // Execute raw SQL via the REST endpoint
    const sqlResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
      }
    );

    // Actually execute the SQL directly via postgres
    const { data: sqlResult, error: sqlError } = await adminClient
      .from("_exec")
      .select()
      .limit(0);

    // Use the management API query endpoint instead
    const queryResponse = await fetch(
      `${SUPABASE_URL}/pg/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: provisionSQL }),
      }
    );

    if (!queryResponse.ok) {
      // Rollback: delete the auth user we just created
      await adminClient.auth.admin.deleteUser(userId);
      const errorText = await queryResponse.text();
      return new Response(
        JSON.stringify({
          error: `Database provisioning failed: ${errorText}`,
          rollback: "Auth user has been cleaned up",
        }),
        {
          status: 500,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    // -----------------------------------------------------------------------
    // 6. Fetch Created Records for Response
    // -----------------------------------------------------------------------
    const { data: orgData } = await adminClient
      .from("organizations")
      .select("id, legal_name, trade_name, license_status, license_expires_at")
      .eq("legal_name", body.legal_name)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const { data: branchData } = await adminClient
      .from("branches")
      .select("id, name, branch_code")
      .eq("organization_id", orgData?.id)
      .limit(1)
      .single();

    // -----------------------------------------------------------------------
    // 7. Return Success Response
    // -----------------------------------------------------------------------
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully onboarded "${body.legal_name}"`,
        data: {
          organization: orgData,
          branch: branchData,
          user: {
            id: userId,
            email: body.user_email,
            name: body.user_name,
            temporary_password: body.user_password,
          },
          license: {
            status: "active",
            starts_at: new Date().toISOString(),
            expires_at: new Date(
              Date.now() + licenseDays * 86400000
            ).toISOString(),
            duration_days: licenseDays,
          },
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `Unexpected error: ${(err as Error).message}`,
      }),
      {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }
});
