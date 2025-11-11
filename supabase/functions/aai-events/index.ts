// supabase/functions/aai-events/index.ts
// POST /functions/v1/aai-events
// Logs an AAI learning event via public.aai_upsert_event and returns the updated stats row.
// Handles CORS (preflight + simple allowlist).

/* ---------------------------- Imports (Deno) ---------------------------- */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* ------------------------------ Config --------------------------------- */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Fallback allowlist useful during local dev:
const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/* ------------------------------ Helpers -------------------------------- */
function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowlist =
    ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_DEV_ORIGINS;
  const allowed =
    origin && (allowlist.includes(origin) || allowlist.includes("*"));

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function parseBearer(jwt: string | null) {
  if (!jwt) return null;
  try {
    const payload = JSON.parse(
      atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload ?? null;
  } catch {
    return null;
  }
}

/** Minimal input check without extra deps */
function requireString(obj: any, key: string, optional = false) {
  const v = obj?.[key];
  if (v == null || v === "") {
    if (optional) return undefined;
    throw new Error(`Missing required field: ${key}`);
  }
  if (typeof v !== "string") throw new Error(`Field ${key} must be string`);
  return v;
}
function requireNumber(obj: any, key: string, optional = false) {
  const v = obj?.[key];
  if (v == null || v === "") {
    if (optional) return undefined;
    throw new Error(`Missing required field: ${key}`);
  }
  if (typeof v !== "number") throw new Error(`Field ${key} must be number`);
  return v;
}

/* ------------------------------- Server -------------------------------- */
serve(async (req) => {
  const headers = corsHeaders(req);

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  // Simple health check
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, service: "aai-events", ts: new Date().toISOString() }),
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Use POST" }),
      { status: 405, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Pull org/user from caller's JWT (but write with service role)
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
    const claims = parseBearer(token);

    const org_id: string | null = claims?.org_id ?? null;
    const user_id: string | null = claims?.sub ?? null;

    if (!org_id) throw new Error("Missing org_id in JWT claims");

    const body = await req.json().catch(() => ({}));

    // Required (minimal viable inputs)
    const driver_id = requireString(body, "driver_id");
    const event_type = requireString(body, "event_type"); // must match aai_event_type
    // Optional but common:
    const load_id = body?.load_id ?? null;

    // Optional context
    const occurred_at = body?.occurred_at ?? null; // ISO string or null
    const lane_origin = body?.lane_origin ?? null;
    const lane_dest = body?.lane_dest ?? null;
    const region = body?.region ?? null;
    const equipment = body?.equipment ?? null;
    const miles =
      body?.miles == null ? null : requireNumber(body, "miles", true);
    const pay_total_usd =
      body?.pay_total_usd == null
        ? null
        : requireNumber(body, "pay_total_usd", true);
    const max_distance =
      body?.max_distance == null
        ? null
        : requireNumber(body, "max_distance", true);
    const payload = body?.payload ?? {};

    // Execute RPC (security definer function handles the write + refresh)
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "aai_upsert_event",
      {
        p_org_id: org_id,
        p_driver_id: driver_id,
        p_load_id: load_id,
        p_event_type: event_type,
        p_occurred_at: occurred_at,
        p_lane_origin: lane_origin,
        p_lane_dest: lane_dest,
        p_region: region,
        p_equipment: equipment,
        p_miles: miles,
        p_pay_total_usd: pay_total_usd,
        p_max_distance: max_distance,
        p_payload: payload,
      },
    );

    if (rpcErr) {
      console.error("RPC error", rpcErr);
      return new Response(
        JSON.stringify({ error: "rpc_failed", details: rpcErr.message }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // Fetch updated stats row for that driver (fast)
    const { data: stats, error: statsErr } = await supabase
      .from("aai_driver_stats")
      .select("*")
      .eq("driver_id", driver_id)
      .eq("org_id", org_id)
      .single();

    if (statsErr) {
      console.error("Stats fetch error", statsErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        event_id: rpcData ?? null,
        driver_stats: stats ?? null,
        actor_user_id: user_id,
      }),
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("AAI Events fatal", err);
    return new Response(
      JSON.stringify({ error: "fatal", details: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
