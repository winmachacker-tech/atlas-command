// supabase/functions/admin-delete-user/index.ts
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
    const user_id = String(body.user_id ?? "").trim();
    if (!user_id) return json(400, { error: "MISSING_ID" });

    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { error: authErr } = await service.auth.admin.deleteUser(user_id);
    if (authErr) return json(400, { error: "AUTH_DELETE_FAILED", message: authErr.message });

    await service.from("users").delete().eq("id", user_id);

    return json(200, { ok: true, message: "User deleted." });
  } catch (e) {
    return json(500, { error: "SERVER_ERROR", message: String(e?.message ?? e) });
  }
});
