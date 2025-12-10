// FILE: supabase/functions/approve-doc-draft/index.ts
// Purpose: Approve or reject AI-generated documentation drafts
//
// Actions:
// - approve: Publishes draft to atlas_docs, updates statuses
// - reject: Marks draft as rejected with reason
// - list: Returns all pending drafts for review
//
// POST { action: "approve" | "reject" | "list", draft_id?, rejection_reason? }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const { action, draft_id, rejection_reason, org_id } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // =========================================================================
    // LIST - Return all pending drafts
    // =========================================================================
    if (action === "list") {
      let query = supabase
        .from("atlas_docs_drafts")
        .select(`
          id,
          title,
          slug,
          body,
          source_questions,
          status,
          generation_model,
          created_at,
          cluster_id
        `)
        .eq("status", "draft")
        .order("created_at", { ascending: false });

      if (org_id) {
        query = query.eq("org_id", org_id);
      }

      const { data: drafts, error } = await query;

      if (error) {
        return jsonResponse({ error: error.message }, 500);
      }

      return jsonResponse({
        ok: true,
        drafts: drafts || [],
        count: drafts?.length || 0,
      });
    }

    // =========================================================================
    // APPROVE - Publish draft to atlas_docs
    // =========================================================================
    if (action === "approve") {
      if (!draft_id) {
        return jsonResponse({ error: "draft_id is required" }, 400);
      }

      // Fetch the draft
      const { data: draft, error: fetchError } = await supabase
        .from("atlas_docs_drafts")
        .select("*")
        .eq("id", draft_id)
        .single();

      if (fetchError || !draft) {
        return jsonResponse({ error: "Draft not found" }, 404);
      }

      if (draft.status !== "draft") {
        return jsonResponse({ error: `Draft already ${draft.status}` }, 400);
      }

      // Generate embedding for the new doc
      const embedding = await generateEmbedding(draft.body);

      // Insert into atlas_docs (matching actual schema)
      const { data: newDoc, error: insertError } = await supabase
        .from("atlas_docs")
        .insert({
          org_id: draft.org_id,
          title: draft.title,
          slug: draft.slug,
          body: draft.body,
          embedding: embedding,
          domain: "general",  // Default domain for AI-generated docs
          doc_type: "knowledge",  // Type for knowledge base articles
          version: "1.0",
          related_docs: [],  // Empty array, can be updated later
          summary: draft.source_questions?.join(", ") || null,  // Store source questions as summary
        })
        .select()
        .single();

      if (insertError) {
        console.error("[approve-draft] Insert error:", insertError);
        return jsonResponse({ error: insertError.message }, 500);
      }

      // Update draft status
      await supabase
        .from("atlas_docs_drafts")
        .update({
          status: "published",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", draft_id);

      // Update cluster status
      if (draft.cluster_id) {
        await supabase
          .from("knowledge_gap_clusters")
          .update({ status: "published" })
          .eq("id", draft.cluster_id);

        // Update all gaps in this cluster
        await supabase
          .from("knowledge_gaps")
          .update({ status: "addressed" })
          .eq("cluster_id", draft.cluster_id);
      }

      console.log(`[approve-draft] Published: ${draft.title} -> doc ${newDoc.id}`);

      return jsonResponse({
        ok: true,
        message: `Published "${draft.title}" to atlas_docs`,
        doc_id: newDoc.id,
        slug: newDoc.slug,
      });
    }

    // =========================================================================
    // REJECT - Mark draft as rejected
    // =========================================================================
    if (action === "reject") {
      if (!draft_id) {
        return jsonResponse({ error: "draft_id is required" }, 400);
      }

      const { data: draft, error: fetchError } = await supabase
        .from("atlas_docs_drafts")
        .select("id, title, status, cluster_id")
        .eq("id", draft_id)
        .single();

      if (fetchError || !draft) {
        return jsonResponse({ error: "Draft not found" }, 404);
      }

      if (draft.status !== "draft") {
        return jsonResponse({ error: `Draft already ${draft.status}` }, 400);
      }

      // Update draft status
      await supabase
        .from("atlas_docs_drafts")
        .update({
          status: "rejected",
          rejection_reason: rejection_reason || "No reason provided",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", draft_id);

      // Update cluster status
      if (draft.cluster_id) {
        await supabase
          .from("knowledge_gap_clusters")
          .update({ status: "dismissed" })
          .eq("id", draft.cluster_id);

        // Mark gaps as dismissed
        await supabase
          .from("knowledge_gaps")
          .update({ status: "dismissed" })
          .eq("cluster_id", draft.cluster_id);
      }

      console.log(`[approve-draft] Rejected: ${draft.title}`);

      return jsonResponse({
        ok: true,
        message: `Rejected "${draft.title}"`,
      });
    }

    return jsonResponse({ error: "Invalid action. Use: list, approve, reject" }, 400);

  } catch (err) {
    console.error("[approve-draft] Error:", err);
    return jsonResponse({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ============================================================================
// HELPERS
// ============================================================================

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000), // Limit input size
      }),
    });

    if (!response.ok) {
      console.error("[approve-draft] Embedding error:", await response.text());
      return [];
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || [];
  } catch (err) {
    console.error("[approve-draft] Embedding error:", err);
    return [];
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}