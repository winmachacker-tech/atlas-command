import { supabase } from "../supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function askDipsyQuestion(
  question: string,
  context: Record<string, any> = {}
) {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("[askDipsyQuestion] getSession error:", error);
    throw error;
  }

  const jwt = data?.session?.access_token;
  if (!jwt) {
    throw new Error("No JWT found. User must be logged in to ask Dipsy.");
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/questions-brain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      question,
      context: {
        source: "faq-test-panel",
        strictMode: true,
        ...context,
      },
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    console.error("[askDipsyQuestion] Edge function error:", json);
    throw new Error(json?.error || "questions-brain returned an error");
  }

  return json;
}
