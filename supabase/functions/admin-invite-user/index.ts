// supabase/functions/admin-invite-user/index.ts
// SIMPLIFIED VERSION with detailed logging + redirect + proper recovery link

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

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "user";
  const full_name = typeof body?.full_name === "string" ? body.full_name.trim() : "";
  const redirect = typeof body?.redirect === "string" ? body.redirect : "/";

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
  console.log("↪️ Redirect:", redirect);

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
      .from("profiles")
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

    // Build the auth callback with next redirect
    const callbackWithNext = `${APP_URL}/auth/callback?next=${encodeURIComponent(redirect)}`;

    // 3. Try to invite; if "already registered", send a recovery link instead
    console.log("📨 Attempting invite…");
    const invite = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: callbackWithNext,
      data: {
        role,
        full_name,
        name: full_name,
      },
    });

    if (invite.error) {
      const msg = String(invite.error.message || "").toLowerCase();
      console.warn("ℹ️ Invite error:", invite.error);

      if (msg.includes("already registered") || msg.includes("user already exists")) {
        console.log("🔁 User exists — generating recovery link email…");
        const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
          type: "recovery",
          email,
          options: {
            redirectTo: callbackWithNext,
            data: { role, full_name },
          },
        });
        if (linkErr) {
          console.error("❌ Recovery link error:", linkErr);
          return new Response(
            JSON.stringify({ error: linkErr.message }),
            { status: 400, headers }
          );
        }

        console.log("✅ Recovery email link generated+sent");
        return new Response(
          JSON.stringify({ ok: true, mode: "recovery_sent" }),
          { status: 200, headers }
        );
      }

      // Other errors
      return new Response(
        JSON.stringify({ error: invite.error.message }),
        { status: 400, headers }
      );
    }

    console.log("✅ Invite sent successfully");
    console.log("📊 Invite data:", JSON.stringify(invite.data, null, 2));

    // 4. Best-effort: if a user object is returned, initialize profiles row
    try {
      const invitedUserId = invite.data?.user?.id;
      if (invitedUserId) {
        const { error: upErr } = await service
          .from("profiles")
          .upsert({
            id: invitedUserId,
            full_name: full_name || null,
            role: role?.toUpperCase() || "USER",
            is_admin: role?.toUpperCase() === "ADMIN",
            profile_complete: false,
            updated_at: new Date().toISOString(),
          }, { onConflict: "id" });

        if (upErr) {
          console.warn("⚠️ profiles upsert warning (non-fatal):", upErr.message);
        } else {
          console.log("✅ profiles row ensured");
        }
      } else {
        console.log("ℹ️ No user object on invite; profiles upsert skipped (will be created on first login).");
      }
    } catch (soft) {
      console.warn("⚠️ profiles upsert skipped (non-fatal):", soft);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "invited",
        user: invite.data?.user ?? null,
      }),
      { status: 200, headers }
    );

  } catch (e) {
    console.error("💥 UNEXPECTED ERROR:", e);
    try { console.error("Error details:", JSON.stringify(e, null, 2)); } catch {}
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
});
