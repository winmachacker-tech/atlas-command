// supabase/functions/admin-invite-user/index.ts
// Deno Edge Function (Supabase). Deploy with: `supabase functions deploy admin-invite-user`

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ---- ENV REQUIRED ----
// SUPABASE_URL            -> project URL (auto in Functions env)
// SB_SERVICE_ROLE_KEY     -> service role key (Functions secret; never expose to client)
// SITE_URL                -> your app base URL, e.g. https://atlas-command-iota.vercel.app
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const SITE_URL     = Deno.env.get("SITE_URL") || "https://atlas-command-iota.vercel.app";

const service = createClient(SUPABASE_URL, SERVICE_KEY);

// CORS helper
const cors = (status = 200, body?: unknown) =>
  new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: {
      "Access-Control-Allow-Origin": SITE_URL,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.substring(7) : null;
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  // Get the user from the access token
  const { data: userData, error: userErr } = await service.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid token" };
  }

  const uid = userData.user.id;

  // Verify admin role in your app registry
  const { data: profile, error: profErr } = await service
    .from("users")
    .select("id, is_admin, role, is_active")
    .eq("id", uid)
    .single();

  if (profErr || !profile) {
    return { ok: false, status: 403, error: "No app profile" };
  }
  if (!profile.is_active) {
    return { ok: false, status: 403, error: "User inactive" };
  }
  const isAdmin = profile.is_admin === true || profile.role === "admin";
  if (!isAdmin) {
    return { ok: false, status: 403, error: "Admin required" };
  }

  return { ok: true, adminId: uid, adminProfile: profile };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return cors(204);

  if (req.method !== "POST") {
    return cors(405, { error: "Method Not Allowed" });
  }

  // Check admin
  const adminCheck = await requireAdmin(req);
  if (!adminCheck.ok) {
    return cors(adminCheck.status, { error: adminCheck.error });
  }
  const adminId = adminCheck.adminId!;

  // Parse input
  let payload: { email?: string; role?: string };
  try {
    payload = await req.json();
  } catch {
    return cors(400, { error: "Invalid JSON body" });
  }

  const email = (payload.email || "").trim().toLowerCase();
  const role = (payload.role || "dispatcher").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return cors(400, { error: "Valid email required" });
  }
  if (!["admin", "dispatcher", "viewer"].includes(role)) {
    return cors(400, { error: "Invalid role. Use: admin | dispatcher | viewer" });
  }

  // 1) Send invite email via Admin API (redirects back to your app)
  const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${SITE_URL}/auth/callback` },
  );

  if (inviteErr || !invited?.user) {
    return cors(400, { error: inviteErr?.message || "Invite failed" });
  }

  // 2) Ensure app-side profile exists and requires password setup
  const { data: upserted, error: upsertErr } = await service
    .from("users")
    .upsert({
      id: invited.user.id,         // link to auth.users id
      email,
      role,                        // 'dispatcher' by default
      is_active: true,
      must_set_password: true,     // <-- gate access until password is set
      created_by: adminId,
    }, { onConflict: "id" })
    .select()
    .single();

  if (upsertErr) {
    return cors(400, { error: upsertErr.message || "App user upsert failed" });
  }

  return cors(200, {
    ok: true,
    message: "Invite sent. User must set a password.",
    invite_user_id: invited.user.id,
    app_user: upserted,
  });
});
