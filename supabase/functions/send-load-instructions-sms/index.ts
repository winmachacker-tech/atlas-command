// FILE: supabase/functions/send-load-instructions-sms/index.ts
// Purpose:
// - Accept POST from Atlas Command frontend
// - Body: { to: string, body: string, loadId?: string, mode?: "driver" | "owner" }
// - Send SMS via Twilio using secret env vars
// - Return JSON { success: true } or { error: string }
// - Includes CORS handling so browser can call it directly

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

// Basic safety: don't start server if Twilio config is missing in the environment
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
  console.warn(
    "[send-load-instructions-sms] Missing Twilio env vars. " +
      "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER."
  );
}

function corsHeaders(origin?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Very light phone sanity check (we do not enforce E.164 here, just basic cleanup)
function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // If they already pass +1..., leave it. Otherwise, strip spaces and dashes.
  const cleaned = trimmed.replace(/[()\s-]/g, "");
  return cleaned;
}

serve(async (req) => {
  const origin = req.headers.get("Origin");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders(origin),
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      }
    );
  }

  try {
    const contentType = req.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return new Response(
        JSON.stringify({ error: "Expected application/json body." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    const toRaw = String(body.to ?? "").trim();
    const textRaw = String(body.body ?? "").trim();
    const loadId = body.loadId ? String(body.loadId) : undefined;
    const mode = body.mode === "owner" ? "owner" : "driver"; // default to driver

    if (!toRaw) {
      return new Response(
        JSON.stringify({ error: "Missing 'to' phone number." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    if (!textRaw) {
      return new Response(
        JSON.stringify({ error: "Missing 'body' text." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return new Response(
        JSON.stringify({
          error:
            "SMS not configured. Missing Twilio environment variables on server.",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    const to = normalizePhone(toRaw);
    if (!to) {
      return new Response(
        JSON.stringify({ error: "Phone number is empty after normalization." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    // Hard guard max length to avoid crazy texts
    const text =
      textRaw.length > 1400
        ? textRaw.slice(0, 1390) + "\n\n[truncated]"
        : textRaw;

    // Optional: prefix for traceability
    const prefix = mode === "owner" ? "[OWNER LOAD]" : "[DRIVER LOAD]";
    const finalBody = `${prefix}${loadId ? ` #${loadId.slice(0, 8)}` : ""}\n\n${text}`;

    // Twilio API request
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

    const payload = new URLSearchParams({
      To: to,
      From: TWILIO_FROM_NUMBER,
      Body: finalBody,
    });

    const authString = `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`;
    const authHeader = "Basic " + btoa(authString);

    const twilioResp = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const twilioJson = await twilioResp.json().catch(() => null);

    if (!twilioResp.ok) {
      const message =
        (twilioJson && (twilioJson.message || twilioJson.error)) ||
        `Twilio error (status ${twilioResp.status})`;
      console.error("[send-load-instructions-sms] Twilio error:", message);
      return new Response(
        JSON.stringify({ error: message }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    // Success
    return new Response(
      JSON.stringify({
        success: true,
        sid: twilioJson?.sid ?? null,
        status: twilioJson?.status ?? null,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      }
    );
  } catch (err) {
    console.error("[send-load-instructions-sms] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      }
    );
  }
});
