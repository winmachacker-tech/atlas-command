// FILE: supabase/functions/dipsy-training-rewriter/index.ts
// Purpose:
// - Auto-rewrite weak / hallucinated answers for the Dipsy Questions Brain.
// - Uses the Evaluator's JSON (in dipsy_training_examples.evaluation) to decide
//   which rows need rewriting.
// - Only rewrites rows where:
//     • evaluation.rewrite_recommended === true
//     • rewritten_answer IS NULL
// - Writes the rewritten answer back into dipsy_training_examples.rewritten_answer.
// - Human still approves/rejects in the Dipsy Training Review UI.
//
// Security:
// - INTERNAL ONLY endpoint.
// - Must include ?token=... matching DIPSY_TRAINING_TOKEN env var.
// - Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS on training tables.
//   (Not exposed to browsers; only cron/CLI hits this.)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

// Read training token lazily inside handler

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EvaluationJson = {
  overall_score: number;
  dimensions: {
    accuracy: number;
    grounding: number;
    clarity: number;
    completeness: number;
    style_tone: number;
  };
  verdict:
    | "excellent"
    | "good"
    | "good_but_improvable"
    | "needs_revision"
    | "unsafe_or_incorrect";
  issues: {
    dimension:
      | "accuracy"
      | "grounding"
      | "clarity"
      | "completeness"
      | "style_tone";
    severity: "low" | "medium" | "high";
    description: string;
  }[];
  rewrite_recommended: boolean;
  rewrite_priority: "low" | "medium" | "high";
  notes_for_rewriter: string | null;
};

type TrainingExampleRow = {
  id: string;
  org_id: string | null;
  question: string | null;
  original_answer: string | null;
  rewritten_answer: string | null;
  evaluation: EvaluationJson | null;
  overall_score: number | null;
  verdict: string | null;
};

const REWRITER_SYSTEM_PROMPT = `
You are the Dipsy Questions Brain Rewriter for Atlas Command.

Your job:
- Take a QUESTION and an ORIGINAL_ANSWER that was previously given to a user.
- Also receive structured EVALUATION guidance (notes_for_rewriter).
- Produce a SINGLE improved ANSWER that is:
  - 100% consistent with Atlas docs (no hallucinations, no guessing).
  - Clear, concise, and well structured.
  - Honest about unknowns: if docs don't say, explicitly say "Atlas docs don't specify ...".
  - Neutral, professional, slightly friendly, not chatty or silly.

Hard rules:
- You are ONLY answering questions about Atlas Command (a TMS).
- If the original answer relied on automation or features that DON'T exist
  (e.g. workflow engines, GPS-based auto status changes, QuickBooks automation, etc.),
  you MUST remove those claims and replace them with explicit "user must click X" style language.
- If docs don't clearly describe a feature, you must say that and avoid inventing UI elements.

Output:
- Return ONLY the final rewritten answer as Markdown text.
- Do NOT include JSON.
- Do NOT mention that you are rewriting or evaluating anything.
`.trim();

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";

    const DIPSY_TRAINING_TOKEN = (Deno.env.get("DIPSY_TRAINING_TOKEN") ?? "")
      .trim();

    if (!DIPSY_TRAINING_TOKEN) {
      console.error("[dipsy-training-rewriter] Missing DIPSY_TRAINING_TOKEN");
      return jsonResponse(500, {
        ok: false,
        error: "Training rewriter misconfigured (missing token env).",
      });
    }

    if (!token || token !== DIPSY_TRAINING_TOKEN) {
      return jsonResponse(401, {
        ok: false,
        error: "Unauthorized: invalid training token.",
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error(
        "[dipsy-training-rewriter] Missing SUPABASE_URL or SERVICE_ROLE",
      );
      return jsonResponse(500, {
        ok: false,
        error: "Training rewriter misconfigured (missing Supabase env).",
      });
    }

    if (!OPENAI_API_KEY) {
      console.error("[dipsy-training-rewriter] Missing OPENAI_API_KEY");
      return jsonResponse(500, {
        ok: false,
        error: "Training rewriter misconfigured (missing OpenAI key).",
      });
    }

    const body = await req.json().catch(() => ({} as any));
    const limitRaw = typeof body.limit === "number" ? body.limit : 20;
    const limit = Math.max(1, Math.min(limitRaw, 50));

    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );

    console.log(
      `[dipsy-training-rewriter] Starting run. limit=${limit}`,
    );

    // 1) Find examples that:
    //    - have evaluation
    //    - evaluation.rewrite_recommended == true
    //    - rewritten_answer IS NULL
    const { data: examples, error: fetchErr } = await supabase
      .from("dipsy_training_examples")
      .select(
        `
        id,
        org_id,
        question,
        original_answer,
        rewritten_answer,
        evaluation,
        overall_score,
        verdict
      `,
      )
      .is("rewritten_answer", null)
      .not("evaluation", "is", null)
      .contains("evaluation", { rewrite_recommended: true })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (fetchErr) {
      console.error(
        "[dipsy-training-rewriter] Failed to fetch examples:",
        fetchErr,
      );
      return jsonResponse(500, {
        ok: false,
        error: fetchErr.message || "Failed to fetch training examples.",
      });
    }

    if (!examples || examples.length === 0) {
      console.log(
        "[dipsy-training-rewriter] No examples needing rewrite.",
      );
      return jsonResponse(200, {
        ok: true,
        processed: 0,
        skipped: 0,
        failures: [],
        message: "No rewrite_recommended examples without rewritten_answer.",
      });
    }

    let processed = 0;
    let skipped = 0;
    const failures: { id: string; error: string }[] = [];

    for (const row of examples as TrainingExampleRow[]) {
      if (!row.question || !row.original_answer || !row.evaluation) {
        skipped++;
        continue;
      }

      const evalJson = row.evaluation;
      if (!evalJson.rewrite_recommended) {
        // Shouldn't happen due to filter, but be safe.
        skipped++;
        continue;
      }

      try {
        const rewritten = await runRewriter(
          row.question,
          row.original_answer,
          evalJson.notes_for_rewriter ?? "",
        );

        const { error: updateErr } = await supabase
          .from("dipsy_training_examples")
          .update({
            rewritten_answer: rewritten,
          })
          .eq("id", row.id);

        if (updateErr) {
          console.error(
            "[dipsy-training-rewriter] Update error:",
            updateErr,
          );
          failures.push({
            id: row.id,
            error: updateErr.message || "Failed to update rewritten_answer.",
          });
          continue;
        }

        processed++;
      } catch (e) {
        console.error(
          "[dipsy-training-rewriter] Rewrite failed for example",
          row.id,
          e,
        );
        failures.push({
          id: row.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    console.log(
      `[dipsy-training-rewriter] Completed. processed=${processed}, skipped=${skipped}, failures=${failures.length}`,
    );

    return jsonResponse(200, {
      ok: true,
      processed,
      skipped,
      failures,
    });
  } catch (err) {
    console.error("[dipsy-training-rewriter] Unhandled error:", err);
    return jsonResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ------------------------------ OpenAI helper ------------------------------

async function runRewriter(
  question: string,
  originalAnswer: string,
  notesForRewriter: string,
): Promise<string> {
  const userPayload = {
    question,
    original_answer: originalAnswer,
    notes_for_rewriter: notesForRewriter,
  };

  const payload = {
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: REWRITER_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("[runRewriter] OpenAI error:", res.status, txt);
    throw new Error(`OpenAI rewriter error ${res.status}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;

  if (!message || !message.content) {
    throw new Error("OpenAI rewriter returned no content.");
  }

  const contentStr =
    typeof message.content === "string"
      ? message.content
      : String(message.content);

  return contentStr.trim();
}
