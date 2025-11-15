// FILE: supabase/functions/ai-retrain/index.ts
// Purpose: Nightly AI maintenance job + browser-safe CORS handling.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-client-info",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: CORS_HEADERS,
  });
}

async function tryRpc(
  supabase: ReturnType<typeof createClient>,
  names: string[],
  args: Record<string, unknown> = {}
) {
  for (const n of names) {
    try {
      const { error } = await supabase.rpc(n, args);
      if (!error) return { ok: true, name: n };
    } catch (e) {
      continue;
    }
  }
  return { ok: false, name: null };
}

Deno.serve(async (req) => {
  // ✅ CORS preflight
  if (req.method === "OPTIONS")
    return new Response("ok", { status: 204, headers: CORS_HEADERS });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key)
    return jsonResponse(500, { ok: false, error: "Missing env keys" });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let lane_key: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.lane_key === "string") lane_key = body.lane_key;
    } else {
      const u = new URL(req.url);
      lane_key = u.searchParams.get("lane_key");
    }
  } catch {}

  // Run backfill + retrain
  const backfill = await tryRpc(supabase, [
    "rpc_ai_backfill_examples_from_raw",
    "ai_backfill_examples_from_raw",
    "rpc_ai_backfill",
    "ai_backfill",
  ], lane_key ? { lane_key } : {});

  const retrain = await tryRpc(supabase, [
    "rpc_ai_retrain",
    "ai_retrain",
    "rpc_ai_train",
    "ai_train",
  ]);

  const payload = {
    ok: retrain.ok,
    lane_key,
    backfill,
    retrain,
    ran_at: new Date().toISOString(),
  };

  // Optional log
  try {
    await supabase.rpc("rpc_ai_log_training_run", {
      p_ok: retrain.ok,
      p_lane_key: lane_key,
      p_backfill_ok: backfill.ok,
      p_backfill_name: backfill.name,
      p_retrain_ok: retrain.ok,
      p_retrain_name: retrain.name,
      p_notes: "manual trigger",
    });
  } catch {}

  return jsonResponse(retrain.ok ? 200 : 500, payload);
});
