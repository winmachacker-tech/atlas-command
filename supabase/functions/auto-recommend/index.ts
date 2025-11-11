// supabase/functions/auto-recommend/index.ts
// Auto-generate AI recommendations to assign ACTIVE drivers to AVAILABLE loads.
// - One best driver per load (no reuse within the same run)
// - Skips loads that already have ANY NEW auto recommendation (matches your unique index)
// - Writes meta: { recommended_driver_id, recommended_driver_name } for one-click "Accept"
// - Falls back gracefully if ai_recommendations.meta column doesn't exist
//
// Deploy:
//   supabase functions deploy auto-recommend
//
// Manual test (no cron wait):
//   GET  ?dryRun=true&limit=10
//   POST { "dryRun": false, "limit": 10 }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;

function corsHeaders(origin?: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const originOf = (req: Request) => req.headers.get("origin") || "*";
const OK = (req: Request, body: Json, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { "Content-Type": "application/json", ...corsHeaders(originOf(req)) },
  });
const ERR = (req: Request, msg: string, code = 400, extra?: Json) =>
  OK(req, { error: msg, ...(extra || {}) }, code);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(originOf(req)) });

  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return ERR(req, "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", 500);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ---- parameters ----
    const url = new URL(req.url);
    let params: { limit?: number; dryRun?: boolean } = {
      limit: Number(url.searchParams.get("limit") ?? "10"),
      dryRun: (url.searchParams.get("dryRun") ?? "false").toLowerCase() === "true",
    };
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as Partial<typeof params>;
        if (typeof body.limit === "number") params.limit = body.limit;
        if (typeof body.dryRun === "boolean") params.dryRun = body.dryRun;
      } catch {/* ignore */}
    }
    const LIMIT = Math.max(1, Math.min(50, params.limit ?? 10));
    const DRY   = !!params.dryRun;

    // ---- candidate loads (AVAILABLE & unassigned) ----
    const { data: loads, error: loadsErr } = await supabase
      .from("loads")
      .select("id, reference, load_number, driver_id, status, created_at")
      .is("driver_id", null)
      .eq("status", "AVAILABLE")
      .order("created_at", { ascending: true })
      .limit(LIMIT);
    if (loadsErr) return ERR(req, `Loads query failed: ${loadsErr.message}`, 500);
    if (!loads?.length) return OK(req, { ok: true, inserted: 0, reason: "No AVAILABLE unassigned loads." });

    // ---- candidate drivers (ACTIVE) ----
    const { data: drivers, error: driversErr } = await supabase
      .from("drivers")
      .select("id, full_name, first_name, last_name, status, created_at")
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: true })
      .limit(LIMIT * 3);
    if (driversErr) return ERR(req, `Drivers query failed: ${driversErr.message}`, 500);
    if (!drivers?.length) return OK(req, { ok: true, inserted: 0, reason: "No ACTIVE drivers." });

    // ---- hard de-dup: find loads that already have ANY NEW auto rec ----
    const loadIds = loads.map((l) => l.id);
    const { data: existing, error: existErr } = await supabase
      .from("ai_recommendations")
      .select("related_id")
      .eq("source", "auto")
      .eq("status", "NEW")
      .eq("related_type", "LOAD")
      .in("related_id", loadIds);
    if (existErr) return ERR(req, `De-dup query failed: ${existErr.message}`, 500);

    const alreadyHasNew = new Set((existing || []).map((r: any) => r.related_id));

    // ---- choose one best driver per load (no reuse within this run) ----
    const usedDrivers = new Set<string>();
    const toInsert: Array<Record<string, unknown>> = [];

    for (const L of loads) {
      if (alreadyHasNew.has(L.id)) continue; // skip to satisfy unique index

      const chosen = drivers.find((d) => !usedDrivers.has(d.id));
      if (!chosen) break;

      usedDrivers.add(chosen.id);

      const driverName =
        (chosen.full_name?.trim() ||
          `${chosen.first_name ?? ""} ${chosen.last_name ?? ""}`.trim()) ||
        chosen.id.slice(0, 8);

      const displayRef = L.reference || L.load_number || L.id.slice(0, 8);

      toInsert.push({
        title: "Auto: assign available driver",
        content: `Driver ${driverName} is available. Recommend assigning to load ${displayRef}.`,
        source: "auto",
        kind: "AI",
        severity: "LOW",
        status: "NEW",
        related_type: "LOAD",
        related_id: L.id,
        meta: {
          recommended_driver_id: chosen.id,
          recommended_driver_name: driverName,
        },
        tags: ["auto", "assign", "match-basic"],
      });
    }

    if (!toInsert.length) {
      return OK(req, { ok: true, inserted: 0, reason: "All candidate loads already have NEW auto recs or no drivers left." });
    }

    if (DRY) return OK(req, { ok: true, dryRun: true, preview: toInsert, inserted: 0 });

    // ---- insert; if meta missing, retry without it ----
    const doInsert = async (rows: Array<Record<string, unknown>>) =>
      await supabase.from("ai_recommendations").insert(rows).select("id, related_id");

    let { data: inserted, error: insErr } = await doInsert(toInsert);

    // if meta column doesn't exist, strip and retry
    if (insErr && /column\s+"?meta"?\s+does not exist/i.test(insErr.message)) {
      const stripped = toInsert.map((r) => {
        const { meta, ...rest } = r;
        return rest;
      });
      const retry = await doInsert(stripped);
      inserted = retry.data;
      insErr = retry.error || null;
    }

    // if unique index still trips for some race condition, treat as success (no new rows)
    if (insErr && /duplicate key value violates unique constraint/i.test(insErr.message)) {
      return OK(req, { ok: true, inserted: 0, reason: "Skipped: NEW auto rec already exists for some loads." });
    }

    if (insErr) return ERR(req, `Insert failed: ${insErr.message}`, 500);

    return OK(req, {
      ok: true,
      inserted: inserted?.length || 0,
      ids: (inserted || []).map((r: any) => r.id),
    });
  } catch (e) {
    return ERR(req, String(e?.message || e), 500);
  }
});
