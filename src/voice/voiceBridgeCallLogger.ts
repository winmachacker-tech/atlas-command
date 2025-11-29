// FILE: src/voice/voiceBridgeCallLogger.ts
//
// Purpose:
// - Small helper used by the Atlas Voice Bridge (server.ts) to log calls
//   into the sales-call-log Edge Function.
// - Works for BOTH outbound + inbound calls.
// - Adds support for direction = "INBOUND" for inbound calls.
//
// Security:
// - Uses ONLY backend env vars (SUPABASE_URL, ATLAS_VOICE_INTERNAL_SECRET).
// - Sends a shared secret header so only your bridge can call the Edge Function.
// - Does NOT expose any keys to the browser.
//
// Usage (from src/server.ts):
//   import { logCallToSupabase } from "./voice/voiceBridgeCallLogger";
//
//   await logCallToSupabase({
//     callSid,
//     orgId,
//     direction: "INBOUND", // or "OUTBOUND"
//     toNumber,
//     fromNumber,
//     transcript,
//     aiSummary,
//     startedAt,
//     endedAt,
//     modelUsed: "gpt-4.1-mini",
//   });
//

export type CallDirection = "INBOUND" | "OUTBOUND";

export interface CallLogPayload {
  callSid: string;

  // Optional org_id (required only when there is no existing sales_calls row,
  // e.g. for fresh inbound calls created by this function).
  orgId?: string | null;

  // Optional prospect mapping
  prospectId?: string | null;

  // Status string, defaults to "COMPLETED"
  status?: string;

  // "INBOUND" or "OUTBOUND". If omitted, the Edge Function will treat it as OUTBOUND.
  direction?: CallDirection;

  // Phone numbers (E.164 if possible, e.g. +1402...)
  toNumber?: string | null;
  fromNumber?: string | null;

  // Transcript + summary text
  transcript?: string | null;
  aiSummary?: string | null;

  // Timestamps in ISO 8601
  startedAt?: string | null;
  endedAt?: string | null;

  // Model used for summary (for your own debugging/analytics)
  modelUsed?: string | null;

  // Optional future recording support (Edge Function already accepts these fields)
  recordingUrl?: string | null;
  recordingDurationSeconds?: number | null;
}

function getSalesCallLogUrl(): string {
  // Build the URL from SUPABASE_URL so you don't have to hardcode the project ref twice.
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error(
      "[voiceBridgeCallLogger] SUPABASE_URL is not set in the Node environment",
    );
  }

  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/sales-call-log`;
}

function getInternalSecret(): string {
  const secret =
    process.env.ATLAS_VOICE_INTERNAL_SECRET ??
    process.env.VOICE_SERVER_WEBHOOK_SECRET ??
    "";

  if (!secret) {
    throw new Error(
      "[voiceBridgeCallLogger] ATLAS_VOICE_INTERNAL_SECRET or VOICE_SERVER_WEBHOOK_SECRET is not set in the Node environment",
    );
  }

  return secret;
}

/**
 * Log a completed call into the sales-call-log Edge Function.
 * This is used by your voice bridge when Twilio sends the "stop" event.
 */
export async function logCallToSupabase(
  payload: CallLogPayload,
): Promise<void> {
  const {
    callSid,
    orgId,
    prospectId,
    status,
    direction,
    toNumber,
    fromNumber,
    transcript,
    aiSummary,
    startedAt,
    endedAt,
    modelUsed,
    recordingUrl,
    recordingDurationSeconds,
  } = payload;

  if (!callSid) {
    throw new Error("[voiceBridgeCallLogger] callSid is required");
  }

  const url = getSalesCallLogUrl();
  const secret = getInternalSecret();

  const body: any = {
    // Edge Function accepts multiple forms, we send the canonical one:
    twilio_call_sid: callSid,
    org_id: orgId ?? null,
    prospect_id: prospectId ?? null,
    status: status ?? "COMPLETED",
    direction: direction ?? "OUTBOUND",
    to_number: toNumber ?? null,
    from_number: fromNumber ?? null,
    transcript: transcript ?? null,
    ai_summary: aiSummary ?? null,
    started_at: startedAt ?? null,
    ended_at: endedAt ?? null,
    model: modelUsed ?? null,
    recording_url: recordingUrl ?? null,
    recording_duration_seconds: recordingDurationSeconds ?? null,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Shared secret: must match ATLAS_VOICE_INTERNAL_SECRET in the Edge Function env
        "x-atlas-voice-secret": secret,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      console.error(
        "[voiceBridgeCallLogger] sales-call-log returned non-OK:",
        res.status,
        text,
      );
    } else {
      const json = await res.json().catch(() => ({}));
      console.log(
        "[voiceBridgeCallLogger] sales-call-log OK:",
        res.status,
        json,
      );
    }
  } catch (err) {
    console.error("[voiceBridgeCallLogger] Error calling sales-call-log:", err);
  }
}
