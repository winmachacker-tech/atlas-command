// FILE: supabase/functions/sales-call-log/index.ts
// Purpose:
// - Called by the Atlas Voice Bridge server when a Twilio call ends.
// - Logs / updates the call record in public.sales_calls with:
//     • transcript
//     • AI summary
//     • final status + timestamps
//     • optional direction / numbers (for inbound vs outbound)
//
// Security:
// - This function is NOT called from the browser.
// - It expects a shared secret in a header, matching one of the env secrets:
//     • ATLAS_VOICE_INTERNAL_SECRET
//     • VOICE_SERVER_WEBHOOK_SECRET  (backwards-compat if the server still uses this)
// - Inside the function we use the SUPABASE_SERVICE_ROLE_KEY to write to sales_calls.
//   This does NOT weaken RLS for normal clients; it only applies inside this function.
//
// Required ENV (set as Edge Function Secrets or project secrets):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - ATLAS_VOICE_INTERNAL_SECRET       (new shared secret for the voice bridge)
//   - VOICE_SERVER_WEBHOOK_SECRET       (optional, for backwards compatibility)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env",
  );
}

const INTERNAL_SECRET_PRIMARY =
  Deno.env.get("ATLAS_VOICE_INTERNAL_SECRET") ?? "";
const INTERNAL_SECRET_FALLBACK =
  Deno.env.get("VOICE_SERVER_WEBHOOK_SECRET") ?? "";
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Simple CORS headers (mainly for consistency; server-to-server doesn't really need CORS)
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-atlas-voice-secret, x-voice-server-webhook-secret, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  // Handle preflight if ever hit from a browser
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
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

  // --- Shared secret check ---------------------------------------------
  // We accept either header name and either env secret for compatibility.
  const secretHeader =
    req.headers.get("x-atlas-voice-secret") ??
    req.headers.get("x-voice-server-webhook-secret") ??
    "";

  const knownSecrets = [
    INTERNAL_SECRET_PRIMARY,
    INTERNAL_SECRET_FALLBACK,
  ].filter((s) => s && s.length > 0);

  const authorized =
    secretHeader.length > 0 && knownSecrets.includes(secretHeader);

  if (!authorized) {
    console.error("[sales-call-log] Unauthorized: invalid internal secret", {
      hasHeader: secretHeader.length > 0,
      usingPrimary: INTERNAL_SECRET_PRIMARY ? true : false,
      usingFallback: INTERNAL_SECRET_FALLBACK ? true : false,
    });

    return new Response(
      JSON.stringify({ error: "Unauthorized (invalid internal secret)" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }
  // ---------------------------------------------------------------------

  let body: any;
  try {
    body = await req.json();
  } catch (_err) {
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

  // Accept multiple possible field names so we don't break if the server uses slightly
  // different naming (callSid vs twilio_call_sid, ai_summary vs summary, etc.)
  const {
    callSid,
    call_sid,
    twilio_call_sid,
    org_id,
    prospect_id,
    status,
    direction,
    to_number,
    from_number,
    started_at,
    ended_at,
    transcript,
    ai_summary,
    summary,
    model,

    // NEW (for future recording support; currently accepted but NOT written to DB):
    // - recording_url: full URL to audio
    // - recording_duration_seconds: length of the recording
    recording_url,
    recording_duration_seconds,
  } = body;

  const sid: string | undefined = twilio_call_sid || callSid || call_sid;
  if (!sid) {
    return new Response(
      JSON.stringify({ error: "Missing twilio_call_sid / callSid in body" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }

  const finalSummary: string | null = ai_summary ?? summary ?? null;
  const nowIso = new Date().toISOString();

  // Log recording-related fields for debugging / future wiring
  if (recording_url || typeof recording_duration_seconds === "number") {
    console.log("[sales-call-log] Incoming recording fields:", {
      twilio_call_sid: sid,
      hasRecordingUrl: !!recording_url,
      recordingDurationSeconds: recording_duration_seconds,
    });
  }

  // 1) Try to find an existing sales_calls row for this Twilio Call SID
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("sales_calls")
    .select("id, org_id, prospect_id")
    .eq("twilio_call_sid", sid)
    .maybeSingle();

  if (lookupError) {
    console.error("[sales-call-log] Lookup error:", lookupError);
    return new Response(
      JSON.stringify({ error: "Database lookup failed", details: lookupError }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }

  // NOTE (IMPORTANT, NON-BREAKING):
  // We are currently NOT persisting recording_url or recording_duration_seconds
  // into sales_calls yet, because the table may not have these columns.
  // This keeps the function fully backwards compatible and avoids runtime errors.
  //
  // Once the schema is updated (e.g., add:
  //   recording_url text,
  //   recording_duration_seconds integer
  // ), we can safely add those fields to the update/insert payloads below.

  // 2) If we found an existing row, update it
  if (existing) {
    const { id } = existing;

    // Build a flexible update payload so we can update direction,
    // numbers, and optional started_at for both outbound + inbound calls.
    const updatePayload: Record<string, any> = {
      status: status ?? "COMPLETED",
      transcript: transcript ?? null,
      ai_summary: finalSummary,
      ended_at: ended_at ?? nowIso,
      // (future) recording_url,
      // (future) recording_duration_seconds,
    };

    // Only overwrite direction if the caller provided one
    if (typeof direction !== "undefined" && direction !== null) {
      updatePayload.direction = direction;
    }

    // Only overwrite started_at if provided (mainly for calls where we tracked it)
    if (typeof started_at !== "undefined" && started_at !== null) {
      updatePayload.started_at = started_at;
    }

    // Only overwrite numbers if provided
    if (typeof to_number !== "undefined" && to_number !== null) {
      updatePayload.to_number = to_number;
    }
    if (typeof from_number !== "undefined" && from_number !== null) {
      updatePayload.from_number = from_number;
    }

    // IMPORTANT FIX:
    // Only overwrite prospect_id if it is actually provided AND non-null.
    // This avoids setting prospect_id = null on a NOT NULL column.
    if (typeof prospect_id !== "undefined" && prospect_id !== null) {
      updatePayload.prospect_id = prospect_id;
    }

    const { error: updateError } = await supabaseAdmin
      .from("sales_calls")
      .update(updatePayload)
      .eq("id", id);

    if (updateError) {
      console.error("[sales-call-log] Update error:", updateError);
      return new Response(
        JSON.stringify({
          error: "Failed to update sales_calls row",
          details: updateError,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action: "updated",
        twilio_call_sid: sid,
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

  // 3) If no existing row, insert a new one — but only if we have org_id
  if (!org_id) {
    return new Response(
      JSON.stringify({
        error:
          "No existing sales_calls row found and org_id was not provided for insert",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }

  const insertPayload: Record<string, any> = {
    org_id,
    prospect_id: prospect_id ?? null,
    twilio_call_sid: sid,
    status: status ?? "COMPLETED",
    direction: direction ?? "OUTBOUND", // INBOUND supported if provided
    to_number: to_number ?? null,
    from_number: from_number ?? null,
    transcript: transcript ?? null,
    ai_summary: finalSummary,
    started_at: started_at ?? nowIso,
    ended_at: ended_at ?? nowIso,
    // (future) recording_url,
    // (future) recording_duration_seconds,
  };

  const { error: insertError } = await supabaseAdmin
    .from("sales_calls")
    .insert(insertPayload);

  if (insertError) {
    console.error("[sales-call-log] Insert error:", insertError);
    return new Response(
      JSON.stringify({
        error: "Failed to insert sales_calls row",
        details: insertError,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      action: "inserted",
      twilio_call_sid: sid,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    },
  );
});
