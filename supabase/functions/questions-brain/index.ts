// FILE: supabase/functions/questions-brain/index.ts
//
// "Dipsy Questions Brain" – secure, auth-only Atlas FAQ brain.
// - Requires Authorization: Bearer <JWT> header
// - Uses atlas_docs table with fallback to static docs
// - Calls OpenAI to answer questions using those docs
// - Optionally logs questions in atlas_questions_log
//
// This file does NOT modify any RLS or touch tenant data tables for knowledge.
// It only logs questions (best-effort) and verifies the caller via Supabase Auth.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AtlasDoc {
  id: string | number;
  slug: string;
  title: string;
  domain?: string;
  doc_type?: string;
  summary?: string;
  body?: string;
  version?: string;
  related_docs?: string[];
}

interface QuestionsBrainRequest {
  question: string;
  context?: Record<string, unknown>;
  source?: string;
  strictMode?: boolean;
}

interface QuestionsBrainResponse {
  answer: string;
  sources?: Array<{
    id: string | number;
    slug: string;
    title: string;
  }>;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS headers
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────────────────────
// Environment variables
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[questions-brain] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars"
  );
}
if (!OPENAI_API_KEY) {
  console.error("[questions-brain] Missing OPENAI_API_KEY env var");
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt for the FAQ brain
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are **Dipsy Questions Brain**, the FAQ and documentation assistant for **Atlas Command**.

Your ONLY knowledge comes from:
- The **atlas_docs** table (Markdown docs)
- The **question** plus **context** the caller passes you

You are NOT a general dispatch AI here. You are a **doc explainer** with strict anti-hallucination rules.

---

## 1. Core behavior

1. Always base your answers on **atlas_docs** content.
2. If the docs do NOT clearly answer the question, say:
   - "This is not documented in Atlas yet."  
   Optionally add:  
   - "Please confirm with your team lead or Atlas support."
3. When you *do* answer:
   - Be concise and practical.
   - Use bullet points and short paragraphs.
   - Prefer concrete workflows and definitions over theory.
4. If multiple docs are relevant, reconcile them clearly and mention both perspectives.

---

## 1b. Listing available documentation

If the user asks what documentation exists, or says things like:
- "What topics are documented?"
- "List all Atlas documentation topics you know about."
- "What docs are available?"

Then it IS in scope. In that case:

- Provide a short bullet list of the main documentation topics you see in the provided docs.
- Use their **titles** (and optionally slugs in backticks), e.g.:
  - Load Lifecycle (\`load-lifecycle\`)
  - Accessorials (\`accessorials\`)
  - Ready_for_Billing (\`ready-for-billing\`)

Keep it summary-level; do NOT try to invent docs that are not present.

---

## 1c. Basic operational “how-to” questions for documented concepts

If the question is a **basic "how do I" operational question** about a concept that *is* documented in \`atlas_docs\` (for example: load, driver, driver assignment, load lifecycle, Ready for Billing, POD, documents, exceptions, appointments, accessorials, invoices, payments, load board, statuses), you should answer it at a **conceptual Atlas level**, even if the exact step-by-step UI clicks are not fully documented.

In these cases:

1. Use the docs as your ground truth for:
   - Correct terminology
   - Valid statuses and transitions
   - Required documents
   - Responsibilities of each role
2. Give a short, practical 3–7 step outline of **how this is done in Atlas**, focusing on:
   - Which object is being acted on (Load, Driver, Document, etc.)
   - Which statuses are involved (e.g. AVAILABLE → PENDING_PICKUP → IN_TRANSIT)
   - Which documents are required (e.g. BOL, POD)
   - Who is responsible (dispatcher, billing, etc.)
3. Avoid inventing exact button labels, menu names, or page names **unless** they are explicitly present in the docs.
   - Use generic phrasing like: "Open the Load details page", "Assign a driver to the load", "Confirm the driver has pickup and delivery details", etc.
4. When you have to be generic about UI, end with a small reminder such as:
   - "Exact button labels may differ; follow your current Atlas UI and team SOPs."

Only fall back to **"This is not documented in Atlas yet."** when:
- The underlying concept itself is not present in any doc, **or**
- Answering would require guessing about data model fields, system behavior, or configuration that is not described in the docs.

---

## 2. Load status canon for Atlas

Atlas Command uses **only these authoritative load statuses**:

- **AVAILABLE**
- **PENDING_PICKUP**
- **IN_TRANSIT**
- **DELIVERED**
- **READY_FOR_BILLING**
- **PROBLEM**
- **CANCELLED**

When asked "what statuses exist" or anything about statuses, always:

- List **only** the statuses above.
- Make it clear these are the **authoritative** Atlas statuses.

If a user mentions any of the following as "statuses", you MUST correct them:

- DISPATCHED
- PICKED_UP or PICKED UP
- ENROUTE / EN ROUTE / ON THE WAY
- AT_SHIPPER / AT_RECEIVER / AT CONSIGNEE
- INVOICED
- PAID
- ANY_OTHER_FREEFORM_LABEL

Explain that:

> These may appear in rate cons, notes, billing systems, or human conversation,  
> but they are **not load statuses in Atlas Command**.

Your job is to reinforce the canonical list and prevent status drift.

---

## 3. Load lifecycle reasoning

When asked about "lifecycle", "flow", or "what happens next", reason strictly with the statuses above plus what is written in **atlas_docs**.

Default, high-level lifecycle (unless docs say otherwise):

1. **AVAILABLE**  
   - Load is created and visible for planning.  
   - No driver is committed yet.

2. **PENDING_PICKUP**  
   - Driver is planned/assigned and moving toward shipper or pickup.  
   - The load has not yet been picked up.

3. **IN_TRANSIT**  
   - The load has been picked up.  
   - Driver is actively moving between stops toward delivery.

4. **DELIVERED**  
   - The load has physically delivered.  
   - POD may or may not yet be uploaded/confirmed.

5. **READY_FOR_BILLING**  
   - Operational side is complete.  
   - POD is received and verified per the "Ready for Billing" documentation.  
   - Load is locked for billing and can move into invoicing workflows.

6. **PROBLEM**  
   - Used when something is wrong: breakdown, refusal, major delay, etc.  
   - It can be entered from **PENDING_PICKUP** or **IN_TRANSIT** or even after **DELIVERED** if the issue is discovered later.  
   - You must describe this as a **branching / exception path**, not a normal step in the lifecycle.

7. **CANCELLED**  
   - Load is cancelled before completion.  
   - Typically from **AVAILABLE** or **PENDING_PICKUP**.  
   - Once cancelled, it does not continue the normal lifecycle.

When explaining transitions:

- Use arrows like: \`AVAILABLE → PENDING_PICKUP → IN_TRANSIT → DELIVERED → READY_FOR_BILLING\`.
- Make it clear that **PROBLEM** and **CANCELLED** are branches, not steps everyone goes through.

If the documentation for a specific edge case is missing (for example, "can a load go from IN_TRANSIT back to AVAILABLE?"), you must say it is not documented.

---

## 4. Billing and Ready_for_Billing

When asked about **READY_FOR_BILLING** or billing workflows:

- Use the dedicated docs: \`ready_for_billing\`, \`billing_workflow\`, \`invoice\`, and any related entries.
- Emphasize that READY_FOR_BILLING means:
  - Operational work is complete.
  - POD is present and verified.
  - The load is locked for billing and invoice creation.

Do **not** invent extra billing states beyond what the docs describe.

---

## 5. Style and safety rules

1. Never invent new fields, statuses, or features that are not in the docs.
2. Never guess at internal table names or APIs.
3. If the question is about something clearly outside Atlas product behavior (e.g., general trucking industry trivia), reply with:
   - "This question is outside the scope of Atlas documentation."
4. For multi-step explanations:
   - Present them as clean sequences or bullet lists.
   - Tie each step back to the specific Atlas concept (status, workflow, doc name).
5. When reasonably possible, subtly reinforce **correct Atlas terminology**:
   - If the user says "dispatched", align it to **PENDING_PICKUP** or **IN_TRANSIT** per docs and explain the difference.
   - If they say "completed", clarify whether they mean **DELIVERED** or **READY_FOR_BILLING**.

---

## 6. When you are unsure

If the docs are ambiguous, conflicting, or silent:

- Say clearly that it is **not fully documented**.
- Offer the safest interpretation that **does not change data model semantics**.
- Recommend confirming with an ops lead or Atlas support before changing any process.

You are a careful, documentation-first explainer.  
Your primary job is to **protect Atlas ground truth** and stop status drift or undocumented behavior from creeping in.
`;


// ─────────────────────────────────────────────────────────────────────────────
// Static fallback docs (used when atlas_docs table is empty)
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_ATLAS_DOCS: AtlasDoc[] = [
  {
    id: "static-load-statuses",
    slug: "load-statuses",
    title: "Atlas Command Load Statuses",
    domain: "Operations",
    doc_type: "Reference",
    summary: "Canonical list of load statuses in Atlas Command",
    body: `
# Atlas Command Load Statuses

Atlas Command uses the following **authoritative** load statuses:

1. **AVAILABLE** - Load is created and visible for planning. No driver committed.
2. **PENDING_PICKUP** - Driver assigned, moving toward pickup location.
3. **IN_TRANSIT** - Load picked up, driver actively moving toward delivery.
4. **DELIVERED** - Load physically delivered. POD may be pending.
5. **READY_FOR_BILLING** - Operations complete, POD verified, ready for invoicing.
6. **PROBLEM** - Exception state for breakdowns, refusals, delays.
7. **CANCELLED** - Load cancelled before completion.

## Important Notes

- DISPATCHED, PICKED_UP, ENROUTE, INVOICED, PAID are NOT valid Atlas statuses
- PROBLEM and CANCELLED are exception paths, not normal workflow steps
- Status transitions follow: AVAILABLE → PENDING_PICKUP → IN_TRANSIT → DELIVERED → READY_FOR_BILLING
    `,
  },
  {
    id: "static-ready-for-billing",
    slug: "ready-for-billing",
    title: "Ready for Billing Workflow",
    domain: "Billing",
    doc_type: "Workflow",
    summary: "How loads transition to READY_FOR_BILLING status",
    body: `
# Ready for Billing

A load becomes **READY_FOR_BILLING** when:

1. The load has been **DELIVERED**
2. Proof of Delivery (POD) has been uploaded
3. POD has been verified/approved by dispatch
4. All required documentation is complete

## What happens next

Once a load is READY_FOR_BILLING:

- It appears in the Billing queue
- An invoice can be generated
- The load is "locked" - operational changes require special handling
- Revenue can be recognized

## Key Points

- READY_FOR_BILLING is NOT the same as INVOICED or PAID
- Those are billing system states, not Atlas load statuses
- Atlas tracks operational status; billing tracks financial status
    `,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Load docs from database
// ─────────────────────────────────────────────────────────────────────────────

async function loadAtlasDocs(
  supabase: ReturnType<typeof createClient>
): Promise<AtlasDoc[]> {
  const { data, error } = await supabase
    .from("atlas_docs")
    .select(
      "id, slug, title, domain, doc_type, summary, body, version, related_docs"
    )
    .order("domain", { ascending: true })
    .order("slug", { ascending: true });

  if (error) {
    console.error("[questions-brain] Error loading atlas_docs:", error.message);
    return [];
  }

  return (data ?? []) as AtlasDoc[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Enforce POST only
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed, use POST" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Supabase client uses anon key + user's JWT so that:
    // - RLS still applies for any logging
    // - We do NOT read tenant/org data for knowledge
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Verify the user is real
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[questions-brain] auth.getUser error:", userError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const body = (await req.json()) as QuestionsBrainRequest;

    if (!body.question || typeof body.question !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'question' in request body" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const question = body.question.trim();
    const context = body.context ?? {};
    const source = body.source ?? "unknown";

    if (!question) {
      return new Response(
        JSON.stringify({ error: "Question cannot be empty" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // We intentionally do NOT read org_id or any tenant data here.
    const orgId: string | null = null;

    // 1) Load docs from Supabase (RLS respected)
    let atlasDocs: AtlasDoc[] = await loadAtlasDocs(supabase);

    // Fallback to static docs if DB empty
    if (!atlasDocs || atlasDocs.length === 0) {
      console.warn(
        "[questions-brain] atlas_docs table empty or unavailable — using STATIC_ATLAS_DOCS"
      );
      atlasDocs = STATIC_ATLAS_DOCS;
    }

    // 2) Build a compact docs string for the AI
    const docsForModel = atlasDocs
      .map((doc) => {
        const title = doc.title ?? "Untitled";
        const slug = doc.slug ?? "";
        const domain = doc.domain ?? "General";
        const docType = doc.doc_type ?? "General";
        const summary = doc.summary ?? "";
        const bodyText = doc.body ?? "";

        return [
          `# ${title}`,
          slug ? `Slug: ${slug}` : "",
          `Domain: ${domain}`,
          `Type: ${docType}`,
          summary ? `Summary: ${summary}` : "",
          "",
          bodyText,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n---\n\n");

    // 3) Call OpenAI to generate an answer based on these docs
    const openAiPayload = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "system",
          content: [
            "Here are the Atlas documentation snippets you can use:",
            docsForModel,
          ].join("\n\n"),
        },
        {
          role: "user",
          content: [
            "User question:",
            question,
            "",
            "Extra context (may be partial):",
            JSON.stringify(context, null, 2),
          ].join("\n"),
        },
      ],
      temperature: 0.1, // low = less "creative", more factual
    };

    const openAiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openAiPayload),
      }
    );

    if (!openAiRes.ok) {
      const text = await openAiRes.text();
      console.error("[questions-brain] OpenAI error:", openAiRes.status, text);
      return new Response(
        JSON.stringify({
          error:
            "I had trouble generating an answer just now. Please try again in a moment.",
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const openAiJson = (await openAiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const answer =
      openAiJson.choices?.[0]?.message?.content?.trim() ??
      "I'm not sure how to answer that based on the docs I have. Please contact support for clarification.";

    // Build response payload with basic doc references
    const responsePayload: QuestionsBrainResponse = {
      answer,
      sources: atlasDocs.map((doc) => ({
        id: doc.id,
        slug: doc.slug,
        title: doc.title,
      })),
    };

    // 4) Try to log the question/answer (best-effort, ignore errors)
    const answerPreview = answer.slice(0, 240);

    try {
      await supabase.from("atlas_questions_log").insert({
        org_id: orgId,
        user_id: user.id,
        question,
        answer_preview: answerPreview,
        source,
      });
    } catch (logErr) {
      console.error("[questions-brain] Error logging question:", logErr);
      // Do NOT throw; logging failure should not break user experience
    }

    // 5) Return answer to the caller
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[questions-brain] Unhandled error:", err);
    return new Response(
      JSON.stringify({
        error:
          "Something went wrong while answering that question. Please try again.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});