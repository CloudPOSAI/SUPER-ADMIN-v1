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

    const COUNTRY_DIAL_CODES: Record<string, string> = {
      AE: "+971",
      SA: "+966",
      OM: "+968",
      BH: "+973",
      KW: "+965",
      QA: "+974",
      IN: "+91",
      US: "+1",
      GB: "+44",
    };
    const defaultPrefix = COUNTRY_DIAL_CODES[(countryCode || "AE").toUpperCase()] || "+971";

    // Format phone to E.164 standard based on selected country
    let formattedPhone: string | undefined = undefined;
    if (body.user_phone && body.user_phone.trim()) {
      const cleanPhone = body.user_phone.trim().replace(/[\s\-\(\)]/g, "");
      if (cleanPhone.startsWith("+")) {
        formattedPhone = cleanPhone;
      } else if (cleanPhone.startsWith("00")) {
        formattedPhone = "+" + cleanPhone.slice(2);
      } else if (cleanPhone.startsWith("0")) {
        formattedPhone = defaultPrefix + cleanPhone.slice(1);
      } else if (/^\d{7,12}$/.test(cleanPhone)) {
        formattedPhone = defaultPrefix + cleanPhone;
      } else {
        formattedPhone = "+" + cleanPhone;
      }
    }

    // -----------------------------------------------------------------------
    // 4. Create Auth User via Admin API
    // -----------------------------------------------------------------------
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email: body.user_email,
        password: body.user_password,
        phone: formattedPhone,
        email_confirm: true,
        phone_confirm: formattedPhone ? true : false,
        user_metadata: { name: body.user_name, phone: body.user_phone },
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
    // 5. Atomic Database Provisioning via SQL RPC Transaction
    // -----------------------------------------------------------------------
    const { data: rpcResult, error: rpcError } = await adminClient.rpc(
      "provision_tenant_atomic",
      {
        p_user_id: userId,
        p_user_email: body.user_email,
        p_user_name: body.user_name,
        p_legal_name: body.legal_name,
        p_trade_name: body.trade_name || body.legal_name,
        p_country_code: countryCode,
        p_license_days: licenseDays,
        p_branch_name: body.branch_name,
        p_branch_code: body.branch_code,
        p_stock_code: body.stock_location_code,
        p_stock_name: stockName,
        p_stock_kind: stockKind,
        p_member_type: memberType,
        p_role_name: roleName,
        p_terminal_code: body.terminal_code,
        p_device_type: deviceType,
        p_printer_name: printerName,
        p_printer_type: printerType,
      }
    );

    if (rpcError) {
      // Rollback: delete the auth user we just created
      await adminClient.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({
          error: `Database provisioning failed: ${rpcError.message}`,
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
