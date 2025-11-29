// FILE: voice-server/atlas-supabase.js
//
// Purpose (plain English):
// ------------------------
// - Give the voice server simple helper functions to read *real* Atlas data
//   from Supabase using the **user's** JWT (RLS-safe).
// - These helpers are called from index.js when OpenAI triggers tools:
//     • fetchActiveLoads      -> list_active_loads
//     • fetchAvailableDrivers -> list_available_drivers
//
// SECURITY MODEL:
// - Uses ONLY:
//     SUPABASE_URL       (project URL)
//     SUPABASE_ANON_KEY  (public anon key)
// - Every request sends:
//     Authorization: Bearer <userAccessToken>
// - That means:
//     • RLS stays fully enforced.
//     • This file cannot see anything the logged-in user couldn't see in the UI.
//     • No service-role key is ever used or stored here.
//
// IMPLEMENTATION NOTES:
// - We use Supabase REST (PostgREST) endpoints:
//     `${SUPABASE_URL}/rest/v1/loads`
//     `${SUPABASE_URL}/rest/v1/drivers`
//   If your table/view names differ, you can adjust LOADS_TABLE and DRIVERS_TABLE
//   below without touching any security or auth logic.
// - We default to `select=*` so we don't break if column names change. The
//   voice server will pick out the fields it cares about when summarizing.
// - Optional filters:
//     fetchActiveLoads:
//       • status            -> `status=eq.<status>` (single status string)
//       • origin_state      -> `origin_state=eq.<2-letter>`
//       • destination_state -> `destination_state=eq.<2-letter>`
//       • limit             -> `limit=<number>` (default 20)
//     fetchAvailableDrivers:
//       • region          -> `home_state=eq.<2-letter>` (maps to driver's home state)
//       • equipment_type  -> `equipment_type=eq.<value>`
//       • limit           -> `limit=<number>` (default 20)
//
// If a request fails (non-2xx), we throw an Error and let index.js turn that
// into a friendly message for the user. We never log tokens or secrets.
//

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Table/view names — tweak here if needed, RLS-safe either way
const LOADS_TABLE = "loads";
const DRIVERS_TABLE = "drivers";

// Basic sanity checks (but do NOT crash the process)
if (!SUPABASE_URL) {
  console.warn(
    "[DipsyVoice:WARN] SUPABASE_URL is not set in .env for voice-server. Atlas tools will fail."
  );
}
if (!SUPABASE_ANON_KEY) {
  console.warn(
    "[DipsyVoice:WARN] SUPABASE_ANON_KEY is not set in .env for voice-server. Atlas tools will fail."
  );
}

/**
 * Small helper to build a Supabase REST URL with query params.
 * We pass in the full filter strings expected by PostgREST, e.g. "status=eq.dispatched".
 */
function buildSupabaseUrl(path, queryParams = {}) {
  const url = new URL(path, SUPABASE_URL);
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.append(key, value.toString());
  });
  return url.toString();
}

/**
 * Shared fetch helper.
 *
 * - path: full path after the project URL, e.g. `/rest/v1/loads`
 * - queryParams: object of query params (we already encode PostgREST operators)
 * - accessToken: user JWT from Supabase Auth (RLS-safe)
 */
async function supabaseGet({ path, queryParams = {}, accessToken }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase URL or anon key missing in voice-server environment."
    );
  }

  if (!accessToken) {
    throw new Error("Missing user access token for RLS-safe Supabase call.");
  }

  const url = buildSupabaseUrl(path, queryParams);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch (_err) {
      // ignore
    }
    console.error("[DipsyVoice:SupabaseError]", {
      path,
      status: res.status,
      body: bodyText?.slice(0, 500),
    });
    throw new Error(
      `Supabase request failed with status ${res.status}. Check logs for path ${path}.`
    );
  }

  try {
    const json = await res.json();
    return json;
  } catch (err) {
    console.error("[DipsyVoice:SupabaseError] Failed to parse JSON:", {
      path,
      message: err.message,
    });
    throw new Error("Supabase returned non-JSON response.");
  }
}

/**
 * Fetch active loads for the current org, with optional filters.
 *
 * Params:
 * - accessToken      (string, required)  -> user JWT
 * - status           (string, optional)  -> e.g. "dispatched", "in_transit"
 * - origin_state     (string, optional)  -> 2-letter, e.g. "CA"
 * - destination_state(string, optional)  -> 2-letter, e.g. "WA"
 * - limit            (number, optional)  -> default 20
 *
 * Returns:
 * - An array of load rows (RLS-filtered).
 */
async function fetchActiveLoads({
  accessToken,
  status,
  origin_state,
  destination_state,
  limit,
}) {
  const path = `/rest/v1/${LOADS_TABLE}`;

  // PostgREST-style filters — adjust field names if needed to match your schema.
  const queryParams = {
    select: "*",
    limit: (limit && Number(limit)) || 20,
  };

  if (status && typeof status === "string" && status.trim()) {
    // single-status filter; if you later want multi-status, you can use in.(...)
    queryParams.status = `eq.${status.trim()}`;
  }

  if (origin_state && typeof origin_state === "string" && origin_state.trim()) {
    queryParams.origin_state = `eq.${origin_state.trim()}`;
  }

  if (
    destination_state &&
    typeof destination_state === "string" &&
    destination_state.trim()
  ) {
    queryParams.destination_state = `eq.${destination_state.trim()}`;
  }

  // NOTE: we do NOT filter by org_id here; RLS handles org isolation via the JWT.
  const data = await supabaseGet({ path, queryParams, accessToken });
  // data is expected to be an array of rows
  return data;
}

/**
 * Fetch available drivers for the current org, with optional filters.
 *
 * Params:
 * - accessToken     (string, required) -> user JWT
 * - region          (string, optional) -> mapped to driver's home_state, e.g. "TX"
 * - equipment_type  (string, optional) -> e.g. "dry_van", "reefer"
 * - limit           (number, optional) -> default 20
 *
 * Returns:
 * - An array of driver rows (RLS-filtered).
 */
async function fetchAvailableDrivers({
  accessToken,
  region,
  equipment_type,
  limit,
}) {
  const path = `/rest/v1/${DRIVERS_TABLE}`;

  const queryParams = {
    select: "*",
    limit: (limit && Number(limit)) || 20,
  };

  // REGION -> home_state (adjust if your column name differs)
  if (region && typeof region === "string" && region.trim()) {
    // Common pattern: drivers.home_state stores a 2-letter state code
    queryParams.home_state = `eq.${region.trim()}`;
  }

  if (
    equipment_type &&
    typeof equipment_type === "string" &&
    equipment_type.trim()
  ) {
    queryParams.equipment_type = `eq.${equipment_type.trim()}`;
  }

  // You may optionally filter to "available" status only, depending on your schema.
  // For example, if drivers have a current_status field:
  //   queryParams.current_status = "eq.available";
  //
  // Leaving this commented so we don't guess your exact column name:
  // queryParams.current_status = "eq.available";

  const data = await supabaseGet({ path, queryParams, accessToken });
  return data;
}

module.exports = {
  fetchActiveLoads,
  fetchAvailableDrivers,
};
