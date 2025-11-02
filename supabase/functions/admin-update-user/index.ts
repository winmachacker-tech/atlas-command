// supabase/functions/admin-update-user/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SB_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8", ...cors } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "NO_AUTH_HEADER" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "INVALID_JWT" });

    const { data: me } = await userClient.from("users").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return json(403, { error: "USER_NOT_ALLOWED" });

    const body = await req.json().catch(() => ({}));
    const user_id   = String(body.user_id ?? "").trim();
    const full_name = body.full_name === undefined ? undefined : String(body.full_name);
    const role      = body.role === undefined ? undefined : String(body.role);

    if (!user_id) return json(400, { error: "MISSING_ID" });

    const patch: Record<string, unknown> = {};
    if (full_name !== undefined) patch.full_name = full_name;
    if (role !== undefined) patch.role = role;
    if (Object.keys(patch).length === 0) return json(400, { error: "NOTHING_TO_UPDATE" });

    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: upErr } = await service.from("users").update(patch).eq("id", user_id);
    if (upErr) return json(400, { error: "UPDATE_FAILED", message: upErr.message });

    if (full_name !== undefined) {
      await service.auth.admin.updateUserById(user_id, { user_metadata: { full_name } });
    }

    return json(200, { ok: true, message: "User updated." });
  } catch (e) {
    return json(500, { error: "SERVER_ERROR", message: String(e?.message ?? e) });
  }
});
