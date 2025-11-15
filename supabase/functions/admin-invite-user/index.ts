// FILE: supabase/functions/admin-invite-user/index.ts
// Purpose: Supabase Edge Function to send Auth invite emails
// so Atlas can invite brand-new users directly from inside the app.
//
// Frontend usage:
//   await supabase.functions.invoke("admin-invite-user", { body: { email } });
//
// This runs on Supabase using the SERVICE ROLE KEY, never exposed to the browser.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: { email?: string } = {};
  try {
    payload = (await req.json()) ?? {};
  } catch {
    // ignore parse error, we'll validate below
  }

  const email = (payload.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Valid email is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("FUNC_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("FUNC_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "[admin-invite-user] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function env."
    );
    return new Response(
      JSON.stringify({
        error:
          "Function is not configured correctly. Missing Supabase env variables.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log("[admin-invite-user] Inviting:", email);

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    email
  );

  if (error) {
    console.error("[admin-invite-user] Supabase invite error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Invite failed." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const user = data?.user ?? null;
  console.log("[admin-invite-user] Invite success for user:", user?.id ?? null);

  return new Response(
    JSON.stringify({
      success: true,
      email,
      userId: user?.id ?? null,
      createdAt: user?.created_at ?? null,
      message:
        "Invite email sent. The user should now appear in Supabase Auth → Users.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
