// supabase/functions/admin-invite-user/index.ts
// Sends an admin invite with an explicit redirect to /auth/callback
// so users DON'T land on "/#". CORS-safe.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://atlas-command-iota.vercel.app";

// The critical part:
const REDIRECT_TO = `${SITE_URL}/auth/callback`;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

function cors(res: Response) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return res;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) {
      return cors(new Response(JSON.stringify({ error: "Email is required" }), { status: 400 }));
    }

    // If you want to allow overriding redirect per-call:
    const redirectTo = String(body.redirectTo || REDIRECT_TO);

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo, // <- forces /auth/callback instead of "/#"
    });

    if (error) {
      // Treat "already configured / already invited" as success-y message
      const msg = /already/i.test(error.message)
        ? "Invite flow already configured; invite re-sent if applicable."
        : error.message;
      return cors(new Response(JSON.stringify({ status: "ok", message: msg }), { status: 200 }));
    }

    return cors(
      new Response(JSON.stringify({ status: "ok", message: "Invite sent", user: data?.user ?? null }), {
        status: 200,
      })
    );
  } catch (e) {
    return cors(new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 }));
  }
});
