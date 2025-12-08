// FILE: supabase/functions/dipsy-training-ingest/index.ts
// Purpose:
// - Ingest dipsy_interaction_log rows into dipsy_training_examples.
// - This is the FIRST step in the training loop pipeline.
//
// Pipeline:
//   1) User asks a question -> logged in dipsy_interaction_log (agent_type = 'questions_brain').
//   2) This function (ingest) turns those into dipsy_training_examples rows (status = 'draft').
//   3) Evaluator function scores them into dipsy_training_evaluations.
//   4) Rewriter function uses evaluations to propose rewritten_answer.
//   5) Human review UI reads from dipsy_training_examples.
//
// Security:
// - INTERNAL ONLY endpoint.
// - Requires x-atlas-training-token header OR { "token": ... } in body
//   which must match DIPSY_TRAINING_TOKEN env var.
// - Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS on training tables
//   (NOT exposed to browser or user JWTs).
//
// Request body options:
//   { "interaction_id": "<uuid>" }   - Process a single interaction by ID
//   { "batch_size": 50 }             - Process up to N unprocessed interactions
//   {}                               - Default batch_size: 50
//
// Response:
//   200 { ok: true, inserted, skipped, message? }
//   4xx/5xx { ok: false, error }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_TOKEN = (Deno.env.get("DIPSY_TRAINING_TOKEN") ?? "").trim();

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atlas-training-token, x-atlas-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  // --- Parse body (we also allow token in body) ---
  let body: any = {};
  try {
    const text = await req.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch (_err) {
    console.error("[dipsy-training-ingest] Invalid JSON body");
    return jsonResponse(400, {
      ok: false,
      error: "Invalid JSON body",
    });
  }

  // --- Auth: internal token check (header OR body) ---
  if (!INTERNAL_TOKEN) {
    console.error("[dipsy-training-ingest] DIPSY_TRAINING_TOKEN env var is not set!");
    return jsonResponse(500, {
      ok: false,
      error: "Server misconfiguration: training token not set",
    });
  }

  const headerToken =
    req.headers.get("x-atlas-training-token") ??
    req.headers.get("X-Atlas-Training-Token") ??
    req.headers.get("x-atlas-internal-token") ??
    req.headers.get("X-Atlas-Internal-Token") ??
    "";

  const bodyToken = body?.token ?? body?.training_token ?? "";
  const providedToken = (headerToken || bodyToken || "").trim();

  console.log("[dipsy-training-ingest] Auth check", {
    hasEnvToken: !!INTERNAL_TOKEN,
    headerTokenPresent: !!headerToken,
    bodyTokenPresent: !!bodyToken,
    tokenSource: headerToken ? "header" : bodyToken ? "body" : "none",
  });

  if (!providedToken) {
    console.error("[dipsy-training-ingest] No token provided");
    return jsonResponse(401, {
      ok: false,
      error:
        "Missing token (provide via x-atlas-training-token header or 'token' in body)",
    });
  }

  if (providedToken !== INTERNAL_TOKEN) {
    console.error("[dipsy-training-ingest] Token mismatch");
    return jsonResponse(401, {
      ok: false,
      error: "Invalid training token",
    });
  }

  console.log("[dipsy-training-ingest] Auth passed ✓");

  // --- Mode: single interaction vs batch ---
  const singleInteractionId: string | null =
    body?.interaction_id ?? body?.interactionId ?? null;
  const batchSize: number = body?.batch_size ?? 50;

  console.log("[dipsy-training-ingest] Mode:", singleInteractionId ? "single" : "batch", {
    singleInteractionId,
    batchSize,
  });

  let interactions: any[] = [];

  if (singleInteractionId) {
    // Single-mode: fetch one specific interaction
    const { data, error } = await supabase
      .from("dipsy_interaction_log")
      .select(
        `
        id,
        org_id,
        user_id,
        channel,
        agent_type,
        question,
        answer,
        created_at
      `,
      )
      .eq("id", singleInteractionId)
      .eq("agent_type", "questions_brain")
      .maybeSingle();

    if (error || !data) {
      console.error("[dipsy-training-ingest] Interaction not found or not questions_brain", error);
      return jsonResponse(404, {
        ok: false,
        error: "Interaction not found or not eligible",
      });
    }

    if (!data.question || !data.answer) {
      console.error("[dipsy-training-ingest] Missing question/answer for interaction", data.id);
      return jsonResponse(400, {
        ok: false,
        error: "Interaction has no question/answer",
      });
    }

    interactions = [data];
  } else {
    // Batch mode: fetch candidate interactions for questions_brain
    const { data, error } = await supabase
      .from("dipsy_interaction_log")
      .select(
        `
        id,
        org_id,
        user_id,
        channel,
        agent_type,
        question,
        answer,
        created_at
      `,
      )
      .eq("agent_type", "questions_brain")
      .not("question", "is", null)
      .not("answer", "is", null)
      .order("created_at", { ascending: false })
      .limit(batchSize);

    if (error) {
      console.error("[dipsy-training-ingest] Failed to fetch interactions", error);
      return jsonResponse(500, {
        ok: false,
        error: "Failed to fetch interactions",
      });
    }

    if (!data || data.length === 0) {
      console.log("[dipsy-training-ingest] No eligible questions_brain interactions found");
      return jsonResponse(200, {
        ok: true,
        inserted: 0,
        skipped: 0,
        message: "No interactions to process",
      });
    }

    const interactionIds = data.map((d: any) => d.id);

    // Find already-processed interactions in dipsy_training_examples
    const { data: existingExamples, error: existingError } = await supabase
      .from("dipsy_training_examples")
      .select("interaction_id, linked_interaction_id")
      .in("interaction_id", interactionIds);

    if (existingError) {
      console.error(
        "[dipsy-training-ingest] Failed to check existing examples",
        existingError,
      );
      return jsonResponse(500, {
        ok: false,
        error: "Failed to check existing examples",
      });
    }

    const alreadyProcessedIds = new Set<string>();
    (existingExamples ?? []).forEach((row: any) => {
      if (row.interaction_id) alreadyProcessedIds.add(row.interaction_id);
      if (row.linked_interaction_id) alreadyProcessedIds.add(row.linked_interaction_id);
    });

    interactions = data.filter((row: any) => !alreadyProcessedIds.has(row.id));

    console.log(
      "[dipsy-training-ingest] Found",
      data.length,
      "interactions,",
      interactions.length,
      "unprocessed",
    );
  }

  if (interactions.length === 0) {
    return jsonResponse(200, {
      ok: true,
      inserted: 0,
      skipped: 0,
      message: "All interactions already processed",
    });
  }

  // --- Insert into dipsy_training_examples ---
  let inserted = 0;
  let skipped = 0;

  for (const interaction of interactions) {
    const payload = {
      org_id: interaction.org_id,
      user_id: interaction.user_id,
      agent_type: interaction.agent_type ?? "questions_brain",
      channel: interaction.channel ?? null,

      // Q&A
      question: interaction.question,
      original_answer: interaction.answer, // THIS is what the evaluator scored
      answer: interaction.answer, // keep for compatibility if you still use it
      rewritten_answer: null,

      // Link back to interaction
      interaction_id: interaction.id,
      linked_interaction_id: interaction.id,

      // Training metadata
      source_type: "questions_brain",
      status: "draft", // UI expects 'draft' for review queue
      correctness_score: null,
      grounded_status: "UNKNOWN",
      has_governance_issues: false,
      hallucination_flags: [],
      tags: [],
      doc_citations: [],
      evaluator_run_id: null,
      revision_run_id: null,
      policy_review_id: null,
      created_by: "dipsy-training-ingest",

      // Evaluation fields will be populated later by evaluator/rewriter
      evaluation_model: null,
      evaluation_notes: null,
      evaluated_at: null,
      overall_score: null,
      verdict: null,
      evaluation: null,

      // Human-review fields
      approved_at: null,
      approved_by: null,
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
    };

    const { error: insertError } = await supabase
      .from("dipsy_training_examples")
      .insert(payload);

    if (insertError) {
      console.error(
        "[dipsy-training-ingest] Insert failed for interaction",
        interaction.id,
        insertError.message,
      );
      skipped++;
    } else {
      inserted++;
    }
  }

  console.log("[dipsy-training-ingest] Complete:", { inserted, skipped });

  return jsonResponse(200, {
    ok: true,
    inserted,
    skipped,
  });
});

// ----------------- Helper -----------------

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
