// FILE: supabase/functions/hos-sim-tick/index.ts
//
// Purpose:
//   Small simulation function to "tick" HOS data for drivers.
//   - Reads drivers in the caller's org (via current_org_id() + RLS).
//   - Only touches drivers that already have HOS fields set.
//   - Decreases remaining minutes, increases "today" minutes based on status.
//   - Lets us exercise and test HOS-aware logic in Dipsy before real ELDs.
//
// Security:
//   - Uses SUPABASE_SERVICE_ROLE_KEY on the server **but**
//     always forwards the caller's JWT in the Authorization header,
//     so ALL queries remain bound by your Row Level Security policies.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

type Json = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[hos-sim-tick] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
  );
}

// CORS (handy if you ever call this from the browser for debugging)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Create Supabase client that:
// - uses service role key (server-side only)
// - but forwards the user's JWT so RLS sees the real user/org context
function getSupabaseClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });
}

async function fetchCurrentOrgId(jwt: string): Promise<string | null> {
  const supabase = getSupabaseClient(jwt);
  const { data, error } = await supabase.rpc("current_org_id");

  if (error) {
    console.error("[hos-sim-tick] current_org_id error:", error.message);
    throw new Error("Failed to resolve current_org_id()");
  }

  return (data as string | null) ?? null;
}

interface DriverHosRow {
  id: string;
  org_id: string;
  first_name: string | null;
  last_name: string | null;
  hos_drive_remaining_min: number | null;
  hos_shift_remaining_min: number | null;
  hos_cycle_remaining_min: number | null;
  hos_on_duty_today_min: number | null;
  hos_drive_today_min: number | null;
  hos_status: string | null;
  hos_last_synced_at: string | null;
}

// Helper: clamp downwards, never below 0
function decMinutes(v: number | null, tick: number): number | null {
  if (v === null || typeof v !== "number") return null;
  const next = v - tick;
  return next > 0 ? next : 0;
}

// Helper: increase minutes, starting at tick if null
function incMinutes(v: number | null, tick: number): number {
  if (v === null || typeof v !== "number") return tick;
  return v + tick;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        { ok: false, error: "Method not allowed. Use POST." },
        405
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();

    if (!jwt) {
      return jsonResponse(
        { ok: false, error: "Missing Authorization Bearer token." },
        401
      );
    }

    // Optional body: { tick_minutes?: number }
    let tickMinutes = 15;
    try {
      const body = (await req.json()) as { tick_minutes?: unknown } | null;
      if (body && typeof body.tick_minutes === "number") {
        // Clamp between 1 and 240 minutes
        const n = body.tick_minutes;
        if (Number.isFinite(n)) {
          tickMinutes = Math.min(Math.max(Math.round(n), 1), 240);
        }
      }
    } catch {
      // No / bad JSON -> ignore, use default 15 minutes
    }

    const supabase = getSupabaseClient(jwt);

    // Resolve the caller's active org using your existing logic
    const orgId = await fetchCurrentOrgId(jwt);
    if (!orgId) {
      return jsonResponse(
        {
          ok: false,
          error:
            "No active organization found (current_org_id() returned null).",
        },
        403
      );
    }

    console.log(
      `[hos-sim-tick] Starting HOS simulation tick=${tickMinutes} min for org ${orgId}`
    );

    // ---- 1) Load drivers for this org ----
    // IMPORTANT CHANGE:
    //   We DO NOT use .or("hos_status.is.not.null,...") anymore.
    //   That syntax caused the PGRST100 parse error you saw.
    //
    //   Instead, we fetch all drivers in this org and filter in JS.
    const { data: drivers, error: driverErr } = await supabase
      .from("drivers")
      .select(
        `
        id,
        org_id,
        first_name,
        last_name,
        hos_drive_remaining_min,
        hos_shift_remaining_min,
        hos_cycle_remaining_min,
        hos_on_duty_today_min,
        hos_drive_today_min,
        hos_status,
        hos_last_synced_at
      `
      )
      .eq("org_id", orgId);

    if (driverErr) {
      console.error("[hos-sim-tick] Failed to fetch drivers:", driverErr);
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch drivers for this organization.",
          details: driverErr,
        },
        500
      );
    }

    const allDrivers = (drivers ?? []) as DriverHosRow[];

    // Only simulate for drivers that actually have some HOS data
    const simulatable = allDrivers.filter((d) => {
      return (
        d.hos_status !== null ||
        d.hos_drive_remaining_min !== null ||
        d.hos_shift_remaining_min !== null ||
        d.hos_cycle_remaining_min !== null ||
        d.hos_on_duty_today_min !== null ||
        d.hos_drive_today_min !== null
      );
    });

    if (simulatable.length === 0) {
      console.log(
        "[hos-sim-tick] No drivers with HOS data to simulate for this org."
      );
      return jsonResponse({
        ok: true,
        org_id: orgId,
        total_drivers: allDrivers.length,
        simulatable_drivers: 0,
        updated: 0,
        tick_minutes: tickMinutes,
        message: "No drivers had HOS fields set. Nothing to update.",
      });
    }

    console.log(
      `[hos-sim-tick] Simulating HOS for ${simulatable.length} drivers`
    );

    const nowIso = new Date().toISOString();
    let updated = 0;
    let failed = 0;

    for (const d of simulatable) {
      const status = d.hos_status || "OFF_DUTY";
      const isDriving = status === "DRIVING";
      const isOnDuty = status === "ON_DUTY" || isDriving;

      const next_drive_remaining = decMinutes(
        d.hos_drive_remaining_min,
        tickMinutes
      );
      const next_shift_remaining = decMinutes(
        d.hos_shift_remaining_min,
        tickMinutes
      );
      const next_cycle_remaining = decMinutes(
        d.hos_cycle_remaining_min,
        tickMinutes
      );

      const next_on_duty_today = isOnDuty
        ? incMinutes(d.hos_on_duty_today_min, tickMinutes)
        : d.hos_on_duty_today_min;
      const next_drive_today = isDriving
        ? incMinutes(d.hos_drive_today_min, tickMinutes)
        : d.hos_drive_today_min;

      const updatePayload = {
        hos_drive_remaining_min: next_drive_remaining,
        hos_shift_remaining_min: next_shift_remaining,
        hos_cycle_remaining_min: next_cycle_remaining,
        hos_on_duty_today_min: next_on_duty_today,
        hos_drive_today_min: next_drive_today,
        hos_last_synced_at: nowIso,
      };

      const { error: updErr } = await supabase
        .from("drivers")
        .update(updatePayload)
        .eq("id", d.id)
        .eq("org_id", orgId);

      if (updErr) {
        failed += 1;
        console.error(
          `[hos-sim-tick] Failed to update driver ${d.id}:`,
          updErr
        );
      } else {
        updated += 1;
      }
    }

    console.log(
      `[hos-sim-tick] Done. Updated=${updated}, Failed=${failed}, Tick=${tickMinutes}min`
    );

    return jsonResponse({
      ok: true,
      org_id: orgId,
      total_drivers: allDrivers.length,
      simulatable_drivers: simulatable.length,
      updated,
      failed,
      tick_minutes: tickMinutes,
      timestamp: nowIso,
    });
  } catch (err: unknown) {
    console.error("[hos-sim-tick] Unhandled error:", err);
    return jsonResponse(
      {
        ok: false,
        error: "Internal server error in hos-sim-tick.",
      },
      500
    );
  }
});
