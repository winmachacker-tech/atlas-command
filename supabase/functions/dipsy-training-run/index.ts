// FILE: supabase/functions/dipsy-training-run/index.ts
// Purpose: Combined training pipeline - ingest + embed
// 1) Ingest new interactions from dipsy_interaction_log → dipsy_training_examples
// 2) Generate embeddings for approved examples

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import OpenAI from "npm:openai";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { batch_size?: number };
    const batchSize = body.batch_size && body.batch_size > 0 ? body.batch_size : 50;

    // ========== STEP 1: INGEST new interactions ==========
    const ingestResult = await ingestNewInteractions(batchSize);
    console.log("[dipsy-training-run] Ingest result:", ingestResult);

    // ========== STEP 2: EMBED approved examples ==========
    const { data: examples, error: examplesError } = await supabaseAdmin
      .from("dipsy_training_examples")
      .select("id, org_id, question, rewritten_answer, status")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(batchSize);

    if (examplesError) {
      return jsonResponse({
        ok: false,
        stage: "fetch_examples",
        error: examplesError.message,
        ingest: ingestResult,
      }, 500);
    }

    if (!examples || examples.length === 0) {
      return jsonResponse({
        ok: true,
        ingest: ingestResult,
        embed: { processed: 0, message: "No approved examples to embed." },
      }, 200);
    }

    const exampleIds = examples.map((ex) => ex.id);

    const { data: existingEmbeddings, error: existingError } = await supabaseAdmin
      .from("dipsy_training_embeddings")
      .select("example_id")
      .in("example_id", exampleIds);

    if (existingError) {
      return jsonResponse({
        ok: false,
        stage: "fetch_existing_embeddings",
        error: existingError.message,
        ingest: ingestResult,
      }, 500);
    }

    const alreadyEmbedded = new Set(
      (existingEmbeddings || []).map((row: { example_id: string }) => row.example_id)
    );
    const toEmbed = examples.filter((ex) => !alreadyEmbedded.has(ex.id));

    if (toEmbed.length === 0) {
      return jsonResponse({
        ok: true,
        ingest: ingestResult,
        embed: { processed: 0, message: "All approved examples already have embeddings." },
      }, 200);
    }

    let successCount = 0;
    const failures: Array<{ example_id: string; error: string }> = [];

    for (const ex of toEmbed) {
      try {
        const text = `Question: ${ex.question ?? ""}\n\nAnswer: ${ex.rewritten_answer ?? ""}`;

        const embeddingRes = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: text,
        });

        const embedding = embeddingRes.data[0]?.embedding;
        if (!embedding) throw new Error("No embedding returned from OpenAI");

        const { error: upsertError } = await supabaseAdmin
          .from("dipsy_training_embeddings")
          .upsert(
            {
              org_id: ex.org_id,
              example_id: ex.id,
              embedding,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "example_id" }
          );

        if (upsertError) throw upsertError;
        successCount += 1;
      } catch (err) {
        failures.push({
          example_id: ex.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return jsonResponse({
      ok: true,
      ingest: ingestResult,
      embed: { processed: successCount, attempted: toEmbed.length, failures },
    }, 200);
  } catch (err) {
    return jsonResponse({
      ok: false,
      stage: "unhandled",
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ========== INGEST FUNCTION ==========
async function ingestNewInteractions(batchSize: number): Promise<{
  inserted: number;
  skipped: number;
  message?: string;
}> {
  // Fetch candidate interactions for questions_brain
  const { data, error } = await supabaseAdmin
    .from("dipsy_interaction_log")
    .select(`
      id,
      org_id,
      user_id,
      channel,
      agent_type,
      question,
      answer,
      created_at
    `)
    .eq("agent_type", "questions_brain")
    .not("question", "is", null)
    .not("answer", "is", null)
    .order("created_at", { ascending: false })
    .limit(batchSize);

  if (error) {
    console.error("[ingest] Failed to fetch interactions", error);
    return { inserted: 0, skipped: 0, message: `Fetch error: ${error.message}` };
  }

  if (!data || data.length === 0) {
    return { inserted: 0, skipped: 0, message: "No interactions to process" };
  }

  const interactionIds = data.map((d: any) => d.id);

  // Find already-processed interactions
  const { data: existingExamples, error: existingError } = await supabaseAdmin
    .from("dipsy_training_examples")
    .select("interaction_id, linked_interaction_id")
    .in("interaction_id", interactionIds);

  if (existingError) {
    console.error("[ingest] Failed to check existing examples", existingError);
    return { inserted: 0, skipped: 0, message: `Existing check error: ${existingError.message}` };
  }

  const alreadyProcessedIds = new Set<string>();
  (existingExamples ?? []).forEach((row: any) => {
    if (row.interaction_id) alreadyProcessedIds.add(row.interaction_id);
    if (row.linked_interaction_id) alreadyProcessedIds.add(row.linked_interaction_id);
  });

  const interactions = data.filter((row: any) => !alreadyProcessedIds.has(row.id));

  if (interactions.length === 0) {
    return { inserted: 0, skipped: 0, message: "All interactions already processed" };
  }

  let inserted = 0;
  let skipped = 0;

  for (const interaction of interactions) {
    const payload = {
      org_id: interaction.org_id,
      user_id: interaction.user_id,
      agent_type: interaction.agent_type ?? "questions_brain",
      channel: interaction.channel ?? null,
      question: interaction.question,
      original_answer: interaction.answer,
      answer: interaction.answer,
      rewritten_answer: null,
      interaction_id: interaction.id,
      linked_interaction_id: interaction.id,
      source_type: "questions_brain",
      status: "draft",
      correctness_score: null,
      grounded_status: "UNKNOWN",
      has_governance_issues: false,
      hallucination_flags: [],
      tags: [],
      doc_citations: [],
      evaluator_run_id: null,
      revision_run_id: null,
      policy_review_id: null,
      created_by: "dipsy-training-run",
      evaluation_model: null,
      evaluation_notes: null,
      evaluated_at: null,
      overall_score: null,
      verdict: null,
      evaluation: null,
      approved_at: null,
      approved_by: null,
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
    };

    const { error: insertError } = await supabaseAdmin
      .from("dipsy_training_examples")
      .insert(payload);

    if (insertError) {
      console.error("[ingest] Insert failed for", interaction.id, insertError.message);
      skipped++;
    } else {
      inserted++;
    }
  }

  return { inserted, skipped };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
