// FILE: supabase/functions/sales-initiate-call/index.ts
// Purpose:
//   Initiate an outbound AI sales call to a prospect.
//   - Authenticates the caller via Supabase Auth (JWT in Authorization header).
//   - Resolves org_id from the user metadata (current org).
//   - Looks up the prospect's phone number in public.sales_prospects.
//   - Finds the last completed outbound sales call (if any) for this prospect
//     to use as FOLLOW-UP memory (ai_summary + transcript).
//   - Creates a row in public.sales_calls (PENDING).
//   - Builds TwiML INLINE (not via remote URL), including:
//       • <Connect><Stream> pointing to your Voice Bridge WS
//       • <Parameter> direction, call_type, last_summary, last_transcript
//       • Optional <Start><Recording> block if TWILIO_RECORDING_STATUS_URL is set
//   - Calls Twilio's Calls API with that TwiML via the `Twiml` param.
//   - Updates sales_calls with twilio_call_sid and status = 'RINGING'.
//   - If Twilio fails, marks the call as FAILED.
//
// Security:
//   - Uses SUPABASE_SERVICE_ROLE_KEY ONLY inside this function.
//   - Never exposes secrets to the browser.
//   - Respects org boundaries by validating org_id and prospect ownership.
//
// CORS:
//   - Uses shared corsHeaders from _shared/cors.ts
//   - Handles OPTIONS preflight and adds Access-Control-Allow-Origin, etc.
//
// ENV required (Supabase → Functions → Environment Variables):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - TWILIO_ACCOUNT_SID
//   - TWILIO_AUTH_TOKEN
//   - TWILIO_FROM_NUMBER
//   - TWILIO_STATUS_CALLBACK_URL
//   - TWILIO_STREAM_WEBSOCKET_URL    ← NEW: wss://.../twilio (voice bridge)
//
// ENV optional (nice-to-have, NOT required):
//   - TWILIO_RECORDING_STATUS_URL  (for recording status webhooks – sales-call-recording)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders } from "../_shared/cors.ts";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

interface SalesInitiateRequest {
  prospect_id: string;
}

function log(...args: unknown[]) {
  console.log("[sales-initiate-call]", ...args);
}

// ---------- XML helpers for TwiML ----------

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
  recordingStatusCallbackUrl?: string | null;
  direction: "OUTBOUND" | "INBOUND";
  isFollowup: boolean;
  lastSummary?: string | null;
  lastTranscript?: string | null;
}

/**
 * Build the TwiML that Twilio will use for this call.
 * It:
 *  - optionally starts call recording (both tracks)
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
    `<Parameter name="call_type" value="${isFollowup ? "FOLLOWUP" : "FIRST"}"/>`,
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

  const recordingBlock = recordingStatusCallbackUrl
    ? `
  <Start>
    <Recording
      recordingStatusCallback="${xmlEscape(recordingStatusCallbackUrl)}"
      recordingStatusCallbackMethod="POST"
      trim="trim-silence"
      recordingTrack="both"
    />
  </Start>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${recordingBlock}
  <Connect>
    <Stream url="${xmlEscape(mediaStreamUrl)}">
      ${params.join("\n      ")}
    </Stream>
  </Connect>
</Response>`;
}

// ---------- Main handler ----------

serve(async (req: Request): Promise<Response> => {
  try {
    // 0) Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : authHeader;

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // --- Twilio envs ---
    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
    const statusCallbackUrl = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");
    const recordingStatusUrl = Deno.env.get("TWILIO_RECORDING_STATUS_URL"); // OPTIONAL
    const mediaStreamUrl = Deno.env.get("TWILIO_STREAM_WEBSOCKET_URL"); // REQUIRED: wss://.../twilio

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        "[sales-initiate-call] Missing Supabase env vars (SUPABASE_URL or SERVICE_ROLE).",
      );
      return new Response(
        JSON.stringify({ error: "Supabase environment not configured" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // 🔍 DEBUG: show which Twilio envs are present (true/false)
    const envPresence = {
      has_TWILIO_ACCOUNT_SID: !!twilioAccountSid,
      has_TWILIO_AUTH_TOKEN: !!twilioAuthToken,
      has_TWILIO_FROM_NUMBER: !!twilioFromNumber,
      has_TWILIO_STATUS_CALLBACK_URL: !!statusCallbackUrl,
      has_TWILIO_RECORDING_STATUS_URL: !!recordingStatusUrl,
      has_TWILIO_STREAM_WEBSOCKET_URL: !!mediaStreamUrl,
    };
    log("Twilio env presence:", envPresence);

    // Required Twilio envs (STREAM URL replaces old TWILIO_TWIML_URL)
    const missing: string[] = [];
    if (!twilioAccountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!twilioAuthToken) missing.push("TWILIO_AUTH_TOKEN");
    if (!twilioFromNumber) missing.push("TWILIO_FROM_NUMBER");
    if (!statusCallbackUrl) missing.push("TWILIO_STATUS_CALLBACK_URL");
    if (!mediaStreamUrl) missing.push("TWILIO_STREAM_WEBSOCKET_URL");

    if (missing.length > 0) {
      console.error(
        "[sales-initiate-call] Missing Twilio env vars:",
        missing,
      );

      return new Response(
        JSON.stringify({
          error: "Twilio environment not configured",
          missing,
          presence: envPresence,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // 1) Validate user via token
    const { data: userResult, error: userError } = await supabaseAdmin.auth
      .getUser(token);

    if (userError || !userResult?.user) {
      console.error("[sales-initiate-call] auth.getUser error:", userError);
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const user = userResult.user;
    const userId = user.id;

    // Try to derive the current org id from user metadata.
    const userMeta = (user.user_metadata ?? {}) as Record<string, Json>;
    const orgId =
      (userMeta.current_org_id as string | undefined) ||
      (userMeta.org_id as string | undefined);

    if (!orgId) {
      console.error(
        "[sales-initiate-call] No org_id / current_org_id in user metadata.",
        { userId, userMeta },
      );
      return new Response(
        JSON.stringify({ error: "No current org selected" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // 2) Parse body
    let body: SalesInitiateRequest;
    try {
      body = (await req.json()) as SalesInitiateRequest;
    } catch (_err) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { prospect_id } = body || {};
    if (!prospect_id) {
      return new Response(
        JSON.stringify({ error: "Missing prospect_id" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // 3) Look up prospect under this org
    const { data: prospect, error: prospectError } = await supabaseAdmin
      .from("sales_prospects")
      .select("id, org_id, phone")
      .eq("id", prospect_id)
      .maybeSingle();

    if (prospectError) {
      console.error(
        "[sales-initiate-call] Error fetching prospect:",
        prospectError,
      );
      return new Response(
        JSON.stringify({ error: "Failed to fetch prospect" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (!prospect) {
      return new Response(
        JSON.stringify({ error: "Prospect not found" }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (prospect.org_id !== orgId) {
      console.error(
        "[sales-initiate-call] Prospect org mismatch.",
        { prospectOrg: prospect.org_id, userOrg: orgId },
      );
      return new Response(
        JSON.stringify({ error: "Prospect does not belong to your org" }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const toNumber = (prospect.phone ?? "").trim();
    if (!toNumber) {
      return new Response(
        JSON.stringify({ error: "Prospect has no phone number" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // 3.5) Fetch last completed outbound call for this prospect (for MEMORY)
    const { data: lastCall, error: lastCallError } = await supabaseAdmin
      .from("sales_calls")
      .select("id, ai_summary, transcript, status, direction")
      .eq("org_id", orgId)
      .eq("prospect_id", prospect_id)
      .eq("direction", "OUTBOUND")
      .eq("status", "COMPLETED")
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCallError) {
      console.error(
        "[sales-initiate-call] Error fetching last call for memory:",
        lastCallError,
      );
    }

    const isFollowup = !!(lastCall && (lastCall.ai_summary || lastCall.transcript));
    const lastSummary = (lastCall?.ai_summary as string | null) ?? null;
    const lastTranscript = (lastCall?.transcript as string | null) ?? null;

    log("Follow-up detection:", {
      prospect_id,
      isFollowup,
      lastCallId: lastCall?.id ?? null,
    });

    // 4) Create sales_calls row (PENDING)
    const { data: insertRows, error: insertError } = await supabaseAdmin
      .from("sales_calls")
      .insert({
        org_id: orgId,
        prospect_id,
        created_by: userId,
        status: "PENDING",
        direction: "OUTBOUND",
        to_number: toNumber,
        from_number: twilioFromNumber,
        // attempt_count uses DB default (1)
      })
      .select("id")
      .limit(1);

    if (insertError || !insertRows || insertRows.length === 0) {
      console.error(
        "[sales-initiate-call] Error inserting sales_calls row:",
        insertError,
      );
      return new Response(
        JSON.stringify({ error: "Failed to create sales call" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const salesCallId = insertRows[0].id as string;
    log("Created sales_calls row", { salesCallId, toNumber, from: twilioFromNumber });

    // 5) Build TwiML INLINE with memory + metadata
    const twiml = buildCallTwiml({
      mediaStreamUrl: mediaStreamUrl!,
      recordingStatusCallbackUrl: recordingStatusUrl ?? null,
      direction: "OUTBOUND",
      isFollowup,
      lastSummary,
      lastTranscript,
    });

    // 6) Initiate Twilio call with TwiML + Answering Machine Detection (AMD)
    const twilioUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`;

    const paramsObj: Record<string, string> = {
      To: toNumber,
      From: twilioFromNumber!,
      // Inline TwiML string – NO external TWIML URL anymore
      Twiml: twiml,
      // Status callback for call lifecycle → our sales-call-status-webhook
      StatusCallback: statusCallbackUrl!,
      StatusCallbackEvent:
        "initiated ringing answered completed failed busy no-answer",
      // Enable Answering Machine Detection so Twilio sends AnsweredBy
      MachineDetection: "Enable",
      MachineDetectionTimeout: "5",
    };

    const params = new URLSearchParams(paramsObj);

    const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const twilioBody = await twilioResponse.json().catch(
      () => ({} as Json),
    );

    if (!twilioResponse.ok) {
      console.error("[sales-initiate-call] Twilio call creation failed:", {
        status: twilioResponse.status,
        body: twilioBody,
      });

      // Mark the sales_call as FAILED if Twilio didn't accept the call
      await supabaseAdmin
        .from("sales_calls")
        .update({
          status: "FAILED",
          ended_at: new Date().toISOString(),
          notes: "Twilio call creation failed",
        })
        .eq("id", salesCallId);

      return new Response(
        JSON.stringify({
          error: "Twilio call creation failed",
          details: twilioBody,
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const twilioSid = (twilioBody as any)?.sid as string | undefined;

    if (!twilioSid) {
      console.warn(
        "[sales-initiate-call] Twilio response OK but missing sid.",
        twilioBody,
      );
    }

    // 7) Update sales_calls row with Twilio SID and set status to RINGING
    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("sales_calls")
      .update({
        twilio_call_sid: twilioSid ?? null,
        status: "RINGING",
        started_at: nowIso,
      })
      .eq("id", salesCallId);

    if (updateError) {
      console.error(
        "[sales-initiate-call] Error updating sales_calls with Twilio SID:",
        updateError,
      );
      // We still let the response be OK; the call is in flight.
    }

    // Respond to frontend with the call id + twilio sid if available
    return new Response(
      JSON.stringify({
        ok: true,
        sales_call_id: salesCallId,
        twilio_call_sid: twilioSid ?? null,
        is_followup: isFollowup,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("[sales-initiate-call] Unhandled error:", err);
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
