import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** ───────────────────────────────────────────────────────────
 *  Env vars (must be set via `supabase secrets set`)
 *  NOTE: Do NOT prefix with SUPABASE_ — those are blocked.
 *  ─────────────────────────────────────────────────────────── */
const SB_URL = Deno.env.get("SB_URL")!;
const SB_ANON_KEY = Deno.env.get("SB_ANON_KEY")!;
const SB_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY")!;

/** CORS (tighten origin later) */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: cors });
}

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  try {
    const { email, is_admin = false, redirectTo } = await req.json().catch(() => ({}));
    if (!email) return json(400, { error: "Missing 'email'" });

    // Pull caller JWT (header is case-insensitive)
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "Unauthorized: no Authorization header" });

    // 1) Verify caller is signed in (user-scoped client)
    const userScoped = createClient(SB_URL, SB_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: whoami, error: whoErr } = await userScoped.auth.getUser();
    if (whoErr || !whoami?.user) return json(401, { error: "Unauthorized" });

    // 2) Verify caller is admin (pick one: RPC or table check)
    // If you already created the RPC 'app_is_admin', keep it:
    const { data: isAdmin, error: adminErr } = await userScoped.rpc("app_is_admin");
    if (adminErr) return json(500, { error: "Admin check failed", detail: adminErr.message });
    if (!isAdmin) return json(403, { error: "Forbidden: admin only" });

    // 3) Service-role client for privileged ops
    const service = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

    // 4) Send invite
    // Use your production app URL for redirect (pass from client or set default)
    const emailRedirectTo = redirectTo ?? "https://atlas-command-iota.vercel.app/login";
    const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
      emailRedirectTo,
    });
    if (inviteErr) return json(400, { error: "Invite failed", detail: inviteErr.message });

    // 5) Ensure profile row exists (not fatal if it fails)
    if (invited?.user?.id) {
      const { error: upsertErr } = await service.from("users").upsert({
        id: invited.user.id,
        email,
        is_admin,
      });
      if (upsertErr) {
        // Don’t fail the invite because of profile upsert — just report it
        console.error("users.upsert failed:", upsertErr.message);
      }
    }

    return json(200, { ok: true, invited: email, user_id: invited?.user?.id ?? null });
  } catch (e) {
    console.error("❌ admin-invite-user crashed:", e);
    return json(500, { error: "Server error", detail: String(e?.message ?? e) });
  }
});
