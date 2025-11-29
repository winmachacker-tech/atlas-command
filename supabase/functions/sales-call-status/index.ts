// FILE: supabase/functions/sales-call-status/index.ts
// Purpose:
// - Webhook endpoint for Twilio Call Status Callback.
// - Twilio will POST here on call lifecycle events with fields like:
//     • CallSid
//     • CallStatus (queued, ringing, in-progress, completed, busy, no-answer, failed, canceled)
//     • AnsweredBy (human, machine, machine_start, machine_end, unknown, etc.)
//     • Timestamp (optional, RFC2822-ish string)
//     • CallDuration (for completed calls, in seconds as string)
//
// - We then:
//     • Look up public.sales_calls by twilio_call_sid = CallSid
//     • Update status
//     • Update answered_by
//     • Update is_voicemail based on AnsweredBy heuristic
//     • Fill started_at / ended_at timestamps when appropriate
//
// Security:
// - This function is NOT called from the browser.
// - It is only called directly by Twilio.
// - We require a secret token in the URL query (?token=...),
//   which must match TWILIO_STATUS_WEBHOOK_TOKEN in the env.
// - Inside the function we use SUPABASE_SERVICE_ROLE_KEY to update sales_calls.
//   This does NOT weaken RLS for normal clients; it only applies inside
//   this function on the backend.
//
// Required ENV (Edge Function secrets / project env):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - TWILIO_STATUS_WEBHOOK_TOKEN   (shared token used in the webhook URL)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STATUS_WEBHOOK_TOKEN =
  Deno.env.get("TWILIO_STATUS_WEBHOOK_TOKEN") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "[sales-call-status] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env",
  );
}

if (!STATUS_WEBHOOK_TOKEN) {
  console.warn(
    "[sales-call-status] TWILIO_STATUS_WEBHOOK_TOKEN is not set. All requests will be rejected.",
  );
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Simple CORS headers (Twilio does not need this, but it doesn't hurt)
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function normalizeStatus(raw: string | null): string | null {
  if (!raw) return null;
  // Twilio sends lowercase or dash-case; we keep lowercase or as-is for now.
  return String(raw).toLowerCase();
}

function parseTwilioTimestamp(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

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

    if (!STATUS_WEBHOOK_TOKEN || tokenParam !== STATUS_WEBHOOK_TOKEN) {
      console.error("[sales-call-status] Unauthorized: bad token", {
        hasTokenParam: tokenParam.length > 0,
      });

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
      console.error("[sales-call-status] Failed to parse formData body");
      return new Response(JSON.stringify({ error: "Invalid form body" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    const callSidRaw = form.get("CallSid");
    const callStatusRaw = form.get("CallStatus");
    const answeredByRaw = form.get("AnsweredBy");
    const timestampRaw = form.get("Timestamp");
    const durationRaw = form.get("CallDuration");

    const callSid = typeof callSidRaw === "string" ? callSidRaw : "";
    const callStatus = normalizeStatus(
      typeof callStatusRaw === "string" ? callStatusRaw : null,
    );
    const answeredBy =
      typeof answeredByRaw === "string" ? answeredByRaw.toLowerCase() : null;
    const timestampStr =
      typeof timestampRaw === "string" ? timestampRaw : null;
    const callDurationStr =
      typeof durationRaw === "string" ? durationRaw : null;

    if (!callSid) {
      console.error(
        "[sales-call-status] Missing CallSid in Twilio webhook payload",
      );
      // 200 so Twilio doesn't retry forever, but we log the problem.
      return new Response(
        JSON.stringify({ ok: false, error: "Missing CallSid" }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    console.log("[sales-call-status] Incoming status callback", {
      callSid,
      callStatus,
      answeredBy,
      timestampStr,
      callDurationStr,
    });

    // -----------------------------------------------------------------------
    // 3) Look up the matching sales_calls row by twilio_call_sid
    // -----------------------------------------------------------------------
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("sales_calls")
      .select("id, started_at, ended_at")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    if (lookupError) {
      console.error("[sales-call-status] Lookup error:", lookupError);
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
      // We don't want Twilio to retry forever if there's no matching row.
      console.warn(
        "[sales-call-status] No sales_calls row found for CallSid",
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

    const { id, started_at, ended_at } = existing;

    // -----------------------------------------------------------------------
    // 4) Build update payload
    // -----------------------------------------------------------------------
    const updatePayload: Record<string, any> = {};

    if (callStatus) {
      updatePayload.status = callStatus;
    }

    if (answeredBy) {
      updatePayload.answered_by = answeredBy;
      // Simple voicemail heuristic based on AnsweredBy
      // Twilio docs: machine, machine_start, machine_end, etc.
      if (answeredBy.startsWith("machine")) {
        updatePayload.is_voicemail = true;
      } else if (answeredBy === "human") {
        updatePayload.is_voicemail = false;
      }
      // Otherwise leave is_voicemail untouched (null) so we can infer later
    }

    const eventIso = parseTwilioTimestamp(timestampStr) ??
      new Date().toISOString();

    // Fill started_at when we first see in-progress (or similar)
    if (
      !started_at &&
      callStatus &&
      (callStatus === "in-progress" || callStatus === "ringing")
    ) {
      updatePayload.started_at = eventIso;
    }

    // Fill ended_at when call reaches a final state
    const finalStates = new Set([
      "completed",
      "busy",
      "failed",
      "no-answer",
      "canceled",
    ]);

    if (!ended_at && callStatus && finalStates.has(callStatus)) {
      updatePayload.ended_at = eventIso;
    }

    // Optionally, if we want to store call duration (separate from recording):
    if (callDurationStr) {
      const n = parseInt(callDurationStr, 10);
      if (!Number.isNaN(n) && n >= 0) {
        // Only set if you *have* a duration column; otherwise ignore.
        // Example: updatePayload.call_duration_seconds = n;
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      console.log(
        "[sales-call-status] Nothing to update for this callback; skipping",
        { callSid },
      );
      return new Response(
        JSON.stringify({ ok: true, skipped: true }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("sales_calls")
      .update(updatePayload)
      .eq("id", id);

    if (updateError) {
      console.error("[sales-call-status] Update error:", updateError);
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

    console.log("[sales-call-status] Updated sales_calls with status info", {
      callSid,
      id,
      updatePayload,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        twilio_call_sid: callSid,
        id,
        updated: updatePayload,
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
    console.error("[sales-call-status] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error in sales-call-status" }),
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
