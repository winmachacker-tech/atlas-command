// FILE: supabase/functions/read-document/index.ts
//
// Purpose:
// - Securely read/interpret documents (like rate cons) for Atlas / Dipsy.
// - The FRONTEND sends already-extracted text (raw_text) from a PDF
//   to this Edge Function.
// - This function calls OpenAI using the secret key stored in Supabase
//   environment variables (never exposed to the browser).
//
// Expected request (POST JSON):
// {
//   "raw_text": "full extracted text of the PDF",
//   "file_name": "Rate Con 203.pdf",          // optional
//   "file_url": "https://.../dipsy-uploads/..." // optional
// }
//
// Response (JSON):
// {
//   "ok": true,
//   "analysis_text": "...human-readable summary & details...",
//   "model": "gpt-4o-mini"
// }
//
// Security:
// - Uses OPENAI_API_KEY from Supabase env (server-side only).
// - No RLS or database writes are touched here.
// - Does NOT weaken or modify any existing security / RLS.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type ReadDocumentRequestBody = {
  raw_text?: string;
  file_name?: string;
  file_url?: string;
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

if (!OPENAI_API_KEY) {
  console.error(
    "[read-document] Missing OPENAI_API_KEY in Supabase environment variables."
  );
}

async function handleReadDocument(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  if (!OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "OPENAI_API_KEY is not configured in Supabase environment variables.",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  let body: ReadDocumentRequestBody;

  try {
    body = (await req.json()) as ReadDocumentRequestBody;
  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body in request." }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const { raw_text, file_name, file_url } = body;

  if (!raw_text || raw_text.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: "raw_text is required and cannot be empty." }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  console.log("[read-document] Received document to analyze:", {
    file_name,
    file_url,
    text_length: raw_text.length,
  });

  try {
    const systemPrompt = `
You are Dipsy, an AI dispatcher for a trucking carrier.

You will be given the FULL plain-text contents of a document, usually a
trucking rate confirmation or similar load document.

Your job is to:
1) Summarize the load in clear, human language (1–3 short paragraphs).
2) Extract key operational details as a JSON object with these fields:

{
  "origin_city": string | null,
  "origin_state": string | null,
  "destination_city": string | null,
  "destination_state": string | null,
  "pickup_appointment": string | null,
  "delivery_appointment": string | null,
  "rate_total": string | null,
  "rate_currency": string | null,
  "miles": string | null,
  "weight_lbs": string | null,
  "commodity": string | null,
  "reference_numbers": string[] | null,
  "notes_for_dispatch": string | null
}

- If a field is not present, return null for that field.
- Be forgiving about messy text and OCR errors.
- Do NOT invent details. Only use what is reasonably supported by the text.

At the end of your response, output:

1) A short summary (Markdown).
2) The JSON object on its own line in a Markdown code block.
`.trim();

    const userPrompt = `
Here is the document text to analyze:

---
${raw_text}
---

File name: ${file_name ?? "unknown"}
File URL: ${file_url ?? "not provided"}
`.trim();

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error(
        "[read-document] OpenAI error:",
        openaiResponse.status,
        errorText
      );

      return new Response(
        JSON.stringify({
          error: "OpenAI API error",
          status: openaiResponse.status,
          details: errorText,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const json = await openaiResponse.json();
    const analysisText: string =
      json.choices?.[0]?.message?.content ??
      "No analysis text returned from OpenAI.";

    console.log(
      "[read-document] Analysis completed, length:",
      analysisText.length
    );

    return new Response(
      JSON.stringify({
        ok: true,
        analysis_text: analysisText,
        model: json.model ?? "gpt-4o-mini",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("[read-document] Unexpected error:", err);

    return new Response(
      JSON.stringify({
        error: "Unexpected error while reading document.",
        details: (err as Error)?.message ?? String(err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

serve(handleReadDocument);
