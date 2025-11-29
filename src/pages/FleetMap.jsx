// FILE: src/pages/FleetMap.jsx
// Purpose:
// - Show live vehicle locations on a "Fleet Map" for the current org.
// - Supports Motive + Samsara + Atlas Dummy sources.
// - Uses current_org_id() on the backend via RLS (no org logic in the client).
// - Reads from:
//      • motive_vehicle_locations_current
//      • samsara_vehicle_locations_current + samsara_vehicles
//      • atlas_dummy_vehicle_locations_current + atlas_dummy_vehicles
//
// Security:
// - Uses ONLY the browser Supabase client (no service-role here).
// - All org boundaries are enforced in Postgres via RLS + current_org_id().
// - We do NOT modify or bypass any RLS or auth checks.
//
// Notes:
// - This file does NOT remove any Motive or Samsara behavior.
// - Atlas Dummy is an additional internal provider for simulated fleets.
// - The "map" is still a simple UI. Phase 2 can plug in a real map provider.

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { MapPin, RefreshCw, AlertCircle, Truck } from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/**
 * Normalized vehicle shape used by the UI.
 *
 * We unify Motive + Samsara + Dummy into one format:
 *  - provider: "motive" | "samsara" | "dummy"
 *  - vehicleId: original provider vehicle ID
 *  - displayName: best human-readable name
 *  - latitude / longitude / speed / heading / etc.
 */
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
    vehicle_number ||
    name ||
    license_plate ||
    `Motive Vehicle ${motive_vehicle_id}`;

  return {
    id: `motive:${motive_vehicle_id}`,
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
    raw: row,
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
    id: `samsara:${samsara_vehicle_id}`,
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
    raw: {
      location: locationRow,
      vehicle: vehicleRow,
    },
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

  const { name, code, make, model, year, color, is_active } = vehicleRow || {};

  const displayName = name || code || `Dummy Vehicle ${dummy_vehicle_id}`;

  return {
    id: `dummy:${dummy_vehicle_id}`,
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
    raw: {
      location: locationRow,
      vehicle: vehicleRow,
      color: color || null,
    },
  };
}

export default function FleetMap() {
  const [orgId, setOrgId] = useState(null);
  const [loadingOrg, setLoadingOrg] = useState(true);

  const [loadingPositions, setLoadingPositions] = useState(false);
  const [error, setError] = useState(null);

  const [vehicles, setVehicles] = useState([]); // unified list (Motive + Samsara + Dummy)
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const [filterProvider, setFilterProvider] = useState("all"); // "all" | "motive" | "samsara" | "dummy"
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);

  // In-memory cache for reverse geocoded labels keyed by rounded coords
  // Example key: "38.588,-121.347"
  const [locationLabels, setLocationLabels] = useState({});

  // Ref to track the geocode interval for cleanup
  const geocodeIntervalRef = useRef(null);

  // 1) Resolve org via RPC current_org_id()
  const resolveOrg = useCallback(async () => {
    setLoadingOrg(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("current_org_id");

    if (rpcError) {
      console.error("[FleetMap] Failed to resolve current_org_id()", rpcError);
      setError("Could not determine your organization. Please try again.");
      setOrgId(null);
      setLoadingOrg(false);
      return;
    }

    if (!data) {
      console.warn("[FleetMap] current_org_id() returned null");
      setError("No active organization found.");
      setOrgId(null);
      setLoadingOrg(false);
      return;
    }

    setOrgId(data);
    setLoadingOrg(false);
  }, []);

  // 2) Load Motive + Samsara + Dummy positions for this org
  const loadPositions = useCallback(async () => {
    if (!orgId) return;

    setLoadingPositions(true);
    setError(null);

    try {
      // RLS + current_org_id() already scope data to the current org,
      // but we also filter by org_id for clarity and safety.
      const [
        { data: motiveLocations, error: motiveError },
        { data: samsaraLocations, error: samsaraLocError },
        { data: samsaraVehicles, error: samsaraVehError },
        { data: dummyLocations, error: dummyLocError },
        { data: dummyVehicles, error: dummyVehError },
      ] = await Promise.all([
        supabase
          .from("motive_vehicle_locations_current")
          .select("*")
          .eq("org_id", orgId),
        supabase
          .from("samsara_vehicle_locations_current")
          .select("*")
          .eq("org_id", orgId),
        supabase.from("samsara_vehicles").select("*").eq("org_id", orgId),
        supabase
          .from("atlas_dummy_vehicle_locations_current")
          .select("*")
          .eq("org_id", orgId),
        supabase.from("atlas_dummy_vehicles").select("*").eq("org_id", orgId),
      ]);

      if (motiveError) {
        console.error(
          "[FleetMap] Error loading Motive locations:",
          motiveError
        );
        throw new Error("Failed to load Motive vehicle positions.");
      }
      if (samsaraLocError) {
        console.error(
          "[FleetMap] Error loading Samsara locations:",
          samsaraLocError
        );
        throw new Error("Failed to load Samsara vehicle positions.");
      }
      if (samsaraVehError) {
        console.error(
          "[FleetMap] Error loading Samsara vehicles:",
          samsaraVehError
        );
        throw new Error("Failed to load Samsara vehicle details.");
      }
      if (dummyLocError) {
        console.error(
          "[FleetMap] Error loading Dummy locations:",
          dummyLocError
        );
        throw new Error("Failed to load Atlas Dummy vehicle positions.");
      }
      if (dummyVehError) {
        console.error(
          "[FleetMap] Error loading Dummy vehicles:",
          dummyVehError
        );
        throw new Error("Failed to load Atlas Dummy vehicle details.");
      }

      const samsaraVehiclesById = new Map();
      (samsaraVehicles || []).forEach((v) => {
        samsaraVehiclesById.set(String(v.samsara_vehicle_id), v);
      });

      const dummyVehiclesById = new Map();
      (dummyVehicles || []).forEach((v) => {
        // v.id is the PK; dummy_locations references dummy_vehicle_id = v.id
        dummyVehiclesById.set(String(v.id), v);
      });

      const motiveNormalized = (motiveLocations || []).map(normalizeMotiveRow);

      const samsaraNormalized = (samsaraLocations || [])
        .map((loc) => {
          const v = samsaraVehiclesById.get(String(loc.samsara_vehicle_id));
          return normalizeSamsaraRow(loc, v);
        })
        .filter(Boolean);

      const dummyNormalized = (dummyLocations || [])
        .map((loc) => {
          const v = dummyVehiclesById.get(String(loc.dummy_vehicle_id));
          return normalizeDummyRow(loc, v);
        })
        .filter(Boolean);

      const combined = [
        ...motiveNormalized,
        ...samsaraNormalized,
        ...dummyNormalized,
      ].sort((a, b) => {
        const tA = a.locatedAt ? new Date(a.locatedAt).getTime() : 0;
        const tB = b.locatedAt ? new Date(b.locatedAt).getTime() : 0;
        return tB - tA; // newest first
      });

      setVehicles(combined);
      setLastRefreshedAt(new Date().toISOString());

      // If no selection yet, select the first vehicle (if any).
      if (!selectedVehicleId && combined.length > 0) {
        setSelectedVehicleId(combined[0].id);
      }
    } catch (err) {
      console.error("[FleetMap] loadPositions error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load fleet positions."
      );
    } finally {
      setLoadingPositions(false);
    }
  }, [orgId, selectedVehicleId]);

  // 3) Initial org resolution
  useEffect(() => {
    resolveOrg();
  }, [resolveOrg]);

  // 4) Whenever org changes, load positions
  useEffect(() => {
    if (orgId) {
      loadPositions();
    }
  }, [orgId, loadPositions]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      if (filterProvider === "all") return true;
      return v.provider === filterProvider;
    });
  }, [vehicles, filterProvider]);

  const selectedVehicle = useMemo(() => {
    return (
      filteredVehicles.find((v) => v.id === selectedVehicleId) ||
      filteredVehicles[0] ||
      null
    );
  }, [filteredVehicles, selectedVehicleId]);

  // Reverse-geocode lat/lon → "City, State" using Nominatim.
  // Rate-limited to 1 request per 1.1 seconds to respect Nominatim's usage policy.
  useEffect(() => {
    // Clear any existing interval
    if (geocodeIntervalRef.current) {
      clearInterval(geocodeIntervalRef.current);
      geocodeIntervalRef.current = null;
    }

    const toLookup = [];

    filteredVehicles.forEach((v) => {
      if (typeof v.latitude !== "number" || typeof v.longitude !== "number") {
        return;
      }
      const key = `${v.latitude.toFixed(3)},${v.longitude.toFixed(3)}`;
      if (!locationLabels[key]) {
        toLookup.push({ key, lat: v.latitude, lon: v.longitude });
      }
    });

    if (toLookup.length === 0) return;

    // Mark all as loading first
    setLocationLabels((prev) => {
      const updates = {};
      toLookup.forEach(({ key }) => {
        if (!prev[key]) {
          updates[key] = "__loading__";
        }
      });
      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, ...updates };
    });

    // Rate-limited sequential fetching (1 request per 1.1 seconds for Nominatim)
    let index = 0;

    const fetchNext = () => {
      if (index >= toLookup.length) {
        if (geocodeIntervalRef.current) {
          clearInterval(geocodeIntervalRef.current);
          geocodeIntervalRef.current = null;
        }
        return;
      }

      const { key, lat, lon } = toLookup[index];
      index++;

      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lon)}`;

      fetch(url, { headers: { Accept: "application/json" } })
        .then((res) => res.json())
        .then((data) => {
          const address = data?.address || {};
          const city =
            address.city ||
            address.town ||
            address.village ||
            address.hamlet ||
            address.suburb ||
            address.county ||
            null;
          const state = address.state || address.region || null;

          const labelParts = [];
          if (city) labelParts.push(city);
          if (state) labelParts.push(state);
          const label =
            labelParts.join(", ") || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

          setLocationLabels((prev) => ({ ...prev, [key]: label }));
        })
        .catch((err) => {
          console.error("[FleetMap] Reverse geocode failed", err);
          setLocationLabels((prev) => ({
            ...prev,
            [key]: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          }));
        });
    };

    // Fetch the first one immediately
    fetchNext();

    // Then fetch remaining at 1.1 second intervals
    if (toLookup.length > 1) {
      geocodeIntervalRef.current = setInterval(fetchNext, 1100);
    }

    return () => {
      if (geocodeIntervalRef.current) {
        clearInterval(geocodeIntervalRef.current);
        geocodeIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredVehicles]);

  const handleRefresh = async () => {
    if (!orgId) return;
    await loadPositions();
  };

  const formatDateTime = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  // Label for the selected vehicle location (for the right-hand details panel)
  let selectedLocationLabel = "";
  if (
    selectedVehicle &&
    typeof selectedVehicle.latitude === "number" &&
    typeof selectedVehicle.longitude === "number"
  ) {
    const key = `${selectedVehicle.latitude.toFixed(
      3
    )},${selectedVehicle.longitude.toFixed(3)}`;
    const cached = locationLabels[key];
    if (!cached || cached === "__loading__") {
      selectedLocationLabel = `${selectedVehicle.latitude.toFixed(
        4
      )}, ${selectedVehicle.longitude.toFixed(4)}`;
    } else {
      selectedLocationLabel = cached;
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-50">
            Fleet Map
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Live positions from <span className="font-medium">Motive</span>,{" "}
            <span className="font-medium">Samsara</span>, and{" "}
            <span className="font-medium">Atlas Dummy Fleet</span> for your org.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastRefreshedAt && (
            <p className="hidden sm:block text-xs text-slate-500">
              Last updated: {formatDateTime(lastRefreshedAt)}
            </p>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loadingOrg || loadingPositions}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs sm:text-sm font-medium",
              "bg-slate-900 hover:bg-slate-800 text-slate-50",
              (loadingOrg || loadingPositions) &&
                "opacity-60 cursor-not-allowed"
            )}
          >
            <RefreshCw
              className={cx("h-4 w-4", loadingPositions && "animate-spin")}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-600 bg-red-950/40 px-3 py-2 text-xs sm:text-sm text-red-100">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">
              There was an issue loading your fleet.
            </p>
            <p className="text-red-200/80">{error}</p>
          </div>
        </div>
      )}

      {/* Org loading state */}
      {loadingOrg && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-6 text-sm text-slate-300">
          Resolving your organization…
        </div>
      )}

      {!loadingOrg && !orgId && !error && (
        <div className="rounded-lg border border-amber-500/60 bg-amber-950/40 px-4 py-6 text-sm text-amber-100">
          No active organization found. Please make sure your account is linked
          to an org before viewing the Fleet Map.
        </div>
      )}

      {/* Main content */}
      {!loadingOrg && orgId && (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr,1.2fr] gap-4">
          {/* Left: Simple "map" / overview */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-emerald-400" />
                <p className="text-xs sm:text-sm text-slate-200 font-medium">
                  Fleet overview
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] sm:text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-slate-300 border border-slate-700">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Motive
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-slate-300 border border-slate-700">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
                  Samsara
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-slate-300 border border-slate-700">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
                  Atlas Dummy
                </span>
              </div>
            </div>

            {/* Provider filter */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Showing:</span>
              <div className="inline-flex rounded-full bg-slate-900 border border-slate-700 p-0.5">
                <button
                  type="button"
                  onClick={() => setFilterProvider("all")}
                  className={cx(
                    "px-2.5 py-1 rounded-full",
                    "transition text-xs",
                    filterProvider === "all"
                      ? "bg-slate-800 text-slate-50"
                      : "text-slate-400 hover:text-slate-100"
                  )}
                >
                  All ({vehicles.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterProvider("motive")}
                  className={cx(
                    "px-2.5 py-1 rounded-full",
                    "transition text-xs",
                    filterProvider === "motive"
                      ? "bg-slate-800 text-slate-50"
                      : "text-slate-400 hover:text-slate-100"
                  )}
                >
                  Motive (
                  {vehicles.filter((v) => v.provider === "motive").length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterProvider("samsara")}
                  className={cx(
                    "px-2.5 py-1 rounded-full",
                    "transition text-xs",
                    filterProvider === "samsara"
                      ? "bg-slate-800 text-slate-50"
                      : "text-slate-400 hover:text-slate-100"
                  )}
                >
                  Samsara (
                  {vehicles.filter((v) => v.provider === "samsara").length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterProvider("dummy")}
                  className={cx(
                    "px-2.5 py-1 rounded-full",
                    "transition text-xs",
                    filterProvider === "dummy"
                      ? "bg-slate-800 text-slate-50"
                      : "text-slate-400 hover:text-slate-100"
                  )}
                >
                  Dummy ({vehicles.filter((v) => v.provider === "dummy").length}
                  )
                </button>
              </div>
            </div>

            {/* "Map" placeholder – list of pins in a simple grid */}
            <div className="mt-1 flex-1 rounded-md border border-slate-800 bg-gradient-to-b from-slate-950 to-slate-900/80 p-2 sm:p-3">
              {loadingPositions ? (
                <div className="flex h-32 items-center justify-center text-xs text-slate-400">
                  Loading vehicle positions…
                </div>
              ) : filteredVehicles.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-xs text-slate-400 text-center">
                  No active vehicle locations from Motive, Samsara, or Atlas
                  Dummy for this org yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {filteredVehicles.map((v) => {
                    let coordLabel = "";
                    if (
                      typeof v.latitude === "number" &&
                      typeof v.longitude === "number"
                    ) {
                      const key = `${v.latitude.toFixed(
                        3
                      )},${v.longitude.toFixed(3)}`;
                      const cached = locationLabels[key];
                      if (!cached || cached === "__loading__") {
                        coordLabel = `${v.latitude.toFixed(
                          4
                        )}, ${v.longitude.toFixed(4)}`;
                      } else {
                        coordLabel = cached;
                      }
                    } else {
                      coordLabel = "Location unavailable";
                    }

                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVehicleId(v.id)}
                        className={cx(
                          "group flex flex-col items-start gap-1 rounded-md border px-2 py-1.5 text-left",
                          "border-slate-800 bg-slate-950/70 hover:bg-slate-900/80",
                          selectedVehicleId === v.id &&
                            "border-emerald-400/70 bg-slate-900"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cx(
                              "inline-block h-1.5 w-1.5 rounded-full",
                              v.provider === "motive"
                                ? "bg-emerald-400"
                                : v.provider === "samsara"
                                ? "bg-sky-400"
                                : "bg-slate-300"
                            )}
                          />
                          <span className="text-[10px] uppercase tracking-wide text-slate-400">
                            {v.providerLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Truck className="h-3.5 w-3.5 text-slate-300" />
                          <p className="text-[11px] font-medium text-slate-100 truncate">
                            {v.displayName}
                          </p>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">
                          {coordLabel}
                        </p>
                        {v.speedMph != null && (
                          <p className="text-[10px] text-slate-500">
                            {Math.round(v.speedMph)} mph
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Selected vehicle details drawer */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-slate-200" />
                <p className="text-xs sm:text-sm font-medium text-slate-100">
                  Vehicle details
                </p>
              </div>
              {selectedVehicle && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300 border border-slate-700">
                  <span
                    className={cx(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      selectedVehicle.provider === "motive"
                        ? "bg-emerald-400"
                        : selectedVehicle.provider === "samsara"
                        ? "bg-sky-400"
                        : "bg-slate-300"
                    )}
                  />
                  {selectedVehicle.providerLabel}
                </span>
              )}
            </div>

            {!selectedVehicle ? (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                Select a vehicle from the left to see details.
              </div>
            ) : (
              <div className="space-y-3 text-xs sm:text-sm text-slate-200">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    Vehicle
                  </p>
                  <p className="font-medium text-slate-50">
                    {selectedVehicle.displayName}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    ID: {selectedVehicle.vehicleId}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Details
                    </p>
                    <p>
                      <span className="text-slate-400">Plate: </span>
                      {selectedVehicle.licensePlate || "—"}
                      {selectedVehicle.licensePlateState
                        ? ` (${selectedVehicle.licensePlateState})`
                        : ""}
                    </p>
                    <p>
                      <span className="text-slate-400">VIN: </span>
                      {selectedVehicle.vin || "—"}
                    </p>
                    <p>
                      <span className="text-slate-400">Make/Model: </span>
                      {selectedVehicle.make || selectedVehicle.model
                        ? `${selectedVehicle.make || ""} ${
                            selectedVehicle.model || ""
                          }`.trim()
                        : "—"}
                    </p>
                    <p>
                      <span className="text-slate-400">Year: </span>
                      {selectedVehicle.year || "—"}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Status
                    </p>
                    <p>
                      <span className="text-slate-400">Status: </span>
                      {selectedVehicle.status || "—"}
                    </p>
                    <p>
                      <span className="text-slate-400">Availability: </span>
                      {selectedVehicle.availabilityStatus || "—"}
                    </p>
                    <p>
                      <span className="text-slate-400">Ignition: </span>
                      {selectedVehicle.ignitionOn == null
                        ? "—"
                        : selectedVehicle.ignitionOn
                        ? "On"
                        : "Off"}
                    </p>
                    <p>
                      <span className="text-slate-400">Speed: </span>
                      {selectedVehicle.speedMph != null
                        ? `${Math.round(selectedVehicle.speedMph)} mph`
                        : "—"}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    Location
                  </p>
                  <p>
                    <span className="text-slate-400">Location: </span>
                    {selectedLocationLabel || "—"}
                  </p>
                  <p>
                    <span className="text-slate-400">Coords: </span>
                    {selectedVehicle.latitude?.toFixed?.(5)},{" "}
                    {selectedVehicle.longitude?.toFixed?.(5)}
                  </p>
                  <p>
                    <span className="text-slate-400">Heading: </span>
                    {selectedVehicle.headingDegrees != null
                      ? `${Math.round(selectedVehicle.headingDegrees)}°`
                      : "—"}
                  </p>
                  <p>
                    <span className="text-slate-400">Sample time: </span>
                    {formatDateTime(selectedVehicle.locatedAt)}
                  </p>
                  <p>
                    <span className="text-slate-400">Last synced: </span>
                    {formatDateTime(selectedVehicle.lastSyncedAt)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}