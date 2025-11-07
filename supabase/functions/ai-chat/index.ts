// supabase/functions/ai-chat/index.ts
// Deno Edge Function — non-streaming, clear error messages, CORS friendly

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

serve(async (req) => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!OPENAI_API_KEY) {
      return json(
        {
          ok: false,
          error: "Missing OPENAI_API_KEY in function environment.",
          hint: "Set it via: supabase secrets set OPENAI_API_KEY=sk-... --project-ref <ref>",
        },
        500,
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return json({ ok: false, error: "Expected application/json body." }, 400);
    }

    const body = (await req.json()) as {
      messages?: ChatMessage[];
      prompt?: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
    };

    // Accept either `messages` or a simple `prompt`
    const messages: ChatMessage[] =
      body?.messages && Array.isArray(body.messages) && body.messages.length
        ? body.messages
        : body?.prompt
        ? [{ role: "user", content: String(body.prompt) }]
        : [];

    if (!messages.length) {
      return json(
        {
          ok: false,
          error: "Provide either `messages` (array) or `prompt` (string).",
          example: {
            prompt: "Say hello to Atlas Command.",
          },
        },
        400,
      );
    }

    // Use a modern, inexpensive chat model; avoid Responses API extras that caused errors earlier.
    const model = body?.model || "gpt-4o-mini";
    const temperature = body?.temperature ?? 0.2;
    const max_tokens = body?.max_tokens ?? 800;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        // NOTE: Not using stream or `stream_options.include_usage` to avoid upstream param errors.
      }),
    });

    const isJSON = (r.headers.get("content-type") || "").includes("application/json");
    const data = isJSON ? await r.json() : await r.text();

    if (!r.ok) {
      // Pass through useful upstream error info and map common cases.
      const upstream = typeof data === "string" ? { message: data } : data;
      const code = upstream?.error?.code ?? r.status;

      // Friendly messages for typical issues
      if (code === "insufficient_quota" || r.status === 429) {
        return json(
          {
            ok: false,
            error: "OpenAI: insufficient quota (429).",
            details:
              "Your API key is out of credits or monthly limit reached. Add billing or raise limits in the OpenAI dashboard.",
            upstream,
          },
          429,
        );
      }
      if (r.status === 401) {
        return json(
          {
            ok: false,
            error: "OpenAI: unauthorized (401).",
            details:
              "Invalid or missing OPENAI_API_KEY for this function environment.",
            upstream,
          },
          401,
        );
      }

      return json(
        {
          ok: false,
          error: "OpenAI upstream error",
          status: r.status,
          upstream,
        },
        502,
      );
    }

    // Normal success
    const text =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      "";

    return json(
      {
        ok: true,
        model,
        output: text,
        raw: data, // keep for debugging; remove if you prefer smaller payloads
      },
      200,
    );
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: "Function error",
        details: err?.message || String(err),
      },
      500,
    );
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}
