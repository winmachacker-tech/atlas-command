// Edge Function: admin-invite-user
// Deploy: supabase functions deploy admin-invite-user
// Secrets required (already in your project):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// Optional (if you want to send a custom email via Resend etc.)
// - RESEND_API_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Pass through the caller auth for row-level auth if needed
    const supabase = createClient(url, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json().catch(() => ({}));
    const { email, role = "user", redirectUrl } = body;

    if (!email || typeof email !== "string") {
      return json({ error: "email required" }, 400);
    }

    // Invite via Supabase Admin API (built-in email)
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo:
        redirectUrl ||
        // Supabase will append /auth/v1/callback, then you can route onward in the app
        "https://atlas-command-iota.vercel.app",
    });
    if (error) return json({ error: error.message }, 400);

    // (Optional) Upsert a role into your public.users row
    if (data?.user?.id) {
      await supabase.from("users").upsert(
        {
          id: data.user.id,
          email: email.toLowerCase(),
          role,
          invited_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    }

    return json({ ok: true, userId: data?.user?.id || null }, 200);
  } catch (e) {
    return json({ error: e?.message ?? "unknown error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
