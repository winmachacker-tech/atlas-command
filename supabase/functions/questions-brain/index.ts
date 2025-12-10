// FILE: supabase/functions/questions-brain/index.ts
// Purpose:
// - FAQ / docs brain for Atlas Command (Dipsy).
// - Uses approved dipsy_training_examples (with embeddings) FIRST.
//   Only falls back to atlas_docs when there is no strong training match.
// - Logs knowledge gaps when no documentation is found.
//
// Flow:
// 1. Resolve org_id for the current user (via JWT + org_members) OR use provided org_id.
// 2. Generate an embedding for the question.
// 3. Query match_dipsy_training_examples(_org_id, _query_embedding, _match_threshold, _match_count).
//    - If high-similarity match found => return rewritten_answer directly.
// 4. Otherwise, query match_atlas_docs(_query_embedding, _match_threshold, _match_count).
//    - Use docs as context and ask OpenAI to answer, strictly doc-grounded.
// 5. If no docs found, log to knowledge_gaps table for future doc generation.
//
// Env vars required:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY
// - OPENAI_API_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPENAI_API_KEY) {
  console.error(
    "[questions-brain] Missing env vars: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY",
  );
}

// ============================================================================
// KNOWLEDGE GAP LOGGING
// ============================================================================

async function logKnowledgeGap(
  orgId: string,
  question: string,
  channel: string,
  embedding: number[]
): Promise<void> {
  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Check for duplicate (same question in last 24 hours)
    const { data: existing } = await adminClient
      .from("knowledge_gaps")
      .select("id")
      .eq("org_id", orgId)
      .eq("question", question)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (existing && existing.length > 0) {
      console.log("[questions-brain] Knowledge gap already logged recently:", question.substring(0, 50));
      return;
    }

    const { error } = await adminClient
      .from("knowledge_gaps")
      .insert({
        org_id: orgId,
        question: question,
        source_channel: channel,
        embedding: embedding,
        status: "new",
      });

    if (error) {
      console.error("[questions-brain] Failed to log knowledge gap:", error);
    } else {
      console.log("[questions-brain] Logged knowledge gap:", question.substring(0, 50));
    }
  } catch (err) {
    console.error("[questions-brain] Error logging knowledge gap:", err);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const payload = (await req.json().catch(() => ({}))) as {
      question?: string;
      context?: Record<string, unknown>;
      org_id?: string;
      channel?: string;
      user_name?: string;
    };

    const question = (payload.question ?? "").trim();
    const context = payload.context ?? {};
    const providedOrgId = payload.org_id;
    const channel = payload.channel ?? "web_app";
    const userName = payload.user_name;

    if (!question) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing 'question' in request body.",
        },
        400,
      );
    }

    // 1) Resolve org_id - use provided org_id OR resolve from JWT
    let orgId: string | null = null;
    let supabaseClient: ReturnType<typeof createClient>;

    if (providedOrgId) {
      // Service-role caller provided org_id directly (e.g., Telegram, WhatsApp)
      supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      orgId = providedOrgId;
      console.log("[questions-brain] Using provided org_id:", orgId, "channel:", channel);
    } else {
      // Standard JWT auth flow (web UI)
      supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      });
      orgId = await resolveOrgId(supabaseClient);
    }

    if (!orgId) {
      return jsonResponse(
        {
          ok: false,
          error: "Could not resolve org for this user.",
        },
        403,
      );
    }

    // 2) Create embedding for the question
    const embedding = await createEmbedding(question);
    if (!embedding) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create embedding for question.",
        },
        500,
      );
    }

    // 3) Try training examples first
    const TRAINING_THRESHOLD = 0.85;
    const TRAINING_MATCH_COUNT = 3;

    let usedTrainingExample = false;
    let trainingAnswer: string | null = null;
    let trainingSource: any[] = [];

    const { data: trainingMatches, error: trainingError } =
      await supabaseClient.rpc("match_dipsy_training_examples", {
        _org_id: orgId,
        _query_embedding: embedding,
        _match_threshold: TRAINING_THRESHOLD,
        _match_count: TRAINING_MATCH_COUNT,
      });

    if (trainingError) {
      console.error(
        "[questions-brain] Error calling match_dipsy_training_examples:",
        trainingError,
      );
    }

    if (trainingMatches && trainingMatches.length > 0) {
      const best = trainingMatches[0];
      if (
        typeof best.rewritten_answer === "string" &&
        best.rewritten_answer.trim().length > 0
      ) {
        usedTrainingExample = true;
        trainingAnswer = best.rewritten_answer.trim();
        trainingSource = trainingMatches;
      }
    }

    if (usedTrainingExample && trainingAnswer) {
      return jsonResponse(
        {
          ok: true,
          answer: trainingAnswer,
          sources: {
            training_examples: trainingSource,
            docs: [],
          },
          meta: {
            used_training_example: true,
            org_id: orgId,
            channel,
            context,
          },
        },
        200,
      );
    }

    // 4) Fall back to atlas_docs brain
    const DOC_THRESHOLD = 0.55;
    const DOC_MATCH_COUNT = 8;

    const { data: docMatches, error: docsError } = await supabaseClient.rpc(
      "match_atlas_docs",
      {
        _org_id: orgId,
        _query_embedding: embedding,
        _match_threshold: DOC_THRESHOLD,
        _match_count: DOC_MATCH_COUNT,
      },
    );

    if (docsError) {
      console.error("[questions-brain] Error calling match_atlas_docs:", docsError);
      return jsonResponse(
        {
          ok: false,
          error: "Failed to query atlas docs.",
          details: docsError.message,
        },
        500,
      );
    }

    if (!docMatches || docMatches.length === 0) {
      // Log this as a knowledge gap for future doc generation
      await logKnowledgeGap(orgId, question, channel, embedding);
      
      return jsonResponse(
        {
          ok: true,
          answer:
            "I don't have enough documentation to answer that question yet. Try asking in a different way or add more FAQs / docs to Atlas.",
          sources: {
            training_examples: [],
            docs: [],
          },
          meta: {
            used_training_example: false,
            org_id: orgId,
            channel,
            context,
            knowledge_gap_logged: true,
          },
        },
        200,
      );
    }

    // Build context text from matched docs
    const docsContext = buildDocsContext(docMatches);

    const systemPrompt = [
      "You are Dipsy, the Questions / FAQ brain for Atlas Command.",
      "You must answer ONLY using the documentation excerpts provided.",
      "If the docs are missing or unclear, say you don't know or that the docs don't cover that yet.",
      "Do not invent product behavior. Do not hallucinate features.",
      userName ? `You are speaking with ${userName}.` : "",
    ].filter(Boolean).join(" ");

    const userPrompt = [
      `User question: ${question}`,
      "",
      "Relevant Atlas docs (for your reference only):",
      docsContext,
    ].join("\n");

    const answer = await callOpenAI(systemPrompt, userPrompt);

    return jsonResponse(
      {
        ok: true,
        answer,
        sources: {
          training_examples: [],
          docs: docMatches,
        },
        meta: {
          used_training_example: false,
          org_id: orgId,
          channel,
          context,
        },
      },
      200,
    );
  } catch (err) {
    console.error("[questions-brain] Unhandled error:", err);
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function resolveOrgId(
  supabaseClient: ReturnType<typeof createClient>,
): Promise<string | null> {
  const {
    data: userData,
    error: userError,
  } = await supabaseClient.auth.getUser();

  if (userError || !userData?.user?.id) {
    console.error("[questions-brain] auth.getUser error:", userError);
    return null;
  }

  const userId = userData.user.id;

  const { data: membership, error: membershipError } = await supabaseClient
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("[questions-brain] Error fetching org_members:", membershipError);
  }

  if (membership?.org_id) {
    return membership.org_id;
  }

  console.warn("[questions-brain] No org membership found for user:", userId);
  return null;
}

async function createEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!response.ok) {
      console.error("[questions-brain] Embedding API error:", await response.text());
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error("[questions-brain] Embedding error:", err);
    return null;
  }
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[questions-brain] OpenAI API error:", await response.text());
      return "I couldn't generate an answer right now. Please try again.";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() ?? 
      "I couldn't generate an answer from the docs.";
  } catch (err) {
    console.error("[questions-brain] OpenAI error:", err);
    return "I couldn't generate an answer right now. Please try again.";
  }
}

function buildDocsContext(docMatches: any[]): string {
  return docMatches
    .map((doc, idx) => {
      const title = doc.title ?? doc.slug ?? `Doc #${idx + 1}`;
      const body = doc.body ?? doc.content ?? "";
      const similarity = doc.similarity ?? null;

      return [
        `--- Doc #${idx + 1} (title: ${title})`,
        similarity != null ? `Similarity: ${similarity.toFixed(3)}` : "",
        "",
        body,
        "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}