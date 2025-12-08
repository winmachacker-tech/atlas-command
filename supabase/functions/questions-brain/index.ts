// FILE: supabase/functions/questions-brain/index.ts
// Purpose:
// - FAQ / docs brain for Atlas Command (Dipsy).
// - Uses approved dipsy_training_examples (with embeddings) FIRST.
//   Only falls back to atlas_docs when there is no strong training match.
//
// Flow:
// 1. Resolve org_id for the current user (via JWT + org_members).
// 2. Generate an embedding for the question.
// 3. Query match_dipsy_training_examples(_org_id, _query_embedding, _match_threshold, _match_count).
//    • If high-similarity match found => return rewritten_answer directly.
// 4. Otherwise, query match_atlas_docs(_query_embedding, _match_threshold, _match_count).
//    • Use docs as context and ask OpenAI to answer, strictly doc-grounded.
//
// Env vars required:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - OPENAI_API_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import OpenAI from "npm:openai";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPENAI_API_KEY) {
  console.error(
    "[questions-brain] Missing env vars: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY",
  );
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const payload = (await req.json().catch(() => ({}))) as {
      question?: string;
      context?: Record<string, unknown>;
    };

    const question = (payload.question ?? "").trim();
    const context = payload.context ?? {};

    if (!question) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing 'question' in request body.",
        },
        400,
      );
    }

    // 1) Resolve org_id
    const orgId = await resolveOrgId(supabaseClient);
    if (!orgId) {
      return jsonResponse(
        {
          ok: false,
          error: "Could not resolve org for this user.",
        },
        403,
      );
    }

    // 2) Create embedding once for the question
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    const embedding = embeddingRes.data[0]?.embedding;
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
            context,
          },
        },
        200,
      );
    }

    // 4) Fall back to atlas_docs brain (existing behavior)
    const DOC_THRESHOLD = 0.78;
    const DOC_MATCH_COUNT = 8;

const { data: docMatches, error: docsError } = await supabaseClient.rpc(
  "match_atlas_docs",
  {
    _org_id: orgId,  // Add this
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
            context,
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
    ].join(" ");

    const userPrompt = [
      `User question: ${question}`,
      "",
      "Relevant Atlas docs (for your reference only):",
      docsContext,
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() ??
      "I couldn't generate an answer from the docs.";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

// Resolve org_id via org_members (orgs table has no owner column)
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

  // Get org from membership
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

// Turn matched docs into a compact reference block for the LLM
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