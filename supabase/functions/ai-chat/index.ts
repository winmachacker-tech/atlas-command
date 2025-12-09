// supabase/functions/ai-chat/index.ts
// Deno Edge Function — Dipsy AI Chat with RAG (Retrieval Augmented Generation)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const DIPSY_SYSTEM_PROMPT = `You are Dipsy, the AI dispatch assistant for Atlas Command — a Transportation Management System (TMS) for small trucking carriers (5-50 trucks).

Your personality:
- Friendly, professional, and helpful
- Concise but thorough
- You speak like a knowledgeable dispatcher colleague

CRITICAL RULES:
1. ONLY answer based on the documentation provided in <atlas_docs> tags below
2. If the docs don't contain information to answer a question, say "I don't have that information in my documentation" — never make things up
3. When citing specific facts, reference which concept/document it comes from
4. For questions about features that don't exist, clearly state they're not currently available
5. Never hallucinate features, automations, or capabilities not documented

You help dispatchers with:
- Understanding loads, drivers, trucks, and assignments
- Explaining billing workflows and load statuses
- Clarifying Atlas Command concepts and terminology
- Answering operational questions about the TMS`;

async function searchAtlasDocs(query: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[ai-chat] No Supabase credentials, skipping RAG");
    return [];
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !["what", "how", "why", "when", "where", "which", "does", "the", "and", "for", "are", "you", "can", "this", "that", "with", "from", "have", "been", "was", "were", "will", "would", "could", "should", "about", "into", "your", "our", "their"].includes(word));

  console.log("[ai-chat] Search keywords:", keywords);

  if (keywords.length === 0) {
    const { data } = await supabase.from("atlas_docs").select("title, body, domain").limit(5);
    return (data ?? []).map(doc => `## ${doc.title}\n${doc.body}`);
  }

  const orConditions = keywords.map(k => `title.ilike.%${k}%,body.ilike.%${k}%,summary.ilike.%${k}%`).join(",");

  const { data, error } = await supabase
    .from("atlas_docs")
    .select("title, body, domain, slug")
    .or(orConditions)
    .limit(8);

  if (error) {
    console.error("[ai-chat] Doc search error:", error);
    return [];
  }

  console.log(`[ai-chat] Found ${data?.length ?? 0} relevant docs`);

  const scored = (data ?? []).map(doc => {
    const text = `${doc.title} ${doc.body} ${doc.domain}`.toLowerCase();
    const score = keywords.reduce((acc, kw) => acc + (text.match(new RegExp(kw, 'gi')) || []).length, 0);
    return { ...doc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map(doc => `## ${doc.title} (${doc.domain})\n${doc.body}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!OPENAI_API_KEY) {
      return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);
    }

    const body = await req.json();

    let messages: ChatMessage[] =
      body?.messages?.length ? body.messages
      : body?.prompt ? [{ role: "user", content: String(body.prompt) }]
      : [];

    if (!messages.length) {
      return json({ ok: false, error: "Provide messages or prompt" }, 400);
    }

    const userMessages = messages.filter(m => m.role === "user");
    const latestQuestion = userMessages[userMessages.length - 1]?.content ?? "";

    let relevantDocs: string[] = [];
    if (!body.skip_rag && latestQuestion) {
      console.log("[ai-chat] RAG search for:", latestQuestion.slice(0, 100));
      relevantDocs = await searchAtlasDocs(latestQuestion);
    }

    let systemPrompt = DIPSY_SYSTEM_PROMPT;
    if (relevantDocs.length > 0) {
      systemPrompt += `\n\n<atlas_docs>\n${relevantDocs.join("\n\n---\n\n")}\n</atlas_docs>`;
    } else {
      systemPrompt += `\n\n<atlas_docs>\nNo specific documentation found.\n</atlas_docs>`;
    }

    const hasSystem = messages.some(m => m.role === "system");
    if (!hasSystem) {
      messages = [{ role: "system", content: systemPrompt }, ...messages];
    } else {
      messages = messages.map(m => m.role === "system" ? { ...m, content: systemPrompt } : m);
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body?.model || "gpt-4o-mini",
        messages,
        temperature: body?.temperature ?? 0.2,
        max_tokens: body?.max_tokens ?? 800,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      return json({ ok: false, error: "OpenAI error", status: r.status, upstream: data }, 502);
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    return json({ ok: true, output: text, docs_used: relevantDocs.length, raw: data }, 200);
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
