// src/lib/pingSupabase.js
export function pingSupabase() {
  console.log("ðŸ” Checking environment from Viteâ€¦");

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url) {
    console.error("âŒ VITE_SUPABASE_URL is missing.");
  } else {
    console.log("âœ… VITE_SUPABASE_URL =", url);
  }

  if (!key) {
    console.error("âŒ VITE_SUPABASE_ANON_KEY is missing.");
  } else {
    console.log("âœ… VITE_SUPABASE_ANON_KEY detected.");
  }
}

