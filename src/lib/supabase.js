// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Basic sanity logs (don't remove; helps verify prod bundle config)
console.log("🔍 SUPABASE_URL =", SUPABASE_URL);
console.log("🔍 FUNCTIONS_URL = (derived from URL)");
console.log("🔍 ANON_KEY detected =", !!ANON_KEY);

if (!SUPABASE_URL || !ANON_KEY) {
  // Make failures obvious
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

// Use localStorage for auth; detect sessions coming from #hash (invite/magic links)
export const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

// Optional: small helper to guarantee we have a JWT before sensitive calls
export async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("⚠️ getSession error:", error);
    throw error;
  }
  const session = data?.session;
  const token = session?.access_token;
  console.log("🔐 requireAuth() token present =", !!token);
  if (!token) {
    throw new Error("Not authenticated. Please sign in again.");
  }
  // no-op: supabase-js automatically attaches the token for PostgREST calls
  return session;
}

// Dev aid: log changes so we know when a user becomes authenticated
try {
  const { data: initial } = await supabase.auth.getSession();
  console.log("🔑 initial session present =", !!initial?.session);
} catch (e) {
  console.warn("getSession failed at init:", e);
}

supabase.auth.onAuthStateChange((_event, s) => {
  console.log("🔄 auth state =", _event, "token present =", !!s?.access_token);
});
