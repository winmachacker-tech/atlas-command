// FILE: src/pages/MotiveOAuthCallback.jsx
// Purpose:
// - Handle Motive redirect back into Atlas.
// - Exchange ?code=... for tokens via the motive-oauth-exchange Edge Function.
// - Show a success or failure card and then bounce back to Integrations.
//
// This component is STRICT-MODE SAFE: we guard so the exchange only runs once.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

const CARD_BASE =
  "w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 px-8 py-10 shadow-xl shadow-black/40";

export default function MotiveOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guard so we only ever attempt the exchange once (even in React Strict Mode)
  const hasStartedRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get("code");

    if (!code) {
      console.warn("[MotiveOAuthCallback] Missing ?code param");
      setStatus("error");
      setErrorMessage("Missing authorization code from Motive.");
      return;
    }

    if (hasStartedRef.current) {
      console.log(
        "[MotiveOAuthCallback] Already started exchange, skipping duplicate effect"
      );
      return;
    }
    hasStartedRef.current = true;

    const redirectUri = `${window.location.origin}/integrations/motive/callback`;

    console.log("[MotiveOAuthCallback] Exchanging code via Edge Function", {
      codeSnippet: `${code.substring(0, 10)}...`,
      redirectUri,
    });

    async function run() {
      try {
        setStatus("loading");
        setErrorMessage(null);

        const { data, error } = await supabase.functions.invoke(
          "motive-oauth-exchange",
          {
            body: {
              code,
              redirect_uri: redirectUri,
            },
          }
        );

        if (error) {
          console.error("[MotiveOAuthCallback] Edge function error:", error);

          // Try to surface server-side message if present
          // @ts-ignore – supabase error.context may exist
          const context = (error as any).context;
          let message = "Edge function returned a non-2xx status code.";

          if (context) {
            try {
              const parsed =
                typeof context === "string" ? JSON.parse(context) : context;
              if (parsed?.error) {
                message = `${parsed.error}${
                  parsed.motive_error_description
                    ? ` – ${parsed.motive_error_description}`
                    : ""
                }`;
              }
            } catch {
              // ignore JSON parse error, fall back to default message
            }
          }

          setStatus((prev) => (prev === "success" ? "success" : "error"));
          if (prev !== "success") {
            setErrorMessage(message);
          }
          return;
        }

        console.log("[MotiveOAuthCallback] Exchange response:", data);

        if (!data || data.ok !== true || !data.access_token) {
          setStatus("error");
          setErrorMessage(
            "Motive OAuth exchange did not return an access token."
          );
          return;
        }

        console.log("[MotiveOAuthCallback] SUCCESS! Got access token");
        console.log(
          "[MotiveOAuthCallback] Access token length:",
          (data.access_token as string).length
        );

        // TODO later: save tokens to DB via another Edge Function

        setStatus("success");

        // After a short pause, bounce back to Integrations with success flag
        setTimeout(() => {
          navigate("/integrations?motive=connected", { replace: true });
        }, 1200);
      } catch (err: any) {
        console.error("[MotiveOAuthCallback] Unexpected error:", err);
        setStatus("error");
        setErrorMessage(
          err?.message || "Unexpected error during Motive OAuth exchange."
        );
      }
    }

    run();
  }, [searchParams, navigate]);

  const isLoading = status === "idle" || status === "loading";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className={CARD_BASE}>
        {isLoading && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            </div>
            <h1 className="text-xl font-semibold">Connecting to Motive…</h1>
            <p className="text-sm text-slate-400">
              Exchanging authorization code for secure API access.
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
              <span className="text-2xl">✅</span>
            </div>
            <h1 className="text-xl font-semibold">Motive connected</h1>
            <p className="text-sm text-slate-400">
              OAuth exchange completed successfully. Redirecting you back to
              Integrations…
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
              <span className="text-2xl">❌</span>
            </div>
            <h1 className="text-xl font-semibold">Connection Failed</h1>
            <p className="text-sm text-rose-400">OAuth exchange failed.</p>
            {errorMessage && (
              <p className="max-h-24 w-full overflow-auto rounded-lg bg-slate-900/80 px-3 py-2 text-left text-xs text-slate-300">
                {errorMessage}
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate("/integrations", { replace: true })}
              className="mt-2 inline-flex items-center justify-center rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white"
            >
              Back to Integrations
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
