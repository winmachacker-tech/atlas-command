// FILE: supabase/functions/samsara-sync-cron/index.ts
//
// Purpose (plain English):
// ------------------------
// - This Edge Function is the **orchestrator** for your Samsara sync.
// - It is what Supabase Scheduled Functions (cron) will call every 5 minutes.
// - When it runs, it:
//
//     1) Calls samsara-sync-vehicles      → updates public.samsara_vehicles
//     2) Calls samsara-sync-locations     → updates public.samsara_vehicle_locations_current
//
// - It does NOT talk to Samsara directly. Instead, it reuses the two
//   dedicated sync functions you already have:
//
//      supabase/functions/samsara-sync-vehicles/index.ts
//      supabase/functions/samsara-sync-locations/index.ts
//
// Security:
// ---------
// - Uses ONLY SUPABASE_SERVICE_ROLE_KEY on the server.
// - Calls the other Edge Functions via supabase-js .functions.invoke().
// - No secrets are returned to the client (this function is meant for cron).
//
// How this fits into your rules:
// ------------------------------
// - All backend logic is in Edge Functions.
// - This function uses the **service-role** key (server only).
// - Multi-tenant org separation is still enforced in DB via RLS + current_org_id().
// - We do NOT touch or weaken any RLS / auth / org boundaries.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Admin client using service-role.
// This is ONLY used on the server, never in the browser.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

type SyncResult = {
  ok: boolean;
  total_orgs?: number;
  total_synced?: number;
  total_skipped?: number;
  results?: unknown;
  error?: string;
};

async function invokeSyncFunction(
  name: string,
  body: Record<string, unknown> = {},
): Promise<SyncResult> {
  // We use supabase.functions.invoke so we don't need to hand-build URLs.
  const { data, error } = await supabaseAdmin.functions.invoke(name, {
    body,
  });

  if (error) {
    console.error(`[samsara-sync-cron] Error invoking ${name}:`, error);
    return {
      ok: false,
      error: error.message ?? `Failed to invoke ${name}`,
    };
  }

  // data is whatever the child function returned as JSON.
  // We keep it loosely typed, just pass it back in the response.
  if (data && typeof data === "object") {
    return { ok: true, ...(data as Record<string, unknown>) } as SyncResult;
  }

  return { ok: true };
}

serve(async (req: Request): Promise<Response> => {
  // We keep this function POST-only for safety and clarity.
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed. Use POST.",
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[samsara-sync-cron] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.",
    );
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
    // If parse fails, just use empty body → all orgs.
    body = {};
  }

  const targetOrgId = body.org_id;

  console.log(
    "[samsara-sync-cron] Starting cron run for",
    targetOrgId ? `org_id=${targetOrgId}` : "ALL orgs",
  );

  // 1) Sync vehicles
  const vehiclesResult = await invokeSyncFunction(
    "samsara-sync-vehicles",
    targetOrgId ? { org_id: targetOrgId } : {},
  );

  // 2) Sync locations
  const locationsResult = await invokeSyncFunction(
    "samsara-sync-locations",
    targetOrgId ? { org_id: targetOrgId } : {},
  );

  const ok = vehiclesResult.ok && locationsResult.ok;
  const statusCode = ok ? 200 : 502;

  const responsePayload = {
    ok,
    message: "Samsara cron sync completed.",
    // Optional: small summary pulled from the two child results.
    vehicles: vehiclesResult,
    locations: locationsResult,
  };

  console.log("[samsara-sync-cron] Finished cron run:", responsePayload);

  return new Response(JSON.stringify(responsePayload, null, 2), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
});
