import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EIADataPoint {
  period: string;
  value: number;
}

interface EIAResponse {
  response: {
    data: EIADataPoint[];
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("Starting EIA diesel price fetch...");

    // Get EIA API key from environment
    const EIA_API_KEY = Deno.env.get("EIA_API_KEY");
    if (!EIA_API_KEY) {
      throw new Error("EIA_API_KEY not found in environment variables");
    }

    // Construct EIA API URL for latest diesel price
    const eiaUrl = new URL("https://api.eia.gov/v2/petroleum/pri/gnd/data");
    eiaUrl.searchParams.append("api_key", EIA_API_KEY);
    eiaUrl.searchParams.append("data[0]", "value");
    eiaUrl.searchParams.append("facets[product][]", "EPD2D"); // No. 2 Diesel Retail Prices
    eiaUrl.searchParams.append("frequency", "weekly");
    eiaUrl.searchParams.append("sort[0][column]", "period");
    eiaUrl.searchParams.append("sort[0][direction]", "desc");
    eiaUrl.searchParams.append("offset", "0");
    eiaUrl.searchParams.append("length", "1");

    console.log("Fetching from EIA API...");
    
    // Fetch from EIA API
    const eiaResponse = await fetch(eiaUrl.toString());
    if (!eiaResponse.ok) {
      throw new Error(`EIA API error: ${eiaResponse.status} ${eiaResponse.statusText}`);
    }

    const eiaData: EIAResponse = await eiaResponse.json();
    console.log("EIA API response:", JSON.stringify(eiaData, null, 2));

    // Extract the latest price
    if (!eiaData.response?.data || eiaData.response.data.length === 0) {
      throw new Error("No data returned from EIA API");
    }

    const latestData = eiaData.response.data[0];
    const pricePerGallon = latestData.value;
    const effectiveDate = latestData.period; // Format: YYYY-MM-DD

    console.log(`Latest diesel price: $${pricePerGallon}/gal on ${effectiveDate}`);

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if this price already exists
    const { data: existingPrice } = await supabase
      .from("fuel_prices")
      .select("id")
      .eq("effective_date", effectiveDate)
      .eq("region", "US_NATIONAL")
      .single();

    if (existingPrice) {
      console.log("Price for this date already exists, skipping insert");
      return new Response(
        JSON.stringify({
          success: true,
          message: "Price already exists for this date",
          price: pricePerGallon,
          effectiveDate: effectiveDate,
          alreadyExists: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Insert the new price into fuel_prices table
    const { data: insertedPrice, error: insertError } = await supabase
      .from("fuel_prices")
      .insert({
        price_per_gallon: pricePerGallon,
        effective_date: effectiveDate,
        region: "US_NATIONAL",
        source: "EIA",
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Database insert error: ${insertError.message}`);
    }

    console.log("Successfully inserted new fuel price:", insertedPrice);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Diesel price updated successfully",
        price: pricePerGallon,
        effectiveDate: effectiveDate,
        data: insertedPrice,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching diesel price:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});