// FILE: src/pages/MotiveOAuthCallback.jsx
// Purpose:
// - Handle the redirect back from Motive after OAuth.
// - Read the ?code from the URL query string.
// - Call the Supabase Edge Function `motive-oauth-exchange`
//   to exchange the code for Motive access/refresh tokens.
// - Show a simple loading / success / error state, then send the user
//   back to Settings → Integrations.
//
// SECURITY:
// - Uses the current Supabase session access token ONLY in the
//   Authorization header when calling the Edge Function.
// - All sensitive work (Motive client_secret, token storage, org scoping,
//   RLS enforcement) is done INSIDE the Edge Function, not in the browser.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

// Helper: determine the redirect_uri we should send to the Edge Function.
// This MUST match what we use in MainLayout → handleConnectMotive.
function getRedirectUri() {
  const envOverride = import.meta.env.VITE_MOTIVE_REDIRECT_URI;
  if (envOverride && envOverride.length > 0) {
    return envOverride;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}/integrations/motive/callback`;
  }

  return "";
}

export default function MotiveOAuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Exchanging authorization code…");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const errorParam = params.get("error");
        const errorDesc = params.get("error_description");

        // If Motive sent us back with an error in the query string
        if (errorParam) {
          setError(
            errorDesc ||
              `Motive returned an error: ${errorParam}. Please try again.`
          );
          setStatus("Unable to connect Motive.");
          return;
        }

        if (!code) {
          setError(
            "Missing authorization code in callback URL. Please start the Motive connection again."
          );
          setStatus("Unable to connect Motive.");
          return;
        }

        setStatus("Contacting Motive to complete connection…");

        // Get current Supabase session so we can call the Edge Function
        const { data: sessData, error: sessErr } =
          await supabase.auth.getSession();
        if (sessErr) {
          console.error("[MotiveOAuthCallback] getSession error:", sessErr);
          setError("Could not read your Atlas session. Please log in again.");
          setStatus("Unable to connect Motive.");
          return;
        }

        const session = sessData?.session;
        if (!session?.access_token) {
          setError(
            "You are not logged in to Atlas. Please sign in and reconnect Motive."
          );
          setStatus("Unable to connect Motive.");
          return;
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          setError(
            "VITE_SUPABASE_URL is not configured in the frontend environment."
          );
          setStatus("Unable to connect Motive.");
          return;
        }

        const redirectUri = getRedirectUri();

        // Call the Edge Function that actually talks to Motive and stores tokens
        const res = await fetch(
          `${supabaseUrl}/functions/v1/motive-oauth-exchange`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              code,
              redirect_uri: redirectUri,
            }),
          }
        );

        if (!res.ok) {
          const text = await res.text().catch(() => null);
          console.error(
            "[MotiveOAuthCallback] Edge Function non-200:",
            res.status,
            text
          );
          setError(
            "Atlas could not complete the Motive connection. Please try again or contact support."
          );
          setStatus("Unable to connect Motive.");
          return;
        }

        const data = await res.json().catch(() => ({}));
        console.log("[MotiveOAuthCallback] Success payload:", data);

        if (cancelled) return;

        setStatus("Motive successfully connected to Atlas!");

        // Small delay so the user sees the success
        setTimeout(() => {
          navigate("/settings/integrations", { replace: true });
        }, 1500);
      } catch (err) {
        console.error("[MotiveOAuthCallback] Unexpected error:", err);
        if (cancelled) return;
        setError(
          "Something went wrong while connecting Motive. Please try again."
        );
        setStatus("Unable to connect Motive.");
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="max-w-md w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-6 shadow-xl">
        <h1 className="text-lg font-semibold mb-2">Connecting Motive…</h1>
        <p className="text-sm text-[var(--text-muted)] mb-4">{status}</p>

        {!error && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <div className="h-3 w-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            <span>Talking securely to Motive and Atlas…</span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/60 bg-rose-500/10 text-rose-100 text-xs px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
