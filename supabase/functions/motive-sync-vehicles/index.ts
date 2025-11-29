// FILE: supabase/functions/motive-sync-vehicles/index.ts
//
// Motive → Atlas Vehicle Sync Engine (V1)
// --------------------------------------
// - Called from Atlas UI with the user's Supabase JWT.
// - Resolves current org via current_org_id() (RLS-safe).
// - Looks up that org's Motive OAuth token in public.motive_connections.
// - Calls Motive /v1/vehicles with a FULL SYNC (no updated_after filter).
// - Safely parses the response (even if not JSON).
// - Normalizes and upserts into public.motive_vehicles (per org).
// - Logs each run in public.motive_sync_runs (status, totals, errors).
//
// Security:
// - Uses anon key + Authorization header for user/org resolution (RLS).
// - Uses service-role key only inside this function for internal writes.
// - Never exposes secrets to the browser.
// - Never changes RLS policies.
//

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, unknown> | null;

// CORS so browser → Supabase Functions works
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface MotiveVehicle {
  id?: number | string;
  vehicle_id?: number | string;
  company_id?: number;
  number?: string;
  status?: string;
  ifta?: boolean;
  vin?: string;
  make?: string;
  model?: string;
  year?: string;
  license_plate_state?: string;
  availability_details?: {
    availability_status?: string;
    out_of_service_reason?: string;
    updated_at?: string;
    additional_note?: string;
  };
  availability_status?: string;
  out_of_service_reason?: string;
  updated_at?: string;
  additional_note?: string;
  custom_driver_app_warning_prompt?: string;
  [key: string]: unknown;
}

interface MotiveVehicleRow {
  org_id: string;
  motive_vehicle_id: number;
  company_id: number | null;
  number: string | null;
  status: string | null;
  is_ifta: boolean | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  license_plate_state: string | null;
  availability_status: string | null;
  out_of_service_reason: string | null;
  motive_updated_at: string | null;
  availability_additional_note: string | null;
  custom_driver_app_warning_prompt: string | null;
  raw: Json;
}

interface MotiveSyncRunRow {
  id?: string;
  org_id: string;
  started_at?: string;
  finished_at?: string | null;
  status: "running" | "success" | "error";
  total_vehicles?: number | null;
  error_message?: string | null;
  updated_after_param?: string | null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MOTIVE_API_BASE_URL =
  Deno.env.get("MOTIVE_API_BASE_URL") ?? "https://api.gomotive.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Safely extract a numeric vehicle ID from various possible fields.
// Returns null if we can't get a valid ID.
function extractMotiveVehicleId(v: MotiveVehicle): number | null {
  const candidates: Array<number | string | undefined> = [
    v.id,
    v.vehicle_id,
    (v as any).vehicleId,
    (v as any).vehicleID,
  ];

  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) {
      return c;
    }
    if (typeof c === "string" && c.trim() !== "") {
      const n = Number(c);
      if (Number.isFinite(n)) {
        return n;
      }
    }
  }

  return null;
}

// Some integrations wrap the payload like:
// { vehicles: [ { vehicle: { id: ..., number: ... } } ] }
// This flattens the wrapper so our extractor sees top-level id/number/etc.
function flattenVehicleWrapper(v: any): MotiveVehicle {
  if (
    v &&
    typeof v === "object" &&
    "vehicle" in v &&
    v.vehicle &&
    typeof v.vehicle === "object"
  ) {
    return {
      ...(v as Record<string, unknown>),
      ...(v.vehicle as Record<string, unknown>),
    } as MotiveVehicle;
  }

  return v as MotiveVehicle;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  // 0) Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  console.log("[motive-sync-vehicles] Incoming request", { requestId });

  try {
    // 1) Require Authorization header (user's Supabase JWT)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn("[motive-sync-vehicles] Missing Authorization header", {
        requestId,
      });
      return jsonResponse(
        { error: "Unauthorized", detail: "Missing Authorization header" },
        401,
      );
    }

    // 2) RLS-aware client (user scope)
    const supabaseRls = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // 3) Admin client (service role) for internal writes
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 4) Resolve current user
    const {
      data: { user },
      error: userError,
    } = await supabaseRls.auth.getUser();

    if (userError || !user) {
      console.error("[motive-sync-vehicles] Failed to get user", {
        requestId,
        userError,
      });
      return jsonResponse(
        { error: "Unauthorized", detail: "Invalid or expired session" },
        401,
      );
    }

    // 5) Resolve org via current_org_id()
    const { data: currentOrgId, error: orgError } = await supabaseRls.rpc<
      string
    >("current_org_id");

    if (orgError || !currentOrgId) {
      console.error("[motive-sync-vehicles] Failed to resolve current_org_id", {
        requestId,
        orgError,
      });
      return jsonResponse(
        {
          error: "Org resolution failed",
          detail:
            "Could not resolve the current org for this user. Make sure current_org_id() is set up.",
        },
        400,
      );
    }

    const orgId = currentOrgId;
    console.log("[motive-sync-vehicles] Starting sync for org", {
      requestId,
      orgId,
      userId: user.id,
    });

    // 6) Fetch Motive access token for this org
    const {
      data: motiveConn,
      error: motiveConnError,
    } = await supabaseAdmin
      .from("motive_connections")
      .select("access_token")
      .eq("org_id", orgId)
      .maybeSingle();

    if (motiveConnError) {
      console.error(
        "[motive-sync-vehicles] Error loading motive_connections",
        { requestId, error: motiveConnError },
      );
      return jsonResponse(
        {
          error: "Motive connection lookup failed",
          detail: motiveConnError.message,
        },
        500,
      );
    }

    if (!motiveConn || !motiveConn.access_token) {
      console.warn("[motive-sync-vehicles] No Motive access token found", {
        requestId,
        orgId,
      });
      return jsonResponse(
        {
          error: "Motive not connected",
          detail:
            "This org does not have a Motive connection set up. Please complete OAuth first.",
        },
        400,
      );
    }

    const motiveAccessToken = motiveConn.access_token as string;

    // 7) FULL SYNC (no incremental updated_after for V1)
    const updatedAfter: string | null = null;

    // 8) Log sync run as "running"
    const syncRun: MotiveSyncRunRow = {
      org_id: orgId,
      status: "running",
      updated_after_param: updatedAfter, // always null for V1 full sync
    };

    const {
      data: createdSyncRun,
      error: syncRunInsertError,
    } = await supabaseAdmin
      .from("motive_sync_runs")
      .insert(syncRun)
      .select("id, started_at")
      .single();

    if (syncRunInsertError || !createdSyncRun) {
      console.error("[motive-sync-vehicles] Failed to insert sync run", {
        requestId,
        error: syncRunInsertError,
      });
      return jsonResponse(
        { error: "Internal error", detail: "Could not create sync run record" },
        500,
      );
    }

    const syncRunId = createdSyncRun.id as string;

    // Helper: mark sync as error and respond
    const failSyncRun = async (message: string, statusCode = 500) => {
      console.error("[motive-sync-vehicles] Sync failed", {
        requestId,
        syncRunId,
        message,
      });

      await supabaseAdmin
        .from("motive_sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", syncRunId);

      return jsonResponse(
        { error: "Sync failed", detail: message },
        statusCode,
      );
    };

    // 9) Call Motive /v1/vehicles (full sync)
    const url = new URL("/v1/vehicles", MOTIVE_API_BASE_URL);

    console.log("[motive-sync-vehicles] Fetching Motive vehicles", {
      requestId,
      url: url.toString(),
    });

    let motiveResp: Response;
    try {
      motiveResp = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${motiveAccessToken}`,
          "Content-Type": "application/json",
        },
      });
    } catch (fetchErr) {
      const msg =
        fetchErr instanceof Error
          ? fetchErr.message
          : String(fetchErr ?? "Unknown error");
      return await failSyncRun(`Network error calling Motive: ${msg}`, 502);
    }

    // Read raw text first so we can handle non-JSON bodies safely
    const rawBody = await motiveResp.text();

    if (!motiveResp.ok) {
      const snippet = rawBody.slice(0, 500);
      return await failSyncRun(
        `Motive API error: ${motiveResp.status} ${motiveResp.statusText} - ${snippet}`,
        502,
      );
    }

    let motiveJson: any;
    try {
      motiveJson = rawBody ? JSON.parse(rawBody) : null;
    } catch (parseErr) {
      const snippet = rawBody.slice(0, 500);
      return await failSyncRun(
        `Failed to parse Motive JSON. Body snippet: ${snippet}`,
        502,
      );
    }

    // Log high-level structure
    console.log("[motive-sync-vehicles] Motive response shape", {
      requestId,
      topLevelKeys:
        motiveJson && typeof motiveJson === "object"
          ? Object.keys(motiveJson)
          : typeof motiveJson,
      vehiclesIsArray: Array.isArray(motiveJson?.vehicles),
      vehiclesDataIsArray: Array.isArray(motiveJson?.vehicles?.data),
      dataIsArray: Array.isArray(motiveJson?.data),
      rootIsArray: Array.isArray(motiveJson),
    });

    // Resolve where the vehicles actually live
    let rawVehicles: any[] = [];

    if (Array.isArray(motiveJson?.vehicles)) {
      rawVehicles = motiveJson.vehicles as any[];
    } else if (motiveJson?.vehicles && Array.isArray(motiveJson.vehicles.data)) {
      rawVehicles = motiveJson.vehicles.data as any[];
    } else if (Array.isArray(motiveJson?.data)) {
      rawVehicles = motiveJson.data as any[];
    } else if (Array.isArray(motiveJson)) {
      rawVehicles = motiveJson as any[];
    }

    console.log("[motive-sync-vehicles] Resolved vehicles length", {
      requestId,
      count: rawVehicles.length,
    });

    if (rawVehicles.length > 0) {
      console.log("[motive-sync-vehicles] Sample vehicle payload", {
        requestId,
        sample: rawVehicles[0],
      });
    }

    if (!rawVehicles || rawVehicles.length === 0) {
      // No vehicles returned: treat as a successful, empty sync.
      await supabaseAdmin
        .from("motive_sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          total_vehicles: 0,
          error_message: null,
        })
        .eq("id", syncRunId);

      return jsonResponse({
        status: "success",
        org_id: orgId,
        total_vehicles: 0,
        updated_after_used: updatedAfter,
        motive_response_shape:
          motiveJson && typeof motiveJson === "object"
            ? Object.keys(motiveJson)
            : typeof motiveJson,
      });
    }

    // 10) Normalize into motive_vehicles rows
    let skippedWithoutId = 0;

    const vehicleRows: MotiveVehicleRow[] = rawVehicles
      .map((v) => {
        // Flatten wrappers like { vehicle: { ... } }
        const flat = flattenVehicleWrapper(v);

        const motiveId = extractMotiveVehicleId(flat);
        if (motiveId === null) {
          skippedWithoutId += 1;
          return null;
        }

        const availability = flat.availability_details ?? {};
        const motiveUpdatedAt =
          (availability.updated_at as string | undefined) ??
          (flat.updated_at as string | undefined) ??
          null;

        return {
          org_id: orgId,
          motive_vehicle_id: motiveId,
          company_id:
            typeof flat.company_id === "number" ? flat.company_id : null,
          number: flat.number ?? null,
          status: flat.status ?? null,
          is_ifta: typeof flat.ifta === "boolean" ? flat.ifta : null,
          vin: flat.vin ?? null,
          make: flat.make ?? null,
          model: flat.model ?? null,
          year: flat.year ?? null,
          license_plate_state: flat.license_plate_state ?? null,
          availability_status:
            (availability.availability_status as string | undefined) ??
            (flat.availability_status as string | undefined) ??
            null,
          out_of_service_reason:
            (availability.out_of_service_reason as string | undefined) ??
            (flat.out_of_service_reason as string | undefined) ??
            null,
          motive_updated_at: motiveUpdatedAt,
          availability_additional_note:
            (availability.additional_note as string | undefined) ??
            (flat.additional_note as string | undefined) ??
            null,
          custom_driver_app_warning_prompt:
            (flat.custom_driver_app_warning_prompt as string | undefined) ??
            null,
          raw: v as Json, // store original payload
        };
      })
      .filter((row): row is MotiveVehicleRow => row !== null);

    console.log("[motive-sync-vehicles] Upserting vehicles", {
      requestId,
      orgId,
      totalFromMotive: rawVehicles.length,
      toUpsert: vehicleRows.length,
      skippedWithoutId,
    });

    if (vehicleRows.length === 0) {
      // All vehicles were missing IDs; we still treat this as a "soft success"
      await supabaseAdmin
        .from("motive_sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          total_vehicles: 0,
          error_message:
            skippedWithoutId > 0
              ? `All ${skippedWithoutId} vehicles from Motive were missing IDs and were skipped.`
              : null,
        })
        .eq("id", syncRunId);

      return jsonResponse({
        status: "success",
        org_id: orgId,
        total_vehicles: 0,
        skipped_without_id: skippedWithoutId,
        updated_after_used: updatedAfter,
      });
    }

    const { error: upsertError } = await supabaseAdmin
      .from("motive_vehicles")
      .upsert(vehicleRows, {
        onConflict: "org_id,motive_vehicle_id",
      });

    if (upsertError) {
      return await failSyncRun(
        `Database upsert error: ${upsertError.message}`,
        500,
      );
    }

    // 11) Mark sync run as success
    const finishedAt = new Date().toISOString();

    const { error: syncRunUpdateError } = await supabaseAdmin
      .from("motive_sync_runs")
      .update({
        status: "success",
        finished_at: finishedAt,
        total_vehicles: vehicleRows.length,
        error_message:
          skippedWithoutId > 0
            ? `Synced ${vehicleRows.length} vehicles. Skipped ${skippedWithoutId} without IDs.`
            : null,
      })
      .eq("id", syncRunId);

    if (syncRunUpdateError) {
      console.error(
        "[motive-sync-vehicles] Failed to update sync run (non-fatal)",
        { requestId, syncRunId, error: syncRunUpdateError },
      );
    }

    console.log("[motive-sync-vehicles] Sync completed successfully", {
      requestId,
      orgId,
      totalFromMotive: rawVehicles.length,
      synced: vehicleRows.length,
      skippedWithoutId,
    });

    return jsonResponse({
      status: "success",
      org_id: orgId,
      total_vehicles: vehicleRows.length,
      skipped_without_id: skippedWithoutId,
      updated_after_used: updatedAfter,
      finished_at: finishedAt,
      sync_run_id: syncRunId,
    });
  } catch (err) {
    console.error("[motive-sync-vehicles] Unhandled error", {
      requestId,
      err,
    });

    return jsonResponse(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
