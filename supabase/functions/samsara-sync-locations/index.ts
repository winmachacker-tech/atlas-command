// FILE: supabase/functions/samsara-sync-locations/index.ts
//
// Purpose (plain English):
// ------------------------
// - This Edge Function syncs **live GPS locations** for Samsara vehicles
//   into your Atlas Command database.
// - It is meant to be called from:
//     • Supabase Scheduled Functions (cron)  ✅ (every 5 minutes later)
//     • Or manually via a POST request for testing.
//
// Behavior:
// ---------
// - For each org that has a Samsara token in samsara_org_connections:
//     1) Fetch the latest telematics data (location, speed, heading, etc.).
//     2) Normalize and map each record to a vehicle.
//     3) Upsert into public.samsara_vehicle_locations_current
//        (one “current” GPS row per org + Samsara vehicle).
//
// Security:
// ---------
// - Uses ONLY SUPABASE_SERVICE_ROLE_KEY (service-role) on the server.
// - Never exposes service-role key or Samsara tokens.
// - Writes bypass RLS (by design) but respect org_id and multi-tenant rules.
// - Reads from samsara_org_connections with service-role.
//
// Assumptions / Requirements:
// ---------------------------
// 1) Environment variables:
//      SUPABASE_URL
//      SUPABASE_SERVICE_ROLE_KEY
//      SAMSARA_API_BASE_URL      (optional, default: https://api.samsara.com)
//
// 2) Table for per-org Samsara tokens:
//      public.samsara_org_connections
//        - org_id               uuid PRIMARY KEY
//        - samsara_access_token text NOT NULL
//        - enabled              boolean NOT NULL DEFAULT true
//        - use_sandbox          boolean NOT NULL DEFAULT true
//
// 3) Tables from previous migration exist:
//      public.samsara_vehicles
//      public.samsara_vehicle_locations_current
//
// 4) Samsara Telematics / Locations API:
//    We assume a structure along the lines of their telematics endpoints
//    where each record includes:
//      - id / vehicleId (or assetId)
//      - latitude, longitude
//      - heading, speed, odometer
//      - time or updatedAt
//    Different Samsara endpoints expose different shapes; we keep the
//    entire record in raw_json so we’re future-proof.
//
//    Example endpoint (conceptual):
//      GET /fleet/vehicles/stats or /fleet/vehicles/locations
//      → [{ id, vehicleId, latitude, longitude, heading, speedMph, ... }]
//
//    If your actual Samsara endpoint name differs, you can update the
//    URL path and field mapping in fetchSamsaraLocationsForOrg() and
//    mapLocationToRow() below.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Default to production host; sandbox is typically the same host with different org context.
const SAMSARA_API_BASE_URL =
  Deno.env.get("SAMSARA_API_BASE_URL") || "https://api.samsara.com";

// Supabase admin client (service-role, server-side only).
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

// Type representing an org's Samsara connection row.
interface SamsaraOrgConnection {
  org_id: string;
  samsara_access_token: string;
  enabled: boolean;
  use_sandbox: boolean | null;
}

// We keep this loose because Samsara's exact schema can vary by endpoint.
interface SamsaraLocationRecord {
  id?: string | number; // This might be the vehicle id itself in some APIs.
  vehicleId?: string | number;
  assetId?: string | number;

  latitude?: number | null;
  longitude?: number | null;

  headingDegrees?: number | null;
  speedMph?: number | null;
  odometerMiles?: number | null;
  ignitionOn?: boolean | null;

  time?: string | number | null; // timestamp
  updatedAt?: string | number | null; // alternative timestamp

  // Catch-all: there may be many more fields.
  [key: string]: unknown;
}

/**
 * Utility: pick the best vehicle identifier from a location record.
 * We try vehicleId, then assetId, then id.
 */
function getVehicleIdFromLocation(rec: SamsaraLocationRecord): string | null {
  if (rec.vehicleId != null) {
    return String(rec.vehicleId);
  }
  if (rec.assetId != null) {
    return String(rec.assetId);
  }
  if (rec.id != null) {
    return String(rec.id);
  }
  return null;
}

/**
 * Utility: parse a timestamp field into an ISO string.
 * Accepts a string or number; returns null if invalid.
 */
function parseTimestamp(value: unknown): string | null {
  if (value == null) return null;

  // Sometimes APIs use ms since epoch; sometimes iso strings.
  if (typeof value === "number") {
    const dt = new Date(value);
    if (!isNaN(dt.getTime())) {
      return dt.toISOString();
    }
  } else if (typeof value === "string") {
    // Try as ISO or numeric string.
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && asNum > 0) {
      const dt = new Date(asNum);
      if (!isNaN(dt.getTime())) {
        return dt.toISOString();
      }
    } else {
      const dt = new Date(value);
      if (!isNaN(dt.getTime())) {
        return dt.toISOString();
      }
    }
  }

  return null;
}

/**
 * Fetch latest Samsara location / telematics data for the given org token.
 *
 * NOTE:
 * - This uses a "generic" path /fleet/vehicles/stats as a stand-in telematics endpoint.
 * - If your Samsara account uses a different endpoint for location snapshots, update:
 *      const url = new URL("/fleet/vehicles/stats", SAMSARA_API_BASE_URL);
 *   and adjust mapping logic in mapLocationToRow() accordingly.
 */
async function fetchSamsaraLocationsForOrg(
  accessToken: string,
): Promise<SamsaraLocationRecord[]> {
  const all: SamsaraLocationRecord[] = [];
  let after: string | undefined;

  while (true) {
    // Adjust path if your Samsara integration uses a different telematics endpoint.
    const url = new URL("/fleet/vehicles/stats", SAMSARA_API_BASE_URL);
    url.searchParams.set("types", "location"); // ask for location stats
    url.searchParams.set("limit", "512");
    if (after) {
      url.searchParams.set("after", after);
    }

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `[Samsara] Failed to fetch vehicle locations: HTTP ${resp.status} ${resp.statusText} ${text}`,
      );
    }

    const json = await resp.json() as {
      data?: SamsaraLocationRecord[] | null;
      pagination?: { endCursor?: string | null; hasNextPage?: boolean | null } | null;
    };

    const pageData = json.data ?? [];
    if (Array.isArray(pageData)) {
      all.push(...pageData);
    }

    const pagination = json.pagination ?? undefined;
    const hasNext =
      pagination?.hasNextPage === true && !!pagination?.endCursor;

    if (hasNext) {
      after = pagination!.endCursor || undefined;
    } else {
      break;
    }
  }

  return all;
}

/**
 * Map a Samsara location record into our samsara_vehicle_locations_current row.
 * We keep raw_json for future-proofing.
 */
function mapLocationToRow(
  orgId: string,
  rec: SamsaraLocationRecord,
): Record<string, unknown> | null {
  const samsaraVehicleId = getVehicleIdFromLocation(rec);
  if (!samsaraVehicleId) {
    // If we can't tie it to a vehicle, we skip.
    return null;
  }

  const lat = rec.latitude ?? null;
  const lon = rec.longitude ?? null;

  if (lat == null || lon == null) {
    // No usable GPS coordinates, skip this record.
    return null;
  }

  const locatedAt =
    parseTimestamp(rec.time) ||
    parseTimestamp(rec.updatedAt) ||
    new Date().toISOString();

  const nowIso = new Date().toISOString();

  return {
    org_id: orgId,
    samsara_vehicle_id: samsaraVehicleId,
    latitude: lat,
    longitude: lon,
    heading_degrees: rec.headingDegrees ?? null,
    speed_mph: rec.speedMph ?? null,
    odometer_miles: rec.odometerMiles ?? null,
    ignition_on: rec.ignitionOn ?? null,
    located_at: locatedAt,
    last_synced_at: nowIso,
    raw_json: rec,
  };
}

/**
 * Sync locations for a single org connection.
 * Returns a summary for the HTTP response.
 */
async function syncLocationsForOrg(
  conn: SamsaraOrgConnection,
): Promise<{ org_id: string; synced: number; skipped: number; error?: string }> {
  const orgId = conn.org_id;

  try {
    const records = await fetchSamsaraLocationsForOrg(conn.samsara_access_token);

    const rows: Record<string, unknown>[] = [];
    let skipped = 0;

    for (const rec of records) {
      const row = mapLocationToRow(orgId, rec);
      if (row) {
        rows.push(row);
      } else {
        skipped += 1;
      }
    }

    if (rows.length === 0) {
      return { org_id: orgId, synced: 0, skipped };
    }

    const { error: upsertError } = await supabaseAdmin
      .from("samsara_vehicle_locations_current")
      .upsert(rows, {
        onConflict: "org_id,samsara_vehicle_id",
      });

    if (upsertError) {
      console.error(
        "[samsara-sync-locations] Upsert error for org",
        orgId,
        upsertError,
      );
      return {
        org_id: orgId,
        synced: 0,
        skipped,
        error: `Upsert error: ${upsertError.message}`,
      };
    }

    return { org_id: orgId, synced: rows.length, skipped };
  } catch (err) {
    console.error(
      "[samsara-sync-locations] Sync error for org",
      orgId,
      err,
    );
    return {
      org_id: orgId,
      synced: 0,
      skipped: 0,
      error: (err as Error).message ?? String(err),
    };
  }
}

/**
 * HTTP handler.
 *
 * Request:
 *   - Method: POST
 *   - Optional JSON body:
 *       { "org_id": "uuid" }
 *
 * Behavior:
 *   - If org_id provided → sync only that org.
 *   - Else → sync all enabled orgs from samsara_org_connections.
 */
serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  let body: { org_id?: string } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = (await req.json()) as { org_id?: string };
    }
  } catch {
    body = {};
  }

  const targetOrgId = body.org_id;

  // Load the Samsara connections for this org or all enabled orgs.
  let query = supabaseAdmin
    .from("samsara_org_connections")
    .select("org_id, samsara_access_token, enabled, use_sandbox")
    .eq("enabled", true);

  if (targetOrgId) {
    query = query.eq("org_id", targetOrgId);
  }

  const { data: connections, error: connectionsError } = await query;

  if (connectionsError) {
    console.error(
      "[samsara-sync-locations] Failed to load samsara_org_connections:",
      connectionsError,
    );
    return new Response(
      JSON.stringify({
        error: "Failed to load Samsara org connections.",
        details: connectionsError.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!connections || connections.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "No enabled Samsara org connections found.",
        org_id: targetOrgId ?? null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const results: {
    org_id: string;
    synced: number;
    skipped: number;
    error?: string;
  }[] = [];

  // Run sequentially for clearer logging + to reduce risk of rate limits.
  for (const c of connections as SamsaraOrgConnection[]) {
    const res = await syncLocationsForOrg(c);
    results.push(res);
  }

  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
  const errors = results.filter((r) => r.error);

  const statusCode = errors.length > 0 && totalSynced === 0 ? 502 : 200;

  return new Response(
    JSON.stringify(
      {
        ok: errors.length === 0,
        total_orgs: results.length,
        total_synced: totalSynced,
        total_skipped: totalSkipped,
        results,
      },
      null,
      2,
    ),
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    },
  );
});
