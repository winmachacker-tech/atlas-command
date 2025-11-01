// supabase/functions/invite_user/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, POST",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return json({ ok: true });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const payload = await req.json().catch(() => ({}));
    const full_name = (payload?.full_name ?? "").trim();
    const email = (payload?.email ?? "").trim();
    const role = (payload?.role ?? "").trim();

    if (!full_name || !email || !role) {
      return json({ error: "full_name, email, and role are required" }, 400);
    }
    if (!["admin", "manager", "dispatcher", "viewer"].includes(role)) {
      return json({ error: "invalid role" }, 400);
    }

    // Use caller's JWT to verify they're an admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user: caller },
    } = await supabase.auth.getUser();

    if (!caller?.id) return json({ error: "Unauthorized" }, 401);

    const { data: me, error: roleErr } = await supabase
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (roleErr) return json({ error: roleErr.message }, 400);
    if (!me || me.role !== "admin") {
      return json({ error: "Forbidden: admin only" }, 403);
    }

    // Service-role client to invite + upsert (bypasses RLS)
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: invitedWrap, error: inviteErr } =
      await svc.auth.admin.inviteUserByEmail(email, {
        data: { full_name, role },
        // redirectTo: "https://your-app.example.com/auth/callback", // optional
      });

    if (inviteErr) return json({ error: inviteErr.message }, 400);

    const uid = invitedWrap?.user?.id;
    if (!uid) return json({ error: "Invite succeeded but no user id returned" }, 500);

    const { error: upsertErr } = await svc
      .from("users")
      .upsert({ id: uid, full_name, email, role }); // PK upsert

    if (upsertErr) return json({ error: upsertErr.message }, 400);

    return json({ ok: true, id: uid }, 201);
  } catch (e: any) {
    return json({ error: e?.message || "Unhandled error" }, 500);
  }
});
