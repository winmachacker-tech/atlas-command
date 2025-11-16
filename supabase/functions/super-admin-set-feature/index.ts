// FILE: supabase/functions/super-admin-set-feature/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    "[super-admin-set-feature] Missing one of SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY",
  );
}

// CORS
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // tighten later if you want
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1) Ensure there is an authenticated user (but don't hard-fail on super_admins yet)
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError) {
      console.error("[super-admin-set-feature] auth.getUser error:", userError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log("[super-admin-set-feature] caller user_id:", user.id);

    // 2) Parse body
    const body = await req.json();
    console.log("[super-admin-set-feature] body:", body);

    const { team_member_id, feature_key, value } = body ?? {};

    if (!team_member_id || typeof feature_key !== "string") {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // allow only specific flags
    const allowedFeatures = ["ai_recommendations_enabled"];
    if (!allowedFeatures.includes(feature_key)) {
      return new Response(JSON.stringify({ error: "Unknown feature_key" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const updateData: Record<string, unknown> = {};
    updateData[feature_key] = !!value;

    // 3) Update team_members row using service role
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: updatedRow, error: updateError } = await adminClient
      .from("team_members")
      .update(updateData)
      .eq("id", team_member_id)
      .select("*")
      .single();

    if (updateError) {
      console.error("[super-admin-set-feature] update error:", updateError);
      return new Response(JSON.stringify({ error: "Update failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log(
      "[super-admin-set-feature] updated team_member:",
      updatedRow,
    );

    return new Response(JSON.stringify({ updated: updatedRow }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    console.error("[super-admin-set-feature] unexpected error:", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
