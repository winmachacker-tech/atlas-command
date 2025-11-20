// FILE: supabase/functions/log-login-event/index.ts
// Purpose:
// - Log login events to security_login_events
// - Use service role key to insert
// - Derive user from the JWT we get in Authorization header
// - mfa_used is passed from the client

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// These are provided to Edge Functions via Supabase env
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[log-login-event] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
}

// Service-role client (no RLS restrictions; we’ll be careful what we do)
const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // --- Auth header / token from browser session ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return new Response("Missing Bearer token", { status: 401 });
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response("Server misconfigured", { status: 500 });
    }

    // --- Parse body (MFA flag) ---
    const body = await req.json().catch(() => ({}));
    const mfaUsed = !!body?.mfa_used;

    // --- Look up user from JWT so we can log email/user_id ---
    const { data: userInfo, error: userErr } = await serviceClient.auth.getUser(
      token
    );
    if (userErr || !userInfo?.user) {
      console.error("[log-login-event] getUser error:", userErr);
      return new Response("Invalid user", { status: 401 });
    }

    const user = userInfo.user;
    const email = user.email ?? null;
    const userId = user.id;

    // --- Best-effort device/IP info from headers ---
    const ip =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      null;
    const userAgent = req.headers.get("user-agent") ?? null;

    // (Optional) Vercel-style geo headers if present
    const city = req.headers.get("x-vercel-ip-city") ?? null;
    const region = req.headers.get("x-vercel-ip-country-region") ?? null;
    const country = req.headers.get("x-vercel-ip-country") ?? null;

    // --- Insert into security_login_events ---
    const { error: insertError } = await serviceClient
      .from("security_login_events")
      .insert({
        user_id: userId,
        email,
        mfa_used: mfaUsed,
        user_agent: userAgent,
        ip_address: ip,
        city,
        region,
        country,
      });

    if (insertError) {
      console.error("[log-login-event] insert error:", insertError);
      return new Response("Insert failed", { status: 500 });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mfa_used: mfaUsed,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[log-login-event] unexpected error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
