// FILE: supabase/functions/geo-reverse/index.ts
//
// Purpose:
// Tiny reverse-geocoding Edge Function for Atlas Command.
// Takes lat/lng and returns a human-friendly place description plus
// helpful metadata (nearest city, state, country, road, distance, bearing).
//
// Input (POST JSON):
//   { "lat": 38.58, "lng": -120.90 }
//
// Output (JSON):
//   {
//     "ok": true,
//     "lat": 38.58,
//     "lng": -120.9,
//     "center_lat": 38.58123,
//     "center_lng": -120.90123,
//     "formatted": "Latrobe, California, United States of America",
//     "city": "Latrobe",
//     "state": "California",
//     "state_code": "CA",
//     "county": "El Dorado County",
//     "country": "United States of America",
//     "country_code": "US",
//     "road": "Latrobe Rd",
//     "distance_m": 1325.4,
//     "distance_miles": 0.82,
//     "bearing_deg": 37.4,
//     "bearing_cardinal": "NE"
//   }
//
// Notes:
// - This function is called server-to-server from other Edge Functions
//   (like dipsy-text) using the Supabase service role key in headers.
// - You can also call it directly from the browser if you want; CORS is open
//   but you should NOT expose your OpenCage key client-side.

// ----------------- Imports & Types -----------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Json = Record<string, unknown>;

// ----------------- Env & Basic Helpers -----------------

const OPENCAGE_API_KEY = Deno.env.get("OPENCAGE_API_KEY") ?? "";

if (!OPENCAGE_API_KEY) {
  console.error("[geo-reverse] Missing OPENCAGE_API_KEY env var");
}

// Standard CORS headers so other services (and optionally the browser)
// can call this function safely.
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper: JSON response with CORS
function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Geo math helpers
const EARTH_RADIUS_M = 6371000; // meters

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Bearing from point A to B in degrees (0–360, 0 = north)
function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);

  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);

  const brngRad = Math.atan2(y, x);
  const brngDeg = (brngRad * 180) / Math.PI;
  return (brngDeg + 360) % 360;
}

// Cardinal direction string from bearing degrees
function bearingToCardinal(bearing: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round((bearing % 360) / 45) % 8;
  return dirs[index];
}

// ----------------- Core Reverse Geocode Logic -----------------

async function reverseGeocode(
  lat: number,
  lng: number
): Promise<Json & { ok: boolean }> {
  if (!OPENCAGE_API_KEY) {
    return {
      ok: false,
      error: "Missing OPENCAGE_API_KEY env var.",
    };
  }

  const q = `${lat},${lng}`;

  const url = new URL("https://api.opencagedata.com/geocode/v1/json");
  url.searchParams.set("q", q);
  url.searchParams.set("key", OPENCAGE_API_KEY);
  url.searchParams.set("limit", "1");
  url.searchParams.set("pretty", "0");
  url.searchParams.set("abbrv", "1");
  // We want annotations so we can pick up roadinfo, etc.
  // (no_annotations=1 would turn most of this off)
  // url.searchParams.set("no_annotations", "1");

  const res = await fetch(url.toString(), {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[geo-reverse] OpenCage HTTP error", res.status, text);
    return {
      ok: false,
      error: `OpenCage HTTP error: ${res.status}`,
    };
  }

  const data: any = await res.json();

  if (!data || !Array.isArray(data.results) || data.results.length === 0) {
    console.warn("[geo-reverse] No results from OpenCage", { q });
    return {
      ok: false,
      error: "No reverse geocode results for these coordinates.",
    };
  }

  const result = data.results[0];
  const components = (result.components ?? {}) as Record<string, unknown>;
  const annotations = (result.annotations ?? {}) as Record<string, unknown>;
  const geometry = (result.geometry ?? {}) as {
    lat?: number;
    lng?: number;
  };

  const centerLat = typeof geometry.lat === "number" ? geometry.lat : lat;
  const centerLng = typeof geometry.lng === "number" ? geometry.lng : lng;

  // City-like name: city, town, village, hamlet, suburb, neighbourhood…
  const cityLike =
    (components.city as string | undefined) ??
    (components.town as string | undefined) ??
    (components.village as string | undefined) ??
    (components.hamlet as string | undefined) ??
    (components.suburb as string | undefined) ??
    (components.neighbourhood as string | undefined) ??
    null;

  const county =
    (components.county as string | undefined) ??
    (components["state_district"] as string | undefined) ??
    null;

  const state = (components.state as string | undefined) ?? null;
  const stateCode =
    (components["ISO_3166-2_lvl4"] as string | undefined) ??
    (components["ISO_3166-2_lvl3"] as string | undefined) ??
    null;

  const country = (components.country as string | undefined) ?? null;
  const countryCode =
    (components.country_code as string | undefined)?.toUpperCase() ?? null;

  // Road / highway name – try components.road first, then roadinfo.road
  const roadinfo = (annotations["roadinfo"] ??
    {}) as Record<string, unknown>;
  const road =
    (components.road as string | undefined) ??
    (roadinfo.road as string | undefined) ??
    null;

  const formatted = (result.formatted as string | undefined) ?? null;

  // Distances & bearings between *exact* query and result center
  const distanceM = haversineDistanceMeters(lat, lng, centerLat, centerLng);
  const distanceMiles = distanceM / 1609.344;

  const bearingDeg = bearingDegrees(lat, lng, centerLat, centerLng);
  const bearingCardinal = bearingToCardinal(bearingDeg);

  return {
    ok: true,
    lat,
    lng,
    center_lat: centerLat,
    center_lng: centerLng,
    formatted,
    city: cityLike,
    state,
    state_code: stateCode,
    county,
    country,
    country_code: countryCode,
    road,
    distance_m: distanceM,
    distance_miles: distanceMiles,
    bearing_deg: bearingDeg,
    bearing_cardinal: bearingCardinal,
  };
}

// ----------------- HTTP Handler -----------------

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method not allowed. Use POST." },
      405
    );
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { ok: false, error: "Invalid JSON body. Expected { lat, lng }." },
        400
      );
    }

    const latRaw = body?.lat;
    const lngRaw = body?.lng;

    const lat = typeof latRaw === "number" ? latRaw : Number(latRaw);
    const lng = typeof lngRaw === "number" ? lngRaw : Number(lngRaw);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Invalid or missing lat/lng. Provide numbers like { \"lat\": 38.58, \"lng\": -120.90 }.",
        },
        400
      );
    }

    const result = await reverseGeocode(lat, lng);
    const status = result.ok ? 200 : 502;
    return jsonResponse(result, status);
  } catch (err: any) {
    console.error("[geo-reverse] Error:", err?.message || err);
    return jsonResponse(
      { ok: false, error: "Internal error in geo-reverse." },
      500
    );
  }
});
