// FILE: src/debug/testDipsyBoardView.js
// Purpose:
// - Simple dev-only helper to test the dipsy-board-view Edge Function
//   using the current logged-in user's Supabase session.
// - After it's wired up, you can run `await window.testDipsyBoardView()`
//   in the browser console and see the JSON response.

import { supabase } from "../lib/supabase";

export async function attachDipsyBoardTester() {
  if (typeof window === "undefined") return;

  // Don't reattach if already present
  if (window.testDipsyBoardView) return;

  window.testDipsyBoardView = async (scope = "dispatcher") => {
    try {
      console.log("[testDipsyBoardView] Fetching current session…");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        console.error("[testDipsyBoardView] No session found:", sessionError);
        return { ok: false, error: "No active session" };
      }

      const accessToken = session.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dipsy-board-view`;

      console.log("[testDipsyBoardView] Calling:", url, "scope:", scope);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope }),
      });

      const json = await res.json().catch(() => null);

      console.log("[testDipsyBoardView] HTTP status:", res.status);
      console.log("[testDipsyBoardView] Response JSON:", json);

      return json;
    } catch (err) {
      console.error("[testDipsyBoardView] Unhandled error:", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  console.log(
    "%cDipsy board tester attached.",
    "color: #22c55e; font-weight: bold;",
    "Run: await window.testDipsyBoardView()"
  );
}
