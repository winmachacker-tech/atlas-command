// FILE: supabase/functions/ai-process-rc/index.ts
//
// Purpose:
// - Securely proxy Atlas Command's RC processing requests to OpenAI.
// - Fix CORS issues by *not* calling api.openai.com directly from the browser.
// - Keep your existing OpenAI request body shape (model, messages, etc.).
//
// How it works:
// - Frontend sends POST -> /functions/v1/ai-process-rc with the same JSON body
//   it used to send to https://api.openai.com/v1/chat/completions.
// - This Edge Function:
//     • Reads that JSON body.
//     • Adds the Authorization header with OPENAI_API_KEY (server-side).
//     • Calls OpenAI's /v1/chat/completions.
//     • Returns the OpenAI response JSON with proper CORS headers.
//
// Security:
// - OPENAI_API_KEY is stored ONLY as a Supabase Edge Function secret.
// - No OpenAI keys are exposed to the browser.
// - This function does NOT touch your database or RLS at all.
//
// Env required (set as Edge Function secret):
//   - OPENAI_API_KEY
//
//   Example:
//   supabase secrets set --env-file ./supabase/.env
//   (with OPENAI_API_KEY=sk-... in that file)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      console.error("[ai-process-rc] Missing OPENAI_API_KEY");
      return new Response(
        JSON.stringify({
          error: "OpenAI not configured",
          details: "OPENAI_API_KEY is not set in Edge Function secrets",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // This is the same body your frontend was sending directly to OpenAI.
    const openaiRequestBody = await req.json();

    console.log("[ai-process-rc] Forwarding request to OpenAI...");

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(openaiRequestBody),
      },
    );

    const text = await openaiResponse.text();

    // Pass through OpenAI's status code, but always include our CORS headers.
    return new Response(text, {
      status: openaiResponse.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[ai-process-rc] Error calling OpenAI:", err);

    return new Response(
      JSON.stringify({
        error: "Failed to contact OpenAI",
        details:
          err instanceof Error ? err.message : "Unknown error occurred",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
