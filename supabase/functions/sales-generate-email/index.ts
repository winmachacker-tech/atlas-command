// FILE: supabase/functions/sales-generate-email/index.ts
//
// Purpose:
//   Generate a personalized, FMCSA-aware outbound sales email draft
//   for a single sales prospect.
//
// Behavior:
//   - Requires authenticated user (via Supabase Auth JWT).
//   - Requires team_members row to determine org_id.
//   - Loads prospect from public.sales_prospects for that org.
//   - Sends a rich carrier profile to OpenAI.
//   - Returns a short, tailored email body (~180 words, 1 clear CTA, no fluff).
//
// Security:
//   - Uses service role key ONLY inside this Edge Function.
//   - Never exposes service role to the browser.
//   - Enforces org_id isolation by checking prospect.org_id === member.org_id.
//   - Does not weaken or bypass RLS for the rest of the app; this is a controlled,
//     server-side check using user.id and org_id.
//
// Request body (JSON, POST):
//   {
//     "prospect_id": "uuid"    // preferred
//     // or "lead_id": "uuid"  // backward compatible
//   }
//
// Response (JSON):
//   Success: {
//     ok: true,
//     email_text: string,
//     prospect_id: string,
//     model: string,
//     tokens_used?: number
//   }
//   Error:   { ok: false, error: string, error_detail?: string }
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

// Try both names so we work with your existing env setup.
const OPENAI_API_KEY =
  Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("ATLAS_OPENAI_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[sales-generate-email] Missing Supabase environment variables."
  );
}

if (!OPENAI_API_KEY) {
  console.error("[sales-generate-email] Missing OpenAI API key.");
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
    // 1) Parse body and support both prospect_id and lead_id for compatibility
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
      console.error("[sales-generate-email] auth.getUser error:", userError);
      return jsonResponse(
        { ok: false, error: "Unauthorized" },
        401
      );
    }

    // 4) Create a service-role client for privileged DB access
    //    (still scoped by user.id and org_id in our queries)
    const serviceClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // 5) Make sure the user has a team membership, and get org_id
    const { data: member, error: memberError } = await serviceClient
      .from("team_members")
      .select("org_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError) {
      console.error(
        "[sales-generate-email] team_members lookup error:",
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

    // 6) Load the sales prospect, enforcing org_id match explicitly.
    //    Use select("*") so we don't break if some columns aren't present yet.
    const { data: prospect, error: prospectError } = await serviceClient
      .from("sales_prospects")
      .select("*")
      .eq("id", prospectId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (prospectError) {
      console.error(
        "[sales-generate-email] Error loading sales_prospect:",
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

    // 7) Build a clean, human-readable carrier profile for the prompt
    const p = prospect as Record<string, any>;

    const legal_name = p.legal_name ?? null;
    const dba_name = p.dba_name ?? null;
    const city = p.city ?? null;
    const state = p.state ?? null;
    const dot_number = p.dot_number ?? null;
    const mc_number = p.mc_number ?? null;
    const operation_type = p.operation_type ?? p.operationType ?? null;
    const carrier_operation = p.carrier_operation ?? p.carrierOperation ?? null;
    const cargo_types = p.cargo_types ?? p.cargoTypes ?? null;
    const power_units = p.power_units ?? p.powerUnits ?? null;
    const drivers = p.drivers ?? null;
    const email = p.email ?? null;
    const phone = p.phone ?? null;
    const created_at = p.created_at ?? null;

    const displayName =
      (dba_name && String(dba_name).trim()) ||
      (legal_name && String(legal_name).trim()) ||
      "this carrier";

    const location =
      [city, state].filter(Boolean).join(", ") || "Unknown location";

    const dotLabel = dot_number ? `DOT ${dot_number}` : "DOT not listed";
    const mcLabel = mc_number ? `MC ${mc_number}` : "MC not listed";

    const opType = operation_type || "Unknown operation type";
    const carrierOp = carrier_operation || "Unknown carrier operation";

    let cargoDescription = "Not specified";
    if (Array.isArray(cargo_types) && cargo_types.length > 0) {
      cargoDescription = cargo_types.join(", ");
    } else if (
      typeof cargo_types === "string" &&
      cargo_types.trim().length > 0
    ) {
      cargoDescription = cargo_types;
    }

    const powerUnitsText =
      typeof power_units === "number"
        ? `${power_units} power units`
        : power_units
        ? String(power_units)
        : "Unknown number of power units";

    const driversText =
      typeof drivers === "number"
        ? `${drivers} drivers`
        : drivers
        ? String(drivers)
        : "Unknown number of drivers";

    const contactBits = [
      email ? `Email: ${email}` : null,
      phone ? `Phone: ${phone}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const startedAt = created_at ? String(created_at) : "Unknown";

    const carrierProfile = `
Carrier Profile
---------------
Legal name: ${legal_name || "N/A"}
DBA: ${dba_name || "N/A"}
Location: ${location}
Identifiers: ${dotLabel}, ${mcLabel}
Operation type: ${opType}
Carrier operation: ${carrierOp}
Primary cargo types: ${cargoDescription}
Fleet size: ${powerUnitsText}, ${driversText}
Org-created at (in your CRM): ${startedAt}
Contact details: ${contactBits || "Not available"}
`.trim();

    // 8) Call OpenAI to generate a short, personalized outbound email
    if (!OPENAI_API_KEY) {
      return jsonResponse(
        {
          ok: false,
          error: "Server missing OpenAI configuration.",
        },
        500
      );
    }

    // Use a commonly available model; adjust if your account prefers another.
    const model = "gpt-4o-mini";

    const systemMessage = `
You are Atlas AI, the sales assistant for Atlas Command.

Atlas Command is an AI-powered TMS and dispatch copilot built specifically for asset-based trucking carriers.
It helps carriers:
- Turn rate confirmations into dispatched loads in about 90 seconds.
- Track trucks, drivers, and loads in one place.
- Improve margins with AI insights around lanes, driver fit, and fuel.

Write concise, conversational outbound sales emails to trucking carriers based on their FMCSA profile.
Requirements:
- Under ~180 words.
- Sounds human and respectful, not hypey or generic.
- Reference the carrier's operation type, size, region, and cargo/fleet details where useful.
- Make it clear why Atlas Command is relevant to them specifically.
- Include exactly ONE clear call to action (CTA) such as a short intro call or quick demo.
- No bullet lists, no subject line, just the email body.
- Do not fabricate data about the carrier beyond what is implied by their profile.
`.trim();

    const userMessage = `
Here is the carrier's profile from FMCSA and our internal CRM:

${carrierProfile}

Write an email as if it's coming from Mark at Atlas Command, reaching out to ${displayName} for the first time.

Tone:
- Friendly, professional, and direct.
- No fluff, no buzzword salad.
- Show that we understand their type of operation and challenges.

Make sure:
- The email feels written specifically for this carrier (not a template).
- You naturally mention how Atlas Command can help a carrier like this.
- Include one clear CTA near the end (e.g., asking if they'd be open to a short call or demo).
- Do NOT include a subject line.
`.trim();

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage },
          ],
          max_tokens: 400, // enough for ~180 words
          temperature: 0.7,
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errorBody = await openaiResponse.text();
      console.error(
        "[sales-generate-email] OpenAI API error:",
        openaiResponse.status,
        errorBody
      );
      return jsonResponse(
        {
          ok: false,
          error: "Failed to generate email via OpenAI.",
          error_detail: errorBody,
        },
        500
      );
    }

    const completion = await openaiResponse.json();
    const emailText: string | undefined =
      completion?.choices?.[0]?.message?.content?.trim();

    if (!emailText) {
      console.error(
        "[sales-generate-email] OpenAI returned no email text:",
        completion
      );
      return jsonResponse(
        {
          ok: false,
          error:
            "AI returned successfully, but no draft text was produced.",
          error_detail: JSON.stringify(completion),
        },
        500
      );
    }

    const tokensUsed: number | undefined =
      completion?.usage?.total_tokens ??
      completion?.usage?.prompt_tokens ??
      undefined;

    // 9) Return the generated email text exactly as the frontend expects
    return jsonResponse({
      ok: true,
      email_text: emailText,
      prospect_id: prospectId,
      model,
      tokens_used: tokensUsed,
    });
  } catch (err: any) {
    console.error("[sales-generate-email] Unhandled error:", err);
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
