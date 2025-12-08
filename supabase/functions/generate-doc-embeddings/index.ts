import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DocRow {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  slug: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { doc_id, force = false } = body;

    // Use service role to bypass RLS (this is an admin operation)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Build query - either single doc or all docs needing embeddings
    let query = supabase
      .from("atlas_docs")
      .select("id, title, summary, body, slug");

    if (doc_id) {
      // Process specific doc
      query = query.eq("id", doc_id);
    } else if (!force) {
      // Only process docs without embeddings
      query = query.is("embedding", null);
    }

    const { data: docs, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch docs: ${fetchError.message}`);
    }

    if (!docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ 
          ok: true, 
          message: "No documents need embedding generation",
          processed: 0 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${docs.length} documents for embeddings...`);

    const results: { id: string; slug: string; status: string; error?: string }[] = [];

    for (const doc of docs as DocRow[]) {
      try {
        // Combine fields for embedding - title weighted by repetition
        const textToEmbed = [
          doc.title,
          doc.title, // Repeat title for emphasis
          doc.summary || "",
          doc.body
        ].filter(Boolean).join("\n\n");

        // Truncate to ~8000 tokens (~32000 chars) to stay within limits
        const truncatedText = textToEmbed.slice(0, 32000);

        // Call OpenAI embeddings API
        const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: truncatedText,
          }),
        });

        if (!embeddingResponse.ok) {
          const errText = await embeddingResponse.text();
          throw new Error(`OpenAI API error: ${embeddingResponse.status} - ${errText}`);
        }

        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;

        // Update the doc with the embedding
        const { error: updateError } = await supabase
          .from("atlas_docs")
          .update({ 
            embedding,
            updated_at: new Date().toISOString()
          })
          .eq("id", doc.id);

        if (updateError) {
          throw new Error(`Failed to update doc: ${updateError.message}`);
        }

        results.push({ id: doc.id, slug: doc.slug, status: "success" });
        console.log(`✓ Generated embedding for: ${doc.slug}`);

      } catch (docError) {
        const errorMessage = docError instanceof Error ? docError.message : "Unknown error";
        results.push({ id: doc.id, slug: doc.slug, status: "error", error: errorMessage });
        console.error(`✗ Failed for ${doc.slug}: ${errorMessage}`);
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const successCount = results.filter(r => r.status === "success").length;
    const errorCount = results.filter(r => r.status === "error").length;

    return new Response(
      JSON.stringify({
        ok: true,
        message: `Processed ${docs.length} documents`,
        summary: {
          total: docs.length,
          success: successCount,
          errors: errorCount,
        },
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("generate-doc-embeddings error:", message);

    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});