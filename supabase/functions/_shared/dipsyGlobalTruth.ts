// FILE: supabase/functions/_shared/dipsyGlobalTruth.ts
// Purpose:
//   Canonical, RLS-safe "ground truth" helpers for Dipsy V2.
//   Every Dipsy tool should use this module to read objective state
//   about loads, drivers, assignments, trucks, and orgs.
//
// Design:
//   - This module NEVER creates its own Supabase client.
//   - It always receives an already-authenticated SupabaseClient,
//     which already has the caller's JWT attached.
//   - That guarantees Row Level Security (RLS) is enforced.
//   - All functions are read-only "truth readers"; they do not
//     mutate data. Write actions will live in a separate module.
//
// NOTE:
//   - Types here are intentionally "shape based" and resilient.
//   - They assume your existing tables: loads, drivers, trucks,
//     load_driver_assignments, motive_vehicle_locations_current.
//   - If any column names differ, adjust the select() lists below,
//     but keep the function signatures the same so tools stay stable.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// Simple JSON helper type
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Generic result wrapper so the LLM can distinguish "no data" vs "error".
export interface TruthResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

// -----------------------------
// Core "truth" view models
// -----------------------------

export interface LoadTruth {
  id: string;
  org_id: string;
  reference: string | null;
  status: string; // e.g. AVAILABLE, IN_TRANSIT, DELIVERED, CANCELLED
  origin_city: string | null;
  origin_state: string | null;
  destination_city: string | null;
  destination_state: string | null;
  pickup_at: string | null; // ISO timestamp
  delivery_at: string | null; // ISO timestamp
  rate: number | null;
  driver_id: string | null;
  driver_name: string | null;
  pod_status: string | null; // e.g. NONE, PENDING, RECEIVED
  raw: Json; // full row snapshot for debugging / future use
}

export interface DriverHosSnapshot {
  status: string | null; // e.g. DRIVING, ON_DUTY, OFF_DUTY, SLEEPER_BERTH
  drive_remaining_hm: string | null; // "8h 47m" style text if you store it
  shift_remaining_hm: string | null;
  cycle_remaining_hm: string | null;
}

export interface DriverTruth {
  id: string;
  org_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null; // ACTIVE / INACTIVE / SUSPENDED / etc.
  dispatch_status: string | null; // AVAILABLE / ASSIGNED / OUT_OF_SERVICE (if you have it)
  hos: DriverHosSnapshot;
  raw: Json;
}

export interface DriverAssignmentTruth {
  driver_id: string;
  driver_name: string | null;
  // Optional: primary active load id if present
  current_load_id: string | null;
  current_load_reference: string | null;
  current_load_status: string | null;
  // All active loads this driver is tied to (usually 0 or 1)
  active_loads: LoadTruth[];
}

export interface TruckTruth {
  id: string;
  org_id: string;
  name: string | null; // e.g. "Truck 2203"
  number: string | null; // your internal number
  status: string | null; // ACTIVE / INACTIVE / OUT_OF_SERVICE
  // Latest location snapshot, if available from Motive/Samsara
  location_lat: number | null;
  location_lng: number | null;
  location_city: string | null;
  location_state: string | null;
  location_recorded_at: string | null; // ISO timestamp
  raw: Json;
}

export interface OrgSummaryTruth {
  org_id: string;
  active_load_count: number;
  available_driver_count: number;
  assigned_driver_count: number;
  active_truck_count: number;
}

// -----------------------------
// Helper: safe error wrapper
// -----------------------------

function wrapError<T>(where: string, error: unknown): TruthResult<T> {
  console.error("[DipsyGlobalTruth]", where, error);
  return {
    ok: false,
    data: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

// -----------------------------
// Loads truth helpers
// -----------------------------

/**
 * Get all "active" loads for an org.
 * You can adjust the status filter to match your definition of "active".
 */
export async function getActiveLoadsTruth(
  client: SupabaseClient,
  orgId: string,
): Promise<TruthResult<LoadTruth[]>> {
  try {
    const { data, error } = await client
      .from("loads")
      .select(
        `
        id,
        org_id,
        reference,
        status,
        origin_city,
        origin_state,
        destination_city,
        destination_state,
        pickup_at,
        delivery_at,
        rate,
        driver_id,
        driver_name,
        pod_status
      `,
      )
      .eq("org_id", orgId)
      .in("status", ["AVAILABLE", "IN_TRANSIT", "DISPATCHED"]); // adjust as needed

    if (error) return wrapError("getActiveLoadsTruth/select", error);

    const rows = (data ?? []) as any[];

    const loads: LoadTruth[] = rows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      reference: row.reference ?? null,
      status: row.status ?? "UNKNOWN",
      origin_city: row.origin_city ?? null,
      origin_state: row.origin_state ?? null,
      destination_city: row.destination_city ?? null,
      destination_state: row.destination_state ?? null,
      pickup_at: row.pickup_at ?? null,
      delivery_at: row.delivery_at ?? null,
      rate: typeof row.rate === "number" ? row.rate : row.rate ?? null,
      driver_id: row.driver_id ?? null,
      driver_name: row.driver_name ?? null,
      pod_status: row.pod_status ?? null,
      raw: row,
    }));

    return { ok: true, data: loads };
  } catch (err) {
    return wrapError("getActiveLoadsTruth/catch", err);
  }
}

/**
 * Get a single load by ID, strictly scoped to org_id.
 */
export async function getLoadByIdTruth(
  client: SupabaseClient,
  orgId: string,
  loadId: string,
): Promise<TruthResult<LoadTruth>> {
  try {
    const { data, error } = await client
      .from("loads")
      .select(
        `
        id,
        org_id,
        reference,
        status,
        origin_city,
        origin_state,
        destination_city,
        destination_state,
        pickup_at,
        delivery_at,
        rate,
        driver_id,
        driver_name,
        pod_status
      `,
      )
      .eq("org_id", orgId)
      .eq("id", loadId)
      .maybeSingle();

    if (error) return wrapError("getLoadByIdTruth/select", error);
    if (!data) {
      return {
        ok: false,
        data: null,
        error: "Load not found for this org.",
      };
    }

    const row = data as any;

    const load: LoadTruth = {
      id: row.id,
      org_id: row.org_id,
      reference: row.reference ?? null,
      status: row.status ?? "UNKNOWN",
      origin_city: row.origin_city ?? null,
      origin_state: row.origin_state ?? null,
      destination_city: row.destination_city ?? null,
      destination_state: row.destination_state ?? null,
      pickup_at: row.pickup_at ?? null,
      delivery_at: row.delivery_at ?? null,
      rate: typeof row.rate === "number" ? row.rate : row.rate ?? null,
      driver_id: row.driver_id ?? null,
      driver_name: row.driver_name ?? null,
      pod_status: row.pod_status ?? null,
      raw: row,
    };

    return { ok: true, data: load };
  } catch (err) {
    return wrapError("getLoadByIdTruth/catch", err);
  }
}

// -----------------------------
// Drivers truth helpers
// -----------------------------

/**
 * Get a single driver by ID with HOS snapshot.
 */
export async function getDriverByIdTruth(
  client: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<TruthResult<DriverTruth>> {
  try {
    const { data, error } = await client
      .from("drivers")
      .select(
        `
        id,
        org_id,
        first_name,
        last_name,
        email,
        phone,
        status,
        dispatch_status,
        hos_status,
        hos_drive_remaining_hm,
        hos_shift_remaining_hm,
        hos_cycle_remaining_hm
      `,
      )
      .eq("org_id", orgId)
      .eq("id", driverId)
      .maybeSingle();

    if (error) return wrapError("getDriverByIdTruth/select", error);
    if (!data) {
      return {
        ok: false,
        data: null,
        error: "Driver not found for this org.",
      };
    }

    const row = data as any;

    const driver: DriverTruth = {
      id: row.id,
      org_id: row.org_id,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      status: row.status ?? null,
      dispatch_status: row.dispatch_status ?? null,
      hos: {
        status: row.hos_status ?? null,
        drive_remaining_hm: row.hos_drive_remaining_hm ?? null,
        shift_remaining_hm: row.hos_shift_remaining_hm ?? null,
        cycle_remaining_hm: row.hos_cycle_remaining_hm ?? null,
      },
      raw: row,
    };

    return { ok: true, data: driver };
  } catch (err) {
    return wrapError("getDriverByIdTruth/catch", err);
  }
}

/**
 * Get all currently AVAILABLE drivers for an org (according to dispatch_status).
 * You can adjust the dispatch_status values to match your schema.
 */
export async function getAvailableDriversTruth(
  client: SupabaseClient,
  orgId: string,
): Promise<TruthResult<DriverTruth[]>> {
  try {
    const { data, error } = await client
      .from("drivers")
      .select(
        `
        id,
        org_id,
        first_name,
        last_name,
        email,
        phone,
        status,
        dispatch_status,
        hos_status,
        hos_drive_remaining_hm,
        hos_shift_remaining_hm,
        hos_cycle_remaining_hm
      `,
      )
      .eq("org_id", orgId)
      .eq("dispatch_status", "AVAILABLE");

    if (error) return wrapError("getAvailableDriversTruth/select", error);

    const rows = (data ?? []) as any[];

    const drivers: DriverTruth[] = rows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      status: row.status ?? null,
      dispatch_status: row.dispatch_status ?? null,
      hos: {
        status: row.hos_status ?? null,
        drive_remaining_hm: row.hos_drive_remaining_hm ?? null,
        shift_remaining_hm: row.hos_shift_remaining_hm ?? null,
        cycle_remaining_hm: row.hos_cycle_remaining_hm ?? null,
      },
      raw: row,
    }));

    return { ok: true, data: drivers };
  } catch (err) {
    return wrapError("getAvailableDriversTruth/catch", err);
  }
}

// -----------------------------
// Driver assignments truth
// -----------------------------

/**
 * Get all active loads currently assigned to a specific driver.
 * This is the canonical place Dipsy should check "is this driver assigned?"
 */
export async function getDriverAssignmentsTruth(
  client: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<TruthResult<DriverAssignmentTruth>> {
  try {
    // First: get driver basic info.
    const driverResult = await getDriverByIdTruth(client, orgId, driverId);
    if (!driverResult.ok || !driverResult.data) {
      return {
        ok: false,
        data: null,
        error: driverResult.error ?? "Driver not found.",
      };
    }

    // Second: get all loads where this driver is currently referenced.
    // We deliberately only look at "active-ish" statuses to avoid historic clutter.
    const { data: loadsData, error: loadsError } = await client
      .from("loads")
      .select(
        `
        id,
        org_id,
        reference,
        status,
        origin_city,
        origin_state,
        destination_city,
        destination_state,
        pickup_at,
        delivery_at,
        rate,
        driver_id,
        driver_name,
        pod_status
      `,
      )
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .in("status", ["AVAILABLE", "IN_TRANSIT", "DISPATCHED", "DELIVERED"]); // include DELIVERED so POD flows can reconcile

    if (loadsError) return wrapError("getDriverAssignmentsTruth/loads", loadsError);

    const rows = (loadsData ?? []) as any[];

    const activeLoads: LoadTruth[] = rows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      reference: row.reference ?? null,
      status: row.status ?? "UNKNOWN",
      origin_city: row.origin_city ?? null,
      origin_state: row.origin_state ?? null,
      destination_city: row.destination_city ?? null,
      destination_state: row.destination_state ?? null,
      pickup_at: row.pickup_at ?? null,
      delivery_at: row.delivery_at ?? null,
      rate: typeof row.rate === "number" ? row.rate : row.rate ?? null,
      driver_id: row.driver_id ?? null,
      driver_name: row.driver_name ?? null,
      pod_status: row.pod_status ?? null,
      raw: row,
    }));

    const current = activeLoads.find(
      (l) => l.status === "IN_TRANSIT" || l.status === "DISPATCHED",
    ) ?? activeLoads[0] ??
      null;

    const assignment: DriverAssignmentTruth = {
      driver_id: driverResult.data.id,
      driver_name: `${driverResult.data.first_name ?? ""} ${driverResult.data.last_name ?? ""}`
        .trim() || null,
      current_load_id: current ? current.id : null,
      current_load_reference: current ? current.reference : null,
      current_load_status: current ? current.status : null,
      active_loads: activeLoads,
    };

    return { ok: true, data: assignment };
  } catch (err) {
    return wrapError("getDriverAssignmentsTruth/catch", err);
  }
}

// -----------------------------
// Trucks truth helpers
// -----------------------------

/**
 * Get a single truck with its latest location snapshot.
 * Assumes you have a view motive_vehicle_locations_current joined to trucks,
 * or you can adjust the select to your schema.
 */
export async function getTruckByIdTruth(
  client: SupabaseClient,
  orgId: string,
  truckId: string,
): Promise<TruthResult<TruckTruth>> {
  try {
    // First, basic truck row.
    const { data: truckData, error: truckError } = await client
      .from("trucks")
      .select(
        `
        id,
        org_id,
        name,
        number,
        status
      `,
      )
      .eq("org_id", orgId)
      .eq("id", truckId)
      .maybeSingle();

    if (truckError) return wrapError("getTruckByIdTruth/truck", truckError);
    if (!truckData) {
      return {
        ok: false,
        data: null,
        error: "Truck not found for this org.",
      };
    }

    const truckRow = truckData as any;

    // Second, latest location (if you have a current-location view).
    const { data: locData, error: locError } = await client
      .from("motive_vehicle_locations_current")
      .select(
        `
        vehicle_id,
        latitude,
        longitude,
        city,
        state,
        recorded_at
      `,
      )
      .eq("truck_id", truckId) // adjust to your FK column if different
      .maybeSingle();

    if (locError && locError.code !== "PGRST116") {
      // PGRST116 = No rows found; not really an error for our purposes.
      console.warn("[DipsyGlobalTruth] getTruckByIdTruth/location", locError);
    }

    const locRow = (locData ?? null) as any | null;

    const truck: TruckTruth = {
      id: truckRow.id,
      org_id: truckRow.org_id,
      name: truckRow.name ?? null,
      number: truckRow.number ?? null,
      status: truckRow.status ?? null,
      location_lat: locRow ? locRow.latitude ?? null : null,
      location_lng: locRow ? locRow.longitude ?? null : null,
      location_city: locRow ? locRow.city ?? null : null,
      location_state: locRow ? locRow.state ?? null : null,
      location_recorded_at: locRow ? locRow.recorded_at ?? null : null,
      raw: {
        truck: truckRow,
        location: locRow,
      },
    };

    return { ok: true, data: truck };
  } catch (err) {
    return wrapError("getTruckByIdTruth/catch", err);
  }
}

// -----------------------------
// Org summary truth
// -----------------------------

/**
 * Light-weight org summary: active loads, available/assigned drivers, active trucks.
 */
export async function getOrgSummaryTruth(
  client: SupabaseClient,
  orgId: string,
): Promise<TruthResult<OrgSummaryTruth>> {
  try {
    const [activeLoads, availableDrivers, assignedDrivers, activeTrucks] =
      await Promise.all([
        client
          .from("loads")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .in("status", ["AVAILABLE", "IN_TRANSIT", "DISPATCHED"]),
        client
          .from("drivers")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("dispatch_status", "AVAILABLE"),
        client
          .from("drivers")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("dispatch_status", "ASSIGNED"),
        client
          .from("trucks")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("status", "ACTIVE"),
      ]);

    const active_load_count = activeLoads.count ?? 0;
    const available_driver_count = availableDrivers.count ?? 0;
    const assigned_driver_count = assignedDrivers.count ?? 0;
    const active_truck_count = activeTrucks.count ?? 0;

    const summary: OrgSummaryTruth = {
      org_id: orgId,
      active_load_count,
      available_driver_count,
      assigned_driver_count,
      active_truck_count,
    };

    return { ok: true, data: summary };
  } catch (err) {
    return wrapError("getOrgSummaryTruth/catch", err);
  }
}

// -----------------------------
// Conversation state (type only)
// -----------------------------

// This is the structured, non-truth "memory" that Dipsy can use to
// remember what the user is talking about ("that load", "that driver").
// It is *not* used as ground truth; tools must always re-check DB for facts.
export interface DipsyConversationState {
  last_load_id?: string | null;
  last_driver_id?: string | null;
  last_truck_id?: string | null;
  org_id?: string | null;
  mode?: "operations" | "intelligence" | "communications" | "business" | "systems";
  // Event ids, last warnings, etc. can be added later.
  recent_event_ids?: string[];
  // Free-form scratch space; safe to ignore if empty.
  scratch?: Json;
}
