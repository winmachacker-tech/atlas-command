// src/lib/aiClient.ts
import { supabase } from "./supabase";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiChatParams = {
  prompt?: string;
  messages?: ChatMessage[];
  model?: string;        // default: gpt-4o-mini
  temperature?: number;  // default: 0.2
  max_tokens?: number;   // default: 800
};

export type AiChatResult =
  | { ok: true; output: string; model: string; raw?: unknown }
  | { ok: false; error: string; details?: unknown; status?: number };

function normalizeError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  // @ts-ignore
  if (err?.message) return String(err.message);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * aiChat â€” Call the ai-chat Edge Function with sensible defaults and robust error handling.
 * Usage:
 *   const res = await aiChat({ prompt: "Say hello to Atlas Command." });
 *   if (res.ok) console.log(res.output)
 *   else alert(res.error)
 */
export async function aiChat(params: AiChatParams): Promise<AiChatResult> {
  try {
    const body = {
      prompt: params.prompt,
      messages: params.messages,
      model: params.model ?? "gpt-4o-mini",
      temperature: params.temperature ?? 0.2,
      max_tokens: params.max_tokens ?? 800,
    };

    // Invoke the deployed function by name. Supabase client injects apikey/Authorization automatically.
    const { data, error } = await supabase.functions.invoke("ai-chat", {
      body,
    });

    if (error) {
      // Network or invoke-layer error
      return {
        ok: false,
        error: `Invoke error: ${normalizeError(error)}`,
        details: error,
        // @ts-ignore
        status: error?.status,
      };
    }

    // Function returns shape: { ok: boolean, output?: string, error?: string, upstream?: any }
    if (!data?.ok) {
      // Map common statuses to friendlier messages if present
      // @ts-ignore
      const status = data?.status ?? (data?.upstream?.error?.code === "insufficient_quota" ? 429 : undefined);
      let message = String(data?.error || "AI request failed");

      if (status === 401) {
        message =
          "Unauthorized (401). Check OPENAI_API_KEY in Supabase function env or your anon key headers.";
      } else if (status === 429 || data?.error?.toString().includes("insufficient quota")) {
        message =
          "Quota exceeded (429). Your OpenAI API key is out of credits or monthly limit. Add billing or raise limits.";
      }

      return {
        ok: false,
        error: message,
        details: data,
        status,
      };
    }

    return {
      ok: true,
      model: data?.model ?? "gpt-4o-mini",
      output: data?.output ?? "",
      raw: data,
    };
  } catch (err) {
    return {
      ok: false,
      error: normalizeError(err),
    };
  }
}

