// supabase/functions/motive-test/index.ts
// Simple sanity check: call Motive with the stored access token for this org.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Helper to get current user + org via Supabase Auth JWT
async function getUserAndOrg(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) throw new Error("Missing Authorization header");

  const jwt = authHeader.replace("Bearer ", "");

  // Call PostgREST with service role but pass user JWT in `Authorization` so RLS sees user
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/current_org_and_user`, {
    method: "POST",
    headers: {
      apiKey: serviceKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to resolve org: ${res.status} ${text}`);
  }

  const data = await res.json();
  // Expect { org_id: uuid, user_id: uuid }
  return data;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { org_id } = await getUserAndOrg(req);

    // Look up this org's Motive connection
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const connRes = await fetch(
      `${supabaseUrl}/rest/v1/motive_connections?org_id=eq.${org_id}&select=*`,
      {
        headers: {
          apiKey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!connRes.ok) {
      const text = await connRes.text();
      return new Response(
        JSON.stringify({
          error: "Failed to load motive_connections row",
          details: text,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = await connRes.json();
    const conn = rows[0];

    if (!conn || !conn.access_token) {
      return new Response(
        JSON.stringify({ error: "No Motive connection found for this org" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call a simple Motive endpoint using the stored token
    const motiveRes = await fetch("https://api.gomotive.com/v1/companies/me", {
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        Accept: "application/json",
      },
    });

    const motiveText = await motiveRes.text();
    let motiveJson: any;
    try {
      motiveJson = JSON.parse(motiveText);
    } catch {
      motiveJson = { raw: motiveText };
    }

    if (!motiveRes.ok) {
      return new Response(
        JSON.stringify({
          error: "Motive API returned error",
          status: motiveRes.status,
          response: motiveJson,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        motive_status: motiveRes.status,
        motive_response: motiveJson,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[motive-test] Error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal error running Motive test",
        message: err.message,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
