// FILE: supabase/functions/sales-generate-followup-email/index.ts
//
// Purpose:
// - Given a prospect_id + call_id, generate a personalized follow-up email draft
//   using OpenAI, based on:
//     • the sales call transcript
//     • the AI summary of the call
//     • basic prospect info (name, company, location, etc.)
//
// - IMPORTANT: This function ONLY GENERATES A DRAFT.
//   • It does NOT send emails.
//   • It does NOT change email_drafts table yet (UI will handle saving later).
//
// Security:
// - Uses the caller's Supabase JWT (Authorization header), so RLS still applies.
// - No secrets exposed to the frontend: OPENAI_API_KEY is only used here.
// - Only users who can see the call + prospect (via RLS) can generate drafts.
//
// Expected input (JSON body):
//   {
//     "prospect_id": "<uuid>",
//     "call_id": "<uuid>"
//   }
//
// Response on success (status 200):
//   {
//     "ok": true,
//     "subject": "...",
//     "draft_text": "...",
//     "draft_html": "..."
//   }
//
// NOTE: Later, the React UI will:
//   • call this function to get the draft
//   • show it to you for edits
//   • save it into public.email_drafts
//   • call sales-send-email when you hit Approve & Send

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type JsonRecord = Record<string, unknown>;

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL =
  Deno.env.get("OPENAI_FOLLOWUP_MODEL") ?? "gpt-4.1-mini";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

if (!OPENAI_API_KEY) {
  console.error("[sales-generate-followup-email] Missing OPENAI_API_KEY");
}
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[sales-generate-followup-email] Missing SUPABASE_URL or SUPABASE_ANON_KEY",
  );
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!OPENAI_API_KEY) {
      return jsonResponse(
        { error: "Server not configured: missing OPENAI_API_KEY" },
        500,
      );
    }

    // Create a Supabase client that uses the caller's JWT.
    // This keeps all your existing RLS in place.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") ?? "",
        },
      },
    });

    // 1) Auth check
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("[sales-generate-followup-email] Auth error:", authError);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // 2) Parse and validate body
    const body = (await req.json()) as {
      prospect_id?: string;
      call_id?: string;
    };

    const prospectId = body?.prospect_id;
    const callId = body?.call_id;

    if (!prospectId || !callId) {
      return jsonResponse(
        {
          error: "Missing required fields: prospect_id and call_id",
        },
        400,
      );
    }

    // 3) Fetch the sales call (RLS will ensure org isolation)
    const {
      data: call,
      error: callError,
    } = await supabase
      .from("sales_calls")
      .select("*")
      .eq("id", callId)
      .eq("prospect_id", prospectId)
      .maybeSingle();

    if (callError) {
      console.error(
        "[sales-generate-followup-email] Error fetching sales_calls:",
        callError,
      );
      return jsonResponse(
        { error: "Failed to fetch call details" },
        400,
      );
    }

    if (!call) {
      return jsonResponse(
        {
          error: "Call not found for this prospect (or access denied)",
        },
        404,
      );
    }

    // Extract safe fields from the call
    const callOrgId = (call as JsonRecord).org_id as string | undefined;
    const transcript =
      ((call as JsonRecord).transcript as string | null | undefined) ?? "";
    const aiSummary =
      ((call as JsonRecord).ai_summary as string | null | undefined) ?? "";
    const callStatus =
      ((call as JsonRecord).status as string | null | undefined) ?? "";
    const direction =
      ((call as JsonRecord).direction as string | null | undefined) ?? "";
    const startedAt =
      ((call as JsonRecord).started_at as string | null | undefined) ?? "";
    const endedAt =
      ((call as JsonRecord).ended_at as string | null | undefined) ?? "";

    // 4) Fetch the prospect under RLS
    const {
      data: prospect,
      error: prospectError,
    } = await supabase
      .from("sales_prospects")
      .select("*")
      .eq("id", prospectId)
      .maybeSingle();

    if (prospectError) {
      console.error(
        "[sales-generate-followup-email] Error fetching sales_prospects:",
        prospectError,
      );
      return jsonResponse(
        { error: "Failed to fetch prospect details" },
        400,
      );
    }

    if (!prospect) {
      return jsonResponse(
        { error: "Prospect not found (or access denied)" },
        404,
      );
    }

    // Basic cross-check: prospect org should match call org, if both present
    const prospectOrgId = (prospect as JsonRecord).org_id as
      | string
      | undefined;
    if (callOrgId && prospectOrgId && callOrgId !== prospectOrgId) {
      console.warn(
        "[sales-generate-followup-email] org_id mismatch between call and prospect",
        { callOrgId, prospectOrgId },
      );
      return jsonResponse(
        {
          error:
            "Data mismatch between call and prospect (org_id conflict). Please contact support.",
        },
        400,
      );
    }

    // Extract prospect info with flexible fallbacks
    const p = prospect as JsonRecord;
    const companyName =
      (p.legal_name as string) ||
      (p.dba_name as string) ||
      (p.name as string) ||
      "your fleet";
    const contactName =
      (p.primary_contact_name as string) ||
      (p.contact_name as string) ||
      (p.owner_name as string) ||
      "";
    const email =
      (p.contact_email as string) ||
      (p.email as string) ||
      (p.primary_email as string) ||
      "";
    const phone =
      (p.contact_phone as string) ||
      (p.phone as string) ||
      (p.primary_phone as string) ||
      "";
    const city = (p.mailing_city as string) || (p.city as string) || "";
    const state = (p.mailing_state as string) || (p.state as string) || "";
    const dotNumber =
      (p.dot_number as string) || (p.usdot as string) || "";
    const mcNumber =
      (p.mc_number as string) || (p.docket_number as string) || "";

    // 5) Build the prompt for OpenAI
    const systemPrompt = `
You are Dipsy, the AI sales assistant for Atlas Command, an AI-powered TMS for asset-based trucking carriers.

Your job:
- Read the call transcript and AI summary.
- Infer the carrier's situation, challenges, and likely pain points.
- Write a concise, friendly, professional follow-up email.

Rules:
- Write as a human sales rep from Atlas Command, not as an AI.
- Assume the sender is Mark from Atlas Command.
- Speak to one decision-maker (e.g., owner/dispatcher).
- Keep it specific to the call context (no generic fluff).
- Focus on 1–3 key pain points and how Atlas Command helps.
- Include a clear next step (e.g., "Would it make sense to schedule a quick demo?").
- Keep it under ~250–300 words.
- Avoid making promises you can’t keep (no fake pricing, no false claims).

You MUST respond in pure JSON with this exact shape:
{
  "subject": "string",
  "draft_text": "string (plain text email body)",
  "draft_html": "string (HTML email body)"
}
`;

    const userPrompt = `
Prospect info (from FMCSA/CRM):
- Company name: ${companyName}
- Contact name (if known): ${contactName || "N/A"}
- Email on file: ${email || "N/A"}
- Phone on file: ${phone || "N/A"}
- Location: ${[city, state].filter(Boolean).join(", ") || "N/A"}
- DOT number: ${dotNumber || "N/A"}
- MC number: ${mcNumber || "N/A"}

Call meta:
- Call direction: ${direction || "N/A"}
- Call status: ${callStatus || "N/A"}
- Started at: ${startedAt || "N/A"}
- Ended at: ${endedAt || "N/A"}

Call AI summary:
${aiSummary || "(no summary available)"}

Raw transcript:
${transcript || "(no transcript available)"}

Task:
1) Infer the prospect's main pain points and interests from the summary/transcript.
2) Write a compelling subject line and follow-up email that:
   - References the call naturally.
   - Shows you understood their situation.
   - Highlights how Atlas Command can help.
   - Ends with a simple call to action (e.g. quick call or demo).

Remember: Return ONLY valid JSON with subject, draft_text, and draft_html.
`;

    // 6) Call OpenAI chat completions API
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.5,
        }),
      },
    );

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error(
        "[sales-generate-followup-email] OpenAI error:",
        openaiRes.status,
        errText,
      );
      return jsonResponse(
        { error: "Failed to generate email draft from OpenAI" },
        500,
      );
    }

    const openaiJson = await openaiRes.json();

    const rawContent =
      openaiJson?.choices?.[0]?.message?.content ?? "";

    let parsed: {
      subject?: string;
      draft_text?: string;
      draft_html?: string;
    };
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      console.error(
        "[sales-generate-followup-email] Failed to parse OpenAI JSON:",
        e,
        rawContent,
      );
      return jsonResponse(
        { error: "OpenAI returned invalid JSON for email draft" },
        500,
      );
    }

    const subject = parsed.subject || "Follow-up from our call";
    const draftText =
      parsed.draft_text ||
      "Hi there,\n\nIt was great speaking with you about your fleet. I wanted to follow up regarding Atlas Command.\n\nBest,\nMark";
    const draftHtml =
      parsed.draft_html ||
      `<p>Hi there,</p><p>It was great speaking with you about your fleet. I wanted to follow up regarding Atlas Command.</p><p>Best,<br/>Mark</p>`;

    // 7) Return the draft to the frontend.
    //    The React UI will:
    //    - display this draft
    //    - let you edit it
    //    - save it into email_drafts
    //    - later call sales-send-email when you approve
    return jsonResponse(
      {
        ok: true,
        subject,
        draft_text: draftText,
        draft_html: draftHtml,
        model: OPENAI_MODEL,
      },
      200,
    );
  } catch (err) {
    console.error("[sales-generate-followup-email] Unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error generating follow-up email" },
      500,
    );
  }
});

// Small helper for consistent JSON + CORS
function jsonResponse(
  data: JsonRecord,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
