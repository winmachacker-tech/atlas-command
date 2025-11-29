// FILE: supabase/functions/sales-call-twiml/index.ts
// Purpose:
//   Return dynamic TwiML for an outbound AI sales call.
//   - Twilio calls this URL when the call is answered.
//   - We receive ?sales_call_id=... as a query param.
//   - We look up that sales_calls row via service role.
//   - We look for the most recent PRIOR call for the same prospect.
//   - If found, we treat this as a FOLLOWUP and pass summary + transcript
//     into <Parameter> tags so the voice bridge can "remember" the last convo.
//   - If not, we treat it as a FIRST call.
//
// Env required:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - VOICE_BRIDGE_STREAM_URL        (e.g. wss://<ngrok>.ngrok-free.dev/twilio)
//   - TWILIO_RECORDING_STATUS_URL    (your existing sales-call-recording webhook)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

function log(...args: unknown[]) {
  console.log("[sales-call-twiml]", ...args);
}

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface BuildTwimlOptions {
  mediaStreamUrl: string;
  recordingStatusCallbackUrl: string;
  direction: "OUTBOUND" | "INBOUND";
  isFollowup: boolean;
  lastSummary?: string | null;
  lastTranscript?: string | null;
}

/**
 * Build the TwiML that Twilio will use for this call.
 * It:
 *  - starts call recording (both tracks)
 *  - connects a Media Stream to the voice bridge
 *  - passes memory + metadata as <Parameter> so they appear in
 *    `start.customParameters` on the bridge.
 */
function buildCallTwiml(opts: BuildTwimlOptions): string {
  const {
    mediaStreamUrl,
    recordingStatusCallbackUrl,
    direction,
    isFollowup,
    lastSummary,
    lastTranscript,
  } = opts;

  // Keep custom parameter payloads small-ish so Twilio doesn’t choke.
  const safeSummary = (lastSummary ?? "").slice(0, 700);
  const safeTranscript = (lastTranscript ?? "").slice(0, 700);

  const params: string[] = [
    `<Parameter name="direction" value="${xmlEscape(direction)}"/>`,
    `<Parameter name="call_type" value="${
      isFollowup ? "FOLLOWUP" : "FIRST"
    }"/>`,
  ];

  if (safeSummary) {
    params.push(
      `<Parameter name="last_summary" value="${xmlEscape(safeSummary)}"/>`,
    );
  }

  if (safeTranscript) {
    params.push(
      `<Parameter name="last_transcript" value="${xmlEscape(
        safeTranscript,
      )}"/>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Recording
      recordingStatusCallback="${xmlEscape(recordingStatusCallbackUrl)}"
      recordingStatusCallbackMethod="POST"
      trim="trim-silence"
      recordingTrack="both"
    />
  </Start>

  <Connect>
    <Stream url="${xmlEscape(mediaStreamUrl)}">
      ${params.join("\n      ")}
    </Stream>
  </Connect>
</Response>`;
}

serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(req.url);
    const salesCallId = url.searchParams.get("sales_call_id");

    if (!salesCallId) {
      log("Missing sales_call_id in query params");
      return new Response("Missing sales_call_id", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const mediaStreamUrl = Deno.env.get("VOICE_BRIDGE_STREAM_URL");
    const recordingStatusUrl = Deno.env.get("TWILIO_RECORDING_STATUS_URL");

    if (!supabaseUrl || !serviceRoleKey || !mediaStreamUrl || !recordingStatusUrl) {
      console.error("[sales-call-twiml] Missing env vars.", {
        has_SUPABASE_URL: !!supabaseUrl,
        has_SERVICE_ROLE: !!serviceRoleKey,
        has_VOICE_BRIDGE_STREAM_URL: !!mediaStreamUrl,
        has_TWILIO_RECORDING_STATUS_URL: !!recordingStatusUrl,
      });
      return new Response("Server env not configured", { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // 1) Current call
    const { data: currentCall, error: currentError } = await supabaseAdmin
      .from("sales_calls")
      .select("id, org_id, prospect_id, direction")
      .eq("id", salesCallId)
      .maybeSingle();

    if (currentError || !currentCall) {
      console.error("[sales-call-twiml] Failed to load sales_call:", {
        salesCallId,
        currentError,
      });
      return new Response("Call not found", { status: 404 });
    }

    const direction =
      (currentCall.direction as "OUTBOUND" | "INBOUND") || "OUTBOUND";

    // 2) Find most recent prior call for this prospect with some transcript/summary
    const { data: priorCalls, error: priorError } = await supabaseAdmin
      .from("sales_calls")
      .select("id, transcript, ai_summary, created_at")
      .eq("org_id", currentCall.org_id)
      .eq("prospect_id", currentCall.prospect_id)
      .neq("id", currentCall.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (priorError) {
      console.error("[sales-call-twiml] Error loading prior calls:", priorError);
    }

    const prior = priorCalls && priorCalls.length > 0 ? priorCalls[0] : null;
    const hasMemory = !!(prior && (prior.transcript || prior.ai_summary));

    const lastSummary = prior?.ai_summary ?? null;
    const lastTranscript = prior?.transcript ?? null;

    log("Building TwiML", {
      salesCallId,
      direction,
      isFollowup: hasMemory,
      has_lastSummary: !!lastSummary,
      has_lastTranscript: !!lastTranscript,
    });

    const twiml = buildCallTwiml({
      mediaStreamUrl,
      recordingStatusCallbackUrl: recordingStatusUrl,
      direction,
      isFollowup: hasMemory,
      lastSummary,
      lastTranscript,
    });

    return new Response(twiml, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  } catch (err) {
    console.error("[sales-call-twiml] Unhandled error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
