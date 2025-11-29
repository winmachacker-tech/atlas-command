// FILE: supabase/functions/sales-call-status-webhook/index.ts
// Purpose:
//   Handle Twilio Voice Status callbacks for Atlas AI Caller.
//   - Verify Twilio request via X-Twilio-Signature + TWILIO_AUTH_TOKEN.
//   - Find the related row in public.sales_calls by twilio_call_sid.
//   - Map Twilio CallStatus into our internal status enum:
//       • PENDING | RINGING | COMPLETED | FAILED | NO_ANSWER
//   - Set answer_type using AnsweredBy + CallStatus:
//       • HUMAN | VOICEMAIL | NO_ANSWER | BUSY | FAILED
//   - Implement retry logic for VOICEMAIL and FAILED-like outcomes:
//       • attempt_count = attempt_count + 1
//       • last_attempt_at = now()
//       • next_attempt_at = now() + 2 hours
//
// Security:
//   - Uses Supabase SERVICE_ROLE key ONLY inside this Edge Function.
//   - Verifies Twilio signature so only Twilio can hit this endpoint.
//   - Does NOT weaken or bypass RLS. It just updates an existing row
//     identified by twilio_call_sid.
//
// ENV required (Supabase project → Functions → Environment Variables):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - TWILIO_AUTH_TOKEN
//   - TWILIO_ACCOUNT_SID (optional extra check; recommended)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

type TwilioStatus =
  | "queued"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "failed"
  | "no-answer"
  | "canceled"
  | string;

// Must match your CHECK constraint on answer_type
type AnswerType = "HUMAN" | "VOICEMAIL" | "NO_ANSWER" | "BUSY" | "FAILED";

function log(...args: unknown[]) {
  console.log("[sales-call-status-webhook]", ...args);
}

// --- Twilio signature verification helpers --- //

async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
): Promise<string> {
  const sortedKeys = Array.from(params.keys()).sort();
  let data = url;
  for (const key of sortedKeys) {
    const value = params.get(key) ?? "";
    data += key + value;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(data),
  );
  const bytes = new Uint8Array(signatureBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Signature = btoa(binary);
  return base64Signature;
}

async function verifyTwilioRequest(
  req: Request,
  params: URLSearchParams,
): Promise<boolean> {
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    console.error(
      "[sales-call-status-webhook] Missing TWILIO_AUTH_TOKEN env var; refusing to process.",
    );
    return false;
  }

  const incomingSignature =
    req.headers.get("X-Twilio-Signature") ??
    req.headers.get("X-TWILIO-SIGNATURE") ??
    "";

  if (!incomingSignature) {
    console.error("[sales-call-status-webhook] Missing X-Twilio-Signature.");
    return false;
  }

  const url = new URL(req.url);
  const fullUrl = url.origin + url.pathname + url.search;

  const expectedSignature = await computeTwilioSignature(
    authToken,
    fullUrl,
    params,
  );

  const safeCompare = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  };

  const matches = safeCompare(incomingSignature, expectedSignature);
  if (!matches) {
    console.error(
      "[sales-call-status-webhook] Invalid Twilio signature.",
      { incomingSignature, expectedSignature },
    );
  }

  return matches;
}

// Map Twilio CallStatus → internal "status" column
function mapTwilioStatusToInternal(callStatus: TwilioStatus): string {
  const s = (callStatus || "").toLowerCase();

  if (["queued", "initiated", "ringing", "in-progress"].includes(s)) {
    return "RINGING";
  }

  if (s === "completed") {
    return "COMPLETED";
  }

  if (s === "no-answer") {
    return "NO_ANSWER";
  }

  // busy, failed, canceled → FAILED
  if (["busy", "failed", "canceled"].includes(s)) {
    return "FAILED";
  }

  // Fallback: keep whatever it was before (we'll just treat as FAILED)
  return "FAILED";
}

// Decide answer_type + retry flag
function decideAnswerTypeAndRetry(
  callStatus: TwilioStatus,
  answeredByRaw: string,
): { answerType: AnswerType | null; scheduleRetry: boolean } {
  const status = (callStatus || "").toLowerCase();
  const answeredBy = (answeredByRaw || "").toLowerCase().trim();

  const voicemailValues = new Set([
    "machine_start",
    "machine_end_beep",
    "machine_end_silence",
    "machine_end_other",
  ]);

  // Clear human detection from Twilio AMD
  if (answeredBy === "human") {
    return { answerType: "HUMAN", scheduleRetry: false };
  }

  // Voicemail / machine from AMD
  if (voicemailValues.has(answeredBy)) {
    return { answerType: "VOICEMAIL", scheduleRetry: true };
  }

  // Status-based decisions
  if (status === "no-answer") {
    return { answerType: "NO_ANSWER", scheduleRetry: true };
  }

  if (status === "busy") {
    return { answerType: "BUSY", scheduleRetry: true };
  }

  if (status === "failed" || status === "canceled") {
    return { answerType: "FAILED", scheduleRetry: true };
  }

  // In-progress / completed without clear AMD result: leave answer_type alone
  return { answerType: null, scheduleRetry: false };
}

// --- Main handler --- //

serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      log("Unexpected content-type:", contentType);
      return new Response("Unsupported Media Type", { status: 415 });
    }

    const formData = await req.formData();
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      params.set(key, String(value));
    }

    const callSid = params.get("CallSid") ?? "";
    const callStatus = (params.get("CallStatus") ?? "") as TwilioStatus;
    const answeredByRaw = params.get("AnsweredBy") ?? "";
    const twilioAccountSid = params.get("AccountSid") ?? "";

    log("Incoming status callback", {
      CallSid: callSid,
      CallStatus: callStatus,
      AnsweredBy: answeredByRaw,
      AccountSid: twilioAccountSid,
    });

    // Verify Twilio signature first
    const isValid = await verifyTwilioRequest(req, params);
    if (!isValid) {
      return new Response("Invalid signature", { status: 403 });
    }

    // Optional: ensure it's from *our* Twilio account
    const expectedAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    if (expectedAccountSid && expectedAccountSid !== twilioAccountSid) {
      console.error(
        "[sales-call-status-webhook] Account SID mismatch.",
        { expectedAccountSid, twilioAccountSid },
      );
      return new Response("Forbidden", { status: 403 });
    }

    if (!callSid) {
      console.error("[sales-call-status-webhook] Missing CallSid.");
      return new Response("Bad Request", { status: 400 });
    }

    // Supabase admin client (service role – internal only)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Find the related sales_calls row
    const { data: callRow, error: fetchError } = await supabaseAdmin
      .from("sales_calls")
      .select("id, attempt_count")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    if (fetchError) {
      console.error(
        "[sales-call-status-webhook] Error fetching sales_calls row:",
        fetchError,
      );
      return new Response("OK", { status: 200 });
    }

    if (!callRow) {
      console.warn(
        "[sales-call-status-webhook] No matching sales_calls row for CallSid:",
        callSid,
      );
      return new Response("OK", { status: 200 });
    }

    const nowIso = new Date().toISOString();
    const internalStatus = mapTwilioStatusToInternal(callStatus);

    const { answerType, scheduleRetry } = decideAnswerTypeAndRetry(
      callStatus,
      answeredByRaw,
    );

    const updates: Record<string, unknown> = {
      status: internalStatus,
      // You track when the call finished via ended_at; we only set it
      // when Twilio sends a final status.
    };

    // Final statuses from Twilio
    const finalStatuses = new Set([
      "completed",
      "failed",
      "busy",
      "no-answer",
      "canceled",
    ]);
    if (finalStatuses.has((callStatus || "").toLowerCase())) {
      updates["ended_at"] = nowIso;
    }

    if (answerType) {
      updates["answer_type"] = answerType;
    }

    if (scheduleRetry) {
      const currentAttempts = (callRow.attempt_count ?? 1) as number;
      const nextAttemptDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2 hours

      updates["attempt_count"] = currentAttempts + 1;
      updates["last_attempt_at"] = nowIso;
      updates["next_attempt_at"] = nextAttemptDate.toISOString();
    } else if (answerType === "HUMAN") {
      // Clear any pending retry – no need to call again
      updates["next_attempt_at"] = null;
    }

    log("Updating sales_calls row", { id: callRow.id, updates });

    const { error: updateError } = await supabaseAdmin
      .from("sales_calls")
      .update(updates)
      .eq("id", callRow.id);

    if (updateError) {
      console.error(
        "[sales-call-status-webhook] Error updating sales_calls row:",
        updateError,
      );
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[sales-call-status-webhook] Unhandled error:", err);
    return new Response("OK", { status: 200 });
  }
});
