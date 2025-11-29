// FILE: src/lib/dipsy/tools/searchTrucksAllSources.js
//
// Purpose:
// - Give Dipsy a SINGLE, truthful source of truck location info,
//   matching what you see on the Fleet Map.
// - Looks in Motive, Samsara, AND Atlas Dummy tables for a given truck.
// - Uses only the standard Supabase client (anon key) so RLS + current_org_id()
//   still fully enforce org boundaries.

import { supabase } from "../../supabase";

// ---------- Helper: resolve orgId safely ----------

async function resolveOrgId(maybeOrgId) {
  // If caller already passed a valid-looking UUID, trust it.
  if (
    maybeOrgId &&
    typeof maybeOrgId === "string" &&
    maybeOrgId.includes("-") &&
    maybeOrgId.length >= 30
  ) {
    return maybeOrgId;
  }

  // Otherwise, fall back to current_org_id() like FleetMap does.
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) {
    console.error(
      "[Dipsy/searchTrucksAllSources] Failed to resolve current_org_id()",
      error
    );
    return null;
  }
  if (!data) {
    console.warn(
      "[Dipsy/searchTrucksAllSources] current_org_id() returned null"
    );
    return null;
  }
  return data;
}

// ---------- Helper: pull a truck identifier out of messy user text ----------

function extractTruckIdentifierFromQuery(raw) {
  if (!raw) return null;
  const q = raw.trim();

  if (!q) return null;

  // 1) Look for "truck 59aa5981", "truck #2203", "unit 145", etc.
  const patterns = [
    /(?:truck|unit|tractor|trailer)\s*#?\s*([A-Za-z0-9-]+)/i,
  ];

  for (const re of patterns) {
    const m = q.match(re);
    if (m && m[1]) {
      return m[1];
    }
  }

  // 2) Split into tokens and try to find the most "ID-like" thing
  const tokens = q.split(/[\s,;:!?/\\]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // Prefer tokens that have both letters & digits (e.g. 59aa5981)
  const alphaNum = tokens.filter(
    (t) => /[A-Za-z]/.test(t) && /\d/.test(t)
  );
  if (alphaNum.length > 0) {
    return alphaNum[alphaNum.length - 1];
  }

  // Then prefer numeric-only tokens (e.g. 2203)
  const numeric = tokens.filter((t) => /^\d+$/.test(t));
  if (numeric.length > 0) {
    return numeric[numeric.length - 1];
  }

  // Fallback: last token
  return tokens[tokens.length - 1];
}

// ---------- Normalizers ----------

function normalizeMotiveRow(row) {
  const {
    motive_vehicle_id,
    vehicle_number,
    name,
    vin,
    license_plate,
    make,
    model,
    year,
    availability_status,
    status,
    latitude,
    longitude,
    heading_degrees,
    speed_mph,
    odometer_miles,
    ignition_on,
    located_at,
    last_synced_at,
  } = row;

  const displayName =
    vehicle_number || name || license_plate || `Motive Vehicle ${motive_vehicle_id}`;

  return {
    provider: "motive",
    providerLabel: "Motive",
    vehicleId: String(motive_vehicle_id),
    displayName,
    licensePlate: license_plate || null,
    vin: vin || null,
    make: make || null,
    model: model || null,
    year: year || null,
    status: status || null,
    availabilityStatus: availability_status || null,
    latitude,
    longitude,
    headingDegrees: heading_degrees ?? null,
    speedMph: speed_mph ?? null,
    odometerMiles: odometer_miles ?? null,
    ignitionOn: ignition_on ?? null,
    locatedAt: located_at,
    lastSyncedAt: last_synced_at,
  };
}

function normalizeSamsaraRow(locationRow, vehicleRow) {
  const {
    samsara_vehicle_id,
    latitude,
    longitude,
    heading_degrees,
    speed_mph,
    odometer_miles,
    ignition_on,
    located_at,
    last_synced_at,
  } = locationRow;

  const {
    name,
    license_plate,
    license_plate_state,
    vin,
    make,
    model,
    model_year,
    status,
    is_active,
  } = vehicleRow || {};

  const displayName =
    name || license_plate || `Samsara Vehicle ${samsara_vehicle_id}`;

  return {
    provider: "samsara",
    providerLabel: "Samsara",
    vehicleId: String(samsara_vehicle_id),
    displayName,
    licensePlate: license_plate || null,
    licensePlateState: license_plate_state || null,
    vin: vin || null,
    make: make || null,
    model: model || null,
    year: model_year || null,
    status: status || null,
    availabilityStatus: is_active ? "active" : "inactive",
    latitude,
    longitude,
    headingDegrees: heading_degrees ?? null,
    speedMph: speed_mph ?? null,
    odometerMiles: odometer_miles ?? null,
    ignitionOn: ignition_on ?? null,
    locatedAt: located_at,
    lastSyncedAt: last_synced_at,
  };
}

function normalizeDummyRow(locationRow, vehicleRow) {
  const {
    dummy_vehicle_id,
    latitude,
    longitude,
    heading_degrees,
    speed_mph,
    odometer_miles,
    ignition_on,
    located_at,
    last_synced_at,
  } = locationRow;

  const { name, code, make, model, year, is_active } = vehicleRow || {};

  const displayName = name || code || `Dummy Vehicle ${dummy_vehicle_id}`;

  return {
    provider: "dummy",
    providerLabel: "Atlas Dummy",
    vehicleId: String(dummy_vehicle_id),
    displayName,
    licensePlate: null,
    licensePlateState: null,
    vin: null,
    make: make || null,
    model: model || null,
    year: year || null,
    status: is_active ? "active" : "inactive",
    availabilityStatus: is_active ? "active" : "inactive",
    latitude,
    longitude,
    headingDegrees: heading_degrees ?? null,
    speedMph: speed_mph ?? null,
    odometerMiles: odometer_miles ?? null,
    ignitionOn: ignition_on ?? null,
    locatedAt: located_at,
    lastSyncedAt: last_synced_at,
  };
}

// ---------- Provider-specific lookups ----------

async function findMotiveTruck(orgId, identifier) {
  if (!identifier) return null;

  const clean = identifier.trim();
  if (!clean) return null;

  const orConditions = [
    `vehicle_number.ilike.%${clean}%`,
    `name.ilike.%${clean}%`,
    `license_plate.ilike.%${clean}%`,
  ];

  // Only try motive_vehicle_id.eq when the identifier is purely numeric
  if (/^\d+$/.test(clean)) {
    orConditions.push(`motive_vehicle_id.eq.${clean}`);
  }

  const orFilters = orConditions.join(",");

  const { data, error } = await supabase
    .from("motive_vehicle_locations_current")
    .select("*")
    .eq("org_id", orgId)
    .or(orFilters)
    .order("located_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error(
      "[Dipsy/searchTrucksAllSources] Motive query error",
      error
    );
    return null;
  }
  if (!data || data.length === 0) return null;

  return normalizeMotiveRow(data[0]);
}

async function findSamsaraTruck(orgId, identifier) {
  if (!identifier) return null;

  const clean = identifier.trim();
  if (!clean) return null;

  const orFilters = [
    `name.ilike.%${clean}%`,
    `license_plate.ilike.%${clean}%`,
    `samsara_vehicle_id.eq.${clean}`,
  ].join(",");

  const { data: vehicles, error: vehErr } = await supabase
    .from("samsara_vehicles")
    .select("*")
    .eq("org_id", orgId)
    .or(orFilters)
    .limit(3);

  if (vehErr) {
    console.error(
      "[Dipsy/searchTrucksAllSources] Samsara veh query error",
      vehErr
    );
    return null;
  }
  if (!vehicles || vehicles.length === 0) return null;

  const vehicleIds = vehicles.map((v) => v.samsara_vehicle_id);

  const { data: locations, error: locErr } = await supabase
    .from("samsara_vehicle_locations_current")
    .select("*")
    .eq("org_id", orgId)
    .in("samsara_vehicle_id", vehicleIds)
    .order("located_at", { ascending: false })
    .limit(1);

  if (locErr) {
    console.error(
      "[Dipsy/searchTrucksAllSources] Samsara loc query error",
      locErr
    );
    return null;
  }
  if (!locations || locations.length === 0) return null;

  const locationRow = locations[0];
  const vehicleRow = vehicles.find(
    (v) => v.samsara_vehicle_id === locationRow.samsara_vehicle_id
  );

  return normalizeSamsaraRow(locationRow, vehicleRow);
}

async function findDummyTruck(orgId, identifier) {
  if (!identifier) return null;

  const cleanRaw = identifier.trim();
  if (!cleanRaw) return null;

  // Extra cleaning for phrases like "truck 4812ca12"
  const cleanedLower = cleanRaw.toLowerCase().replace(/truck/gi, "").trim();
  const clean = cleanedLower || cleanRaw.trim();

  const orConditions = [
    `name.ilike.%${clean}%`,
    `code.ilike.%${clean}%`,
  ];

  // Only try id.eq when it looks like a full UUID (avoids errors on partial IDs)
  if (/^[0-9a-fA-F-]{36}$/.test(clean)) {
    orConditions.push(`id.eq.${clean}`);
  }

  const orFilters = orConditions.join(",");

  const { data: vehicles, error: vehErr } = await supabase
    .from("atlas_dummy_vehicles")
    .select("*")
    .eq("org_id", orgId)
    .or(orFilters)
    .limit(3);

  if (vehErr) {
    console.error(
      "[Dipsy/searchTrucksAllSources] Dummy veh query error",
      vehErr
    );
    return null;
  }
  if (!vehicles || vehicles.length === 0) return null;

  const vehicleIds = vehicles.map((v) => v.id);

  const { data: locations, error: locErr } = await supabase
    .from("atlas_dummy_vehicle_locations_current")
    .select("*")
    .eq("org_id", orgId)
    .in("dummy_vehicle_id", vehicleIds)
    .order("located_at", { ascending: false })
    .limit(1);

  if (locErr) {
    console.error(
      "[Dipsy/searchTrucksAllSources] Dummy loc query error",
      locErr
    );
    return null;
  }
  if (!locations || locations.length === 0) return null;

  const locationRow = locations[0];
  const vehicleRow = vehicles.find(
    (v) => v.id === locationRow.dummy_vehicle_id
  );

  return normalizeDummyRow(locationRow, vehicleRow);
}

// ---------- Main exported tool ----------

/**
 * searchTrucksAllSources
 *
 * Input:
 *   { orgId: string | number | null, query: string }
 *
 * Output:
 *   - On success:
 *      {
 *        success: true,
 *        provider: "motive" | "samsara" | "dummy",
 *        provider_label: string,
 *        truck_id: string,
 *        truck_display_name: string,
 *        latitude: number,
 *        longitude: number,
 *        speed_mph: number | null,
 *        heading_degrees: number | null,
 *        located_at: string | null,
 *        last_synced_at: string | null,
 *      }
 *
 *   - On failure:
 *      { success: false, reason: "NOT_FOUND" | "MISSING_ORG" | "EMPTY_QUERY" }
 */
export async function searchTrucksAllSources({ orgId, query }) {
  const resolvedOrgId = await resolveOrgId(orgId);

  if (!resolvedOrgId) {
    console.warn(
      "[Dipsy/searchTrucksAllSources] Missing or unresolved orgId – cannot search trucks."
    );
    return { success: false, reason: "MISSING_ORG" };
  }

  const identifier = extractTruckIdentifierFromQuery(query || "");
  if (!identifier) {
    console.log(
      "[Dipsy/searchTrucksAllSources] Could not extract identifier from query",
      query
    );
    return { success: false, reason: "EMPTY_QUERY" };
  }

  console.log(
    "[Dipsy/searchTrucksAllSources] Searching for truck across providers",
    { orgId: resolvedOrgId, rawQuery: query, identifier }
  );

  // Try providers in a priority order: Motive → Samsara → Dummy.
  const [motive, samsara, dummy] = await Promise.all([
    findMotiveTruck(resolvedOrgId, identifier),
    findSamsaraTruck(resolvedOrgId, identifier),
    findDummyTruck(resolvedOrgId, identifier),
  ]);

  const candidate = motive || samsara || dummy;
  if (!candidate) {
    console.log(
      "[Dipsy/searchTrucksAllSources] No truck found in Motive/Samsara/Dummy for",
      identifier
    );
    return { success: false, reason: "NOT_FOUND" };
  }

  return {
    success: true,
    provider: candidate.provider,
    provider_label: candidate.providerLabel,
    truck_id: candidate.vehicleId,
    truck_display_name: candidate.displayName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    speed_mph: candidate.speedMph,
    heading_degrees: candidate.headingDegrees,
    located_at: candidate.locatedAt,
    last_synced_at: candidate.lastSyncedAt,
  };
}

export default searchTrucksAllSources;
