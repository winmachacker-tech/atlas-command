// FILE: supabase/functions/motive-sync-vehicle-locations/index.ts
//
// Motive → Atlas Vehicle Locations Sync (V1)
// -----------------------------------------
// - Called from Atlas UI with the user's Supabase JWT.
// - Resolves current org via current_org_id() (RLS-safe).
// - Looks up that org's Motive OAuth token in public.motive_connections.
// - Calls Motive /v2/vehicle_locations (or configured base URL).
// - Safely parses the response (even if nested or oddly shaped).
// - Normalizes into public.motive_vehicle_locations_current (per org).
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

interface MotiveLocationRaw {
  id?: number | string;
  vehicle_id?: number | string;
  locatable_id?: number | string;
  locatable_type?: string;
  lat?: number | string;
  lon?: number | string;
  lng?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  description?: string;
  located_at?: string;
  recorded_at?: string;
  created_at?: string;
  speed?: number | string;
  bearing?: number | string;
  odometer?: number | string;
  true_odometer?: number | string;
  engine_hours?: number | string;
  true_engine_hours?: number | string;
  battery_voltage?: number | string;
  veh_range?: number | string;
  fuel?: number | string;
  fuel_primary_remaining_percentage?: number | string;
  fuel_secondary_remaining_percentage?: number | string;
  movement_type?: string;
  current_driver?: {
    id?: number | string;
    name?: string;
    email?: string;
  } | null;
  [key: string]: unknown;
}

interface MotiveVehicleLocationRow {
  org_id: string;
  motive_vehicle_id: number;
  location_id: string | null;
  lat: number | null;
  lon: number | null;
  description: string | null;
  located_at: string | null;
  speed: number | null;
  bearing: number | null;
  odometer: number | null;
  true_odometer: number | null;
  engine_hours: number | null;
  true_engine_hours: number | null;
  battery_voltage: number | null;
  veh_range: number | null;
  fuel: number | null;
  fuel_primary_remaining_percentage: number | null;
  fuel_secondary_remaining_percentage: number | null;
  current_driver_id: number | null;
  current_driver_name: string | null;
  current_driver_email: string | null;
  movement_type: string | null;
  raw: Json;
  updated_at?: string; // set on upsert
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

// Same base as vehicles; we’ll call /v2/vehicle_locations under this.
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

function toNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim() !== "") {
    const n = Number(input);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toString(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (typeof input === "number" && Number.isFinite(input)) return String(input);
  return null;
}

// Extract Motive vehicle id from a location record.
// We try several fields: vehicle_id, locatable_id (if type is vehicle), etc.
function extractMotiveVehicleId(loc: MotiveLocationRaw): number | null {
  const candidates: Array<number | string | undefined> = [];

  if (typeof loc.vehicle_id !== "undefined") {
    candidates.push(loc.vehicle_id);
  }

  if (
    loc.locatable_type === "vehicle" ||
    loc.locatable_type === "Vehicle" ||
    loc.locatable_type === "VEHICLE"
  ) {
    candidates.push(loc.locatable_id);
  }

  // Some APIs might nest vehicle info; we can extend here later if needed.

  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) {
      return c;
    }
    if (typeof c === "string" && c.trim() !== "") {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}

// Extract latitude & longitude from multiple possible fields.
function extractLatLon(loc: MotiveLocationRaw): { lat: number | null; lon: number | null } {
  const latCandidates: Array<number | string | undefined> = [
    loc.lat,
    (loc as any).latitude,
  ];

  const lonCandidates: Array<number | string | undefined> = [
    loc.lon,
    loc.lng,
    (loc as any).longitude,
  ];

  let lat: number | null = null;
  let lon: number | null = null;

  for (const c of latCandidates) {
    const n = toNumber(c);
    if (n !== null) {
      lat = n;
      break;
    }
  }

  for (const c of lonCandidates) {
    const n = toNumber(c);
    if (n !== null) {
      lon = n;
      break;
    }
  }

  return { lat, lon };
}

// Pick the best timestamp field to represent "location time".
function extractLocatedAt(loc: MotiveLocationRaw): string | null {
  const candidates: Array<string | undefined> = [
    loc.located_at as string | undefined,
    loc.recorded_at as string | undefined,
    loc.created_at as string | undefined,
  ];

  for (const c of candidates) {
    if (c && c.trim() !== "") return c;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  // 0) Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  console.log("[motive-sync-vehicle-locations] Incoming request", { requestId });

  try {
    // 1) Require Authorization header (user's Supabase JWT)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn(
        "[motive-sync-vehicle-locations] Missing Authorization header",
        { requestId },
      );
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
      console.error(
        "[motive-sync-vehicle-locations] Failed to get user",
        { requestId, userError },
      );
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
      console.error(
        "[motive-sync-vehicle-locations] Failed to resolve current_org_id",
        { requestId, orgError },
      );
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
    console.log("[motive-sync-vehicle-locations] Starting sync for org", {
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
        "[motive-sync-vehicle-locations] Error loading motive_connections",
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
      console.warn(
        "[motive-sync-vehicle-locations] No Motive access token found",
        { requestId, orgId },
      );
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

    // 7) For V1, we do a FULL snapshot of current locations (no updated_after).
    const updatedAfter: string | null = null;

    // 8) Log sync run as "running"
    const syncRun: MotiveSyncRunRow = {
      org_id: orgId,
      status: "running",
      updated_after_param: updatedAfter,
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
      console.error(
        "[motive-sync-vehicle-locations] Failed to insert sync run",
        { requestId, error: syncRunInsertError },
      );
      return jsonResponse(
        {
          error: "Internal error",
          detail: "Could not create sync run record",
        },
        500,
      );
    }

    const syncRunId = createdSyncRun.id as string;

    // Helper: mark sync as error and respond
    const failSyncRun = async (message: string, statusCode = 500) => {
      console.error("[motive-sync-vehicle-locations] Sync failed", {
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

    // 9) Call Motive /v2/vehicle_locations
    const url = new URL("/v2/vehicle_locations", MOTIVE_API_BASE_URL);

    console.log("[motive-sync-vehicle-locations] Fetching Motive locations", {
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
    console.log(
      "[motive-sync-vehicle-locations] Motive response shape",
      {
        requestId,
        topLevelKeys:
          motiveJson && typeof motiveJson === "object"
            ? Object.keys(motiveJson)
            : typeof motiveJson,
        vehicleLocationsIsArray: Array.isArray(
          motiveJson?.vehicle_locations,
        ),
        dataIsArray: Array.isArray(motiveJson?.data),
        rootIsArray: Array.isArray(motiveJson),
      },
    );

    // 10) Resolve where the locations actually live
    let rawLocations: any[] = [];

    if (Array.isArray(motiveJson?.vehicle_locations)) {
      rawLocations = motiveJson.vehicle_locations as any[];
    } else if (
      motiveJson?.vehicle_locations &&
      Array.isArray(motiveJson.vehicle_locations.data)
    ) {
      rawLocations = motiveJson.vehicle_locations.data as any[];
    } else if (Array.isArray(motiveJson?.data)) {
      rawLocations = motiveJson.data as any[];
    } else if (Array.isArray(motiveJson)) {
      rawLocations = motiveJson as any[];
    }

    console.log(
      "[motive-sync-vehicle-locations] Resolved locations length",
      { requestId, count: rawLocations.length },
    );

    if (rawLocations.length > 0) {
      console.log(
        "[motive-sync-vehicle-locations] Sample location payload",
        { requestId, sample: rawLocations[0] },
      );
    }

    if (!rawLocations || rawLocations.length === 0) {
      // No locations returned: treat as a successful, empty sync.
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

    // 11) Normalize into motive_vehicle_locations_current rows
    let skippedWithoutVehicle = 0;
    let skippedWithoutLatLon = 0;

    const nowIso = new Date().toISOString();

    const locationRows: MotiveVehicleLocationRow[] = rawLocations
      .map((raw: any) => {
        const loc = raw as MotiveLocationRaw;

        const motiveVehicleId = extractMotiveVehicleId(loc);
        if (motiveVehicleId === null) {
          skippedWithoutVehicle += 1;
          return null;
        }

        const { lat, lon } = extractLatLon(loc);
        if (lat === null || lon === null) {
          skippedWithoutLatLon += 1;
          return null;
        }

        const locatedAt = extractLocatedAt(loc);
        const locationId = toString(loc.id);

        const currentDriver = loc.current_driver ?? null;
        const currentDriverId = currentDriver
          ? toNumber(currentDriver.id)
          : null;
        const currentDriverName = currentDriver
          ? toString(currentDriver.name)
          : null;
        const currentDriverEmail = currentDriver
          ? toString(currentDriver.email)
          : null;

        return {
          org_id: orgId,
          motive_vehicle_id: motiveVehicleId,
          location_id: locationId,
          lat,
          lon,
          description: toString(loc.description),
          located_at: locatedAt,
          speed: toNumber(loc.speed),
          bearing: toNumber(loc.bearing),
          odometer: toNumber(loc.odometer),
          true_odometer: toNumber(loc.true_odometer),
          engine_hours: toNumber(loc.engine_hours),
          true_engine_hours: toNumber(loc.true_engine_hours),
          battery_voltage: toNumber(loc.battery_voltage),
          veh_range: toNumber(loc.veh_range),
          fuel: toNumber(loc.fuel),
          fuel_primary_remaining_percentage: toNumber(
            loc.fuel_primary_remaining_percentage,
          ),
          fuel_secondary_remaining_percentage: toNumber(
            loc.fuel_secondary_remaining_percentage,
          ),
          current_driver_id: currentDriverId,
          current_driver_name: currentDriverName,
          current_driver_email: currentDriverEmail,
          movement_type: toString(loc.movement_type),
          raw: raw as Json,
          updated_at: nowIso,
        };
      })
      .filter((row): row is MotiveVehicleLocationRow => row !== null);

    console.log(
      "[motive-sync-vehicle-locations] Normalized locations summary",
      {
        requestId,
        orgId,
        totalFromMotive: rawLocations.length,
        toUpsert: locationRows.length,
        skippedWithoutVehicle,
        skippedWithoutLatLon,
      },
    );

    if (locationRows.length === 0) {
      // All records were missing vehicle id or lat/lon
      await supabaseAdmin
        .from("motive_sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          total_vehicles: 0,
          error_message:
            skippedWithoutVehicle + skippedWithoutLatLon > 0
              ? `All ${rawLocations.length} locations were skipped (missing vehicle id or lat/lon).`
              : null,
        })
        .eq("id", syncRunId);

      return jsonResponse({
        status: "success",
        org_id: orgId,
        total_vehicles: 0,
        skipped_without_vehicle_id: skippedWithoutVehicle,
        skipped_without_lat_lon: skippedWithoutLatLon,
        updated_after_used: updatedAfter,
      });
    }

    const { error: upsertError } = await supabaseAdmin
      .from("motive_vehicle_locations_current")
      .upsert(locationRows, {
        onConflict: "org_id,motive_vehicle_id",
      });

    if (upsertError) {
      return await failSyncRun(
        `Database upsert error: ${upsertError.message}`,
        500,
      );
    }

    // 12) Mark sync run as success
    const finishedAt = new Date().toISOString();

    const { error: syncRunUpdateError } = await supabaseAdmin
      .from("motive_sync_runs")
      .update({
        status: "success",
        finished_at: finishedAt,
        total_vehicles: locationRows.length,
        error_message:
          skippedWithoutVehicle + skippedWithoutLatLon > 0
            ? `Synced ${locationRows.length} locations. Skipped ${skippedWithoutVehicle} without vehicle id and ${skippedWithoutLatLon} without lat/lon.`
            : null,
      })
      .eq("id", syncRunId);

    if (syncRunUpdateError) {
      console.error(
        "[motive-sync-vehicle-locations] Failed to update sync run (non-fatal)",
        { requestId, syncRunId, error: syncRunUpdateError },
      );
    }

    console.log(
      "[motive-sync-vehicle-locations] Sync completed successfully",
      {
        requestId,
        orgId,
        totalFromMotive: rawLocations.length,
        synced: locationRows.length,
        skippedWithoutVehicle,
        skippedWithoutLatLon,
      },
    );

    return jsonResponse({
      status: "success",
      org_id: orgId,
      total_vehicles: locationRows.length,
      skipped_without_vehicle_id: skippedWithoutVehicle,
      skipped_without_lat_lon: skippedWithoutLatLon,
      updated_after_used: updatedAfter,
      finished_at: finishedAt,
      sync_run_id: syncRunId,
    });
  } catch (err) {
    console.error(
      "[motive-sync-vehicle-locations] Unhandled error",
      { requestId, err },
    );

    return jsonResponse(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
