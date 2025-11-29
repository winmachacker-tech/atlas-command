// FILE: supabase/functions/hos-sync/index.ts
//
// Purpose:
// Safely update driver HOS (Hours of Service) snapshot fields on public.drivers.
//
// - Accepts a JSON body with a list of drivers and their HOS values (in minutes).
// - Uses the caller's JWT (Authorization: Bearer <access_token>) to resolve
//   current_org_id(), so updates are scoped to the active org.
// - Uses the Supabase SERVICE_ROLE key on the server side, but STILL filters
//   updates by org_id, so multi-tenant boundaries are respected.
// - Does NOT modify any RLS policies or security logic.
//
// This is a generic ingestion endpoint. Later you can:
// - Build a Motive HOS poller that calls this function with mapped driver IDs.
// - Build a Samsara HOS clocks poller that calls this function.
// - Or call it manually from internal admin tools to seed/test HOS data.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

type Json = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[hos-sync] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
}

// CORS headers so you can call this from browser/Atlas UI if needed
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper: JSON response with CORS
function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Supabase client using SERVICE_ROLE, but passing user JWT in headers
function getSupabaseClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });
}

// Resolve current_org_id() for the calling user
async function fetchCurrentOrgId(jwt: string): Promise<string | null> {
  const supabase = getSupabaseClient(jwt);
  const { data, error } = await supabase.rpc("current_org_id");

  if (error) {
    console.error("[hos-sync] current_org_id error:", error.message);
    throw new Error("Failed to resolve current_org_id()");
  }

  return (data as string | null) ?? null;
}

// Shape of a driver payload we expect in the request body
interface DriverHosPayload {
  driver_id: string; // internal drivers.id (uuid)
  hos_drive_remaining_min?: number | null;
  hos_shift_remaining_min?: number | null;
  hos_cycle_remaining_min?: number | null;
  hos_on_duty_today_min?: number | null;
  hos_drive_today_min?: number | null;
  hos_status?: string | null;
  hos_last_synced_at?: string | null; // ISO string; if omitted, we'll use now()
}

// Clean/normalize a payload (e.g., cast empty strings to null)
function normalizeDriverHosPayload(p: DriverHosPayload): DriverHosPayload {
  const clean = { ...p };

  // Convert empty strings to null for optional fields
  const toNullIfEmpty = (v: unknown) =>
    typeof v === "string" && v.trim() === "" ? null : v;

  clean.hos_status = toNullIfEmpty(clean.hos_status) as string | null;
  clean.hos_last_synced_at = toNullIfEmpty(
    clean.hos_last_synced_at,
  ) as string | null;

  return clean;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method not allowed. Use POST." },
      405,
    );
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();

    if (!jwt) {
      return jsonResponse(
        { ok: false, error: "Missing Authorization Bearer token." },
        401,
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
    }

    // Basic body validation
    const drivers = Array.isArray(body?.drivers) ? body.drivers : null;

    if (!drivers || drivers.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "Body must include a non-empty 'drivers' array.",
          example: {
            drivers: [
              {
                driver_id: "uuid-of-driver",
                hos_drive_remaining_min: 300,
                hos_shift_remaining_min: 480,
                hos_cycle_remaining_min: 1800,
                hos_on_duty_today_min: 120,
                hos_drive_today_min: 60,
                hos_status: "DRIVING",
                hos_last_synced_at: new Date().toISOString(),
              },
            ],
          },
        },
        400,
      );
    }

    // Resolve org for this user
    const orgId = await fetchCurrentOrgId(jwt);
    if (!orgId) {
      return jsonResponse(
        {
          ok: false,
          error:
            "No active organization found for this user. Make sure your account is linked to an org.",
        },
        403,
      );
    }

    const supabase = getSupabaseClient(jwt);

    const results: {
      driver_id: string;
      success: boolean;
      error?: string;
    }[] = [];

    // Update each driver row
    for (const raw of drivers) {
      const payload = normalizeDriverHosPayload(raw as DriverHosPayload);

      if (!payload.driver_id) {
        results.push({
          driver_id: "(missing)",
          success: false,
          error: "Missing driver_id",
        });
        continue;
      }

      // Build update object only with fields present in the payload
      const update: Record<string, unknown> = {};

      if ("hos_drive_remaining_min" in payload) {
        update.hos_drive_remaining_min = payload.hos_drive_remaining_min;
      }
      if ("hos_shift_remaining_min" in payload) {
        update.hos_shift_remaining_min = payload.hos_shift_remaining_min;
      }
      if ("hos_cycle_remaining_min" in payload) {
        update.hos_cycle_remaining_min = payload.hos_cycle_remaining_min;
      }
      if ("hos_on_duty_today_min" in payload) {
        update.hos_on_duty_today_min = payload.hos_on_duty_today_min;
      }
      if ("hos_drive_today_min" in payload) {
        update.hos_drive_today_min = payload.hos_drive_today_min;
      }
      if ("hos_status" in payload) {
        update.hos_status = payload.hos_status;
      }

      // If caller didn't send hos_last_synced_at, default to now()
      if ("hos_last_synced_at" in payload && payload.hos_last_synced_at) {
        update.hos_last_synced_at = payload.hos_last_synced_at;
      } else {
        update.hos_last_synced_at = new Date().toISOString();
      }

      if (Object.keys(update).length === 0) {
        results.push({
          driver_id: payload.driver_id,
          success: false,
          error: "No HOS fields provided to update.",
        });
        continue;
      }

      const { error } = await supabase
        .from("drivers")
        .update(update)
        .eq("id", payload.driver_id)
        .eq("org_id", orgId);

      if (error) {
        console.error("[hos-sync] Update error for driver", payload.driver_id, error.message);
        results.push({
          driver_id: payload.driver_id,
          success: false,
          error: error.message,
        });
      } else {
        results.push({
          driver_id: payload.driver_id,
          success: true,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return jsonResponse({
      ok: true,
      org_id: orgId,
      total: results.length,
      updated: successCount,
      failed: failureCount,
      results,
    });
  } catch (err: any) {
    console.error("[hos-sync] Error:", err?.message || err);
    return jsonResponse(
      { ok: false, error: "Internal server error in hos-sync." },
      500,
    );
  }
});
