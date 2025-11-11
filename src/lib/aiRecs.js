// /src/lib/aiRecs.js
// Tiny helper utilities to INSERT (and optionally list) AI recommendations
// into the public.ai_recommendations table you created in Step 1.
//
// Usage examples:
//   import { addGlobalRec, addLoadRec, addDriverRec, addTruckRec, listAIRecs } from "./aiRecs";
//
//   await addGlobalRec({
//     title: "Morning pulse: spot market cooling in CA",
//     content: { lanes: ["NORCAL->TX", "NORCAL->IL"], note: "Expect -3% vs last week" },
//     source: "AI Dispatch v1",
//     score: 0.78,
//   });
//
//   await addLoadRec("7ec07385-70be-40c9-9c17-4792ed451ef2", {
//     title: "Best driver based on ETA/HOS: Bruce Wayne",
//     content: "Driver Bruce Wayne can pick up by 13:40, meets HOS window.",
//     source: "AI Dispatch v1",
//     score: 0.91,
//   });
//
// NOTE: Ensure RLS + table exist per migration, and user is authenticated for auth.uid() stamping.

import { supabase } from "./supabase";

/* ------------------------------ Constants/API ------------------------------ */
export const AI_CONTEXT = Object.freeze({
  GLOBAL: "GLOBAL",
  LOAD: "LOAD",
  DRIVER: "DRIVER",
  TRUCK: "TRUCK",
});

/* --------------------------------- Utils ---------------------------------- */
function isUUID(v) {
  // Accepts standard UUIDs (v4 typical). Simple regex; DB will enforce type further.
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    // Fallback to toString if user passed a weird object
    return String(content);
  }
}

function validatePayload({ title, context_type, context_id }) {
  if (!title || !title.trim()) {
    return "Title is required.";
  }
  if (context_type === AI_CONTEXT.GLOBAL && context_id) {
    return "GLOBAL recommendations must not include a context_id.";
  }
  if (
    (context_type === AI_CONTEXT.LOAD ||
      context_type === AI_CONTEXT.DRIVER ||
      context_type === AI_CONTEXT.TRUCK) &&
    !isUUID(context_id)
  ) {
    return `context_id must be a valid UUID for context_type ${context_type}.`;
  }
  return null;
}

/* ------------------------------ Core Insertion ----------------------------- */
/**
 * Low-level insert. Prefer the convenience wrappers below.
 * @param {Object} params
 * @param {string} params.title - Short human title
 * @param {string|Object} params.content - Plain text or a JS object (auto-JSON stringified)
 * @param {'GLOBAL'|'LOAD'|'DRIVER'|'TRUCK'} params.context_type
 * @param {string|null} [params.context_id] - UUID when context_type != GLOBAL
 * @param {string|null} [params.source] - e.g., "AI Dispatch v1"
 * @param {number|null} [params.score] - optional ranking/confidence
 * @returns {Promise<{data: any|null, error: Error|null}>}
 */
export async function insertAIRecommendation({
  title,
  content,
  context_type = AI_CONTEXT.GLOBAL,
  context_id = null,
  source = null,
  score = null,
}) {
  const payload = {
    title: String(title || "").trim(),
    content: normalizeContent(content),
    context_type,
    context_id: context_id || null,
    source: source || null,
    score: typeof score === "number" ? score : score === "" ? null : score ?? null,
  };

  const validationError = validatePayload(payload);
  if (validationError) {
    return { data: null, error: new Error(validationError) };
  }

  const { data, error } = await supabase
    .from("ai_recommendations")
    .insert([payload])
    .select("*")
    .single();

  return { data, error };
}

/* --------------------------- Convenience Wrappers -------------------------- */
/**
 * Global recommendation (no context_id).
 */
export async function addGlobalRec({ title, content, source = null, score = null }) {
  return insertAIRecommendation({
    title,
    content,
    context_type: AI_CONTEXT.GLOBAL,
    context_id: null,
    source,
    score,
  });
}

/**
 * Load-scoped recommendation.
 */
export async function addLoadRec(loadId, { title, content, source = null, score = null }) {
  return insertAIRecommendation({
    title,
    content,
    context_type: AI_CONTEXT.LOAD,
    context_id: loadId,
    source,
    score,
  });
}

/**
 * Driver-scoped recommendation.
 */
export async function addDriverRec(driverId, { title, content, source = null, score = null }) {
  return insertAIRecommendation({
    title,
    content,
    context_type: AI_CONTEXT.DRIVER,
    context_id: driverId,
    source,
    score,
  });
}

/**
 * Truck-scoped recommendation.
 */
export async function addTruckRec(truckId, { title, content, source = null, score = null }) {
  return insertAIRecommendation({
    title,
    content,
    context_type: AI_CONTEXT.TRUCK,
    context_id: truckId,
    source,
    score,
  });
}

/* ------------------------------- Quick Reader ------------------------------ */
/**
 * List recommendations with optional filters.
 * All filters are optional; pass what you need.
 *
 * @param {Object} [opts]
 * @param {'GLOBAL'|'LOAD'|'DRIVER'|'TRUCK'} [opts.context_type]
 * @param {string} [opts.context_id] - UUID when context_type != GLOBAL
 * @param {number} [opts.limit=50]
 * @returns {Promise<{data:any[]|null, error:Error|null}>}
 */
export async function listAIRecs(opts = {}) {
  const { context_type, context_id, limit = 50 } = opts;
  let query = supabase
    .from("ai_recommendations")
    .select("id, created_at, title, content, context_type, context_id, source, score, created_by")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (context_type) query = query.eq("context_type", context_type);
  if (context_id) query = query.eq("context_id", context_id);

  const { data, error } = await query;
  return { data, error };
}

/* --------------------------- Opinionated Shortcuts ------------------------- */
// Example: call this after assigning a driver to a load
export async function logDriverAssignmentSuggestion({ loadId, driverId, driverName, etaText, reason }) {
  if (!isUUID(loadId) || !isUUID(driverId)) {
    return { data: null, error: new Error("loadId and driverId must be valid UUIDs.") };
  }
  const title = `Assignment candidate: ${driverName ?? "Driver"} for load ${loadId.slice(0, 8)}`;
  const content = {
    driver_id: driverId,
    driver_name: driverName || null,
    eta: etaText || null,
    reason: reason || "AI dispatch suggestion",
  };
  return addLoadRec(loadId, {
    title,
    content,
    source: "AI Dispatch v1",
    score: 0.9,
  });
}

