// FILE: supabase/functions/log-login-event/index.ts
// Purpose:
// - Log login events to security_login_events
// - Derive org_id from team_members
// - Respect RLS for client by doing org lookup with service role
// - mfa_used is passed from the client (logLoginEventWithMfa)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// These are provided to Edge Functions via Supabase env
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[log-login-event] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
  );
}

serve(async (req: Request): Promise<Response> => {
  // --- CORS headers (critical for browser calls from localhost:5173) ---
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Server is misconfigured" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ---- Auth: get user from Bearer token ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer", "").trim();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing Bearer token" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      console.error("[log-login-event] getUser error:", userError);
      return new Response(
        JSON.stringify({ error: "Unable to resolve user from token" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const email =
      user.email ??
      (user.user_metadata as any)?.email ??
      "unknown@example.com";

    // ---- Body: MFA + hint data from client (optional) ----
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const mfaUsed = !!body.mfa_used;
    const event = body.event ?? "UNKNOWN";
    const currentLevel = body.currentLevel ?? null;

    const userAgent =
      body.user_agent || req.headers.get("User-Agent") || null;

    const ipHeader = req.headers.get("x-forwarded-for") ?? null;
    const ipAddress = ipHeader
      ? ipHeader.split(",")[0].trim()
      : null;

    // ---- Org lookup via team_members ----
    const { data: tmRow, error: tmError } = await supabaseAdmin
      .from("team_members")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (tmError) {
      console.error("[log-login-event] team_members error:", tmError);
    }

    const orgId = tmRow?.org_id ?? null;

    // ---- Insert login event ----
    const { error: insertError } = await supabaseAdmin
      .from("security_login_events")
      .insert({
        org_id: orgId,
        user_id: user.id,
        email,
        event,
        current_level: currentLevel,
        mfa_used: mfaUsed,
        user_agent: userAgent,
        ip_address: ipAddress,
      });

    if (insertError) {
      console.error("[log-login-event] insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to insert login event" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        email,
        org_id: orgId,
        mfa_used: mfaUsed,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (e) {
    console.error("[log-login-event] Unexpected error:", e);
    return new Response(
      JSON.stringify({ error: "Unexpected error in log-login-event" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
