// src/lib/api.js
import { supabase } from "./supabase";

/** Normalize PostgREST/Supabase errors */
function normError(e) {
  const msg =
    e?.message ||
    e?.error_description ||
    e?.hint ||
    e?.details ||
    "Unknown error";
  return new Error(msg);
}

/** Tiny retry helper (network blips, 429/5xx) */
async function withRetry(fn, { tries = 3, delayMs = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // retry on 429/5xx or fetch failures
      const code = e?.code || e?.status || 0;
      const transient =
        e?.name === "TypeError" || // fetch failed
        code === 0 ||
        code === 429 ||
        (code >= 500 && code < 600);
      if (!transient || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/** -------- Public API: add methods here as we grow -------- */

/** List loads with filters + pagination */
export async function listLoads({ q = "", status = "ALL", from = 0, to = 24 } = {}) {
  return withRetry(async () => {
    let query = supabase
      .from("loads")
      .select(
        "id, reference, customer, broker, status, origin_city, origin_state, dest_city, dest_state, eta, created_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status !== "ALL") query = query.eq("status", status);
    if (q) {
      query = query.or(
        `reference.ilike.%${q}%,customer.ilike.%${q}%,broker.ilike.%${q}%,origin_city.ilike.%${q}%,dest_city.ilike.%${q}%`
      );
    }

    const { data, error, count } = await query;
    if (error) throw normError(error);
    return { rows: data ?? [], count: count ?? 0 };
  });
}

/** Insert a load (expects fully shaped payload per schema) */
export async function insertLoad(payload) {
  return withRetry(async () => {
    const { error } = await supabase.from("loads").insert(payload);
    if (error) throw normError(error);
    return true;
  });
}

/** In-Transit view */
export async function listInTransit(limit = 200) {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from("v_in_transit")
      .select(
        "id, reference, customer, broker, status, origin_city, origin_state, dest_city, dest_state, eta"
      )
      .limit(limit);
    if (error) throw normError(error);
    return data ?? [];
  });
}

/** Dashboard RPC + KPI counts */
export async function getWeeklyTrend(weeks = 8) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc("get_weekly_loads_trend", {
      p_weeks: weeks,
    });
    if (error) throw normError(error);
    return data ?? [];
  });
}

export async function countLoadsByStatus(status) {
  return withRetry(async () => {
    const { count, error } = await supabase
      .from("loads")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) throw normError(error);
    return count ?? 0;
  });
}

export async function countLoadsAll() {
  return withRetry(async () => {
    const { count, error } = await supabase
      .from("loads")
      .select("id", { count: "exact", head: true });
    if (error) throw normError(error);
    return count ?? 0;
  });
}

