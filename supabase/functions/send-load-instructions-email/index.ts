// FILE: supabase/functions/send-load-instructions-email/index.ts
// Purpose:
// - Send "Load Instructions" emails from Atlas Command.
// - Frontend calls this via supabase.functions.invoke("send-load-instructions-email", { body: { ... } }).
//
// Security:
// - Uses SUPABASE_ANON_KEY + the caller's Authorization: Bearer <access_token>
//   so all queries are still protected by Row Level Security.
// - org_id and access are enforced by your existing RLS on `loads`.
// - NO service-role key is used here.
//
// Expected request body (primary shape from new code):
// {
//   "load_id": "uuid",
//   "to": "dispatcher@example.com" | ["a@x.com", "b@y.com"],
//   "cc": "optional@example.com" | ["..."],
//   "bcc": "optional@example.com" | ["..."],
//   "subject": "optional override",
//   "note": "optional free-text note"
// }
//
// Backwards-compatible aliases that we also accept (for older/other UI code):
// - loadId, id, load: { id: "..." }
// - email, recipient (for "to")

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Basic permissive CORS for your app. Auth is still enforced via JWT/RLS.
const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface SendEmailPayload {
  load_id?: string;
  loadId?: string;
  id?: string;
  load?: { id?: string };
  to?: string | string[];
  email?: string | string[];
  recipient?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  note?: string;
}

// Helper: send email via Resend API
async function sendViaResend(args: {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  text: string;
}) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM_EMAIL =
    Deno.env.get("RESEND_FROM_EMAIL") ?? "Atlas Command <no-reply@atlascommand.app>";

  if (!RESEND_API_KEY) {
    console.error("[send-load-instructions-email] Missing RESEND_API_KEY env var");
    throw new Error("Email service not configured (RESEND_API_KEY missing).");
  }

  const body = {
    from: RESEND_FROM_EMAIL,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    html: args.html,
    text: args.text,
  };

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("[send-load-instructions-email] Resend error:", resp.status, text);
    throw new Error(`Failed to send email (Resend status ${resp.status}).`);
  }

  return await resp.json();
}

serve(async (req) => {
  // Handle OPTIONS preflight quickly
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader) {
      console.warn("[send-load-instructions-email] Missing Authorization header");
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error("[send-load-instructions-email] Missing Supabase URL or ANON key");
      return new Response(
        JSON.stringify({ error: "Server not configured (Supabase env missing)" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // Critical: pass the user's Authorization header into the Supabase client via global.headers
    // so auth.getUser() + RLS use the correct access token.
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch,
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // 1) Verify the user (keeps RLS tied to their org / permissions)
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError) {
      console.error("[send-load-instructions-email] auth.getUser error:", userError);
      return new Response(
        JSON.stringify({ error: "Failed to authenticate user" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    if (!user) {
      console.warn("[send-load-instructions-email] No user found");
      return new Response(
        JSON.stringify({ error: "User not authenticated" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // 2) Parse body
    let rawPayload: unknown;
    try {
      rawPayload = await req.json();
    } catch (e) {
      console.error("[send-load-instructions-email] Invalid JSON body", e);
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const payload = rawPayload as SendEmailPayload;
    const {
      load_id,
      loadId,
      id,
      load,
      to,
      email,
      recipient,
      cc,
      bcc,
      subject,
      note,
    } = payload || {};

    // Normalize load_id: support multiple shapes
    const normalizedLoadId =
      load_id ??
      loadId ??
      id ??
      (load && load.id) ??
      undefined;

    // Normalize "to": we accept to / email / recipient
    const normalizedToRaw = to ?? email ?? recipient ?? undefined;

    // Turn normalizedToRaw into either string or string[]
    let normalizedTo: string | string[] | undefined;
    if (Array.isArray(normalizedToRaw)) {
      normalizedTo = normalizedToRaw.filter((x) => !!x);
    } else if (typeof normalizedToRaw === "string" && normalizedToRaw.trim().length > 0) {
      normalizedTo = normalizedToRaw.trim();
    }

    if (!normalizedLoadId || !normalizedTo || (Array.isArray(normalizedTo) && normalizedTo.length === 0)) {
      // Log the payload so we can see what the UI actually sent if we inspect logs
      console.error("[send-load-instructions-email] Missing required fields", {
        payload,
        resolved: {
          normalizedLoadId,
          normalizedTo,
        },
      });

      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          details: {
            has_load_id: !!normalizedLoadId,
            has_to: !!normalizedTo,
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // 3) Fetch load details (RLS will keep this safe)
    const { data: loadRow, error: loadError } = await supabaseClient
      .from("loads")
      .select("*")
      .eq("id", normalizedLoadId)
      .single();

    if (loadError) {
      console.error("[send-load-instructions-email] Error fetching load:", loadError);
      return new Response(
        JSON.stringify({ error: "Unable to find load or access denied" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const loadData: any = loadRow;

    // 4) Build subject + body
    const reference =
      (loadData.reference_number as string | null) ??
      (loadData.load_number as string | null) ??
      `Load ${loadData.id}`;

    const pickupCity = loadData.pickup_city ?? loadData.origin_city ?? "";
    const pickupState = loadData.pickup_state ?? loadData.origin_state ?? "";
    const deliveryCity = loadData.delivery_city ?? loadData.destination_city ?? "";
    const deliveryState = loadData.delivery_state ?? loadData.destination_state ?? "";

    const pickupDate = loadData.pickup_date ?? loadData.pickup_at ?? "";
    const deliveryDate = loadData.delivery_date ?? loadData.delivery_at ?? "";

    const driverName = loadData.driver_name ?? "";
    const driverPhone = loadData.driver_phone ?? loadData.driver_phone_number ?? "";

    const equipment = loadData.equipment_type ?? "";
    const weight = loadData.weight ?? loadData.weight_lbs ?? "";
    const miles = loadData.miles ?? loadData.distance_miles ?? "";
    const rate = loadData.rate ?? "";

    const subjectLine =
      subject ??
      `Load Instructions: ${reference} (${pickupCity}, ${pickupState} → ${deliveryCity}, ${deliveryState})`;

    const noteSection = note
      ? `<p><strong>Dispatcher Note:</strong><br/>${note.replace(/\n/g, "<br/>")}</p>`
      : "";

    const html = `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #111827;">
        <h2 style="font-size: 18px; margin-bottom: 8px;">Load Instructions</h2>
        <p style="margin-bottom: 4px;"><strong>Reference:</strong> ${reference}</p>
        <p style="margin-bottom: 4px;"><strong>Route:</strong> ${pickupCity}, ${pickupState} → ${deliveryCity}, ${deliveryState}</p>
        <p style="margin-bottom: 4px;"><strong>Pickup:</strong> ${pickupDate || "TBD"}</p>
        <p style="margin-bottom: 4px;"><strong>Delivery:</strong> ${deliveryDate || "TBD"}</p>
        <p style="margin-bottom: 4px;"><strong>Equipment:</strong> ${equipment || "N/A"}</p>
        <p style="margin-bottom: 4px;"><strong>Weight:</strong> ${weight || "N/A"}</p>
        <p style="margin-bottom: 4px;"><strong>Miles:</strong> ${miles || "N/A"}</p>
        <p style="margin-bottom: 4px;"><strong>Rate:</strong> ${rate || "N/A"}</p>
        <hr style="margin: 12px 0;" />
        <p style="margin-bottom: 4px;"><strong>Driver:</strong> ${driverName || "TBD"}</p>
        <p style="margin-bottom: 4px;"><strong>Driver Phone:</strong> ${driverPhone || "TBD"}</p>
        ${noteSection}
        <p style="margin-top: 16px;">If you have any questions about this load, please reply to this email.</p>
      </div>
    `;

    const textLines: string[] = [];

    textLines.push("Load Instructions");
    textLines.push(`Reference: ${reference}`);
    textLines.push(
      `Route: ${pickupCity}, ${pickupState} -> ${deliveryCity}, ${deliveryState}`,
    );
    textLines.push(`Pickup: ${pickupDate || "TBD"}`);
    textLines.push(`Delivery: ${deliveryDate || "TBD"}`);
    textLines.push(`Equipment: ${equipment || "N/A"}`);
    textLines.push(`Weight: ${weight || "N/A"}`);
    textLines.push(`Miles: ${miles || "N/A"}`);
    textLines.push(`Rate: ${rate || "N/A"}`);
    textLines.push("");
    textLines.push(`Driver: ${driverName || "TBD"}`);
    textLines.push(`Driver Phone: ${driverPhone || "TBD"}`);

    if (note) {
      textLines.push("");
      textLines.push("Dispatcher Note:");
      textLines.push(note);
    }

    const textBody = textLines.join("\n");

    // 5) Actually send the email
    await sendViaResend({
      to: normalizedTo,
      cc,
      bcc,
      subject: subjectLine,
      html,
      text: textBody,
    });

    // 6) Success response
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("[send-load-instructions-email] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
