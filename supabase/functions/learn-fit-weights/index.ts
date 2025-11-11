// supabase/functions/learn-fit-weights/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    // Basic guard (optional): require POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), { status: 405 });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500 });
    }

    const { data, error } = await fetch(`${SUPABASE_URL}/rest/v1/rpc/learn_fit_weights`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE,
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({}),
    }).then(r => r.ok ? r.json() : r.json().then(j => { throw new Error(JSON.stringify(j)); }));

    return new Response(JSON.stringify({ updated: data }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
