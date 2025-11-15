// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

/**
 * Expected envs:
 *   VITE_SUPABASE_URL                -> https://<your-project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY           -> anon key from Supabase
 *   (optional) VITE_SUPABASE_FUNCTIONS_URL -> https://<your-project-ref>.functions.supabase.co
 */

function normalizeUrl(u) {
  if (!u) return "";
  // remove accidental trailing slash
  return u.replace(/\/+$/, "");
}

const RAW_URL = import.meta.env.VITE_SUPABASE_URL || "";
const RAW_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const RAW_FN_URL =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || (RAW_URL ? RAW_URL.replace(".supabase.co", ".functions.supabase.co") : "");

const SUPABASE_URL = normalizeUrl(RAW_URL);
const SUPABASE_ANON_KEY = RAW_ANON;
const SUPABASE_FUNCTIONS_URL = normalizeUrl(RAW_FN_URL);

// ---- Hard safety checks (prevents "Failed to fetch (api.supabase.com)") ----
(function guard() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // eslint-disable-next-line no-console
    console.error(
      "%cSupabase misconfigured",
      "color: #fff; background:#d33; padding:2px 6px; border-radius:4px;",
      {
        VITE_SUPABASE_URL: SUPABASE_URL || "(missing)",
        VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY ? "(present)" : "(missing)",
      }
    );
    throw new Error("Supabase env vars missing. Check your .env and Vercel env.");
  }

  // The client must point to your project's domain, NOT api.supabase.com
  if (/api\.supabase\.com/i.test(SUPABASE_URL)) {
    throw new Error(
      `Invalid VITE_SUPABASE_URL "${SUPABASE_URL}". Use "https://<project-ref>.supabase.co", not api.supabase.com.`
    );
  }

  if (!/^https:\/\/.+\.supabase\.co$/i.test(SUPABASE_URL)) {
    // You might be using http:// or a wrong host
    // eslint-disable-next-line no-console
    console.warn(
      "VITE_SUPABASE_URL looks unusual:",
      SUPABASE_URL,
      "Expected: https://<project-ref>.supabase.co"
    );
  }
})();

// ---- Create client ----
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: { "x-client-info": "atlas-command-web" },
  },
});

// Optional: tiny health check helper you can call from anywhere
export async function supabaseHealthCheck() {
  try {
    const { data, error } = await supabase.from("drivers").select("id").limit(1);
    if (error) throw error;
    return { ok: true, rows: data?.length ?? 0 };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}

// Useful in dev: expose a quick check in the console
if (typeof window !== "undefined") {
  window._supabaseInfo = {
    url: SUPABASE_URL,
    hasAnonKey: !!SUPABASE_ANON_KEY,
    functionsUrl: SUPABASE_FUNCTIONS_URL,
  };
  window._supabaseHealthCheck = supabaseHealthCheck;
}
// TEMP: expose supabase client for browser debugging
if (typeof window !== "undefined") {
  window.supabase = supabase;
}
