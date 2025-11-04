// supabase/functions/admin-invite-user/index.ts
// SIMPLIFIED VERSION with detailed logging

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON_KEY = Deno.env.get("SB_ANON_KEY") ?? "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("SITE_URL") ?? "https://atlas-command-iota.vercel.app";

const ALLOWLIST = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  APP_URL,
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWLIST.has(origin)) return true;
  if (/^https:\/\/atlas-command-[\w-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

function buildCorsHeaders(origin: string | null): Headers {
  const h = new Headers();
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  h.set("Access-Control-Max-Age", "86400");
  h.set("Access-Control-Allow-Origin", isAllowedOrigin(origin) ? (origin as string) : APP_URL);
  return h;
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const headers = buildCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  console.log("🚀 [START] admin-invite-user function called");

  // Validate env vars
  if (!SUPABASE_URL || !SB_ANON_KEY || !SB_SERVICE_ROLE_KEY) {
    console.error("❌ Missing environment variables");
    return new Response(
      JSON.stringify({ error: "Server configuration error" }), 
      { status: 500, headers }
    );
  }

  // Parse body
  let body: any;
  try {
    body = await req.json();
    console.log("📦 Request body:", JSON.stringify(body, null, 2));
  } catch (e) {
    console.error("❌ Invalid JSON body:", e);
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers,
    });
  }

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = typeof body?.role === "string" ? body.role : "user";
  const full_name = typeof body?.full_name === "string" ? body.full_name.trim() : "";

  if (!email) {
    console.error("❌ Missing email");
    return new Response(JSON.stringify({ error: "Email required" }), {
      status: 400,
      headers,
    });
  }

  console.log("📧 Email:", email);
  console.log("👤 Name:", full_name);
  console.log("🎭 Role:", role);

  // Create clients
  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(SUPABASE_URL, SB_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const service = createClient(SUPABASE_URL, SB_SERVICE_ROLE_KEY);

  try {
    // 1. Verify caller is authenticated
    console.log("🔐 Verifying authentication...");
    const { data: userResp, error: authErr } = await anon.auth.getUser();
    
    if (authErr) {
      console.error("❌ Auth error:", authErr);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers,
      });
    }

    if (!userResp?.user) {
      console.error("❌ No user found");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers,
      });
    }

    const callerId = userResp.user.id;
    console.log("✅ Caller ID:", callerId);

    // 2. Verify caller is admin
    console.log("👮 Checking admin status...");
    const { data: me, error: meErr } = await service
      .from("users")
      .select("is_admin")
      .eq("id", callerId)
      .maybeSingle();

    if (meErr) {
      console.error("❌ Admin lookup error:", meErr);
      return new Response(JSON.stringify({ error: "Admin lookup failed" }), {
        status: 500,
        headers,
      });
    }

    if (!me?.is_admin) {
      console.error("❌ User is not admin");
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers,
      });
    }

    console.log("✅ Admin verified");

    // 3. Check if user already exists
    console.log("🔍 Checking if user exists...");
    const { data: existingUsers } = await service.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    if (existingUser) {
      console.log("ℹ️  User already exists, sending recovery email");
      
      const recovery = await service.auth.resetPasswordForEmail(email, {
        redirectTo: `${APP_URL}/auth/callback`,
      });

      if (recovery.error) {
        console.error("❌ Recovery email error:", recovery.error);
        return new Response(
          JSON.stringify({ error: recovery.error.message }), 
          { status: 400, headers }
        );
      }

      console.log("✅ Recovery email sent");
      return new Response(
        JSON.stringify({ ok: true, mode: "recovery_sent" }),
        { status: 200, headers }
      );
    }

    // 4. Invite new user
    console.log("📨 Sending invite email...");
    const invite = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${APP_URL}/auth/callback`,
      data: { 
        role, 
        full_name,
        name: full_name, // Some versions use 'name' instead
      },
    });

    if (invite.error) {
      console.error("❌ Invite error:", invite.error);
      return new Response(
        JSON.stringify({ error: invite.error.message }), 
        { status: 400, headers }
      );
    }

    console.log("✅ Invite sent successfully");
    console.log("📊 Invite data:", JSON.stringify(invite.data, null, 2));

    return new Response(
      JSON.stringify({ 
        ok: true, 
        mode: "invited",
        user: invite.data?.user,
      }),
      { status: 200, headers }
    );

  } catch (e) {
    console.error("💥 UNEXPECTED ERROR:", e);
    console.error("Error details:", JSON.stringify(e, null, 2));
    return new Response(
      JSON.stringify({ error: "Internal server error" }), 
      { status: 500, headers }
    );
  }
});