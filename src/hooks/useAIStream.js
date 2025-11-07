// src/hooks/useAIStream.js
// UPDATED: uses the signed-in user's access token for Edge Functions auth.
// Drop-in replacement for your existing file.

import { useCallback, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

/** Resolve the Edge Function URL & build auth headers with the user's JWT */
async function getFunctionConfig() {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl) throw new Error("VITE_SUPABASE_URL is not set");
  if (!anonKey) throw new Error("VITE_SUPABASE_ANON_KEY is not set");

  // Get the current session access token (JWT) for Authorization
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`auth error: ${error.message}`);
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new Error("No signed-in session. Please sign in before using Dispatch AI.");
  }

  return {
    url: `${baseUrl.replace(/\/$/, "")}/functions/v1/ai-chat?stream=1`,
    headers: {
      "Content-Type": "application/json",
      // Edge Functions expect a valid JWT here (user session), not the anon key
      Authorization: `Bearer ${accessToken}`,
      // apikey can remain the anon key
      apikey: anonKey,
    },
  };
}

/** Stream helper: read text chunks and forward them up */
async function streamToText({ response, onChunk, signal }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let utf8 = "";

  while (true) {
    if (signal?.aborted) {
      try { reader.releaseLock?.(); } catch {}
      throw new DOMException("Aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;

    utf8 += decoder.decode(value, { stream: true });
    if (utf8) {
      onChunk(utf8);
      utf8 = "";
    }
  }
  if (utf8) onChunk(utf8);
}

export default function useAIStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState(null);

  const historyRef = useRef([]);
  const abortRef = useRef(null);

  const reset = useCallback(() => {
    setOutput("");
    setError(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort?.();
  }, []);

  const send = useCallback(
    async ({
      prompt,
      system,
      model = "gpt-4o-mini",
      temperature,
      extraMessages = [],
      appendToHistory = true,
      onToken,
    }) => {
      setError(null);
      setIsStreaming(true);

      const messages = [
        ...extraMessages,
        ...historyRef.current.filter((m) => m.role !== "system"),
        { role: "user", content: String(prompt ?? "") },
      ].filter(Boolean);

      if (appendToHistory) {
        historyRef.current.push({ role: "user", content: String(prompt ?? "") });
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const { url, headers } = await getFunctionConfig();
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model, system, messages, temperature }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => res.statusText);
          throw new Error(`AI upstream error (${res.status}): ${msg}`);
        }

        let assembled = "";
        await streamToText({
          response: res,
          signal: ctrl.signal,
          onChunk: (chunk) => {
            assembled += chunk;
            setOutput((prev) => prev + chunk);
            if (onToken) {
              try { onToken(chunk); } catch {}
            }
          },
        });

        if (appendToHistory && assembled.trim().length) {
          historyRef.current.push({ role: "assistant", content: assembled });
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    []
  );

  return useMemo(
    () => ({
      send,
      stop,
      reset,
      pushToHistory(message) {
        if (message && message.role && typeof message.content === "string") {
          historyRef.current.push({ role: message.role, content: message.content });
        }
      },
      setHistory(next) {
        historyRef.current = Array.isArray(next) ? next.slice() : [];
      },
      getHistory() {
        return historyRef.current.slice();
      },
      isStreaming,
      output,
      error,
    }),
    [send, stop, reset, isStreaming, output, error]
  );
}
