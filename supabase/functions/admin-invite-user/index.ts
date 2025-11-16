// FILE: supabase/functions/admin-invite-user/index.ts
// Purpose:
//   Invite a user to the caller's organization AND send them to the right TMS login page.
//   - Handles CORS for browser calls
//   - Inserts into team_invites
//   - Uses auth.admin.inviteUserByEmail to send the email
//
// IMPORTANT ENV CONFIG:
//   In your Supabase project/function env, set:
//     SUPABASE_URL              = https://YOUR-PROJECT-REF.supabase.co
//     SUPABASE_SERVICE_ROLE_KEY = <service role key>
//     SUPABASE_ANON_KEY         = <anon key>
//     SITE_URL                  = http://localhost:5173           (for local dev)
//       or                      = https://YOUR-TMS-DOMAIN         (for prod)
//   The invite link will redirect to `${SITE_URL}/login`.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

// This should be JUST your TMS base URL (NO /sign-in, NO /auth, etc.)
const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:5173";

// CORS so browser can call this function
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const jwt = authHeader.replace("Bearer ", "");

    // Client with caller's JWT (RLS applies)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    });

    // Admin client for auth.admin (no RLS)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      console.error("Error fetching user:", userError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read request body
    const body = await req.json();
    const emailRaw: string | undefined = body?.email;
    const roleRaw: string | undefined = body?.role;

    const email = emailRaw?.trim().toLowerCase();
    const role = roleRaw?.trim() || "member";

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find caller's org + role
    const { data: tmRows, error: tmError } = await userClient
      .from("team_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .limit(1);

    if (tmError || !tmRows || tmRows.length === 0) {
      console.error("Caller not in any org:", tmError);
      return new Response(
        JSON.stringify({ error: "You are not in any organization" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const callerOrgId = tmRows[0].org_id as string;
    const callerRole = (tmRows[0].role as string) ?? "member";

    // Only owner/admin can invite (your call; keeps things safe)
    if (!["owner", "admin"].includes(callerRole)) {
      return new Response(
        JSON.stringify({ error: "You do not have permission to invite users" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Insert invite row
    const { data: inviteRow, error: inviteError } = await userClient
      .from("team_invites")
      .insert({
        org_id: callerOrgId,
        email,
        role,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (inviteError) {
      console.error("Error inserting invite:", inviteError);
      return new Response(
        JSON.stringify({ error: "Failed to create invite" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Send invite email
    const { data: inviteRes, error: authInviteError } =
      await adminClient.auth.admin.inviteUserByEmail(email, {
        // 👇 This is the key: after they accept/set password, send them to your TMS /login
        redirectTo: `${siteUrl}/login`,
      });

    if (authInviteError) {
      console.error("Error sending invite email:", authInviteError);
      return new Response(
        JSON.stringify({
          error: "Created invite, but failed to send email",
          details: authInviteError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        invite: inviteRow,
        authInvite: inviteRes,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Unexpected error in admin-invite-user:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
