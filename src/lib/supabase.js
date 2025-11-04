// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

/* ------------------------------ Env + Logging ------------------------------ */
const SUPABASE_URL   = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY       = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FUNCTIONS_URL  =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
  (SUPABASE_URL ? `${new URL(SUPABASE_URL).origin}/functions/v1` : undefined);

if (typeof window !== "undefined") {
  console.log("🔍 SUPABASE_URL =", SUPABASE_URL);
  console.log("🔍 FUNCTIONS_URL =", FUNCTIONS_URL ? "(derived from URL)" : "undefined");
  console.log("🔍 ANON_KEY detected =", Boolean(ANON_KEY));
}

/* --------------------------------- Guards --------------------------------- */
if (!SUPABASE_URL) throw new Error("VITE_SUPABASE_URL is missing");
if (!ANON_KEY)     throw new Error("VITE_SUPABASE_ANON_KEY is missing");

/* ------------------------------- Create client ----------------------------- */
export const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      "x-client-info": "atlas-command-web",
    },
  },
});

/* ---------------------------- Auth state logging --------------------------- */
supabase.auth.onAuthStateChange((event, session) => {
  const hasToken = Boolean(session?.access_token);
  console.log("🔄 auth state =", event, "token present =", hasToken);
});

/* ----------------------------- Dev-only global ----------------------------- */
/** Expose client in dev so you can use it in the browser console */
if (typeof window !== "undefined" && import.meta.env.DEV) {
  // eslint-disable-next-line no-underscore-dangle
  window.__sb = supabase;
  console.info("🧰 Dev helper: window.__sb is available for console use");
}

/* --------------------------- Helper (optional) ----------------------------- */
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/* ------------------------------- Functions URL ----------------------------- */
export const functionsUrl = FUNCTIONS_URL;
