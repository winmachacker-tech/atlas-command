// FILE: src/lib/driverFeedback.js
// Purpose: Record 👍/👎 driver feedback through Supabase RPC.
// RPC: public.rpc_record_driver_feedback(p_driver_id, p_customer_id, p_lane_key, p_vote, p_note)

import { supabase } from "./supabase";

/**
 * Core helper to call the RPC.
 *
 * @param {Object} p
 * @param {string} p.driverId - required UUID
 * @param {string|null} [p.customerId] - UUID or null
 * @param {string|null} [p.laneKey] - string or null
 * @param {"up"|"down"} p.vote - required
 * @param {string|null} [p.note] - optional
 * @returns {Promise<object>} driver_feedback row
 */
export async function recordDriverFeedback({
  driverId,
  customerId = null,
  laneKey = null,
  vote,
  note = null,
}) {
  if (!driverId) throw new Error("driverId is required");
  if (vote !== "up" && vote !== "down") throw new Error('vote must be "up" or "down"');

  const { data, error } = await supabase.rpc("rpc_record_driver_feedback", {
    p_driver_id: driverId,
    p_customer_id: customerId,
    p_lane_key: laneKey,
    p_vote: vote,
    p_note: note,
  });

  if (error) {
    console.error("[recordDriverFeedback] RPC error:", error);
    throw new Error(error.message || "Failed to record feedback");
  }

  return data;
}

/** Convenience wrappers */
export async function thumbUp({ driverId, customerId = null, laneKey = null, note = null }) {
  return recordDriverFeedback({ driverId, customerId, laneKey, vote: "up", note });
}
export async function thumbDown({ driverId, customerId = null, laneKey = null, note = null }) {
  return recordDriverFeedback({ driverId, customerId, laneKey, vote: "down", note });
}

/** Optional default export to avoid import typos elsewhere */
export default { recordDriverFeedback, thumbUp, thumbDown };
