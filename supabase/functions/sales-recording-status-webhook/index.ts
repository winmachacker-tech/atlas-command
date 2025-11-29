// FILE: supabase/functions/sales-recording-status-webhook/index.ts
// Purpose:
// - Receive Twilio RecordingStatusCallback webhooks.
// - Securely update public.sales_calls with recording metadata:
//
//   • recording_sid
//   • recording_url
//   • recording_status
//   • recording_duration_sec
//
// Security:
// - NOT called from the browser.
// - Requires a shared token, sent as either:
//     ?token=...      (query string)
//   or
//     x-twilio-recording-token: ... (header)
// - The token must match TWILIO_RECORDING_WEBHOOK_TOKEN in Supabase env.
// - Uses SUPABASE_SERVICE_ROLE_KEY only inside this function.
//
// Expected Twilio params (form-encoded):
//   CallSid
//   RecordingSid
//   RecordingUrl
//   RecordingStatus
//   RecordingDuration
//
// We match on sales_calls.twilio_call_sid = CallSid.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders } from "../_shared/cors.ts";

// ---- Env ----

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RECORDING_TOKEN = Deno.env.get("TWILIO_RECORDING_WEBHOOK_TOKEN") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env",
  );
}

if (!RECORDING_TOKEN) {
  console.warn(
    "[sales-recording-status-webhook] WARNING: TWILIO_RECORDING_WEBHOOK_TOKEN not set. Requests will be rejected.",
  );
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- Helpers ----

function log(...args: unknown[]) {
  console.log("[sales-recording-status-webhook]", ...args);
}

function unauthorized(message: string): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized", message }),
    {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

// ---- Handler ----

serve(async (req: Request): Promise<Response> => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // ---- Auth via shared token ----
    // We accept either:
    //   • ?token=...  in the URL
    //   • x-twilio-recording-token header
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get("token") ?? "";
    const tokenFromHeader =
      req.headers.get("x-twilio-recording-token") ?? "";

    const providedToken = tokenFromQuery || tokenFromHeader;

    if (!RECORDING_TOKEN || !providedToken || providedToken !== RECORDING_TOKEN) {
      log("Unauthorized webhook", {
        hasEnvToken: !!RECORDING_TOKEN,
        hasProvidedToken: !!providedToken,
      });
      return unauthorized(
        "Missing or invalid TWILIO_RECORDING_WEBHOOK_TOKEN",
      );
    }

    // ---- Parse Twilio form body ----
    const rawBody = await req.text();
    const form = new URLSearchParams(rawBody);

    const callSid = form.get("CallSid") ?? "";
    const recordingSid = form.get("RecordingSid") ?? "";
    const recordingUrl = form.get("RecordingUrl") ?? "";
    const recordingStatus = form.get("RecordingStatus") ?? "";
    const recordingDurationStr = form.get("RecordingDuration") ?? "";

    if (!callSid) {
      log("Missing CallSid in webhook payload", { rawBody });
      return new Response(
        JSON.stringify({ error: "Missing CallSid in payload" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const recordingDurationSec = Number.parseInt(recordingDurationStr, 10);
    const duration =
      Number.isFinite(recordingDurationSec) && recordingDurationSec >= 0
        ? recordingDurationSec
        : null;

    log("Received recording webhook", {
      callSid,
      recordingSid,
      recordingStatus,
      duration,
    });

    // ---- Update sales_calls row that matches this CallSid ----
    const updatePayload: Record<string, unknown> = {
      recording_sid: recordingSid || null,
      recording_url: recordingUrl || null,
      recording_status: recordingStatus || null,
      recording_duration_sec: duration,
      // NOTE: we do NOT touch status/ended_at here; that’s handled by the
      // call status webhook / voice bridge.
    };

    const { error: updateError } = await supabaseAdmin
      .from("sales_calls")
      .update(updatePayload)
      .eq("twilio_call_sid", callSid);

    if (updateError) {
      console.error(
        "[sales-recording-status-webhook] Failed to update sales_calls:",
        updateError,
      );
      return new Response(
        JSON.stringify({ error: "Failed to update sales_calls" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error(
      "[sales-recording-status-webhook] Unhandled error:",
      err,
    );
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
