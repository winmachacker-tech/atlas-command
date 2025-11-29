// FILE: supabase/functions/hos-sim-reset/index.ts
// Purpose: Demo-only HOS reset simulator.
// - Derives org_id from the caller's JWT (via current_org_id()).
// - Resets HOS fields for all drivers in that org to a "fresh day" state.
// - NOT real ELD data. Do not use for compliance.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[hos-sim-reset] Missing Supabase env vars");
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!authHeader) {
      console.error("[hos-sim-reset] Missing Authorization header");
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create client that runs as the authenticated user (JWT forwarded)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Derive org_id from the authenticated user via your existing helper
    const { data: orgId, error: orgErr } = await supabase.rpc("current_org_id");

    if (orgErr || !orgId) {
      console.error("[hos-sim-reset] current_org_id error:", orgErr);
      return new Response(
        JSON.stringify({ error: "Could not determine org_id from token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[hos-sim-reset] Using org_id:", orgId);

    // Get how many drivers we have for logging / UX summary
    const { data: beforeDrivers, error: beforeErr } = await supabase
      .from("drivers")
      .select("id")
      .eq("org_id", orgId);

    if (beforeErr) {
      console.error("[hos-sim-reset] Failed to count drivers:", beforeErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch drivers for org" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const totalDrivers = beforeDrivers?.length ?? 0;

    // "Fresh day" defaults (11h drive, 14h shift, 70h cycle – demo only)
    const defaultDriveMin = 11 * 60;
    const defaultShiftMin = 14 * 60;
    const defaultCycleMin = 70 * 60;
    const nowIso = new Date().toISOString();

    const { data: updatedRows, error: updateErr } = await supabase
      .from("drivers")
      .update({
        hos_drive_remaining_min: defaultDriveMin,
        hos_shift_remaining_min: defaultShiftMin,
        hos_cycle_remaining_min: defaultCycleMin,
        hos_on_duty_today_min: 0,
        hos_drive_today_min: 0,
        hos_status: "OFF_DUTY",
        hos_last_synced_at: nowIso,
      })
      .eq("org_id", orgId)
      .select("id");

    if (updateErr) {
      console.error("[hos-sim-reset] Update error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Failed to reset HOS for drivers" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resetCount = updatedRows?.length ?? 0;

    const payload = {
      success: true,
      org_id: orgId,
      total_drivers: totalDrivers,
      reset_count: resetCount,
      defaults: {
        drive_min: defaultDriveMin,
        shift_min: defaultShiftMin,
        cycle_min: defaultCycleMin,
      },
      timestamp: nowIso,
      note: "Demo-only HOS reset. Not real ELD data.",
    };

    console.log("[hos-sim-reset] Result:", payload);

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[hos-sim-reset] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error", details: `${err}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
