// FILE: supabase/functions/sales-send-email/index.ts
//
// Purpose:
//   Send a single outbound sales email for a sales prospect.
//
// Behavior:
//   - Requires authenticated user (via Supabase Auth JWT).
//   - Requires team_members row to determine org_id.
//   - Loads prospect from public.sales_prospects for that org.
//   - Uses the email body provided by the caller (from your /sales UI).
//   - Sends the email via Resend.
//   - Attempts to log into public.sales_email_log (non-fatal on error).
//
// Security:
//   - Uses service role key ONLY inside this Edge Function.
//   - Never exposes service role to the browser.
//   - Enforces org_id isolation by checking prospect.org_id === member.org_id.
//   - Does not weaken or bypass RLS for the rest of the app.
//
// Request body (JSON, POST):
//   {
//     "prospect_id": "uuid",   // preferred
//     "lead_id": "uuid",       // backward compatible
//     "email_text": "string",  // preferred
//     "body_text": "string"    // fallback, for older callers
//   }
//
// Response (JSON):
//   Success: {
//     ok: true,
//     prospect_id: string,
//     to_email: string,
//     subject: string,
//     provider_message_id?: string
//   }
//   Error: {
//     ok: false,
//     error: string,
//     error_detail?: string
//   }
//
// CORS:
//   - Handles OPTIONS preflight.
//   - Returns Access-Control-Allow-* headers via shared cors.ts.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SALES_FROM_EMAIL =
  Deno.env.get("SALES_FROM_EMAIL") ?? "mark@atlascommand.app";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[sales-send-email] Missing Supabase environment variables."
  );
}

if (!RESEND_API_KEY) {
  console.error("[sales-send-email] Missing RESEND_API_KEY.");
}

// Helper to build JSON responses with CORS headers
function jsonResponse(
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method not allowed" },
      405
    );
  }

  try {
    // 1) Parse JSON body
    let body: any;
    try {
      body = await req.json();
    } catch (_err) {
      return jsonResponse(
        { ok: false, error: "Invalid JSON body" },
        400
      );
    }

    const prospectId: string | undefined =
      body?.prospect_id ?? body?.lead_id ?? body?.id;

    if (!prospectId) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Missing prospect_id (or lead_id) in request body.",
        },
        400
      );
    }

    const draftBody: string | undefined =
      body?.email_text ?? body?.body_text ?? body?.text;

    // 2) Create a normal Supabase client using the user's JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse(
        { ok: false, error: "Missing or invalid Authorization header" },
        401
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // 3) Get the authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[sales-send-email] auth.getUser error:", userError);
      return jsonResponse(
        { ok: false, error: "Unauthorized" },
        401
      );
    }

    // 4) Create a service-role client for privileged DB access
    const serviceClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // 5) Look up team membership to get org_id
    const { data: member, error: memberError } = await serviceClient
      .from("team_members")
      .select("org_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError) {
      console.error(
        "[sales-send-email] team_members lookup error:",
        memberError
      );
      return jsonResponse(
        {
          ok: false,
          error: "Failed to verify team membership",
          error_detail: JSON.stringify(memberError),
        },
        500
      );
    }

    if (!member || !member.org_id) {
      return jsonResponse(
        {
          ok: false,
          error: "No team membership found for this user.",
        },
        403
      );
    }

    const orgId: string = member.org_id;

    // 6) Load the sales prospect, enforcing org_id match
    const { data: prospect, error: prospectError } = await serviceClient
      .from("sales_prospects")
      .select("*")
      .eq("id", prospectId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (prospectError) {
      console.error(
        "[sales-send-email] Error loading sales_prospect:",
        prospectError
      );
      return jsonResponse(
        {
          ok: false,
          error: "Failed to load prospect",
          error_detail: JSON.stringify(prospectError),
        },
        500
      );
    }

    if (!prospect) {
      return jsonResponse(
        {
          ok: false,
          error: "Prospect not found for this org.",
        },
        404
      );
    }

    const p = prospect as Record<string, any>;
    const legal_name = p.legal_name ?? null;
    const dba_name = p.dba_name ?? null;
    const toEmail = p.email ?? null;

    if (!toEmail || typeof toEmail !== "string") {
      return jsonResponse(
        {
          ok: false,
          error:
            "Prospect has no valid email address on file.",
        },
        400
      );
    }

    const displayName =
      (dba_name && String(dba_name).trim()) ||
      (legal_name && String(legal_name).trim()) ||
      "your operation";

    const subject = `Quick idea for ${displayName}`;

    // If no draft body came from the caller, fall back to a simple template
    const bodyText =
      (draftBody && String(draftBody).trim()) ||
      `Hi there,

I'm Mark from Atlas Command. We're building an AI-powered TMS and dispatch copilot specifically for asset-based carriers.

I'd love to share a few concrete ways we might be able to streamline your dispatch and load management.

Would you be open to a short call or quick demo sometime next week?

Best,
Mark`;

    if (!RESEND_API_KEY) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Email provider is not configured (missing RESEND_API_KEY).",
        },
        500
      );
    }

    // 7) Send email via Resend
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SALES_FROM_EMAIL,
        to: [toEmail],
        subject,
        text: bodyText,
      }),
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      console.error(
        "[sales-send-email] Resend API error:",
        resendResponse.status,
        errorBody
      );
      return jsonResponse(
        {
          ok: false,
          error: "Failed to send email via Resend.",
          error_detail: errorBody,
        },
        500
      );
    }

    const resendJson = await resendResponse.json();
    const providerMessageId: string | undefined = resendJson?.id;

    // 8) Try to log the email send into sales_email_log (non-fatal if it fails)
    try {
      const insertPayload: Record<string, any> = {
        org_id: orgId,
        prospect_id: prospectId,
        to_email: toEmail,
        subject,
        body: bodyText,
        provider: "resend",
        provider_message_id: providerMessageId ?? null,
        created_by: user.id,
      };

      const { error: logError } = await serviceClient
        .from("sales_email_log")
        .insert(insertPayload);

      if (logError) {
        console.error(
          "[sales-send-email] Failed to insert sales_email_log:",
          logError
        );
      }
    } catch (logErr) {
      console.error(
        "[sales-send-email] Unexpected error while logging email:",
        logErr
      );
    }

    // 9) Return success to caller
    return jsonResponse({
      ok: true,
      prospect_id: prospectId,
      to_email: toEmail,
      subject,
      provider_message_id: providerMessageId,
    });
  } catch (err: any) {
    console.error("[sales-send-email] Unhandled error:", err);
    return jsonResponse(
      {
        ok: false,
        error: "Internal server error",
        error_detail: err?.message ?? String(err),
      },
      500
    );
  }
});
