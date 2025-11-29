// FILE: supabase/functions/dipsy-fleet-tools/index.ts
//
// Purpose (plain English):
// ------------------------
// - Give Dipsy a SINGLE unified set of tools for fleet data, regardless
//   of whether it comes from Motive or Samsara.
// - Tools:
//     1) search_fleet_vehicles
//           → find trucks across BOTH Motive + Samsara
//     2) search_fleet_locations
//           → get latest GPS locations across BOTH Motive + Samsara
//
// - Dipsy (your Node/voice layer) will call THIS Edge Function, which then
//   talks to Postgres under the user's identity (RLS stays in charge).
//
// Security model:
// ---------------
// - Runs as an Edge Function (backend only).
// - Uses the anon key + user access_token to query DB:
//     • The user's Supabase JWT is passed as "access_token" in the body.
//     • We create a Supabase client with Authorization: Bearer <token>.
//     • This means all reads are subject to:
//           - Supabase Auth
//           - RLS policies
//           - current_org_id()
// - We DO NOT weaken or modify any RLS or org boundaries.
//
// Input contract (from Dipsy layer):
// ----------------------------------
//   POST /dipsy-fleet-tools
//   {
//     "tool": "search_fleet_vehicles" | "search_fleet_locations",
//     "args": { ... },
//     "access_token": "supabase_user_jwt_here"
//   }
//
// Output (to Dipsy / OpenAI):
// ---------------------------
// - JSON-safe arrays with normalized fleet vehicles / locations, with:
//     provider: "motive" | "samsara"
//     fleet_vehicle_id: "<provider>:<provider_vehicle_id>"
//     ...plus human-readable details.
//
// Required env vars:
// ------------------
//   SUPABASE_URL
//   SUPABASE_ANON_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Create a Supabase client that acts AS THE USER using their JWT.
// This preserves RLS, auth.uid(), current_org_id(), and org boundaries.
function createUserClient(accessToken: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Edge function misconfigured: SUPABASE_URL or SUPABASE_ANON_KEY is missing.",
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
    },
  });
}

// Types for unified tools
type FleetProvider = "motive" | "samsara" | "all";

interface SearchFleetVehiclesArgs {
  // Which provider(s) to search:
  //   "motive" | "samsara" | "all" (default: all)
  provider?: FleetProvider;
  // Free text filter across name / plate / VIN / ID, etc.
  query?: string;
  // Limit total vehicles returned (across both providers).
  limit?: number;
}

interface SearchFleetLocationsArgs {
  provider?: FleetProvider; // default: all
  // Optional global ID like "motive:123" or "samsara:vehicle_456".
  fleet_vehicle_id?: string;
  // Optional provider-specific ID, if you want to target only by that.
  provider_vehicle_id?: string;
  // Free text across vehicle fields (name, plate, etc.).
  query?: string;
  // Limit total results across both providers.
  limit?: number;
}

// Helper: parse provider filter from args
function resolveProviderFilter(p?: string | null): FleetProvider {
  if (p === "motive" || p === "samsara") return p;
  return "all";
}

// Helper: parse a fleet_vehicle_id like "motive:123"
function parseFleetVehicleId(
  fleetVehicleId?: string | null,
): { provider?: FleetProvider; providerVehicleId?: string } {
  if (!fleetVehicleId) return {};
  const [providerPart, ...rest] = fleetVehicleId.split(":");
  const id = rest.join(":");
  if (!id) return {};
  if (providerPart === "motive" || providerPart === "samsara") {
    return {
      provider: providerPart,
      providerVehicleId: id,
    };
  }
  return {};
}

// Normalize Motive rows to unified vehicle shape
function normalizeMotiveVehicle(row: any) {
  const displayName =
    row.vehicle_number ||
    row.name ||
    row.license_plate ||
    `Motive Vehicle ${row.motive_vehicle_id}`;

  return {
    provider: "motive" as const,
    provider_label: "Motive",
    provider_vehicle_id: String(row.motive_vehicle_id),
    fleet_vehicle_id: `motive:${row.motive_vehicle_id}`,
    org_id: row.org_id,
    name: displayName,
    license_plate: row.license_plate ?? null,
    vin: row.vin ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    year: row.year ?? null,
    status: row.status ?? null,
    availability_status: row.availability_status ?? null,
    has_location:
      row.latitude != null && row.longitude != null ? true : false,
    // Location snippets (if present in this view):
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    located_at: row.located_at ?? null,
    last_synced_at: row.last_synced_at ?? null,
  };
}

// Normalize Samsara vehicles to unified vehicle shape
function normalizeSamsaraVehicle(
  vehicleRow: any,
  locationRow: any | null,
) {
  const displayName =
    vehicleRow?.name ||
    vehicleRow?.license_plate ||
    `Samsara Vehicle ${vehicleRow?.samsara_vehicle_id}`;

  const hasLocation =
    locationRow &&
    locationRow.latitude != null &&
    locationRow.longitude != null;

  return {
    provider: "samsara" as const,
    provider_label: "Samsara",
    provider_vehicle_id: String(vehicleRow.samsara_vehicle_id),
    fleet_vehicle_id: `samsara:${vehicleRow.samsara_vehicle_id}`,
    org_id: vehicleRow.org_id,
    name: displayName,
    license_plate: vehicleRow.license_plate ?? null,
    license_plate_state: vehicleRow.license_plate_state ?? null,
    vin: vehicleRow.vin ?? null,
    make: vehicleRow.make ?? null,
    model: vehicleRow.model ?? null,
    year: vehicleRow.model_year ?? null,
    status: vehicleRow.status ?? null,
    availability_status: vehicleRow.is_active ? "active" : "inactive",
    has_location: !!hasLocation,
    // Location snippets if we have them:
    latitude: hasLocation ? locationRow.latitude : null,
    longitude: hasLocation ? locationRow.longitude : null,
    located_at: hasLocation ? locationRow.located_at : null,
    last_synced_at: hasLocation ? locationRow.last_synced_at : null,
  };
}

// Normalize Motive location row to unified location shape
function normalizeMotiveLocation(row: any) {
  const displayName =
    row.vehicle_number ||
    row.name ||
    row.license_plate ||
    `Motive Vehicle ${row.motive_vehicle_id}`;

  return {
    provider: "motive" as const,
    provider_label: "Motive",
    provider_vehicle_id: String(row.motive_vehicle_id),
    fleet_vehicle_id: `motive:${row.motive_vehicle_id}`,
    org_id: row.org_id,
    name: displayName,
    license_plate: row.license_plate ?? null,
    vin: row.vin ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    year: row.year ?? null,
    status: row.status ?? null,
    availability_status: row.availability_status ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    heading_degrees: row.heading_degrees ?? null,
    speed_mph: row.speed_mph ?? null,
    odometer_miles: row.odometer_miles ?? null,
    ignition_on: row.ignition_on ?? null,
    located_at: row.located_at,
    last_synced_at: row.last_synced_at,
  };
}

// Normalize Samsara location row + vehicle row to unified location shape
function normalizeSamsaraLocation(locationRow: any, vehicleRow: any | null) {
  const displayName =
    vehicleRow?.name ||
    vehicleRow?.license_plate ||
    `Samsara Vehicle ${locationRow.samsara_vehicle_id}`;

  return {
    provider: "samsara" as const,
    provider_label: "Samsara",
    provider_vehicle_id: String(locationRow.samsara_vehicle_id),
    fleet_vehicle_id: `samsara:${locationRow.samsara_vehicle_id}`,
    org_id: locationRow.org_id,
    name: displayName,
    license_plate: vehicleRow?.license_plate ?? null,
    license_plate_state: vehicleRow?.license_plate_state ?? null,
    vin: vehicleRow?.vin ?? null,
    make: vehicleRow?.make ?? null,
    model: vehicleRow?.model ?? null,
    year: vehicleRow?.model_year ?? null,
    status: vehicleRow?.status ?? null,
    availability_status: vehicleRow?.is_active ? "active" : "inactive",
    latitude: locationRow.latitude,
    longitude: locationRow.longitude,
    heading_degrees: locationRow.heading_degrees ?? null,
    speed_mph: locationRow.speed_mph ?? null,
    odometer_miles: locationRow.odometer_miles ?? null,
    ignition_on: locationRow.ignition_on ?? null,
    located_at: locationRow.located_at,
    last_synced_at: locationRow.last_synced_at,
  };
}

// Tool 1: search_fleet_vehicles (Motive + Samsara)
async function handleSearchFleetVehicles(
  accessToken: string,
  args: SearchFleetVehiclesArgs,
) {
  const supabaseUser = createUserClient(accessToken);

  // Resolve org via current_org_id() under the user's RLS context.
  const { data: orgId, error: orgError } = await supabaseUser.rpc(
    "current_org_id",
  );

  if (orgError) {
    console.error(
      "[dipsy-fleet-tools] current_org_id() error (vehicles):",
      orgError,
    );
    return {
      error: "Could not resolve current org.",
      details: orgError.message,
    };
  }

  if (!orgId) {
    return { error: "No active organization for this user." };
  }

  const providerFilter = resolveProviderFilter(args.provider ?? null);
  const query = (args.query ?? "").trim();
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

  const results: any[] = [];

  // 1) Motive branch
  if (providerFilter === "motive" || providerFilter === "all") {
    let q = supabaseUser
      .from("motive_vehicle_locations_current")
      .select("*")
      .eq("org_id", orgId)
      .order("located_at", { ascending: false })
      .limit(limit);

    if (query) {
      q = q.or(
        [
          `name.ilike.%${query}%`,
          `vehicle_number.ilike.%${query}%`,
          `license_plate.ilike.%${query}%`,
          `vin.ilike.%${query}%`,
          `motive_vehicle_id.ilike.%${query}%`,
        ].join(","),
      );
    }

    const { data, error } = await q;
    if (error) {
      console.error(
        "[dipsy-fleet-tools] Motive vehicles query error:",
        error,
      );
      return {
        error: "Failed to search Motive vehicles.",
        details: error.message,
      };
    }

    (data ?? []).forEach((row: any) => {
      results.push(normalizeMotiveVehicle(row));
    });
  }

  // 2) Samsara branch
  if (providerFilter === "samsara" || providerFilter === "all") {
    // We want vehicles, plus a hint if they have a location row.
    const vehLimit = limit; // simple: same limit per provider.
    let vq = supabaseUser
      .from("samsara_vehicles")
      .select("*")
      .eq("org_id", orgId)
      .order("name", { ascending: true })
      .limit(vehLimit);

    if (query) {
      vq = vq.or(
        [
          `name.ilike.%${query}%`,
          `license_plate.ilike.%${query}%`,
          `vin.ilike.%${query}%`,
          `external_id.ilike.%${query}%`,
          `samsara_vehicle_id.ilike.%${query}%`,
        ].join(","),
      );
    }

    const { data: vehicles, error: vehError } = await vq;
    if (vehError) {
      console.error(
        "[dipsy-fleet-tools] Samsara vehicles query error:",
        vehError,
      );
      return {
        error: "Failed to search Samsara vehicles.",
        details: vehError.message,
      };
    }

    const vehicleIds = Array.from(
      new Set(
        (vehicles ?? []).map((v: any) => String(v.samsara_vehicle_id)),
      ),
    );

    let locsById = new Map<string, any>();
    if (vehicleIds.length > 0) {
      const { data: locations, error: locError } = await supabaseUser
        .from("samsara_vehicle_locations_current")
        .select("*")
        .eq("org_id", orgId)
        .in("samsara_vehicle_id", vehicleIds);

      if (locError) {
        console.error(
          "[dipsy-fleet-tools] Samsara locations query (for vehicles) error:",
          locError,
        );
        // We don't hard-fail here; we can still return vehicle-level info.
      } else {
        (locations ?? []).forEach((loc: any) => {
          locsById.set(String(loc.samsara_vehicle_id), loc);
        });
      }
    }

    (vehicles ?? []).forEach((v: any) => {
      const loc = locsById.get(String(v.samsara_vehicle_id)) ?? null;
      results.push(normalizeSamsaraVehicle(v, loc));
    });
  }

  // Sort newest location first, where available.
  results.sort((a, b) => {
    const tA = a.located_at ? new Date(a.located_at).getTime() : 0;
    const tB = b.located_at ? new Date(b.located_at).getTime() : 0;
    return tB - tA;
  });

  // Enforce global limit.
  const sliced = results.slice(0, limit);

  return {
    ok: true,
    org_id: orgId,
    count: sliced.length,
    results: sliced,
  };
}

// Tool 2: search_fleet_locations (Motive + Samsara)
async function handleSearchFleetLocations(
  accessToken: string,
  args: SearchFleetLocationsArgs,
) {
  const supabaseUser = createUserClient(accessToken);

  const { data: orgId, error: orgError } = await supabaseUser.rpc(
    "current_org_id",
  );

  if (orgError) {
    console.error(
      "[dipsy-fleet-tools] current_org_id() error (locations):",
      orgError,
    );
    return {
      error: "Could not resolve current org.",
      details: orgError.message,
    };
  }

  if (!orgId) {
    return { error: "No active organization for this user." };
  }

  const providerFilter = resolveProviderFilter(args.provider ?? null);
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const query = (args.query ?? "").trim();

  const { provider: fvProvider, providerVehicleId: fvProviderVehicleId } =
    parseFleetVehicleId(args.fleet_vehicle_id);

  const providerVehicleId =
    args.provider_vehicle_id?.trim() || fvProviderVehicleId || null;

  const results: any[] = [];

  // Motive locations
  if (
    providerFilter === "motive" ||
    providerFilter === "all" ||
    fvProvider === "motive"
  ) {
    let mq = supabaseUser
      .from("motive_vehicle_locations_current")
      .select("*")
      .eq("org_id", orgId)
      .order("located_at", { ascending: false })
      .limit(limit);

    if (fvProvider === "motive" && providerVehicleId) {
      mq = mq.eq("motive_vehicle_id", providerVehicleId);
    } else if (!fvProvider && providerVehicleId && providerFilter !== "samsara") {
      // If fleet_vehicle_id was not set but provider_vehicle_id was,
      // and user didn't explicitly filter to samsara, we can try to match motif.
      mq = mq.eq("motive_vehicle_id", providerVehicleId);
    }

    if (query) {
      mq = mq.or(
        [
          `name.ilike.%${query}%`,
          `vehicle_number.ilike.%${query}%`,
          `license_plate.ilike.%${query}%`,
          `vin.ilike.%${query}%`,
          `motive_vehicle_id.ilike.%${query}%`,
        ].join(","),
      );
    }

    const { data, error } = await mq;
    if (error) {
      console.error(
        "[dipsy-fleet-tools] Motive locations query error:",
        error,
      );
      return {
        error: "Failed to load Motive locations.",
        details: error.message,
      };
    }

    (data ?? []).forEach((row: any) => {
      results.push(normalizeMotiveLocation(row));
    });
  }

  // Samsara locations
  if (
    providerFilter === "samsara" ||
    providerFilter === "all" ||
    fvProvider === "samsara"
  ) {
    let lq = supabaseUser
      .from("samsara_vehicle_locations_current")
      .select("*")
      .eq("org_id", orgId)
      .order("located_at", { ascending: false })
      .limit(limit);

    if (fvProvider === "samsara" && providerVehicleId) {
      lq = lq.eq("samsara_vehicle_id", providerVehicleId);
    } else if (!fvProvider && providerVehicleId && providerFilter !== "motive") {
      lq = lq.eq("samsara_vehicle_id", providerVehicleId);
    }

    const { data: locations, error: locError } = await lq;
    if (locError) {
      console.error(
        "[dipsy-fleet-tools] Samsara locations query error:",
        locError,
      );
      return {
        error: "Failed to load Samsara locations.",
        details: locError.message,
      };
    }

    if (!locations || locations.length === 0) {
      // Nothing to join.
    } else {
      const vehicleIds = Array.from(
        new Set(
          locations.map((loc: any) => String(loc.samsara_vehicle_id)),
        ),
      );

      let vq = supabaseUser
        .from("samsara_vehicles")
        .select("*")
        .eq("org_id", orgId)
        .in("samsara_vehicle_id", vehicleIds);

      if (query) {
        vq = vq.or(
          [
            `name.ilike.%${query}%`,
            `license_plate.ilike.%${query}%`,
            `vin.ilike.%${query}%`,
            `external_id.ilike.%${query}%`,
            `samsara_vehicle_id.ilike.%${query}%`,
          ].join(","),
        );
      }

      const { data: vehicles, error: vehError } = await vq;
      if (vehError) {
        console.error(
          "[dipsy-fleet-tools] Samsara vehicles (for locations) query error:",
          vehError,
        );
        return {
          error: "Failed to load Samsara vehicle details.",
          details: vehError.message,
        };
      }

      const vehiclesById = new Map<string, any>();
      (vehicles ?? []).forEach((v: any) => {
        vehiclesById.set(String(v.samsara_vehicle_id), v);
      });

      (locations ?? []).forEach((loc: any) => {
        const v = vehiclesById.get(String(loc.samsara_vehicle_id)) ?? null;
        results.push(normalizeSamsaraLocation(loc, v));
      });
    }
  }

  // Sort newest first
  results.sort((a, b) => {
    const tA = a.located_at ? new Date(a.located_at).getTime() : 0;
    const tB = b.located_at ? new Date(b.located_at).getTime() : 0;
    return tB - tA;
  });

  const sliced = results.slice(0, limit);

  return {
    ok: true,
    org_id: orgId,
    count: sliced.length,
    results: sliced,
  };
}

// HTTP handler: dispatch based on "tool"
serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "Server misconfigured: SUPABASE_URL or SUPABASE_ANON_KEY is missing.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  let body:
    | {
        tool?: string;
        args?: Record<string, unknown>;
        access_token?: string;
      }
    | undefined;

  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = (await req.json()) as typeof body;
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!body) {
    return new Response(
      JSON.stringify({ error: "Missing request body." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { tool, args = {}, access_token } = body;

  if (!tool) {
    return new Response(
      JSON.stringify({ error: "Missing 'tool' field." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!access_token) {
    return new Response(
      JSON.stringify({
        error:
          "Missing 'access_token'. Dipsy must pass the user's Supabase JWT.",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    if (tool === "search_fleet_vehicles") {
      const result = await handleSearchFleetVehicles(
        access_token,
        args as SearchFleetVehiclesArgs,
      );
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (tool === "search_fleet_locations") {
      const result = await handleSearchFleetLocations(
        access_token,
        args as SearchFleetLocationsArgs,
      );
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown tool: ${tool}` }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[dipsy-fleet-tools] Unhandled error:", err);
    return new Response(
      JSON.stringify({
        error: "Unexpected error while executing tool.",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
