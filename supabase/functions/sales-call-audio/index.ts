// FILE: supabase/functions/sales-call-audio/index.ts
// Purpose:
//   Securely proxy Twilio recordings → Atlas UI without exposing Twilio
//   credentials or any shared token to the browser.
//
// Call pattern (from frontend):
//   POST /functions/v1/sales-call-audio
//   Headers:
//     Authorization: Bearer <Supabase access token>
//     apikey: <anon key>
//     Content-Type: application/json
//   Body:
//     { "recording_sid": "RExxxxxxxxxxxxxxxxxxxx" }
//
// Edge Function:
//   - Requires a valid Supabase JWT (verify_jwt = true by default)
//   - Reads recording_sid from JSON body
//   - Fetches the audio from Twilio using BASIC auth
//   - Returns raw audio bytes (audio/mpeg)
//
// Required ENV:
//   - TWILIO_ACCOUNT_SID
//   - TWILIO_AUTH_TOKEN
//
// Notes:
//   • We do NOT use SALES_CALL_AUDIO_TOKEN anymore.
//   • We do NOT expose TWILIO_* secrets to the client.
//   • RLS on sales_calls prevents users from ever seeing SIDs that
//     don't belong to their org.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const recordingSid = body?.recording_sid as string | undefined;

    if (!recordingSid || typeof recordingSid !== "string") {
      return new Response(
        JSON.stringify({ error: "recording_sid is required" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    // Build Twilio Recording URL (we force .mp3)
    const twilioUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;

    // Basic auth header for Twilio
    const basicAuth =
      "Basic " + btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`);

    const twilioResponse = await fetch(twilioUrl, {
      headers: {
        Authorization: basicAuth,
      },
    });

    if (!twilioResponse.ok) {
      console.error(
        "[sales-call-audio] Twilio fetch error:",
        twilioResponse.status,
      );
      return new Response(
        JSON.stringify({
          error: "Twilio fetch failed",
          status: twilioResponse.status,
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const audioBytes = await twilioResponse.arrayBuffer();

    return new Response(audioBytes, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error("[sales-call-audio] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }
});
