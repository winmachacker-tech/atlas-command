// src/lib/driverPreferences.js
// Drop-in helper for reading & writing driver preferences + learning signals.
// Usage examples:
//   import { upsertDriverPreferences, getDriverSnapshot, getDriverStats, getDriverRecentFeedback } from "../lib/driverPreferences";
//   await upsertDriverPreferences(driverId, { home_base: "Houston, TX", regions: ["West Coast","South East"], equipment: "Reefer", max_distance_mi: 600 });

import { supabase } from "./supabase";

/** Normalize plain JS to JSONB-safe payload (removes undefined, keeps nulls out) */
function cleanPrefs(prefs = {}) {
  const out = {};
  for (const [k, v] of Object.entries(prefs)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) out[k] = v.filter((x) => x !== null && x !== undefined);
    else out[k] = v;
  }
  return out;
}

/**
 * Upsert driver preferences via RPC (server-side function):
 *   public.upsert_driver_preferences_json(driver_id uuid, prefs jsonb)
 * Returns the merged row from public.driver_preferences
 */
export async function upsertDriverPreferences(driverId, prefs) {
  if (!driverId) throw new Error("driverId is required");
  const payload = cleanPrefs(prefs);

  const { data, error } = await supabase.rpc("upsert_driver_preferences_json", {
    driver_id: driverId,
    prefs: payload,
  });

  if (error) {
    // Surface PostgREST/RLS errors to caller
    throw new Error(error.message || "Failed to save driver preferences");
  }
  return data;
}

/** Fetch the current preference snapshot for a driver (coalesced table + latest feedback meta). */
export async function getDriverSnapshot(driverId) {
  if (!driverId) throw new Error("driverId is required");
  const { data, error } = await supabase
    .from("ai_driver_pref_snapshot")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to load driver snapshot");
  // maybeSingle() returns null if not found; return a sane empty shape
  return (
    data || {
      driver_id: driverId,
      updated_at: null,
      home_base: null,
      regions: null,
      avoid_states: null,
      equipment: null,
      trailer_type: null,
      max_distance_mi: null,
    }
  );
}

/** Fetch thumbs/acceptance rollups for a driver. */
export async function getDriverStats(driverId) {
  if (!driverId) throw new Error("driverId is required");
  const { data, error } = await supabase
    .from("ai_driver_learning_stats")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to load driver stats");
  return (
    data || {
      driver_id: driverId,
      thumbs_up: 0,
      thumbs_down: 0,
      thumbs_neutral: 0,
      accepted_count: 0,
      total_events: 0,
      acceptance_rate_pct: 0,
      last_updated_at: null,
    }
  );
}

/** Fetch recent feedback rows for a driver (default 10). */
export async function getDriverRecentFeedback(driverId, limit = 10) {
  if (!driverId) throw new Error("driverId is required");
  const { data, error } = await supabase
    .from("ai_driver_recent_feedback")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message || "Failed to load recent feedback");
  return data || [];
}

/**
 * Optional: record a thumbs event (writes to the same view your app posts to).
 * Pass minimal fields; function fills defaults server-side.
 * Example:
 *   await recordThumb({
 *     driver_id, load_id, load_number, rating: "up",
 *     source: "driver-learning", meta: { intent: "preference_update", equipment: "Reefer" }
 *   })
 */
export async function recordThumb({
  rating = "neutral",
  source = "unknown",
  driver_id = null,
  load_id = null,
  load_number = null,
  item_id = null,
  comment = null,
  note = null,
  meta = {},
  accepted = false,
  ai_version = null,
  intent = null,
}) {
  const { data, error } = await supabase.from("dispatch_feedback_events"\).insert([
    {
      rating,
      source,
      driver_id,
      load_id,
      load_number,
      item_id,
      comment,
      note,
      meta,
      accepted,
      ai_version,
      intent,
    },
  ]);
  if (error) throw new Error(error.message || "Failed to record feedback");
  return data;
}

