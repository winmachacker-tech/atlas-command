// FILE: supabase/functions/dipsy-training-evaluate/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface EvaluateRequestBody {
  batch_size?: number;
}

interface TrainingExampleRow {
  id: string;
  org_id: string | null;
  source_type: string;
  question: string;
  answer: string;
  status: string;
  correctness_score: number | null;
  grounded_status: string | null;
  has_governance_issues: boolean;
  hallucination_flags: unknown;
  doc_citations: unknown;
}

interface AtlasDocRow {
  id: string;
  slug: string;
  title: string;
  domain: string | null;
  doc_type: string | null;
  summary: string | null;
  body: string;
}

interface EvaluationResult {
  correctness_score: number;
  grounded_status: "FULLY_GROUNDED" | "PARTIALLY_GROUNDED" | "NOT_GROUNDED";
  has_governance_issues: boolean;
  hallucination_flags: string[];
  doc_citations: { slug: string; title: string; reason: string }[];
  notes: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("DIPSY_TRAINING_EVAL_MODEL") ??
  "gpt-4.1-mini";

const SYSTEM_PROMPT = `
You are the Atlas Command Governance Evaluator.

Your job:
- Evaluate answers produced by the Atlas "Questions Brain" (FAQ agent).
- You MUST ground all judgments ONLY in the provided Atlas docs and governance docs.
- You MUST NOT use any outside knowledge, guesses, or assumptions.

You will be given:
- A user QUESTION.
- The ORIGINAL_ANSWER that Dipsy (Questions Brain) gave.
- One or more DOCS, which contain the official Atlas documentation and governance rules relevant to the question.

Your tasks:
1. Reconstruct the BEST_POSSIBLE_ANSWER strictly from the DOCS.
   - This is only for your own reasoning, not for output.
   - Ignore any knowledge you have outside the DOCS.

2. Compare ORIGINAL_ANSWER to the DOCS:
   - Is it correct given the DOCS?
   - Does it omit important details the DOCS clearly state?
   - Does it invent information that is NOT in the DOCS?
   - Does it violate any governance rules (e.g., hallucinations, overconfident claims when docs are missing, ignoring safety rules)?

3. Classify groundedness:
   - "FULLY_GROUNDED": Answer is factually correct and fully consistent with DOCS. No invented facts.
   - "PARTIALLY_GROUNDED": Some parts are supported by DOCS but there are minor omissions or mild speculation.
   - "NOT_GROUNDED": The answer is mostly inconsistent with DOCS, fabricates details, or relies on missing docs.

4. Scoring:
   - correctness_score: float from 0.0 to 1.0
     - 1.0 = perfectly correct, fully aligned, complete enough for the question.
     - 0.8 = mostly correct, only minor issues.
     - 0.5 = mixed correctness / significant omissions.
     - 0.0 = incorrect or strongly misleading.

5. Governance & hallucinations:
   - has_governance_issues = true if:
     - the answer fabricates details not present in DOCS,
     - the answer is overconfident when docs are obviously missing,
     - the answer contradicts governance rules,
     - or the answer could mislead an operator about how Atlas behaves.
   - hallucination_flags: array of short codes, e.g.:
     - "FABRICATED_FIELD"
     - "FABRICATED_STATUS_VALUE"
     - "UNSUPPORTED_POLICY_CLAIM"
     - "OVERCONFIDENT_WHEN_DOCS_MISSING"
     - "CONTRADICTS_GOVERNANCE"
     - "MISSTATES_STATUS_LIFECYCLE"

6. Doc citations:
   - doc_citations: array of objects:
     - { "slug": string, "title": string, "reason": string }
   - ONLY cite docs that actually support your evaluation.
   - Use the provided doc slug and title.

Output format:
- You MUST return a single valid JSON object with these exact top-level keys:
  - correctness_score (number, 0.0–1.0)
  - grounded_status (string: "FULLY_GROUNDED" | "PARTIALLY_GROUNDED" | "NOT_GROUNDED")
  - has_governance_issues (boolean)
  - hallucination_flags (array of strings)
  - doc_citations (array of { slug, title, reason })
  - notes (string, short explanation for a human reviewer)

Do NOT include any additional top-level keys.
Do NOT include markdown.
Do NOT include prose outside the JSON.
Return ONLY the JSON object.
`.trim();

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function sanitizeSearchTerm(q: string): string {
  // keep it simple: trim + cap length + remove quotes
  return q.replace(/["']/g, "").slice(0, 120);
}

function formatDocsForPrompt(docs: AtlasDocRow[]): string {
  if (!docs.length) {
    return "NO_DOCS_AVAILABLE";
  }
  return docs
    .map((d, idx) => {
      const summary = d.summary ?? "";
      const body = d.body ?? "";
      const clippedBody = body.length > 1800 ? body.slice(0, 1800) + "..." : body;
      return [
        `DOC ${idx + 1}:`,
        `slug: ${d.slug}`,
        `title: ${d.title}`,
        d.domain ? `domain: ${d.domain}` : "",
        d.doc_type ? `doc_type: ${d.doc_type}` : "",
        summary ? `summary: ${summary}` : "",
        `body:`,
        clippedBody,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n--------------------\n\n");
}

async function callOpenAIEval(payload: {
  question: string;
  answer: string;
  docs: AtlasDocRow[];
}): Promise<EvaluationResult> {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const docsText = formatDocsForPrompt(payload.docs);

  const userContent = `
QUESTION:
${payload.question}

ORIGINAL_ANSWER:
${payload.answer}

DOCS:
${docsText}

Remember: base your evaluation ONLY on DOCS. If DOCS do not provide enough information, treat missing information as unknown and penalize overconfident answers.
`.trim();

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.0,
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("No content in OpenAI response");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error("Failed to parse OpenAI JSON: " + String(e));
  }

  // Basic validation/coercion
  const result: EvaluationResult = {
    correctness_score: Number(parsed.correctness_score ?? 0),
    grounded_status: parsed.grounded_status,
    has_governance_issues: Boolean(parsed.has_governance_issues),
    hallucination_flags: Array.isArray(parsed.hallucination_flags)
      ? parsed.hallucination_flags.map((x: any) => String(x))
      : [],
    doc_citations: Array.isArray(parsed.doc_citations)
      ? parsed.doc_citations.map((c: any) => ({
        slug: String(c.slug ?? ""),
        title: String(c.title ?? ""),
        reason: String(c.reason ?? ""),
      }))
      : [],
    notes: String(parsed.notes ?? ""),
  };

  return result;
}

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const authHeader = req.headers.get("authorization") ??
      req.headers.get("Authorization");

    if (!authHeader) {
      return jsonResponse(401, {
        ok: false,
        error: "missing_authorization_header",
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Sanity check: valid user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse(401, {
        ok: false,
        error: "invalid_jwt",
        detail: userError?.message ?? "No user for JWT",
      });
    }

    // Parse batch_size
    let batchSize = 10;
    try {
      const body = (await req.json()) as EvaluateRequestBody;
      if (
        body &&
        typeof body.batch_size === "number" &&
        body.batch_size > 0 &&
        body.batch_size <= 50
      ) {
        batchSize = body.batch_size;
      }
    } catch {
      // ignore invalid/empty body
    }

    // Fetch queued examples for this org (RLS enforces org)
    const { data: examples, error: exErr } = await supabase
      .from("dipsy_training_examples")
      .select(
        "id, org_id, source_type, question, answer, status, correctness_score, grounded_status, has_governance_issues, hallucination_flags, doc_citations",
      )
      .eq("status", "QUEUED_FOR_EVAL")
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (exErr) {
      return jsonResponse(500, {
        ok: false,
        error: "failed_to_query_examples",
        detail: exErr.message,
      });
    }

    if (!examples || !examples.length) {
      return jsonResponse(200, {
        ok: true,
        evaluated: 0,
        skipped: 0,
        message: "No training examples queued for evaluation",
      });
    }

    let evaluatedCount = 0;
    let skippedCount = 0;
    const errors: Record<string, string> = {};

    for (const ex of examples as TrainingExampleRow[]) {
      try {
        const searchTerm = sanitizeSearchTerm(ex.question);

        // Fetch candidate docs for this org (RLS applies)
        const { data: docs, error: docsErr } = await supabase
          .from("atlas_docs")
          .select(
            "id, slug, title, domain, doc_type, summary, body",
          )
          .or(
            `title.ilike.%${searchTerm}%,summary.ilike.%${searchTerm}%,body.ilike.%${searchTerm}%`,
          )
          .order("id", { ascending: true })
          .limit(6);

        if (docsErr) {
          throw new Error("atlas_docs query failed: " + docsErr.message);
        }

        const docsForEval = (docs ?? []) as AtlasDocRow[];

        const evalResult = await callOpenAIEval({
          question: ex.question,
          answer: ex.answer,
          docs: docsForEval,
        });

        const newStatus =
          evalResult.has_governance_issues ||
          evalResult.grounded_status === "NOT_GROUNDED"
            ? "FLAGGED"
            : "EVALUATED";

        const { error: updateErr } = await supabase
          .from("dipsy_training_examples")
          .update({
            correctness_score: evalResult.correctness_score,
            grounded_status: evalResult.grounded_status,
            has_governance_issues: evalResult.has_governance_issues,
            hallucination_flags: evalResult.hallucination_flags,
            doc_citations: evalResult.doc_citations,
            status: newStatus,
            // Optional columns if you added them:
            // evaluation_model: OPENAI_MODEL,
            // evaluation_notes: evalResult.notes,
            // evaluated_at: new Date().toISOString(),
          })
          .eq("id", ex.id);

        if (updateErr) {
          throw new Error("update_failed: " + updateErr.message);
        }

        evaluatedCount++;
      } catch (e) {
        console.error("Evaluation error for example", ex.id, e);
        errors[ex.id] = String(e);
        skippedCount++;
        // We intentionally leave status = 'QUEUED_FOR_EVAL' so we can retry later.
      }
    }

    return jsonResponse(200, {
      ok: true,
      evaluated: evaluatedCount,
      skipped: skippedCount,
      errors,
    });
  } catch (err) {
    console.error("Unhandled error in dipsy-training-evaluate:", err);
    return jsonResponse(500, {
      ok: false,
      error: "unhandled_error",
      detail: String(err),
    });
  }
});
