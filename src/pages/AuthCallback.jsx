// src/pages/AuthCallback.jsx
// Handles Supabase auth links (invite, signup, magiclink, recovery, email_change).
// - Parses hash fragment from Supabase (/auth/v1/verify?type=...#access_token=...)
// - Sets the Supabase session
// - For type=invite|signup -> redirect to /set-password (force password creation)
// - For type=magiclink|recovery|email_change -> send to dashboard (or ?next)
// Drop-in ready.

import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2 } from "lucide-react";

function parseHashParams() {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const out = Object.fromEntries(params.entries());
  // normalize keys we care about
  return {
    type: out.type || "",
    access_token: out.access_token || "",
    refresh_token: out.refresh_token || "",
    provider_token: out.provider_token || "",
    expires_in: out.expires_in ? Number(out.expires_in) : undefined,
    token_type: out.token_type || "",
    error: out.error || "",
    error_description: out.error_description || "",
  };
}

export default function AuthCallback() {
  const nav = useNavigate();
  const loc = useLocation();
  const [status, setStatus] = useState("Processing sign-in…");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { search } = window.location;
        const qs = new URLSearchParams(search);
        const next = qs.get("next") || "/";

        // Parse fragment from Supabase verify URL
        const { type, access_token, refresh_token, error, error_description } = parseHashParams();

        // If Supabase reported an error in the fragment, show it
        if (error) {
          setErr(`${error}: ${error_description || "Authentication error"}`);
          setStatus("Auth error");
          return;
        }

        // We need tokens to establish a session
        if (!access_token || !refresh_token) {
          setErr("Missing access token. The link may have expired or was already used.");
          setStatus("Invalid link");
          return;
        }

        setStatus("Establishing session…");
        const { error: setErrRes } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (setErrRes) {
          setErr(setErrRes.message || "Failed to set session");
          setStatus("Auth failed");
          return;
        }

        // Route based on link type
        const t = (type || "").toLowerCase();

        if (t === "invite" || t === "signup") {
          // Force new users to create their password
          setStatus("Redirecting to set password…");
          // Pass along ?next so after password set we can land where intended
          nav(`/set-password?next=${encodeURIComponent(next)}`, { replace: true });
          return;
        }

        if (t === "recovery") {
          // Password recovery should also land on set-password
          setStatus("Redirecting to set password…");
          nav(`/set-password?next=${encodeURIComponent(next)}`, { replace: true });
          return;
        }

        // Magiclink / email_change / unknown types -> send to next (dashboard)
        setStatus("Redirecting…");
        nav(next, { replace: true });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStatus("Auth error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 text-zinc-100 shadow-2xl ring-1 ring-white/10 p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="animate-spin" />
          <div className="text-lg font-medium">{status}</div>
        </div>
        {err && (
          <div className="mt-4 rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-rose-200 text-sm">
            {err}
          </div>
        )}
        {!err && (
          <p className="mt-3 text-sm text-zinc-400">
            If this page doesn’t move on its own in a few seconds, you can safely close it and try
            clicking the link again.
          </p>
        )}
      </div>
    </div>
  );
}
