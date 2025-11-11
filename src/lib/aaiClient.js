// src/lib/aaiClient.js
// Thin client for posting AAI learning events to the aai-events Edge Function.
// Requires: supabase client (src/lib/supabase.js) and deployed function `aai-events`.

import { supabase } from "./supabase";

/* -------------------------------- Config ------------------------------- */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const FUNCTIONS_URL =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
  (SUPABASE_URL ? `${new URL(SUPABASE_URL).origin}/functions/v1` : undefined);

if (!FUNCTIONS_URL) {
  throw new Error(
    "AAI: FUNCTIONS_URL is undefined. Set VITE_SUPABASE_FUNCTIONS_URL or VITE_SUPABASE_URL."
  );
}

const AAI_ENDPOINT = `${FUNCTIONS_URL}/aai-events`;

/* ------------------------------ Internals ------------------------------ */
async function getAuthBearer() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("AAI: No Supabase session token found.");
  return `Bearer ${token}`;
}

async function postAAI(body) {
  const auth = await getAuthBearer();

  const res = await fetch(AAI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = json?.details || json?.error || res.statusText;
    throw new Error(`AAI request failed: ${msg}`);
  }

  return json; // { ok, event_id, driver_stats, actor_user_id }
}

/* ------------------------------ Public API ----------------------------- */
/**
 * Log a generic AAI learning event.
 * @param {Object} params
 * @param {string} params.event_type - one of:
 *   'offer_shown' | 'offer_accepted' | 'offer_declined' |
 *   'assigned' | 'unassigned' | 'pickup_scanned' | 'delivered' |
 *   'detention' | 'late' | 'thumb_up' | 'thumb_down'
 * @param {string} params.driver_id
 * @param {string} [params.load_id]
 * @param {string} [params.occurred_at] - ISO string
 * @param {string} [params.lane_origin]
 * @param {string} [params.lane_dest]
 * @param {string} [params.region]
 * @param {string} [params.equipment]
 * @param {number} [params.miles]
 * @param {number} [params.pay_total_usd]
 * @param {number} [params.max_distance]
 * @param {Object} [params.payload]
 * @returns {Promise<{event_id?: string, driver_stats?: any}>}
 */
export async function logAAIEvent(params) {
  if (!params?.event_type) throw new Error("AAI: event_type is required");
  if (!params?.driver_id) throw new Error("AAI: driver_id is required");
  return postAAI(params);
}

/* --------------------------- Convenience calls ------------------------- */
export async function logOfferShown({
  driverId,
  loadId,
  laneOrigin,
  laneDest,
  region,
  equipment,
  miles,
  payTotalUsd,
  maxDistance,
  payload,
}) {
  return logAAIEvent({
    event_type: "offer_shown",
    driver_id: driverId,
    load_id: loadId ?? null,
    lane_origin: laneOrigin ?? null,
    lane_dest: laneDest ?? null,
    region: region ?? null,
    equipment: equipment ?? null,
    miles: miles ?? null,
    pay_total_usd: payTotalUsd ?? null,
    max_distance: maxDistance ?? null,
    payload: payload ?? {},
  });
}

export async function logOfferAccepted({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "offer_accepted",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

export async function logOfferDeclined({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "offer_declined",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

export async function logAssigned({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "assigned",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

export async function logUnassigned({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "unassigned",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

export async function logDelivered({
  driverId,
  loadId,
  miles,
  payTotalUsd,
  payload,
}) {
  return logAAIEvent({
    event_type: "delivered",
    driver_id: driverId,
    load_id: loadId ?? null,
    miles: miles ?? null,
    pay_total_usd: payTotalUsd ?? null,
    payload: payload ?? {},
  });
}

export async function logDetention({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "detention",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

export async function logLate({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "late",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

export async function logThumbUp({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "thumb_up",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

export async function logThumbDown({ driverId, loadId, payload }) {
  return logAAIEvent({
    event_type: "thumb_down",
    driver_id: driverId,
    load_id: loadId ?? null,
    payload: payload ?? {},
  });
}

/* --------------------------- Tiny UI helpers --------------------------- */
/**
 * Safe caller that wonâ€™t explode the UIâ€”returns null on error and logs.
 */
export async function tryLogAAIEvent(params) {
  try {
    return await logAAIEvent(params);
  } catch (err) {
    console.warn("AAI log failed:", err);
    return null;
  }
}

