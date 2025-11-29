// FILE: supabase/functions/motive-sync/index.ts
//
// Purpose (plain English):
// ------------------------
// This Edge Function is the SAFE bridge between Atlas Command and Motive.
//
// - Atlas (frontend) calls this function with a small JSON body like:
//     { "resource": "vehicle_locations" }
// - The function:
//
//   1) Looks up your Motive sandbox access token from environment variables.
//   2) Calls the correct Motive API endpoint (read-only).
//   3) Returns the JSON data to Atlas.
//
// Supported resources (V1):
//   - "vehicle_locations"  -> GET /v2/vehicle_locations
//   - "driver_locations"   -> GET /v1/driver_locations
//   - "available_time"     -> GET /v1/available_time
//   - "hos_violations"     -> GET /v1/hos_violations
//
// SECURITY:
// ---------
// - Motive access token is read from Deno.env (MOTIVE_SANDBOX_ACCESS_TOKEN).
// - No secrets are ever exposed to the browser.
// - Function is READ-ONLY: only calls Motive GET endpoints.
// - This file does NOT modify your Supabase schema or RLS rules.
//
// HOW TO CALL FROM FRONTEND (later):
// ----------------------------------
//   const { data, error } = await supabase.functions.invoke("motive-sync", {
//     body: { resource: "vehicle_locations" },
//   });
//
//   if (error) { /* show error */ }
//   else { console.log(data.data); /* Motive payload */ }
//
// CORS:
// -----
// - Allows POST from your frontend origin (or * in dev).
//
// Runtime: Supabase Edge Functions (Deno)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type MotiveResource =
  | "vehicle_locations"
  | "driver_locations"
  | "available_time"
  | "hos_violations";

interface MotiveSyncRequest {
  resource: MotiveResource;
  // Optional: extra query parameters to pass directly to Motive.
  // Example: { id: "1234" }
  params?: Record<string, string | number | boolean | null | undefined>;
}

// Map our simple resource names to Motive endpoints.
// Docs:
//   - v2/vehicle_locations   -> vehicles with locations, drivers, etc.
//   - v1/driver_locations    -> drivers with current vehicle + location.
//   - v1/available_time      -> drivers with available HOS time.
//   - v1/hos_violations      -> drivers with HOS violations.
const ENDPOINTS: Record<MotiveResource, string> = {
  vehicle_locations: "/v2/vehicle_locations",
  driver_locations: "/v1/driver_locations",
  available_time: "/v1/available_time",
  hos_violations: "/v1/hos_violations",
};

const DEFAULT_API_BASE = "https://api.gomotive.com";

// ---- CORS Helpers ----------------------------------------------------------

const ALLOWED_ORIGIN = "*"; // You can tighten this later for prod.

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

// Build query string from params object (simple, safe).
function buildQuery(params?: MotiveSyncRequest["params"]): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null,
  );
  if (entries.length === 0) return "";
  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    search.append(key, String(value));
  }
  return `?${search.toString()}`;
}

// ---- Main handler ----------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        ...corsHeaders(),
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(),
        },
      },
    );
  }

  try {
    const apiBase = Deno.env.get("MOTIVE_API_BASE") ?? DEFAULT_API_BASE;
    const accessToken = Deno.env.get("MOTIVE_SANDBOX_ACCESS_TOKEN");

    if (!accessToken) {
      return new Response(
        JSON.stringify({
          error: "Motive sandbox token is not configured",
          hint:
            "Set MOTIVE_SANDBOX_ACCESS_TOKEN in Supabase Edge Function secrets.",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        },
      );
    }

    let bodyJson: MotiveSyncRequest;

    try {
      bodyJson = (await req.json()) as MotiveSyncRequest;
    } catch {
      return new Response(
        JSON.stringify({
          error: "Invalid JSON body",
          expected_example: {
            resource: "vehicle_locations",
            params: { /* optional query params */ },
          },
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        },
      );
    }

    const { resource, params } = bodyJson;

    if (!resource || !(resource in ENDPOINTS)) {
      return new Response(
        JSON.stringify({
          error: "Invalid or missing 'resource'.",
          allowed_resources: Object.keys(ENDPOINTS),
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        },
      );
    }

    const endpoint = ENDPOINTS[resource];
    const query = buildQuery(params);
    const url = `${apiBase}${endpoint}${query}`;

    const motiveResp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const text = await motiveResp.text();
    let motiveData: unknown = text;

    // Try to parse JSON; if it fails, return raw text.
    try {
      motiveData = JSON.parse(text);
    } catch {
      // ignore JSON parse error; leave motiveData as text
    }

    if (!motiveResp.ok) {
      return new Response(
        JSON.stringify({
          error: "Failed to fetch from Motive API",
          status: motiveResp.status,
          statusText: motiveResp.statusText,
          url,
          motive_response: motiveData,
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        resource,
        url,
        motive_status: motiveResp.status,
        data: motiveData,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(),
        },
      },
    );
  } catch (err) {
    console.error("[motive-sync] Unhandled error:", err);
    return new Response(
      JSON.stringify({
        error: "Unhandled error in motive-sync function",
        message: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(),
        },
      },
    );
  }
});
