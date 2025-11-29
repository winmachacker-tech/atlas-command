// FILE: supabase/functions/samsara-sync-vehicles/index.ts
//
// Purpose (plain English):
// ------------------------
// - This Edge Function syncs Samsara vehicles into your Atlas Command database.
// - It is meant to be called from:
//     • Supabase Scheduled Functions (cron)  ✅ (later step)
//     • Or manually from the dashboard / admin tools (via POST).
// - For each org that has a Samsara token stored, it will:
//     1) Call Samsara's "List all vehicles" API for that org.
//     2) Normalize the data.
//     3) Upsert rows into public.samsara_vehicles (org-scoped, RLS-protected).
//
// Security:
// ---------
// - Uses ONLY the Supabase service-role key (server-side env).
// - Never exposes the service-role key or Samsara tokens in responses.
// - public.samsara_vehicles remains RLS-protected by org_id + current_org_id().
// - Writes bypass RLS as intended, because this runs on the server with service-role.
//
// Assumptions / Requirements:
// ---------------------------
// 1) Environment variables (set in Supabase project / functions config):
//      SUPABASE_URL
//      SUPABASE_SERVICE_ROLE_KEY
//      SAMSARA_API_BASE_URL        (optional, defaults to https://api.samsara.com)
//
// 2) A credentials table to store per-org Samsara tokens, e.g.:
//
//      public.samsara_org_connections (recommended shape)
//      --------------------------------------------------
//      org_id               uuid PRIMARY KEY
//      samsara_access_token text NOT NULL
//      enabled              boolean NOT NULL DEFAULT true
//      use_sandbox          boolean NOT NULL DEFAULT true
//      created_at           timestamptz DEFAULT now()
//      updated_at           timestamptz DEFAULT now()
//
//    This table should be RLS-protected by org and only writable from
//    secure admin paths or Edge Functions. We will create a proper
//    migration for this table in a later step if you want.
//
// 3) The samsara_vehicles table from the previous migration exists.
//
// Samsara API reference:
// ----------------------
// - List all vehicles: GET /fleet/vehicles  (Bearer <token>)
//   Returns a paginated response:
//     {
//       "data": [ { ...vehicle... }, ... ],
//       "pagination": { "endCursor": "abcd", "hasNextPage": true/false }
//     }
//
//   Docs (vehicles + integration guide) show structure including:
//     id, name, licensePlate, vin, externalIds, ... :contentReference[oaicite:0]{index=0}

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// You can override this for sandbox if Samsara ever changes host.
// For now, sandbox orgs also use https://api.samsara.com with different org context.
const SAMSARA_API_BASE_URL =
  Deno.env.get("SAMSARA_API_BASE_URL") || "https://api.samsara.com";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[samsara-sync-vehicles] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.",
  );
}

// Supabase admin client (service-role).
// NOTE: This runs ONLY on the server (Edge Function), never in the browser.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

// Types for clarity (not strict DB types, just for this function).
interface SamsaraOrgConnection {
  org_id: string;
  samsara_access_token: string;
  enabled: boolean;
  use_sandbox: boolean | null;
}

interface SamsaraVehicleApiRecord {
  id: string | number;
  name?: string | null;
  licensePlate?: string | null;
  licensePlateState?: string | null;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  modelYear?: number | null;
  isActive?: boolean | null;
  externalIds?: Record<string, unknown> | null;
  // Many more fields may exist; we keep them in raw_json.
  [key: string]: unknown;
}

interface SamsaraVehiclePage {
  data?: SamsaraVehicleApiRecord[] | null;
  pagination?: {
    endCursor?: string | null;
    hasNextPage?: boolean | null;
  } | null;
}

/**
 * Fetch all Samsara vehicles for a given token, handling pagination.
 */
async function fetchAllSamsaraVehicles(
  accessToken: string,
): Promise<SamsaraVehicleApiRecord[]> {
  const all: SamsaraVehicleApiRecord[] = [];
  let after: string | undefined;

  while (true) {
    const url = new URL("/fleet/vehicles", SAMSARA_API_BASE_URL);
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
        `[Samsara] Failed to list vehicles: HTTP ${resp.status} ${resp.statusText} ${text}`,
      );
    }

    const json = (await resp.json()) as SamsaraVehiclePage;

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
 * Map a Samsara vehicle record into our samsara_vehicles row shape.
 * We deliberately keep raw_json for debugging and future expansion.
 */
function mapVehicleToRow(
  orgId: string,
  v: SamsaraVehicleApiRecord,
): Record<string, unknown> {
  const nowIso = new Date().toISOString();

  // Try to get a stable external ID if present.
  let externalId: string | null = null;
  if (v.externalIds && typeof v.externalIds === "object") {
    // Samsara often stores them as { key: "value", ... }.
    const values = Object.values(v.externalIds);
    if (values.length > 0 && typeof values[0] === "string") {
      externalId = values[0] as string;
    }
  }

  // Some Samsara responses may include an updatedAt field; we simply try to read it.
  let samsaraUpdatedAt: string | null = null;
  if (v["updatedAt"]) {
    try {
      const asStr = String(v["updatedAt"]);
      const dt = new Date(asStr);
      if (!isNaN(dt.getTime())) {
        samsaraUpdatedAt = dt.toISOString();
      }
    } catch {
      // ignore parsing issues; keep null
    }
  }

  return {
    org_id: orgId,
    samsara_vehicle_id: String(v.id),
    external_id: externalId,
    name: v.name ?? null,
    license_plate: v.licensePlate ?? null,
    license_plate_state: v.licensePlateState ?? null,
    vin: v.vin ?? null,
    make: v.make ?? null,
    model: v.model ?? null,
    model_year: v.modelYear ?? null,
    is_active: v.isActive ?? null,
    status: v["status"] ?? null, // may or may not exist; harmless if null
    last_synced_at: nowIso,
    samsara_updated_at: samsaraUpdatedAt,
    raw_json: v,
  };
}

/**
 * Sync vehicles for a single org connection.
 * Returns a small summary used in the HTTP response.
 */
async function syncVehiclesForOrg(
  conn: SamsaraOrgConnection,
): Promise<{ org_id: string; synced: number; error?: string }> {
  const orgId = conn.org_id;

  try {
    const vehicles = await fetchAllSamsaraVehicles(conn.samsara_access_token);
    const rows = vehicles.map((v) => mapVehicleToRow(orgId, v));

    if (rows.length === 0) {
      // No vehicles for this org; nothing to upsert.
      return { org_id: orgId, synced: 0 };
    }

    const { error: upsertError } = await supabaseAdmin
      .from("samsara_vehicles")
      .upsert(rows, {
        onConflict: "org_id,samsara_vehicle_id",
      });

    if (upsertError) {
      console.error(
        "[samsara-sync-vehicles] Upsert error for org",
        orgId,
        upsertError,
      );
      return {
        org_id: orgId,
        synced: 0,
        error: `Upsert error: ${upsertError.message}`,
      };
    }

    return { org_id: orgId, synced: rows.length };
  } catch (err) {
    console.error(
      "[samsara-sync-vehicles] Sync error for org",
      orgId,
      err,
    );
    return {
      org_id: orgId,
      synced: 0,
      error: (err as Error).message ?? String(err),
    };
  }
}

/**
 * Main HTTP handler.
 *
 * Request:
 * --------
 * - Method: POST
 * - Optional JSON body:
 *     {
 *       "org_id": "uuid"   // if provided, sync ONLY this org
 *     }
 *
 * Behavior:
 * ---------
 * - If org_id is provided:
 *     -> Look up that single org's Samsara token and sync just that org.
 * - If no org_id:
 *     -> Fetch ALL enabled org connections and sync them one by one.
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
    // If parsing fails, just treat as empty.
    body = {};
  }

  const targetOrgId = body.org_id;

  // Build query for samsara_org_connections.
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
      "[samsara-sync-vehicles] Failed to load samsara_org_connections:",
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

  // Run sync sequentially per org to keep logs simple and avoid hitting rate limits.
  const results: { org_id: string; synced: number; error?: string }[] = [];
  for (const c of connections as SamsaraOrgConnection[]) {
    const res = await syncVehiclesForOrg(c);
    results.push(res);
  }

  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const errors = results.filter((r) => r.error);

  const statusCode = errors.length > 0 && totalSynced === 0 ? 502 : 200;

  return new Response(
    JSON.stringify(
      {
        ok: errors.length === 0,
        total_orgs: results.length,
        total_synced: totalSynced,
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
