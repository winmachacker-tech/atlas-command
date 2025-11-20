// FILE: supabase/functions/calculate-miles/index.ts
// Purpose: Calculate driving distance between origin and destination using Google Maps Directions API
// Called by: AddLoadModal's "Calculate Miles" button

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CalculateMilesRequest {
  origin: string;
  destination: string;
}

interface GoogleMapsDirectionsResponse {
  routes?: Array<{
    legs?: Array<{
      distance?: {
        text: string;
        value: number; // meters
      };
    }>;
  }>;
  status: string;
  error_message?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[calculate-miles] Request received");

    // Get environment variables
    const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!GOOGLE_MAPS_API_KEY) {
      throw new Error("GOOGLE_MAPS_API_KEY not configured");
    }

    // Parse request body
    const { origin, destination }: CalculateMilesRequest = await req.json();

    if (!origin || !destination) {
      return new Response(
        JSON.stringify({ error: "Origin and destination are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[calculate-miles] Calculating route:", { origin, destination });

    // Call Google Maps Directions API
    const mapsUrl = new URL("https://maps.googleapis.com/maps/api/directions/json");
    mapsUrl.searchParams.append("origin", origin);
    mapsUrl.searchParams.append("destination", destination);
    mapsUrl.searchParams.append("key", GOOGLE_MAPS_API_KEY);

    const mapsResponse = await fetch(mapsUrl.toString());
    const mapsData: GoogleMapsDirectionsResponse = await mapsResponse.json();

    console.log("[calculate-miles] Google Maps response status:", mapsData.status);

    // Handle Google Maps API errors
    if (mapsData.status !== "OK") {
      console.error("[calculate-miles] Google Maps error:", {
        status: mapsData.status,
        error_message: mapsData.error_message,
      });

      return new Response(
        JSON.stringify({
          error: `Unable to calculate route: ${mapsData.status}`,
          details: mapsData.error_message,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Extract distance from response
    const route = mapsData.routes?.[0];
    const leg = route?.legs?.[0];
    const distanceMeters = leg?.distance?.value;

    if (!distanceMeters) {
      throw new Error("No distance data in Google Maps response");
    }

    // Convert meters to miles (1 meter = 0.000621371 miles)
    const miles = Math.round(distanceMeters * 0.000621371);

    console.log("[calculate-miles] Calculated miles:", miles);

    return new Response(
      JSON.stringify({
        miles,
        origin,
        destination,
        raw_distance_meters: distanceMeters,
        raw_distance_text: leg?.distance?.text,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[calculate-miles] Error:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});