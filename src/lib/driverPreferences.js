// src/lib/driverPreferences.js
import { supabase } from "./supabase";

/** Coerce various shapes into a UUID string */
function coerceDriverId(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.id || v.driver_id || v.driverId || v.value || null;
  return null;
}

/* ---- dedupe + short cooldown guards ---- */
const inflight = new Map();                 // key: "driverId:rating" -> Promise
const cooldown = new Map();                 // key -> timestamp
const COOLDOWN_MS = 600;
const keyFor = (id, rating) => `${id}:${rating}`;

/**
 * Record a thumbs feedback with an idempotency key so ONE click == ONE row max.
 * Also dispatches a single global event for UI listeners.
 *
 * @param {string|object} driverId - UUID or object with { id } / { driver_id }
 * @param {"up"|"down"} rating
 * @param {string} [clickKey] - stable key from a global click bus (optional but recommended)
 */
export async function recordThumb(driverId, rating, clickKey) {
  const id = coerceDriverId(driverId);
  if (!id) throw new Error("Missing driver_id");
  if (rating !== "up" && rating !== "down") throw new Error("Invalid rating");

  const pair = keyFor(id, rating);
  const now = Date.now();

  // swallow duplicates within cooldown window
  const until = cooldown.get(pair) || 0;
  if (now < until) return;

  // collapse concurrent calls
  if (inflight.has(pair)) return inflight.get(pair);

  // prefer caller-supplied key; else generate one
  const click_key =
    clickKey ||
    ((typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${id}-${rating}-${now}`);

  const payload = { driver_id: id, rating, is_interactive: true, click_key };

  const p = (async () => {
    try {
      const { error } = await supabase
        .from("driver_feedback")
        .upsert(payload, { onConflict: "click_key" });
      if (error) throw error;

      // fire global event once per successful insert
      window.dispatchEvent(new CustomEvent("ac-driver-feedback"));
    } finally {
      inflight.delete(pair);
      cooldown.set(pair, Date.now() + COOLDOWN_MS);
      setTimeout(() => {
        if ((cooldown.get(pair) || 0) <= Date.now()) cooldown.delete(pair);
      }, COOLDOWN_MS + 50);
    }
  })();

  inflight.set(pair, p);
  return p;
}

/* stubs to keep prior imports happy */
export async function getDriverPreferences() { return { likes: [], dislikes: [] }; }
export async function getDriverRecentFeedback() { return []; }

export default { recordThumb, getDriverPreferences, getDriverRecentFeedback };
