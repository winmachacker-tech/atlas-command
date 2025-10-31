// src/lib/pingSupabase.js
export function pingSupabase() {
  console.log("🔍 Checking environment from Vite…");

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url) {
    console.error("❌ VITE_SUPABASE_URL is missing.");
  } else {
    console.log("✅ VITE_SUPABASE_URL =", url);
  }

  if (!key) {
    console.error("❌ VITE_SUPABASE_ANON_KEY is missing.");
  } else {
    console.log("✅ VITE_SUPABASE_ANON_KEY detected.");
  }
}
