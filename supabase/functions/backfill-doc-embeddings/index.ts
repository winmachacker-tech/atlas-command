// FILE: supabase/functions/backfill-doc-embeddings/index.ts
// Purpose: Generate embeddings for atlas_docs that are missing them
// Usage: POST { org_id?: string, limit?: number }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetOrgId = body.org_id || null;
    const limit = body.limit || 50;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find docs with missing embeddings
    let query = supabase
      .from("atlas_docs")
      .select("id, title, body")
      .is("embedding", null)
      .limit(limit);

    if (targetOrgId) {
      query = query.eq("org_id", targetOrgId);
    }

    const { data: docs, error: fetchError } = await query;

    if (fetchError) {
      return jsonResponse({ error: fetchError.message }, 500);
    }

    if (!docs || docs.length === 0) {
      return jsonResponse({ 
        ok: true, 
        message: "No docs with missing embeddings",
        updated: 0 
      });
    }

    console.log(`[backfill] Found ${docs.length} docs missing embeddings`);

    let updated = 0;
    const results: any[] = [];

    for (const doc of docs) {
      try {
        // Generate embedding
        const embedding = await generateEmbedding(doc.body);
        
        if (!embedding || embedding.length === 0) {
          console.error(`[backfill] Failed to generate embedding for: ${doc.title}`);
          results.push({ id: doc.id, title: doc.title, status: "failed", reason: "empty embedding" });
          continue;
        }

        // Update the doc
        const { error: updateError } = await supabase
          .from("atlas_docs")
          .update({ embedding: embedding })
          .eq("id", doc.id);

        if (updateError) {
          console.error(`[backfill] Update failed for ${doc.title}:`, updateError);
          results.push({ id: doc.id, title: doc.title, status: "failed", reason: updateError.message });
        } else {
          updated++;
          results.push({ id: doc.id, title: doc.title, status: "success" });
          console.log(`[backfill] Updated: ${doc.title}`);
        }
      } catch (err) {
        console.error(`[backfill] Error processing ${doc.title}:`, err);
        results.push({ id: doc.id, title: doc.title, status: "error", reason: String(err) });
      }
    }

    return jsonResponse({
      ok: true,
      found: docs.length,
      updated,
      results,
    });

  } catch (err) {
    console.error("[backfill] Error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

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
        input: text.slice(0, 8000),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[backfill] OpenAI error:", errText);
      return [];
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || [];
  } catch (err) {
    console.error("[backfill] Embedding error:", err);
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