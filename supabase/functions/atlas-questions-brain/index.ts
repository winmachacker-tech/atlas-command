// FILE: supabase/functions/atlas-questions-brain/index.ts
// Purpose:
// - Answer "How does Atlas work?" questions for Dipsy.
// - DOES NOT touch tenant data tables; only explains features, flows, and terminology.
// - Requires Authorization: Bearer <JWT> and respects org context via auth + RPC.
//
// Security:
// - 401 if no/malformed Authorization header
// - 401 if auth.getUser() fails
// - No service_role key. Uses anon key + caller token (RLS-safe).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

// Basic CORS
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

serve(async (req: Request): Promise<Response> => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(401, {
        ok: false,
        error: "Missing or invalid Authorization header",
      });
    }

    const accessToken = authHeader.replace(/bearer /i, "").trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const body = await req.json().catch(() => ({} as any));
    const question: string = body.question ?? "";
    const userId: string | null = body.user_id ?? null;

    if (!question || typeof question !== "string") {
      return jsonResponse(400, {
        ok: false,
        error: "Missing 'question' in request body",
      });
    }

    // Resolve user (and therefore org context via RLS / RPC if needed)
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      console.error("[atlas-questions-brain] auth.getUser error:", userErr);
      return jsonResponse(401, {
        ok: false,
        error: "Unable to resolve user from token",
      });
    }

    // Optionally resolve org via RPC, but DO NOT touch org data tables.
    // This is just to keep behavior consistent with the rest of Atlas.
    let orgId: string | null = null;
    try {
      const { data: rpcOrgId, error: orgErr } = await supabase.rpc(
        "current_org_id",
      );
      if (!orgErr && rpcOrgId) {
        orgId = rpcOrgId as string;
      }
    } catch (e) {
      console.warn("[atlas-questions-brain] current_org_id() failed:", e);
    }

    if (!OPENAI_API_KEY) {
      console.warn(
        "[atlas-questions-brain] OPENAI_API_KEY not set; returning simple answer",
      );
      return jsonResponse(200, {
        ok: true,
        answer:
          "Atlas Questions Brain is online, but OpenAI is not configured. I can’t yet give detailed feature explanations.",
        user_id: userId ?? user.id,
        org_id: orgId,
      });
    }

    // Call OpenAI to generate an explanation about Atlas features/flows.
    const systemPrompt = `
You are the Atlas Questions Brain.

Your ONLY job:
- Explain how Atlas Command works as a product: pages, buttons, statuses, workflows, billing flow, and best practices.
- You NEVER read or mention live tenant data (no specific loads, drivers, or orgs).
- You speak like a clear, confident product specialist.
- Be concise but precise. Use bullet points where helpful.

You are allowed to:
- Explain what a status means (e.g. "Ready for Billing").
- Explain what happens when a user clicks a button (e.g. "Mark Delivered", "Upload POD", "Ready for Billing").
- Describe general flows (e.g. "Delivery → POD → Ready for Billing → Invoiced").
- Describe which page or card something lives on (e.g. "on the Load Details page, in the Load Documents card").

You are NOT allowed to:
- Invent specific customer names, load numbers, or proprietary data.
- Talk about org-specific data (you don't know it).
`;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `User ID: ${userId ?? user.id}, Org ID: ${
          orgId ?? "unknown"
        }\nQuestion: ${question}`,
      },
    ];

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages,
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error(
        "[atlas-questions-brain] OpenAI error:",
        aiRes.status,
        text,
      );
      return jsonResponse(500, {
        ok: false,
        error: `OpenAI error ${aiRes.status}`,
      });
    }

    const json = await aiRes.json();
    const answer: string =
      json.choices?.[0]?.message?.content ??
      "I couldn't generate an explanation for that question.";

    return jsonResponse(200, {
      ok: true,
      answer,
      user_id: userId ?? user.id,
      org_id: orgId,
      source: "atlas_questions_brain",
    });
  } catch (err) {
    console.error("[atlas-questions-brain] Unhandled error:", err);
    return jsonResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
