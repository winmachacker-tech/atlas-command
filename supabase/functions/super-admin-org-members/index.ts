// FILE: supabase/functions/super-admin-org-members/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "*";

  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  // 🔹 Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    console.error("[super-admin-org-members] Missing env vars");
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(url, serviceRoleKey);

  try {
    // Expect body: { org_id: "..." }
    const body = await req.json().catch(() => ({}));
    const org_id = body.org_id ?? body.orgId ?? null;

    if (!org_id) {
      return new Response(
        JSON.stringify({ error: "org_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔹 Simplest possible query first
    const { data, error } = await supabase
      .from("team_members")
      .select("*")
      .eq("org_id", org_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[super-admin-org-members] team_members error:", error);
      return new Response(
        JSON.stringify({ error: error.message ?? String(error) }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      "[super-admin-org-members] returning members count:",
      data?.length ?? 0,
      "for org_id",
      org_id,
    );

    return new Response(JSON.stringify({ members: data ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[super-admin-org-members] unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
