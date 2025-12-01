// FILE: supabase/functions/dipsy-tools-fleet/index.ts
//
// Purpose (plain English):
// ------------------------
// This Edge Function is the backend “fleet + driver utility tool” for Dipsy.
// It currently supports two tools:
//
// 1) tool: "search_fleet_latest"
//    params: { provider: "dummy" | "motive" | "samsara" | "all", limit?: number }
//
//    → Returns a unified list of vehicles with:
//        - provider (dummy / motive / samsara)
//        - vehicle_id
//        - display_name
//        - latitude / longitude
//        - speed_mph
//        - located_at
//        - city, state, location_text (e.g. "near Placerville, CA")
//
// 2) tool: "release_driver_from_all_loads"
//    params: { driver_id: string }
//
//    → Unassigns a driver from all *active* loads for this org, so Dipsy can
//      safely use that driver for a new load without double-assignment.
//      This is used when you say things like:
//        - “Unassign Elon from all loads and put him on this one.”
//
// Flow (for both tools):
// 1) Caller sends POST with the *user’s* JWT in Authorization header.
// 2) We create a Supabase client with the service-role key BUT forward the
//    user’s JWT so all queries still respect RLS + current_org_id().
// 3) We resolve org via rpc("current_org_id").
// 4) We run the requested tool’s logic, always filtering by org_id.
// 5) We return JSON that Dipsy can use to talk like a dispatcher.
//
// SECURITY:
// - Uses SUPABASE_SERVICE_ROLE_KEY only on the server.
// - Always forwards the original Authorization header to Supabase.
// - RLS + current_org_id() are never bypassed.
// - Google Maps API key stays ONLY on the server via Deno.env (never sent to browser).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// ---------- CORS -------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // You can lock this down later if you want
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- Types ------------------------------------------------------------

type ProviderType = "motive" | "samsara" | "dummy";

type SearchFleetLatestParams = {
  provider?: "all" | ProviderType;
  limit?: number;
};

type ReleaseDriverFromAllLoadsParams = {
  // For safety and simplicity, this tool currently requires a specific driver_id.
  // Dipsy (or another tool) should resolve name → driver_id before calling this.
  driver_id: string;
};

type FleetToolRequest = {
  tool?: string;
  // NOTE: At runtime this may be either SearchFleetLatestParams or
  // ReleaseDriverFromAllLoadsParams depending on the "tool" value.
  params?: SearchFleetLatestParams | ReleaseDriverFromAllLoadsParams;
};

type NormalizedFleetVehicle = {
  provider: ProviderType;
  vehicle_id: string;
  display_name: string;

  latitude: number | null;
  longitude: number | null;
  speed_mph: number | null;
  located_at: string | null;

  // reverse-geocoded fields
  city?: string | null;
  state?: string | null;
  location_text?: string | null; // e.g. "near Placerville, CA"

  raw: unknown;
};

type ReleaseDriverResult = {
  ok: boolean;
  tool: "release_driver_from_all_loads";
  driver_id?: string;
  released_load_ids?: string[];
  total_released?: number;
  error?: string;
};

// ---------- Supabase client (RLS-safe) --------------------------------------

function createRlsClient(authHeader: string | null) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!url || !serviceKey) {
    console.error("[dipsy-tools-fleet] Missing SUPABASE_URL or SERVICE_ROLE_KEY");
    throw new Error("Supabase environment is not configured.");
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });

  return client;
}

// ---------- Normalizers per provider ----------------------------------------

function normalizeDummyRow(row: any): NormalizedFleetVehicle {
  return {
    provider: "dummy",
    vehicle_id: String(row.atlas_dummy_vehicle_id ?? row.id ?? row.vehicle_id),
    display_name:
      row.display_name ??
      row.name ??
      row.vehicle_number ??
      `Dummy Truck ${row.atlas_dummy_vehicle_id ?? row.id ?? "?"}`,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    speed_mph:
      typeof row.speed_mph === "number"
        ? row.speed_mph
        : typeof row.speed_mph === "string"
        ? Number(row.speed_mph)
        : null,
    located_at: row.located_at ?? row.sampled_at ?? null,
    raw: row,
  };
}

function normalizeMotiveRow(row: any): NormalizedFleetVehicle {
  return {
    provider: "motive",
    vehicle_id: String(row.motive_vehicle_id ?? row.id ?? row.vehicle_id),
    display_name:
      row.vehicle_number ??
      row.name ??
      row.license_plate ??
      `Motive Vehicle ${row.motive_vehicle_id ?? row.id ?? "?"}`,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    speed_mph:
      typeof row.speed_mph === "number"
        ? row.speed_mph
        : typeof row.speed_mph === "string"
        ? Number(row.speed_mph)
        : null,
    located_at: row.located_at ?? row.sampled_at ?? null,
    raw: row,
  };
}

function normalizeSamsaraRow(row: any): NormalizedFleetVehicle {
  return {
    provider: "samsara",
    vehicle_id: String(row.samsara_vehicle_id ?? row.id ?? row.vehicle_id),
    display_name:
      row.name ??
      row.license_plate ??
      row.vehicle_number ??
      `Samsara Vehicle ${row.samsara_vehicle_id ?? row.id ?? "?"}`,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    speed_mph:
      typeof row.speed_mph === "number"
        ? row.speed_mph
        : typeof row.speed_mph === "string"
        ? Number(row.speed_mph)
        : null,
    located_at: row.located_at ?? row.sampled_at ?? null,
    raw: row,
  };
}

// ---------- Google Reverse Geocoding ----------------------------------------
//
// We use your Google Maps API key (server-side only) to turn lat/lon into a
// city + state. This never touches the browser.
// If the key is missing, we silently skip and just return coordinates.
//

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";

type GeocodeResult = {
  city: string | null;
  state: string | null;
  description: string | null; // e.g. "near Placerville, CA"
};

async function reverseGeocodeGoogle(
  lat: number,
  lng: number,
): Promise<GeocodeResult | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    // No key configured → skip gracefully
    return null;
  }

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        "[dipsy-tools-fleet] Google geocode HTTP error:",
        res.status,
        await res.text(),
      );
      return null;
    }

    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      return null;
    }

    const best = data.results[0];
    const components: any[] = best.address_components ?? [];

    let city: string | null = null;
    let state: string | null = null;

    for (const comp of components) {
      const types: string[] = comp.types ?? [];
      if (types.includes("locality")) {
        city = comp.long_name;
      } else if (types.includes("administrative_area_level_1")) {
        state = comp.short_name; // "CA", "TX", etc.
      }
    }

    let description: string | null = null;
    if (city && state) {
      description = `near ${city}, ${state}`;
    } else if (city) {
      description = `near ${city}`;
    } else if (state) {
      description = `in ${state}`;
    }

    return { city, state, description };
  } catch (err) {
    console.error("[dipsy-tools-fleet] Google geocode error:", err);
    return null;
  }
}

// Limit how many vehicles we geocode per call to avoid hammering the API.
const MAX_GEOCODE_PER_CALL = 10;

async function enrichWithGeocoding(
  vehicles: NormalizedFleetVehicle[],
): Promise<void> {
  if (!GOOGLE_MAPS_API_KEY) {
    // Nothing to do; we just keep lat/lon.
    return;
  }

  let count = 0;
  for (const v of vehicles) {
    if (count >= MAX_GEOCODE_PER_CALL) break;
    if (v.latitude == null || v.longitude == null) continue;

    const geo = await reverseGeocodeGoogle(v.latitude, v.longitude);
    if (geo) {
      v.city = geo.city;
      v.state = geo.state;
      v.location_text = geo.description;
      count += 1;
    }
  }
}

// ---------- Tool implementation: search_fleet_latest ------------------------

async function handleSearchFleetLatest(
  authHeader: string | null,
  params: SearchFleetLatestParams | undefined,
) {
  const started = performance.now();
  const provider = params?.provider ?? "all";
  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100); // clamp 1–100

  const supabase = createRlsClient(authHeader);

  // 1) Resolve org via current_org_id()
  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");

  if (orgError) {
    console.error("[dipsy-tools-fleet] current_org_id error:", orgError);
    return {
      ok: false,
      error: "Could not determine your organization for fleet lookup.",
    };
  }

  if (!orgId) {
    console.warn("[dipsy-tools-fleet] current_org_id returned null");
    return {
      ok: false,
      error:
        "You do not appear to have an active organization. Fleet tools require an org.",
    };
  }

  const results: NormalizedFleetVehicle[] = [];

  async function safeQuery<T>(
    label: string,
    fn: () => Promise<{ data: T[] | null; error: any }>,
    normalizer: (row: any) => NormalizedFleetVehicle,
  ) {
    const { data, error } = await fn();
    if (error) {
      console.error(`[dipsy-tools-fleet] ${label} query error:`, error);
      return;
    }
    if (!data || data.length === 0) return;
    for (const row of data) {
      results.push(normalizer(row));
    }
  }

  // Dummy (sandbox) provider
  if (provider === "all" || provider === "dummy") {
    await safeQuery(
      "dummy_latest",
      () =>
        supabase
          .from("atlas_dummy_vehicle_locations_current")
          .select("*")
          .eq("org_id", orgId)
          .order("located_at", { ascending: false })
          .limit(limit),
      normalizeDummyRow,
    );
  }

  // Motive provider
  if (provider === "all" || provider === "motive") {
    await safeQuery(
      "motive_latest",
      () =>
        supabase
          .from("motive_vehicle_locations_current")
          .select("*")
          .eq("org_id", orgId)
          .order("located_at", { ascending: false })
          .limit(limit),
      normalizeMotiveRow,
    );
  }

  // Samsara provider
  if (provider === "all" || provider === "samsara") {
    await safeQuery(
      "samsara_latest",
      () =>
        supabase
          .from("samsara_vehicle_locations_current")
          .select("*")
          .eq("org_id", orgId)
          .order("located_at", { ascending: false })
          .limit(limit),
      normalizeSamsaraRow,
    );
  }

  // Sort newest first
  results.sort((a, b) => {
    const tA = a.located_at ? Date.parse(a.located_at) : 0;
    const tB = b.located_at ? Date.parse(b.located_at) : 0;
    return tB - tA;
  });

  // Enrich with city/state for up to MAX_GEOCODE_PER_CALL vehicles
  await enrichWithGeocoding(results);

  const durationMs = Math.round(performance.now() - started);

  return {
    ok: true,
    tool: "search_fleet_latest",
    result: results.slice(0, limit),
    duration_ms: durationMs,
  };
}

// ---------- Tool implementation: release_driver_from_all_loads --------------
//
// Purpose:
// - Safely unassign a driver from all *active* loads in THIS org.
// - Used when Dipsy needs to "free up" a driver before putting them
//   on a new load so we never double-assign.
//
// Notes:
// - This does NOT bypass RLS; it uses the user's JWT via createRlsClient.
// - It only updates loads for the current org_id.
// - It only touches loads with "active-like" statuses. Closed/canceled
//   loads are left alone.
//

// These are the statuses we consider "active enough" that a driver being
// assigned still matters. Adjust as your real enum grows, but it's safe
// to include extra strings that may not exist.
const ACTIVE_LOAD_STATUSES = [
  "TENDERED",
  "DISPATCHED",
  "ASSIGNED",
  "IN_TRANSIT",
  "EN_ROUTE",
  "AT_PICKUP",
  "AT_DELIVERY",
  "DELIVERED",
  "POD_PENDING",
  "POD_WAITING",
];

async function handleReleaseDriverFromAllLoads(
  authHeader: string | null,
  params: ReleaseDriverFromAllLoadsParams | undefined,
): Promise<ReleaseDriverResult> {
  const supabase = createRlsClient(authHeader);

  // 1) Validate input
  const driverId = params?.driver_id;
  if (!driverId) {
    console.warn(
      "[dipsy-tools-fleet] release_driver_from_all_loads called without driver_id",
    );
    return {
      ok: false,
      tool: "release_driver_from_all_loads",
      error: "driver_id is required to release a driver from loads.",
    };
  }

  // 2) Resolve org via current_org_id()
  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");

  if (orgError) {
    console.error(
      "[dipsy-tools-fleet] current_org_id error (release_driver_from_all_loads):",
      orgError,
    );
    return {
      ok: false,
      tool: "release_driver_from_all_loads",
      error: "Could not determine your organization for driver release.",
    };
  }

  if (!orgId) {
    console.warn(
      "[dipsy-tools-fleet] current_org_id returned null (release_driver_from_all_loads)",
    );
    return {
      ok: false,
      tool: "release_driver_from_all_loads",
      error:
        "You do not appear to have an active organization. Driver release requires an org.",
    };
  }

  // 3) Find all active loads currently assigned to this driver in this org.
  const { data: loads, error: loadsError } = await supabase
    .from("loads")
    .select("id,status")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .in("status", ACTIVE_LOAD_STATUSES);

  if (loadsError) {
    console.error(
      "[dipsy-tools-fleet] Error fetching loads for driver release:",
      loadsError,
    );
    return {
      ok: false,
      tool: "release_driver_from_all_loads",
      error: "Failed to look up loads for this driver.",
    };
  }

  if (!loads || loads.length === 0) {
    // Nothing to release; this is not an error, just a no-op.
    return {
      ok: true,
      tool: "release_driver_from_all_loads",
      driver_id: driverId,
      released_load_ids: [],
      total_released: 0,
    };
  }

  const loadIds = loads.map((l) => l.id);

  // 4) Unassign the driver from those loads (set driver_id to null).
  const { data: updated, error: updateError } = await supabase
    .from("loads")
    .update({ driver_id: null })
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .in("status", ACTIVE_LOAD_STATUSES)
    .select("id");

  if (updateError) {
    console.error(
      "[dipsy-tools-fleet] Error releasing driver from loads:",
      updateError,
    );
    return {
      ok: false,
      tool: "release_driver_from_all_loads",
      error: "Failed to release driver from loads.",
    };
  }

  const updatedIds = (updated ?? []).map((l: any) => l.id);

  return {
    ok: true,
    tool: "release_driver_from_all_loads",
    driver_id: driverId,
    released_load_ids: updatedIds,
    total_released: updatedIds.length,
  };
}

// ---------- Main HTTP handler -----------------------------------------------

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing Authorization header (user JWT required).",
      }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let payload: FleetToolRequest;
  try {
    payload = (await req.json()) as FleetToolRequest;
  } catch (_err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const tool = payload.tool ?? "search_fleet_latest";

  try {
    switch (tool) {
      case "search_fleet_latest": {
        const result = await handleSearchFleetLatest(
          authHeader,
          payload.params as SearchFleetLatestParams | undefined,
        );
        const status = result.ok ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "release_driver_from_all_loads": {
        const result = await handleReleaseDriverFromAllLoads(
          authHeader,
          payload.params as ReleaseDriverFromAllLoadsParams | undefined,
        );
        const status = result.ok ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(
          JSON.stringify({
            ok: false,
            error: `Unknown fleet tool: ${tool}`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
    }
  } catch (err) {
    console.error("[dipsy-tools-fleet] Unhandled error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Unexpected error while running fleet tool.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
