// FILE: supabase/functions/cluster-knowledge-gaps/index.ts
// Purpose:
// - Clusters similar knowledge gaps using vector similarity
// - Generates documentation drafts for each cluster
// - Designed to run as a scheduled job or manual trigger
//
// Flow:
// 1. Fetch all "new" knowledge gaps with embeddings
// 2. Cluster similar questions (cosine similarity > 0.85)
// 3. Create/update knowledge_gap_clusters
// 4. Generate draft documentation using OpenAI
// 5. Save drafts to atlas_docs_drafts for human review
//
// Trigger: POST with optional { org_id, dry_run }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const CLUSTER_SIMILARITY_THRESHOLD = 0.85;
const MIN_CLUSTER_SIZE_FOR_DOC = 1; // Generate doc even for single questions

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetOrgId = body.org_id || null;
    const dryRun = body.dry_run === true;

    console.log("[cluster-gaps] Starting clustering job", { targetOrgId, dryRun });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Fetch all "new" knowledge gaps
    let query = supabase
      .from("knowledge_gaps")
      .select("id, org_id, question, embedding, source_channel, created_at")
      .eq("status", "new")
      .not("embedding", "is", null)
      .order("created_at", { ascending: true });

    if (targetOrgId) {
      query = query.eq("org_id", targetOrgId);
    }

    const { data: gaps, error: gapsError } = await query;

    if (gapsError) {
      console.error("[cluster-gaps] Error fetching gaps:", gapsError);
      return jsonResponse({ error: gapsError.message }, 500);
    }

    if (!gaps || gaps.length === 0) {
      console.log("[cluster-gaps] No new knowledge gaps to process");
      return jsonResponse({
        ok: true,
        message: "No new knowledge gaps to process",
        gaps_processed: 0,
        clusters_created: 0,
        drafts_generated: 0,
      });
    }

    console.log(`[cluster-gaps] Found ${gaps.length} new gaps to cluster`);

    // Parse embeddings - Supabase returns vectors as strings
    const parsedGaps = gaps.map(gap => {
      let embedding = gap.embedding;

      // If embedding is a string, parse it
      if (typeof embedding === "string") {
        try {
          // Remove brackets and split by comma
          embedding = embedding
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((n: string) => parseFloat(n.trim()));
        } catch (e) {
          console.error("[cluster-gaps] Failed to parse embedding for gap:", gap.id);
          embedding = null;
        }
      }

      return { ...gap, embedding };
    }).filter(gap => gap.embedding && Array.isArray(gap.embedding) && gap.embedding.length > 0);

    if (parsedGaps.length === 0) {
      console.log("[cluster-gaps] No gaps with valid embeddings");
      return jsonResponse({
        ok: true,
        message: "No gaps with valid embeddings to process",
        gaps_processed: gaps.length,
        clusters_created: 0,
        drafts_generated: 0,
      });
    }

    console.log(`[cluster-gaps] ${parsedGaps.length} gaps have valid embeddings`);

    // 2) Group gaps by org_id
    const gapsByOrg: Record<string, typeof parsedGaps> = {};
    for (const gap of parsedGaps) {
      if (!gapsByOrg[gap.org_id]) {
        gapsByOrg[gap.org_id] = [];
      }
      gapsByOrg[gap.org_id].push(gap);
    }

    let totalClustersCreated = 0;
    let totalDraftsGenerated = 0;
    const results: any[] = [];

    // 3) Process each org
    for (const [orgId, orgGaps] of Object.entries(gapsByOrg)) {
      console.log(`[cluster-gaps] Processing org ${orgId} with ${orgGaps.length} gaps`);

      // Cluster the gaps
      const clusters = clusterGaps(orgGaps, CLUSTER_SIMILARITY_THRESHOLD);
      console.log(`[cluster-gaps] Created ${clusters.length} clusters for org ${orgId}`);

      for (const cluster of clusters) {
        // Find the most representative question (shortest or first)
        const representativeQuestion = cluster
          .map(g => g.question)
          .sort((a, b) => a.length - b.length)[0];

        // Calculate centroid (average embedding)
        const centroid = calculateCentroid(cluster.map(g => g.embedding));

        // Suggest a topic name
        const suggestedTopic = await suggestTopicName(cluster.map(g => g.question));

        if (dryRun) {
          results.push({
            org_id: orgId,
            representative_question: representativeQuestion,
            suggested_topic: suggestedTopic,
            question_count: cluster.length,
            questions: cluster.map(g => g.question),
          });
          continue;
        }

        // Create the cluster record
        console.log(`[cluster-gaps] Creating cluster for topic: ${suggestedTopic}, questions: ${cluster.length}`);

        const { data: clusterRecord, error: clusterError } = await supabase
          .from("knowledge_gap_clusters")
          .insert({
            org_id: orgId,
            representative_question: representativeQuestion,
            question_count: cluster.length,
            suggested_topic: suggestedTopic,
            centroid: centroid,
            status: "pending",
          })
          .select()
          .single();

        if (clusterError) {
          console.error("[cluster-gaps] Error creating cluster:", clusterError);
          continue;
        }

        console.log(`[cluster-gaps] Created cluster: ${clusterRecord.id}`);

        totalClustersCreated++;

        // Update all gaps in this cluster
        const gapIds = cluster.map(g => g.id);
        await supabase
          .from("knowledge_gaps")
          .update({
            cluster_id: clusterRecord.id,
            status: "clustered"
          })
          .in("id", gapIds);

        // Generate documentation draft if cluster is large enough
        if (cluster.length >= MIN_CLUSTER_SIZE_FOR_DOC) {
          const draft = await generateDocDraft(
            orgId,
            clusterRecord.id,
            suggestedTopic,
            cluster.map(g => g.question)
          );

          if (draft) {
            const { error: draftError } = await supabase
              .from("atlas_docs_drafts")
              .insert(draft);

            if (draftError) {
              console.error("[cluster-gaps] Error saving draft:", draftError);
            } else {
              totalDraftsGenerated++;

              // Update cluster status
              await supabase
                .from("knowledge_gap_clusters")
                .update({ status: "draft_created" })
                .eq("id", clusterRecord.id);
            }
          }
        }

        results.push({
          org_id: orgId,
          cluster_id: clusterRecord.id,
          representative_question: representativeQuestion,
          suggested_topic: suggestedTopic,
          question_count: cluster.length,
          draft_generated: cluster.length >= MIN_CLUSTER_SIZE_FOR_DOC,
        });
      }
    }

    console.log(`[cluster-gaps] Complete. Clusters: ${totalClustersCreated}, Drafts: ${totalDraftsGenerated}`);

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      gaps_processed: parsedGaps.length,
      clusters_created: totalClustersCreated,
      drafts_generated: totalDraftsGenerated,
      results,
    });

  } catch (err) {
    console.error("[cluster-gaps] Unhandled error:", err);
    return jsonResponse({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ============================================================================
// CLUSTERING LOGIC
// ============================================================================

function clusterGaps(
  gaps: Array<{ id: string; question: string; embedding: number[] }>,
  threshold: number
): Array<Array<{ id: string; question: string; embedding: number[] }>> {
  const clusters: Array<Array<typeof gaps[0]>> = [];
  const assigned = new Set<string>();

  for (const gap of gaps) {
    if (assigned.has(gap.id)) continue;

    // Start a new cluster with this gap
    const cluster = [gap];
    assigned.add(gap.id);

    // Find all similar gaps
    for (const other of gaps) {
      if (assigned.has(other.id)) continue;

      const similarity = cosineSimilarity(gap.embedding, other.embedding);
      if (similarity >= threshold) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function calculateCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];

  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }

  return centroid;
}

// ============================================================================
// AI HELPERS
// ============================================================================

async function suggestTopicName(questions: string[]): Promise<string> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 50,
        messages: [
          {
            role: "system",
            content: "You suggest short, clear topic names for documentation. Respond with ONLY the topic name, no explanation. Use Title Case. Examples: 'Rate Confirmations', 'Driver HOS Rules', 'POD Upload Process'",
          },
          {
            role: "user",
            content: `Suggest a documentation topic name that would answer these questions:\n${questions.map(q => `- ${q}`).join("\n")}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[cluster-gaps] OpenAI topic suggestion error:", await response.text());
      return "Untitled Topic";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "Untitled Topic";
  } catch (err) {
    console.error("[cluster-gaps] Topic suggestion error:", err);
    return "Untitled Topic";
  }
}

async function generateDocDraft(
  orgId: string,
  clusterId: string,
  topic: string,
  questions: string[]
): Promise<{
  org_id: string;
  cluster_id: string;
  title: string;
  slug: string;
  body: string;
  source_questions: string[];
  generation_model: string;
  status: string;
} | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content: `You are a technical writer creating documentation for Atlas Command, a Transportation Management System (TMS) for trucking companies.

Write clear, helpful documentation that:
- Explains the concept in plain language
- Is relevant to dispatchers, drivers, and fleet managers
- Includes practical examples where helpful
- Uses a friendly but professional tone
- Is structured with clear sections if needed

Format the response as Markdown. Start with a brief introduction, then cover the key points.

Do NOT include a title heading (we'll add that separately).
Do NOT include "In Atlas Command..." repeatedly - assume the reader knows they're using Atlas.`,
          },
          {
            role: "user",
            content: `Write documentation about "${topic}" that answers these user questions:\n${questions.map(q => `- ${q}`).join("\n")}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[cluster-gaps] OpenAI doc generation error:", await response.text());
      return null;
    }

    const data = await response.json();
    const body = data.choices?.[0]?.message?.content?.trim();

    if (!body) return null;

    // Generate slug from topic
    const slug = topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    return {
      org_id: orgId,
      cluster_id: clusterId,
      title: topic,
      slug: slug,
      body: body,
      source_questions: questions,
      generation_model: "gpt-4o-mini",
      status: "draft",
    };
  } catch (err) {
    console.error("[cluster-gaps] Doc generation error:", err);
    return null;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}