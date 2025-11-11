// src/lib/driverPreferences.js
// Purpose: Single helper to record driver thumbs with ALL required fields
// - Always sends: driver_id, rating ('up' | 'down'), lane_key, customer_id, click_key
// - Prevents NULLs that the trainer would ignore
// Usage:
//   await recordThumb({ driverId, rating: 'up', laneKey, customerId });

import { supabase } from "../lib/supabase";

/** Make a short, mostly-unique click key (human+time readable) */
function makeClickKey(rating = "up") {
  const ts = Date.now(); // ms
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}-${rating}`;
}

/**
 * Coerce id from string or object ({ id } or { driver_id }).
 */
function coerceId(maybe) {
  if (!maybe) return null;
  if (typeof maybe === "string") return maybe;
  if (typeof maybe === "object") {
    if (maybe.id) return maybe.id;
    if (maybe.driver_id) return maybe.driver_id;
  }
  return null;
}

/**
 * Record a thumbs-up/down for a driver, with lane+customer context.
 * @param {{
 *  driverId: string | {id?: string, driver_id?: string},
 *  rating: 'up' | 'down',
 *  laneKey: string,
 *  customerId: string,
 *  note?: string,
 *  isInteractive?: boolean
 * }} params
 */
export async function recordThumb(params) {
  const {
    driverId,
    rating,
    laneKey,
    customerId,
    note = null,
    isInteractive = true,
  } = params || {};

  const driver_id = coerceId(driverId);

  // Basic validation so we never insert half-baked rows
  if (!driver_id) throw new Error("recordThumb: driverId is required");
  if (rating !== "up" && rating !== "down")
    throw new Error("recordThumb: rating must be 'up' or 'down'");
  if (!laneKey || typeof laneKey !== "string")
    throw new Error("recordThumb: laneKey (e.g., 'Tulsa, OK → Columbus, OH') is required");
  if (!customerId || typeof customerId !== "string")
    throw new Error("recordThumb: customerId (UUID) is required");

  const click_key = makeClickKey(rating);
  const nowIso = new Date().toISOString();
  const sec = Math.floor(Date.now() / 1000);

  const row = {
    driver_id,
    rating,
    lane_key: laneKey,
    customer_id: customerId,
    note,
    click_key,
    is_interactive: isInteractive,
    created_at: nowIso,
    created_at_sec: sec,
    created_epoch_sec: sec,
    created_epoch_2s: Math.floor(sec / 2),
  };

  const { error } = await supabase.from("driver_feedback").insert(row);
  if (error) {
    // Surface constraint issues clearly for debugging
    throw new Error(
      `[driver_feedback.insert] ${error.code || ""} ${error.message || error.toString()}`
    );
  }

  return { ok: true, click_key };
}

/**
 * Small helper to wrap UI onClick handlers with guard + toast patterns.
 * Example:
 *   await thumbUp({ driverId, laneKey, customerId })
 */
export async function thumbUp({ driverId, laneKey, customerId, note }) {
  return recordThumb({ driverId, rating: "up", laneKey, customerId, note });
}

export async function thumbDown({ driverId, laneKey, customerId, note }) {
  return recordThumb({ driverId, rating: "down", laneKey, customerId, note });
}
