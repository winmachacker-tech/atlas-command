// FILE: supabase/functions/motive-sync-locations/index.ts
//
// Purpose:
// - Pull live vehicle locations from Motive's API for a given org.
// - Store the "latest known location" for each vehicle into
//   public.motive_vehicle_locations_current.
//
// Data flow (v2/vehicle_locations):
// - GET https://api.gomotive.com/v2/vehicle_locations
//   Authorization: Bearer <access_token from motive_connections>
//
// SECURITY:
// - Uses SB_SERVICE_ROLE_KEY ONLY inside this function.
// - Never exposes secrets or access tokens to the browser.
// - Still respects org boundaries; we explicitly scope by org_id.
// - RLS stays enabled; this function writes with service role as a backend job.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers so browser / ngrok / prod can call this safely.
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  for (const [k, v] of Object.entries(corsHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers,
  });
}

serve(async (req: Request) => {
  const startTime = Date.now();

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  // 1) Read required environment variables
  const supabaseUrl = Deno.env.get("SB_URL");
  const supabaseServiceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY");
  const motiveDefaultOrgId = Deno.env.get("MOTIVE_DEFAULT_ORG_ID") || null;
  const motiveBaseUrl =
    Deno.env.get("MOTIVE_API_BASE_URL") ?? "https://api.gomotive.com";
  const vehicleLocationsPath =
    Deno.env.get("MOTIVE_VEHICLE_LOCATIONS_PATH") ?? "/v2/vehicle_locations";

  // Optional: legacy single-token env, as a fallback
  const motiveApiTokenEnv = Deno.env.get("MOTIVE_API_TOKEN") || null;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error("[motive-sync-locations] Missing Supabase env config.");
    return jsonResponse(
      {
        error: "Missing Supabase configuration",
        missing: {
          SB_URL: !supabaseUrl,
          SB_SERVICE_ROLE_KEY: !supabaseServiceRoleKey,
        },
      },
      { status: 500 },
    );
  }

  // 2) Figure out which org we're syncing for
  let requestedOrgId: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => null) as any;
      if (body && typeof body.org_id === "string") {
        requestedOrgId = body.org_id;
      }
    }
  } catch {
    // ignore body parsing errors; we'll fall back to default org
  }

  const orgId = requestedOrgId || motiveDefaultOrgId;
  if (!orgId) {
    console.error(
      "[motive-sync-locations] No org_id provided and MOTIVE_DEFAULT_ORG_ID not set.",
    );
    return jsonResponse(
      {
        error:
          "No org_id specified and MOTIVE_DEFAULT_ORG_ID is not configured.",
      },
      { status: 400 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // 3) Load Motive OAuth token for this org from motive_connections
    console.log(
      "[motive-sync-locations] Looking up Motive connection for org:",
      orgId,
    );

    const { data: motiveConn, error: motiveConnErr } = await supabase
      .from("motive_connections")
      .select("org_id, access_token, expires_at, scope, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (motiveConnErr) {
      console.error(
        "[motive-sync-locations] Error reading motive_connections:",
        motiveConnErr,
      );
    }

    let accessToken: string | null = null;
    let expired = false;

    if (motiveConn && motiveConn.access_token) {
      accessToken = motiveConn.access_token as string;
      if (motiveConn.expires_at) {
        const expiresAt = new Date(motiveConn.expires_at as string);
        expired = expiresAt.getTime() < Date.now();
      }
    }

    if (!accessToken && motiveApiTokenEnv) {
      // Fallback: legacy MOTIVE_API_TOKEN env
      console.warn(
        "[motive-sync-locations] No DB token found; falling back to MOTIVE_API_TOKEN env. Consider reconnecting Motive via OAuth.",
      );
      accessToken = motiveApiTokenEnv;
      expired = false; // cannot know, assume valid
    }

    if (!accessToken) {
      console.error(
        "[motive-sync-locations] No Motive access token available for this org.",
      );
      return jsonResponse(
        {
          error:
            "No Motive access token available. Please connect Motive in the Integrations page.",
          org_id: orgId,
        },
        { status: 401 },
      );
    }

    if (expired) {
      console.error("[motive-sync-locations] Motive access token is expired.");
      return jsonResponse(
        {
          error:
            "The Motive access token for this org has expired. Please reconnect Motive.",
          org_id: orgId,
        },
        { status: 401 },
      );
    }

    // 4) Call Motive API for vehicle locations
    const motiveUrl = `${motiveBaseUrl}${vehicleLocationsPath}`;
    console.log("[motive-sync-locations] Fetching from Motive:", motiveUrl);

    const motiveRes = await fetch(motiveUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!motiveRes.ok) {
      const text = await motiveRes.text().catch(() => "");
      console.error(
        "[motive-sync-locations] Motive API error:",
        motiveRes.status,
        text,
      );
      return jsonResponse(
        {
          error: "Failed to fetch vehicle locations from Motive",
          status: motiveRes.status,
          body: text,
        },
        { status: 502 },
      );
    }

    const motiveJson = await motiveRes.json().catch((err) => {
      console.error("[motive-sync-locations] Failed to parse Motive JSON:", err);
      throw new Error("Unable to parse Motive response JSON");
    });

    const vehicles: any[] = (motiveJson as any)?.vehicles ?? [];
    console.log(
      `[motive-sync-locations] Received ${vehicles.length} vehicles from Motive for org ${orgId}.`,
    );

    // 5) Map Motive response → motive_vehicle_locations_current rows
    const nowIso = new Date().toISOString();
    const rows = vehicles.map((vehicle) => {
      const loc = (vehicle as any).current_location ?? {};
      const driver = (vehicle as any).current_driver ?? {};

      const driverNameParts: string[] = [];
      if (driver.first_name) driverNameParts.push(String(driver.first_name));
      if (driver.last_name) driverNameParts.push(String(driver.last_name));
      const driverName =
        driverNameParts.length > 0 ? driverNameParts.join(" ") : null;

      return {
        org_id: orgId,
        motive_vehicle_id: vehicle.id ?? null,
        location_id: loc.id ?? null,
        lat: loc.lat ?? null,
        lon: loc.lon ?? null,
        description: loc.description ?? null,
        located_at: loc.located_at ?? null,
        speed: loc.speed ?? null,
        bearing: loc.bearing ?? null,
        odometer: loc.odometer ?? null,
        true_odometer: loc.true_odometer ?? null,
        engine_hours: loc.engine_hours ?? null,
        true_engine_hours: loc.true_engine_hours ?? null,
        battery_voltage: loc.battery_voltage ?? null,
        veh_range: loc.veh_range ?? null,
        fuel: loc.fuel ?? null,
        fuel_primary_remaining_percentage:
          loc.fuel_primary_remaining_percentage ?? null,
        fuel_secondary_remaining_percentage:
          loc.fuel_secondary_remaining_percentage ?? null,
        current_driver_id: driver.id ?? null,
        current_driver_name: driverName,
        current_driver_email: driver.email ?? null,
        movement_type: loc.type ?? null, // e.g. "vehicle_moving"
        raw: vehicle, // full Motive vehicle object (jsonb)
        updated_at: nowIso,
      };
    });

    // 6) Replace all "current" rows for this org with the latest snapshot
    console.log(
      `[motive-sync-locations] Upserting ${rows.length} rows for org ${orgId}.`,
    );

    // Clear existing rows for this org
    const { error: deleteError } = await supabase
      .from("motive_vehicle_locations_current")
      .delete()
      .eq("org_id", orgId);

    if (deleteError) {
      console.error(
        "[motive-sync-locations] Failed to clear existing rows:",
        deleteError,
      );
      return jsonResponse(
        {
          error: "Failed to clear existing motive locations for org",
          details: deleteError,
        },
        { status: 500 },
      );
    }

    // Insert new snapshot if we have any rows
    let insertedCount = 0;
    if (rows.length > 0) {
      const { error: insertError, count } = await supabase
        .from("motive_vehicle_locations_current")
        .insert(rows, { count: "exact" });

      if (insertError) {
        console.error(
          "[motive-sync-locations] Failed to insert rows:",
          insertError,
        );
        return jsonResponse(
          {
            error: "Failed to insert motive vehicle locations",
            details: insertError,
          },
          { status: 500 },
        );
      }

      insertedCount = count ?? rows.length;
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[motive-sync-locations] Sync complete. Inserted ${insertedCount} rows for org ${orgId} in ${durationMs}ms.`,
    );

    return jsonResponse(
      {
        ok: true,
        org_id: orgId,
        vehicles_received: vehicles.length,
        rows_inserted: insertedCount,
        duration_ms: durationMs,
        motive_endpoint: motiveUrl,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[motive-sync-locations] Unexpected error:", err);
    return jsonResponse(
      {
        error: "Unexpected error while syncing Motive locations",
        details: `${err}`,
      },
      { status: 500 },
    );
  }
});
