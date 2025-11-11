// supabase/functions/dispatch-intent/index.ts
// Assign / Unassign by IDs (preferred) or by natural-language prompt (back-compat).
// Uses SERVICE KEY (bypass RLS). Includes strict CORS and safe error handling.
// Now also logs each handled request to public.ai_recommendations.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

/** ------------------------- CORS (allow-list) ------------------------- */
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://atlas-command-iota.vercel.app", // add your prod origin(s)
]);

function pickAllowedOrigin(req: Request): string {
  const origin = req.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return "http://localhost:5173";
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = pickAllowedOrigin(req);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** ---------------------- Helpers / simple parsing --------------------- */
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

function isAssignIntent(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes("assign a driver") ||
    t.includes("assign driver") ||
    (t.includes("assign") && t.includes("driver"))
  );
}
function isUnassignIntent(text: string) {
  const t = text.toLowerCase();
  return t.includes("unassign") && t.includes("load");
}
function extractLoadToken(prompt: string): string | null {
  const p = prompt.trim();
  const m = p.match(
    /(?:assign|unassign)\s+(?:a\s+driver\s+for\s+)?load\s+(.+?)(?:\s+to\s+driver|\s*$)/i
  );
  if (m && m[1]) return m[1].trim().replace(/["'.,]/g, "");
  const u = p.match(UUID_RE)?.[0];
  return u ? u.trim() : null;
}
function extractDriverName(prompt: string): string | null {
  const m = prompt.match(/to\s+driver\s+(.+)$/i);
  if (m && m[1]) return m[1].trim().replace(/["'.,]/g, "");
  return null;
}
function nameKey(s: string) {
  return s
    .toLowerCase()
    .replace(/[,._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** --------------------- AI Recommendations Logger --------------------- */
/**
 * Non-blocking insert into public.ai_recommendations.
 * If the insert fails, we swallow the error and return a warning object.
 */
async function logAiRec(
  supabase: ReturnType<typeof createClient>,
  opts: {
    title: string;
    content: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    status?: "NEW" | "ACCEPTED" | "REJECTED" | "ARCHIVED";
    related_id?: string | null;
    related_type?: "LOAD" | "DRIVER" | "TRUCK" | null;
    tags?: string[];
    kind?: "AI" | "HUMAN";
    source?: string;
  }
) {
  const payload = {
    title: opts.title,
    content: opts.content,
    source: opts.source ?? "dispatch-intent",
    kind: opts.kind ?? "AI",
    severity: opts.severity,
    status: opts.status ?? "NEW",
    related_type: opts.related_type ?? (opts.related_id ? "LOAD" : null),
    related_id: opts.related_id ?? null,
    tags: opts.tags ?? ["dispatch"],
  };

  try {
    const { data, error } = await supabase
      .from("ai_recommendations")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return { recommendation: data, warning: null };
  } catch (e) {
    // Do not block the main flow if logging fails.
    return { recommendation: null, warning: String(e?.message || e) };
  }
}

/** ------------------------------ Main --------------------------------- */
serve(async (req) => {
  const baseCors = corsHeaders(req);

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: baseCors });
  }

  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({
          error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        }),
        { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    // Admin (service role) — bypasses RLS by design of your original function
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Body
    let body: {
      action?: "assign" | "unassign";
      load_id?: string; // ✅ preferred path
      driver_id?: string; // ✅ preferred path for assign
      org_id?: string;
      prompt?: string; // back-compat
      dryRun?: boolean;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      /* ignore; handled below if needed */
    }

    const dryRun = Boolean(body.dryRun);

    /** ------------------------------------------------------------------
     *  PREFERRED PATH: explicit IDs
     *  ------------------------------------------------------------------ */
    if (body.load_id && body.action === "unassign") {
      // Fetch load to know current driver for status flip (optional)
      const { data: load, error: loadErr } = await supabase
        .from("loads")
        .select("id, driver_id, reference, load_number")
        .eq("id", body.load_id)
        .maybeSingle();
      if (loadErr) {
        return new Response(
          JSON.stringify({ error: `Load lookup failed: ${loadErr.message}` }),
          { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
        );
      }
      if (!load) {
        return new Response(JSON.stringify({ error: "Load not found." }), {
          status: 404,
          headers: { ...baseCors, "Content-Type": "application/json" },
        });
      }

      if (!dryRun) {
        const { error: updLoadErr } = await supabase
          .from("loads")
          .update({ driver_id: null })
          .eq("id", load.id);
        if (updLoadErr) {
          return new Response(
            JSON.stringify({ error: `Failed to update load: ${updLoadErr.message}` }),
            { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
          );
        }
        if (load.driver_id) {
          await supabase.from("drivers").update({ status: "ACTIVE" }).eq("id", load.driver_id);
        }
      }

      // 🔎 Log to ai_recommendations (non-blocking)
      const { recommendation, warning } = await logAiRec(supabase, {
        title: "Unassign driver request",
        content:
          body.prompt?.trim() ||
          `Unassign driver from load ${load.reference ?? load.load_number ?? load.id}`,
        severity: "HIGH",
        status: "NEW",
        related_id: load.id,
        related_type: "LOAD",
        tags: ["dispatch", "unassign"],
      });

      return new Response(
        JSON.stringify({
          action: "unassign_driver",
          load_id: load.id,
          reference: load.reference ?? null,
          load_number: load.load_number ?? null,
          message: dryRun
            ? `Dry run: would unassign driver from load ${load.reference ?? load.load_number ?? load.id}`
            : `Unassigned driver from load ${load.reference ?? load.load_number ?? load.id}`,
          recommendation,
          log_warning: warning, // present only if logging failed
        }),
        { status: 200, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    if (body.load_id && body.driver_id && (body.action === "assign" || !body.action)) {
      // Verify load & driver
      const [{ data: load, error: loadErr }, { data: drv, error: drvErr }] = await Promise.all([
        supabase
          .from("loads")
          .select("id, reference, load_number")
          .eq("id", body.load_id)
          .maybeSingle(),
        supabase
          .from("drivers")
          .select("id, status, first_name, last_name, full_name")
          .eq("id", body.driver_id)
          .maybeSingle(),
      ]);

      if (loadErr) {
        return new Response(
          JSON.stringify({ error: `Load lookup failed: ${loadErr.message}` }),
          { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
        );
      }
      if (!load) {
        return new Response(JSON.stringify({ error: "Load not found." }), {
          status: 404,
          headers: { ...baseCors, "Content-Type": "application/json" },
        });
      }
      if (drvErr) {
        return new Response(
          JSON.stringify({ error: `Driver lookup failed: ${drvErr.message}` }),
          { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
        );
      }
      if (!drv) {
        return new Response(JSON.stringify({ error: "Driver not found." }), {
          status: 404,
          headers: { ...baseCors, "Content-Type": "application/json" },
        });
      }

      const fullName =
        (drv.full_name?.trim() ||
          `${drv.first_name ?? ""} ${drv.last_name ?? ""}`.trim()) ||
        drv.id;

      if (!dryRun) {
        const { error: updLoadErr } = await supabase
          .from("loads")
          .update({ driver_id: drv.id })
          .eq("id", load.id);
        if (updLoadErr) {
          return new Response(
            JSON.stringify({ error: `Failed to update load: ${updLoadErr.message}` }),
            { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
          );
        }
        if (drv.status === "ACTIVE") {
          await supabase.from("drivers").update({ status: "ASSIGNED" }).eq("id", drv.id);
        }
      }

      // 🔎 Log to ai_recommendations (non-blocking)
      const { recommendation, warning } = await logAiRec(supabase, {
        title: "Assign driver request",
        content:
          body.prompt?.trim() ||
          `Assign driver ${fullName} to load ${load.reference ?? load.load_number ?? load.id}`,
        severity: "MEDIUM",
        status: "NEW",
        related_id: load.id,
        related_type: "LOAD",
        tags: ["dispatch", "assign"],
      });

      return new Response(
        JSON.stringify({
          action: "assign_driver",
          load_id: load.id,
          load_number: load.load_number ?? null,
          reference: load.reference ?? null,
          driver: { id: drv.id, name: fullName },
          message: dryRun
            ? `Dry run: would assign ${fullName} to load ${load.reference ?? load.load_number ?? load.id}`
            : `Assigned ${fullName} to load ${load.reference ?? load.load_number ?? load.id}`,
          recommendation,
          log_warning: warning,
        }),
        { status: 200, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    /** ------------------------------------------------------------------
     *  BACK-COMPAT PATH: natural-language prompt
     *  ------------------------------------------------------------------ */
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required fields. Provide (action, load_id[, driver_id]) or a prompt.",
        }),
        { status: 400, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    // Determine intent
    const intentAssign = isAssignIntent(prompt);
    const intentUnassign = isUnassignIntent(prompt);
    const token = extractLoadToken(prompt);

    if (!token) {
      // Still log an unlinked recommendation so it shows up in your hub.
      const { recommendation, warning } = await logAiRec(supabase, {
        title: "Dispatch request (unlinked)",
        content: prompt,
        severity: "LOW",
        status: "NEW",
        related_id: null,
        related_type: null,
        tags: ["dispatch", "unlinked"],
      });

      return new Response(
        JSON.stringify({
          error:
            'Missing required field: load_id or load_number (or reference). Include a UUID or an external load reference/number in your prompt.',
          recommendation,
          log_warning: warning,
        }),
        { status: 400, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    // Lookup load by UUID / reference / load_number
    const isUuid = UUID_RE.test(token);
    const loadQuery = isUuid
      ? supabase
          .from("loads")
          .select("id, driver_id, reference, load_number")
          .eq("id", token.toLowerCase())
          .maybeSingle()
      : supabase
          .from("loads")
          .select("id, driver_id, reference, load_number")
          .or(`reference.eq.${token},load_number.eq.${token}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

    const { data: loadRow, error: loadErr2 } = await loadQuery;
    if (loadErr2) {
      return new Response(
        JSON.stringify({ error: `Load lookup failed: ${loadErr2.message}` }),
        { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }
    if (!loadRow) {
      // Log as unlinked (token not found)
      const { recommendation, warning } = await logAiRec(supabase, {
        title: "Dispatch request (unknown load)",
        content: prompt,
        severity: "LOW",
        related_id: null,
        related_type: null,
        tags: ["dispatch", "not_found"],
      });

      return new Response(
        JSON.stringify({ error: `Load not found for token "${token}".`, recommendation, log_warning: warning }),
        { status: 404, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    if (intentUnassign) {
      if (!dryRun) {
        await supabase.from("loads").update({ driver_id: null }).eq("id", loadRow.id);
      }

      const { recommendation, warning } = await logAiRec(supabase, {
        title: "Unassign driver request",
        content: prompt,
        severity: "HIGH",
        related_id: loadRow.id,
        related_type: "LOAD",
        tags: ["dispatch", "unassign"],
      });

      return new Response(
        JSON.stringify({
          action: "unassign_driver",
          load_id: loadRow.id,
          reference: loadRow.reference ?? null,
          load_number: loadRow.load_number ?? null,
          message: dryRun
            ? `Dry run: would unassign driver from load ${loadRow.reference ?? loadRow.load_number ?? loadRow.id}`
            : `Unassigned driver from load ${loadRow.reference ?? loadRow.load_number ?? loadRow.id}`,
          recommendation,
          log_warning: warning,
        }),
        { status: 200, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    if (intentAssign) {
      // Try to match by name if provided; otherwise pick first ACTIVE
      const desiredName = extractDriverName(prompt);
      const { data: pool, error: poolErr } = await supabase
        .from("drivers")
        .select("id, status, first_name, last_name, full_name")
        .eq("status", "ACTIVE")
        .order("last_name", { ascending: true })
        .limit(200);
      if (poolErr) {
        return new Response(
          JSON.stringify({ error: `Driver query failed: ${poolErr.message}` }),
          { status: 500, headers: { ...baseCors, "Content-Type": "application/json" } }
        );
      }
      if (!pool || pool.length === 0) {
        // Log the failed attempt linked to the load
        const { recommendation, warning } = await logAiRec(supabase, {
          title: "Assign driver request (no ACTIVE drivers)",
          content: prompt,
          severity: "MEDIUM",
          related_id: loadRow.id,
          related_type: "LOAD",
          tags: ["dispatch", "assign", "no_candidates"],
        });

        return new Response(
          JSON.stringify({
            error: "No eligible driver found (need at least one ACTIVE driver)",
            recommendation,
            log_warning: warning,
          }),
          { status: 400, headers: { ...baseCors, "Content-Type": "application/json" } }
        );
      }

      let chosen = pool[0];
      if (desiredName) {
        const target = nameKey(desiredName);
        const byFull =
          pool.find((d) => d.full_name && nameKey(d.full_name) === target) ??
          pool.find(
            (d) => nameKey(`${d.first_name ?? ""} ${d.last_name ?? ""}`) === target
          ) ??
          pool.find(
            (d) => nameKey(`${d.last_name ?? ""} ${d.first_name ?? ""}`) === target
          );
        if (!byFull) {
          const { recommendation, warning } = await logAiRec(supabase, {
            title: `Assign driver request (driver "${desiredName}" not found)`,
            content: prompt,
            severity: "MEDIUM",
            related_id: loadRow.id,
            related_type: "LOAD",
            tags: ["dispatch", "assign", "not_found"],
          });

          return new Response(
            JSON.stringify({
              error: `Driver "${desiredName}" not found among ACTIVE drivers.`,
              recommendation,
              log_warning: warning,
            }),
            { status: 404, headers: { ...baseCors, "Content-Type": "application/json" } }
          );
        }
        chosen = byFull;
      }

      const fullName =
        (chosen.full_name?.trim() ||
          `${chosen.first_name ?? ""} ${chosen.last_name ?? ""}`.trim()) ||
        chosen.id;

      if (!dryRun) {
        await supabase.from("loads").update({ driver_id: chosen.id }).eq("id", loadRow.id);
        if (chosen.status === "ACTIVE") {
          await supabase.from("drivers").update({ status: "ASSIGNED" }).eq("id", chosen.id);
        }
      }

      const { recommendation, warning } = await logAiRec(supabase, {
        title: "Assign driver request",
        content: prompt,
        severity: "MEDIUM",
        related_id: loadRow.id,
        related_type: "LOAD",
        tags: ["dispatch", "assign"],
      });

      return new Response(
        JSON.stringify({
          action: "assign_driver",
          load_id: loadRow.id,
          load_number: loadRow.load_number ?? null,
          reference: loadRow.reference ?? null,
          driver: { id: chosen.id, name: fullName },
          message: dryRun
            ? `Dry run: would assign ${fullName} to load ${loadRow.reference ?? loadRow.load_number ?? loadRow.id}`
            : `Assigned ${fullName} to load ${loadRow.reference ?? loadRow.load_number ?? loadRow.id}`,
          recommendation,
          log_warning: warning,
        }),
        { status: 200, headers: { ...baseCors, "Content-Type": "application/json" } }
      );
    }

    // Unknown intent -> log unlinked and return helpful error
    const { recommendation, warning } = await logAiRec(supabase, {
      title: "Dispatch request (unrecognized intent)",
      content: prompt,
      severity: "LOW",
      related_id: null,
      related_type: null,
      tags: ["dispatch", "unknown_intent"],
    });

    return new Response(
      JSON.stringify({
        error: "Unrecognized intent. Provide IDs or a valid prompt.",
        recommendation,
        log_warning: warning,
      }),
      { status: 400, headers: { ...baseCors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
