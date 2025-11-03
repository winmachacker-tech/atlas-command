// supabase/functions/admin-manage-user/index.ts
// Admin-only: update (email / is_admin) and delete users.
// Uses PROJECT_URL and SERVICE_ROLE secrets (same as your invite function).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type UpdatePayload = {
  action: "update";
  user_id: string;
  updates?: {
    email?: string;      // optional, admin can set a new email (may trigger confirmation flows)
    is_admin?: boolean;  // optional, toggle admin flag on public.users
  };
};

type DeletePayload = {
  action: "delete";
  user_id: string;
};

type Body = UpdatePayload | DeletePayload;

const PROJECT_URL = Deno.env.get("PROJECT_URL") || "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // optionally restrict to your origins later
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json200(payload: unknown) {
  return new Response(JSON.stringify(payload, null, 2), { status: 200, headers: corsHeaders });
}

function preflight() {
  return new Response("ok", { headers: corsHeaders });
}

function getBearer(req: Request): string | null {
  const raw = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const [scheme, token] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return (token || "").trim() || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json200({ ok: false, error: "MethodNotAllowed" });

  if (!PROJECT_URL || !SERVICE_ROLE) {
    return json200({
      ok: false,
      error: "MissingSecrets",
      details: "Set PROJECT_URL and SERVICE_ROLE in Edge Function secrets.",
    });
  }

  const token = getBearer(req);
  if (!token) return json200({ ok: false, error: "Unauthorized", details: "Missing Bearer token" });

  const admin = createClient(PROJECT_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Who is calling?
  const { data: userData, error: getUserErr } = await admin.auth.getUser(token);
  if (getUserErr || !userData?.user) {
    return json200({ ok: false, error: "Unauthorized", details: getUserErr?.message || "Invalid session" });
  }
  const caller = userData.user;

  // Ensure caller is admin
  const { data: adminRow, error: adminErr } = await admin
    .from("users")
    .select("is_admin")
    .eq("id", caller.id)
    .maybeSingle();
  if (adminErr) return json200({ ok: false, error: "AdminCheckFailed", details: adminErr.message });
  if (!adminRow?.is_admin) return json200({ ok: false, error: "Forbidden", details: "Admin privileges required" });

  // Parse body
  let body: Body | null = null;
  try {
    body = await req.json();
  } catch {
    return json200({ ok: false, error: "BadRequest", details: "Invalid JSON body" });
  }

  if (!body || (body.action !== "update" && body.action !== "delete")) {
    return json200({ ok: false, error: "BadRequest", details: "action must be 'update' or 'delete'" });
  }

  if (!body.user_id || typeof body.user_id !== "string") {
    return json200({ ok: false, error: "BadRequest", details: "user_id is required" });
  }

  // Safety: don't let admins delete their own account accidentally
  if (body.action === "delete" && body.user_id === caller.id) {
    return json200({ ok: false, error: "BadRequest", details: "You cannot delete your own account" });
  }

  try {
    if (body.action === "update") {
      const updates = body.updates || {};
      let authUpdated: any = null;
      let userRowUpdated: any = null;

      // 1) Update email via Auth (optional)
      if (typeof updates.email === "string" && updates.email.trim().length > 0) {
        const newEmail = updates.email.trim().toLowerCase();
        const { data, error } = await admin.auth.admin.updateUserById(body.user_id, { email: newEmail });
        if (error) return json200({ ok: false, error: "AuthUpdateFailed", details: error.message });
        authUpdated = data ?? null;
      }

      // 2) Update is_admin in public.users (optional)
      if (typeof updates.is_admin === "boolean") {
        const { data, error } = await admin
          .from("users")
          .update({ is_admin: updates.is_admin })
          .eq("id", body.user_id)
          .select("id, email, is_admin, updated_at")
          .maybeSingle();
        if (error) return json200({ ok: false, error: "UserRowUpdateFailed", details: error.message });
        userRowUpdated = data ?? null;
      }

      return json200({ ok: true, action: "update", user_id: body.user_id, authUpdated, userRowUpdated });
    }

    if (body.action === "delete") {
      // 1) Delete auth user
      const { error: delErr } = await admin.auth.admin.deleteUser(body.user_id);
      if (delErr) return json200({ ok: false, error: "AuthDeleteFailed", details: delErr.message });

      // 2) (Optional) Clean up row in public.users (ignore if it doesn't exist)
      const { error: pruneErr } = await admin.from("users").delete().eq("id", body.user_id);
      if (pruneErr) {
        // Not fatal—some setups keep audit rows. Return as info.
        return json200({ ok: true, action: "delete", user_id: body.user_id, warning: pruneErr.message });
      }

      return json200({ ok: true, action: "delete", user_id: body.user_id });
    }

    return json200({ ok: false, error: "UnhandledAction" });
  } catch (e) {
    return json200({ ok: false, error: "UnhandledException", details: String(e) });
  }
});
