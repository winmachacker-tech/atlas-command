// FILE: src/lib/dipsyQuestions.ts
//
// Thin client for the "questions-brain" Edge Function.
// Used by Dipsy (FAQ / Atlas docs brain) to answer
// product questions about how Atlas works.
//
// Security:
// - Uses the browser Supabase client (anon key + user JWT).
// - RLS still applies (no service-role keys in the browser).
// - Edge function enforces Authorization: Bearer <JWT>.

import { supabase } from "./supabase";

export type DipsyQuestionsSource = {
  id: string;
  slug: string | null;
  title: string | null;
};

export type DipsyQuestionsResponse = {
  answer: string;
  sources: DipsyQuestionsSource[];
};

export type DipsyQuestionsContext = Record<string, unknown>;

/**
 * Ask the Atlas Questions Brain (FAQ agent) a question.
 *
 * @param question - Natural language question about Atlas.
 * @param context  - Optional extra context (where in the UI, etc.).
 */
export async function askDipsyQuestion(
  question: string,
  context: DipsyQuestionsContext = {},
): Promise<DipsyQuestionsResponse> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error("[dipsyQuestions] Question cannot be empty");
  }

  const { data, error } = await supabase.functions.invoke(
    "questions-brain",
    {
      body: {
        question: trimmed,
        context,
      },
    },
  );

  if (error) {
    console.error("[dipsyQuestions] questions-brain error:", error);
    throw error;
  }

  if (!data || typeof data.answer !== "string") {
    console.error("[dipsyQuestions] Unexpected payload from questions-brain:", data);
    throw new Error("Unexpected response from questions-brain");
  }

  return data as DipsyQuestionsResponse;
}
