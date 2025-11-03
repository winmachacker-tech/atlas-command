// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

/** ------------------------------------------------------------------------
 *  Environment
 *  --------------------------------------------------------------------- */
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  // eslint-disable-next-line no-console
  console.error("❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

console.log("🔍 SUPABASE_URL =", SUPABASE_URL);
console.log("🔍 FUNCTIONS_URL = (derived from URL)");
console.log("🔍 ANON_KEY detected =", !!SUPABASE_ANON);

/** ------------------------------------------------------------------------
 *  Client with durable auth
 *   - persistSession: keeps the session across reloads
 *   - autoRefreshToken: refreshes JWT before it expires
 *   - detectSessionInUrl: handles PKCE/callback flows
 *  --------------------------------------------------------------------- */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      "x-client-info": "atlas-command",
    },
  },
});

/** ------------------------------------------------------------------------
 *  Helpers
 *  --------------------------------------------------------------------- */

/**
 * Returns a *fresh* access token (refreshes if needed).
 * Throws with a clear message if there is no logged-in user.
 */
export async function getAccessToken() {
  // 1) Try current session
  const { data: s1, error: e1 } = await supabase.auth.getSession();
  if (e1) {
    console.warn("[auth.getSession] error:", e1?.message || e1); // non-fatal log
  }
  let jwt = s1?.session?.access_token ?? null;

  // 2) If missing, try refresh (helps when the app sat idle)
  if (!jwt) {
    const { data: s2, error: e2 } = await supabase.auth.refreshSession();
    if (e2) {
      console.warn("[auth.refreshSession] error:", e2?.message || e2);
    }
    jwt = s2?.session?.access_token ?? null;
  }

  if (!jwt) {
    throw new Error("No active session. Please log in and try again.");
  }
  return jwt;
}

/**
 * Authenticated Edge Function invoke.
 * Always attaches a valid Bearer token.
 *
 * Usage:
 *   const data = await invokeWithAuth("admin-invite-user", { email, fullName, phone });
 */
export async function invokeWithAuth(functionName, body) {
  const jwt = await getAccessToken();

  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    headers: {
      // Explicitly attach the current user's JWT.
      Authorization: `Bearer ${jwt}`,
    },
  });

  if (error) {
    // Ensure network/invoke errors surface clearly
    const msg = error?.message || `Failed to call ${functionName}`;
    const err = new Error(msg);
    err.cause = error;
    throw err;
  }

  return data;
}

/** ------------------------------------------------------------------------
 *  Quick debug utilities (optional)
 *  --------------------------------------------------------------------- */
export async function logAuthDebug() {
  const { data } = await supabase.auth.getSession();
  const uid = data?.session?.user?.id;
  const email = data?.session?.user?.email;
  const frag = (data?.session?.access_token || "").slice(0, 12);
  console.log("[auth] uid:", uid, "email:", email, "jwt(12):", frag ? frag + "…" : "(none)");
}
