// src/lib/openaiConfig.js
// Central place to read the OpenAI API key in a Vite app

// Vite exposes env vars via import.meta.env, not process.env
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

// Simple runtime debug so you can see if prod has the key
if (typeof window !== "undefined") {
  console.log(
    "[Atlas/OpenAI] Runtime key present?",
    OPENAI_API_KEY
      ? `YES (starts with ${String(OPENAI_API_KEY).slice(0, 7)}...)`
      : "NO (VITE_OPENAI_API_KEY is missing)"
  );
}

/**
 * Get the OpenAI API key for browser-side fetch calls.
 * Throws a clear error if the key is missing so we don't
 * accidentally call OpenAI with "undefined".
 */
export function getOpenAIApiKey() {
  if (!OPENAI_API_KEY || typeof OPENAI_API_KEY !== "string") {
    console.error(
      "[Atlas/OpenAI] VITE_OPENAI_API_KEY is missing or invalid. " +
        "Add it to your Vercel project env vars and redeploy."
    );
    throw new Error("OpenAI API key is not configured in VITE_OPENAI_API_KEY.");
  }
  return OPENAI_API_KEY;
}
