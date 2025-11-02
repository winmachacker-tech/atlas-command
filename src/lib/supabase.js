// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FUNCTIONS_URL =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `${URL}/functions/v1`;

if (import.meta.env.DEV) {
  console.log("🔍 SUPABASE_URL =", URL);
  console.log("🔍 FUNCTIONS_URL =", FUNCTIONS_URL ? "(derived from URL)" : "undefined");
  console.log("🔍 ANON_KEY detected =", !!ANON);
}

export const supabase = createClient(URL, ANON, {
  global: { headers: { "x-client-info": "atlas-command" } },
  auth: { persistSession: true, autoRefreshToken: true },
});

export { FUNCTIONS_URL };
