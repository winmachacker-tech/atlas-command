// FILE: supabase/functions/sales-call-recording/index.ts
// Purpose:
// - Webhook endpoint for Twilio Recording Status Callback.
// - When a call recording is finished, Twilio POSTs here with:
//     • CallSid
//     • RecordingUrl
//     • RecordingDuration (in seconds, as string)
//     • RecordingSid
//     • RecordingStatus
//
// - We then:
//     • Look up public.sales_calls by twilio_call_sid = CallSid
//     • Update recording_url / recording_duration_seconds / recording_sid / recording_status
//     • Download the recording from Twilio using ACCOUNT_SID + AUTH_TOKEN
//     • Upload it into Supabase Storage bucket `call-recordings`
//     • Store the storage path in sales_calls.recording_storage_path
//
// Security:
// - This function is NOT called from the browser.
// - It is only called directly by Twilio.
// - We require a secret token in the URL query (?token=...),
//   which must match TWILIO_RECORDING_WEBHOOK_TOKEN in the env.
// - Inside the function we use SUPABASE_SERVICE_ROLE_KEY to update sales_calls
//   and upload to Storage. This does NOT weaken RLS for normal clients.
//
// Required ENV (Edge Function secrets / project env):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - TWILIO_RECORDING_WEBHOOK_TOKEN
//   - TWILIO_ACCOUNT_SID
//   - TWILIO_AUTH_TOKEN

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RECORDING_WEBHOOK_TOKEN =
  Deno.env.get("TWILIO_RECORDING_WEBHOOK_TOKEN") ?? "";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env",
  );
}

if (!RECORDING_WEBHOOK_TOKEN) {
  console.warn(
    "[sales-call-recording] TWILIO_RECORDING_WEBHOOK_TOKEN is not set. All requests will be rejected.",
  );
}

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.warn(
    "[sales-call-recording] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set. " +
      "We will NOT be able to copy audio into Supabase Storage.",
  );
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Simple CORS headers (Twilio does not need this, but it doesn't hurt)
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  // Handle preflight (not typically used by Twilio, but safe)
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  }

  try {
    // -----------------------------------------------------------------------
    // 1) Check URL token (?token=...) against env secret
    // -----------------------------------------------------------------------
    const url = new URL(req.url);
    const tokenParam = url.searchParams.get("token") ?? "";

    if (!RECORDING_WEBHOOK_TOKEN || tokenParam !== RECORDING_WEBHOOK_TOKEN) {
      console.error("[sales-call-recording] Unauthorized: bad token", {
        hasTokenParam: tokenParam.length > 0,
      });

      // Return 401 so random callers can’t hit this endpoint.
      return new Response(
        JSON.stringify({ error: "Unauthorized (invalid token)" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    // -----------------------------------------------------------------------
    // 2) Parse Twilio form body (application/x-www-form-urlencoded)
    // -----------------------------------------------------------------------
    let form: FormData;
    try {
      form = await req.formData();
    } catch (_err) {
      console.error("[sales-call-recording] Failed to parse formData body");
      return new Response(JSON.stringify({ error: "Invalid form body" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    const callSidRaw = form.get("CallSid");
    const recordingUrlRaw = form.get("RecordingUrl");
    const recordingDurationRaw = form.get("RecordingDuration");
    const recordingSidRaw = form.get("RecordingSid");
    const recordingStatusRaw = form.get("RecordingStatus");

    const callSid = typeof callSidRaw === "string" ? callSidRaw : "";
    const recordingUrl =
      typeof recordingUrlRaw === "string" ? recordingUrlRaw : "";
    const recordingDurationStr =
      typeof recordingDurationRaw === "string" ? recordingDurationRaw : "";
    const recordingSid =
      typeof recordingSidRaw === "string" ? recordingSidRaw : null;
    const recordingStatus =
      typeof recordingStatusRaw === "string" ? recordingStatusRaw : null;

    if (!callSid) {
      console.error(
        "[sales-call-recording] Missing CallSid in Twilio webhook payload",
      );
      // 200 so Twilio doesn't retry forever, but we log the problem.
      return new Response(JSON.stringify({ ok: false, error: "Missing CallSid" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    if (!recordingUrl) {
      console.error(
        "[sales-call-recording] Missing RecordingUrl in Twilio webhook payload",
        { callSid },
      );
      return new Response(
        JSON.stringify({ ok: false, error: "Missing RecordingUrl" }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const durationSeconds = (() => {
      const n = parseInt(recordingDurationStr, 10);
      if (Number.isNaN(n) || n < 0) return null;
      return n;
    })();

    console.log("[sales-call-recording] Incoming recording callback", {
      callSid,
      recordingUrl,
      durationSeconds,
      recordingSid,
      recordingStatus,
    });

    // -----------------------------------------------------------------------
    // 3) Look up the matching sales_calls row by twilio_call_sid
    // -----------------------------------------------------------------------
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("sales_calls")
      .select("id, org_id")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    if (lookupError) {
      console.error("[sales-call-recording] Lookup error:", lookupError);
      return new Response(
        JSON.stringify({ error: "Database lookup failed" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    if (!existing) {
      console.warn(
        "[sales-call-recording] No sales_calls row found for CallSid",
        { callSid },
      );
      return new Response(
        JSON.stringify({
          ok: false,
          warning: "No matching sales_calls row for this CallSid",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const { id, org_id } = existing;

    // -----------------------------------------------------------------------
    // 4) Attempt to copy recording into Supabase Storage
    // -----------------------------------------------------------------------
    let recordingStoragePath: string | null = null;

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      try {
        // Twilio RecordingUrl usually needs an extension for raw audio.
        // We'll request MP3 (most browser-friendly).
        const recordingUrlMp3 = recordingUrl.endsWith(".mp3")
          ? recordingUrl
          : `${recordingUrl}.mp3`;

        console.log("[sales-call-recording] Fetching Twilio audio", {
          recordingUrlMp3,
        });

        const twilioResp = await fetch(recordingUrlMp3, {
          method: "GET",
          headers: {
            Authorization:
              "Basic " +
              btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          },
        });

        if (!twilioResp.ok) {
          console.error(
            "[sales-call-recording] Failed to download audio from Twilio",
            {
              status: twilioResp.status,
              statusText: twilioResp.statusText,
            },
          );
        } else {
          const audioBuffer = await twilioResp.arrayBuffer();

          const safeOrgId = String(org_id || "unknown-org");
          const safeRecordingSid = recordingSid || callSid;
          const storagePath =
            `${safeOrgId}/sales_calls/${id}/recording_${safeRecordingSid}.mp3`;

          console.log("[sales-call-recording] Uploading to Storage", {
            storagePath,
          });

          const { error: uploadError } = await supabaseAdmin.storage
            .from("call-recordings")
            .upload(storagePath, audioBuffer, {
              contentType: "audio/mpeg",
              upsert: true,
            });

          if (uploadError) {
            console.error(
              "[sales-call-recording] Upload to Storage failed:",
              uploadError,
            );
          } else {
            recordingStoragePath = storagePath;
          }
        }
      } catch (err) {
        console.error(
          "[sales-call-recording] Error copying audio into Storage:",
          err,
        );
      }
    } else {
      console.warn(
        "[sales-call-recording] Skipping Storage upload: Twilio credentials missing.",
      );
    }

    // -----------------------------------------------------------------------
    // 5) Update the sales_calls row with recording info
    // -----------------------------------------------------------------------
    const updatePayload: Record<string, any> = {
      recording_url: recordingUrl,
      recording_duration_seconds: durationSeconds,
      recording_sid: recordingSid,
      recording_status: recordingStatus,
    };

    if (recordingStoragePath) {
      updatePayload.recording_storage_path = recordingStoragePath;
    }

    const { error: updateError } = await supabaseAdmin
      .from("sales_calls")
      .update(updatePayload)
      .eq("id", id);

    if (updateError) {
      console.error("[sales-call-recording] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update sales_calls row" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    console.log("[sales-call-recording] Updated sales_calls with recording", {
      callSid,
      recordingUrl,
      durationSeconds,
      recordingSid,
      recordingStatus,
      id,
      recordingStoragePath,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        twilio_call_sid: callSid,
        recording_url: recordingUrl,
        recording_duration_seconds: durationSeconds,
        recording_sid: recordingSid,
        recording_status: recordingStatus,
        recording_storage_path: recordingStoragePath,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  } catch (err) {
    console.error("[sales-call-recording] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error in sales-call-recording" }),
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
