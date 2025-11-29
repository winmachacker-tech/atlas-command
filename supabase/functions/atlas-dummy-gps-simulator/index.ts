// FILE: supabase/functions/atlas-dummy-gps-simulator/index.ts
//
// Purpose (plain English):
// ------------------------
// - Move your Atlas dummy trucks around on the map.
// - When called, it:
//     1) Finds all active dummy vehicles (atlas_dummy_vehicles WHERE is_active = true).
//     2) Loads their current locations (atlas_dummy_vehicle_locations_current).
//     3) For each truck, computes a new fake GPS position and telematics.
//     4) UPSERTs the new "current" position back into atlas_dummy_vehicle_locations_current.
//
// CORS:
// ------
// - This version adds CORS headers so you can safely call it from localhost:5173
//   or your production frontend (e.g. Vercel).
//
// Security model:
// ----------------
// - Uses SUPABASE_SERVICE_ROLE_KEY as supabaseAdmin (server-side only).
// - Service-role bypasses RLS, which is normal and expected for backend jobs.
// - We DO NOT change or weaken any RLS or auth logic.
// - Dummy data is fully multi-tenant via org_id on both tables.
//
// Behavior details:
// -----------------
// - If a vehicle has an existing location, we "nudge" it a little in a random direction.
// - If no location yet, we start near a default coordinate (roughly Northern California).
// - We simulate:
//     • latitude / longitude
//     • heading_degrees
//     • speed_mph
//     • odometer_miles
//     • ignition_on
//     • located_at / last_synced_at timestamps

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Admin client (service-role). Only used on the server in Edge Functions.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Types
interface DummyVehicle {
  id: string;
  org_id: string;
  name: string | null;
  code: string | null;
  is_active: boolean;
}

interface DummyLocation {
  id: string;
  org_id: string;
  dummy_vehicle_id: string;
  latitude: number;
  longitude: number;
  heading_degrees: number | null;
  speed_mph: number | null;
  odometer_miles: number | null;
  ignition_on: boolean | null;
  located_at: string;
  last_synced_at: string;
}

// CORS helper
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // Safe here: no sensitive data is returned.
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

// Simple helper: clamp a value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Approximate "move" function: takes a starting lat/long and nudges it.
// - maxDeltaDeg controls the maximum change in degrees per step.
//   0.02 degrees is roughly ~2 km in latitude.
function movePosition(
  lat: number,
  lon: number,
  maxDeltaDeg = 0.02,
): { latitude: number; longitude: number } {
  const dLat = (Math.random() - 0.5) * maxDeltaDeg * 2;
  const dLon = (Math.random() - 0.5) * maxDeltaDeg * 2;

  const newLat = clamp(lat + dLat, -89.0, 89.0);
  const newLon = clamp(lon + dLon, -179.9, 179.9);

  return { latitude: newLat, longitude: newLon };
}

// Compute heading (rough estimate) from old → new position.
function computeHeading(
  oldLat: number,
  oldLon: number,
  newLat: number,
  newLon: number,
): number {
  const dLon = (newLon - oldLon) * (Math.PI / 180);
  const lat1 = oldLat * (Math.PI / 180);
  const lat2 = newLat * (Math.PI / 180);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = Math.atan2(y, x);
  brng = (brng * 180) / Math.PI;
  brng = (brng + 360) % 360;
  return brng;
}

// Generate a new simulated telematics snapshot for a given vehicle.
function generateTelematics(
  prevLocation: DummyLocation | null,
  baseLat: number,
  baseLon: number,
): {
  latitude: number;
  longitude: number;
  heading_degrees: number;
  speed_mph: number;
  odometer_miles: number;
  ignition_on: boolean;
} {
  // Start position:
  const startLat = prevLocation?.latitude ?? baseLat;
  const startLon = prevLocation?.longitude ?? baseLon;

  // Move to new position:
  const { latitude, longitude } = movePosition(startLat, startLon);

  // Heading: compute from old → new
  const heading_degrees = computeHeading(startLat, startLon, latitude, longitude);

  // Simple speed model:
  // - 80% chance truck is "moving"
  // - 20% chance truck is "stopped" (speed 0, ignition maybe off)
  const moving = Math.random() < 0.8;
  const ignition_on = moving || Math.random() < 0.5;

  const speed_mph = moving ? Math.round(30 + Math.random() * 45) : 0; // ~30–75 mph

  // Odometer: if we had a previous reading, add some distance.
  const prevOdo = prevLocation?.odometer_miles ?? (100_000 + Math.random() * 50_000);

  // Assume a small time step for distance, e.g. ~2 minutes (0.033 hours)
  const timeStepHours = 0.033;
  const deltaMiles = speed_mph * timeStepHours;
  const odometer_miles = prevOdo + deltaMiles;

  return {
    latitude,
    longitude,
    heading_degrees,
    speed_mph,
    odometer_miles,
    ignition_on,
  };
}

// Choose a default starting position for a vehicle with no prior location.
// Here we center around Northern California (roughly Sacramento) and add
// small random offsets so trucks don't stack on top of each other.
function getDefaultStartPosition(vehicleIndex: number): { latitude: number; longitude: number } {
  const baseLat = 38.58;  // Sacramento-ish
  const baseLon = -121.49;

  const offsetLat = ((vehicleIndex % 5) - 2) * 0.02; // spread a bit north/south
  const offsetLon = (Math.floor(vehicleIndex / 5) - 2) * 0.02; // spread east/west

  return {
    latitude: baseLat + offsetLat,
    longitude: baseLon + offsetLon,
  };
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[atlas-dummy-gps-simulator] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.",
    );
    return jsonResponse(
      {
        error:
          "Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.",
      },
      500,
    );
  }

  // Optional body:
  // {
  //   "org_id": "uuid-optional",   // If provided, simulate only this org's dummy fleet.
  //   "maxVehicles": 50            // Optional cap on total vehicles processed.
  // }
  let body: { org_id?: string; maxVehicles?: number } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = (await req.json()) as typeof body;
    }
  } catch {
    // Non-fatal: treat as empty body.
    body = {};
  }

  const targetOrgId = body.org_id;
  const maxVehicles = Math.min(Math.max(body.maxVehicles ?? 200, 1), 500);

  // 1) Load active dummy vehicles
  let vehiclesQuery = supabaseAdmin
    .from("atlas_dummy_vehicles")
    .select("id, org_id, name, code, is_active")
    .eq("is_active", true)
    .limit(maxVehicles);

  if (targetOrgId) {
    vehiclesQuery = vehiclesQuery.eq("org_id", targetOrgId);
  }

  const { data: vehicles, error: vehiclesError } = await vehiclesQuery;

  if (vehiclesError) {
    console.error(
      "[atlas-dummy-gps-simulator] Error loading dummy vehicles:",
      vehiclesError,
    );
    return jsonResponse(
      {
        error: "Failed to load dummy vehicles.",
        details: vehiclesError.message,
      },
      500,
    );
  }

  if (!vehicles || vehicles.length === 0) {
    console.log(
      "[atlas-dummy-gps-simulator] No active dummy vehicles found. Nothing to simulate.",
    );
    return jsonResponse(
      {
        ok: true,
        message: "No active dummy vehicles to simulate.",
        updated: 0,
      },
      200,
    );
  }

  const dummyVehicles: DummyVehicle[] = vehicles as unknown as DummyVehicle[];

  // 2) Load existing locations for these vehicles
  const vehicleIds = dummyVehicles.map((v) => v.id);

  const { data: locations, error: locationsError } = await supabaseAdmin
    .from("atlas_dummy_vehicle_locations_current")
    .select("*")
    .in("dummy_vehicle_id", vehicleIds);

  if (locationsError) {
    console.error(
      "[atlas-dummy-gps-simulator] Error loading existing dummy locations:",
      locationsError,
    );
    return jsonResponse(
      {
        error: "Failed to load existing dummy vehicle locations.",
        details: locationsError.message,
      },
      500,
    );
  }

  const locationsByVehicleId = new Map<string, DummyLocation>();
  (locations ?? []).forEach((loc: any) => {
    locationsByVehicleId.set(loc.dummy_vehicle_id, loc as DummyLocation);
  });

  const nowIso = new Date().toISOString();
  const upserts: any[] = [];

  // 3) Build new locations for each vehicle
  dummyVehicles.forEach((vehicle, index) => {
    const prev = locationsByVehicleId.get(vehicle.id) ?? null;

    const defaultPos = getDefaultStartPosition(index);
    const telem = generateTelematics(prev, defaultPos.latitude, defaultPos.longitude);

    upserts.push({
      // Multi-tenant:
      org_id: vehicle.org_id,
      dummy_vehicle_id: vehicle.id,

      // GPS + telematics:
      latitude: telem.latitude,
      longitude: telem.longitude,
      heading_degrees: telem.heading_degrees,
      speed_mph: telem.speed_mph,
      odometer_miles: telem.odometer_miles,
      ignition_on: telem.ignition_on,

      located_at: nowIso,
      last_synced_at: nowIso,
    });
  });

  if (upserts.length === 0) {
    return jsonResponse(
      {
        ok: true,
        message: "No dummy vehicles required updates.",
        updated: 0,
      },
      200,
    );
  }

  // 4) UPSERT all new locations.
  //
  // We rely on the unique index:
  //   (org_id, dummy_vehicle_id)
  //
  // so that upsert keeps exactly one "current" row per vehicle per org.
  const { error: upsertError } = await supabaseAdmin
    .from("atlas_dummy_vehicle_locations_current")
    .upsert(upserts, {
      onConflict: "org_id,dummy_vehicle_id",
    });

  if (upsertError) {
    console.error(
      "[atlas-dummy-gps-simulator] Error upserting dummy locations:",
      upsertError,
    );
    return jsonResponse(
      {
        error: "Failed to upsert dummy vehicle locations.",
        details: upsertError.message,
      },
      500,
    );
  }

  console.log(
    `[atlas-dummy-gps-simulator] Updated locations for ${upserts.length} dummy vehicles.`,
  );

  return jsonResponse(
    {
      ok: true,
      message: "Dummy GPS simulation step completed.",
      updated: upserts.length,
      org_filter: targetOrgId ?? null,
    },
    200,
  );
});
