// src/pages/AuthCallback.jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Safe, single-run handler for all Supabase auth callback shapes.
 * Minimal, integrity-first changes:
 *  - Keep your logic, add support for ?redirect_to as alias of ?next
 *  - Handle ?error_description from Supabase gracefully
 *  - Do NOT remap "signup" -> "invite" (pass-through to verifyOtp)
 *  - Fixed to use "profiles" table instead of "users"
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [status, setStatus] = useState("Processing sign-in…");

  useEffect(() => {
    if (ranRef.current) return; // guard StrictMode double invoke
    ranRef.current = true;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const search = url.searchParams;
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));

        // Early: bubble up errors that come back in the URL
        const urlErr = search.get("error_description");
        if (urlErr) {
          console.warn("[AuthCallback] URL error_description:", urlErr);
          setStatus(urlErr);
          setTimeout(() => navigate("/login", { replace: true }), 2000);
          return;
        }

        // Optional: allow caller to pass a post-login redirect.
        // Supports both ?next=/x and ?redirect_to=/x (either one).
        const next = search.get("next") || search.get("redirect_to") || "/";

        // Supabase callback shapes:
        const rawType = (search.get("type") || "").toLowerCase();
        // Pass-through real types: signup | invite | recovery | magiclink | email_change
        // Only normalize "email" (legacy) to "magiclink".
        const type = rawType === "email" ? "magiclink" : rawType || null;

        const token_hash = search.get("token_hash");
        const code = search.get("code"); // OAuth/PKCE
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");

        console.log("[AuthCallback] incoming", {
          type,
          has_token_hash: !!token_hash,
          has_code: !!code,
          has_hash_tokens: !!access_token && !!refresh_token,
          next,
        });

        let session = null;
        let user = null;

        if (type && token_hash) {
          // invite / recovery / magiclink / email_change / signup
          setStatus(`Verifying ${type} link…`);
          const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
          if (error) {
            console.error("[AuthCallback] verifyOtp error", error);
            throw error;
          }
          session = data.session ?? null;
          user = data.user ?? session?.user ?? null;
          console.log("[AuthCallback] verifyOtp ok", { hasSession: !!session });

        } else if (code) {
          // OAuth/PKCE callback
          setStatus("Exchanging authorization code…");
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("[AuthCallback] exchangeCodeForSession error", error);
            throw error;
          }
          session = data.session;
          user = data.user ?? session?.user ?? null;
          console.log("[AuthCallback] exchangeCodeForSession ok");

        } else if (access_token && refresh_token) {
          // Hash tokens flow
          setStatus("Restoring session…");
          const { data, error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) {
            console.error("[AuthCallback] setSession error", error);
            throw error;
          }
          session = data.session;
          user = data.user ?? session?.user ?? null;
          console.log("[AuthCallback] setSession ok");

        } else {
          console.warn("[AuthCallback] No recognizable params, redirecting to /login");
          navigate("/login", { replace: true });
          return;
        }

        // Sometimes session exists but user is null; refetch defensively.
        if (!user) {
          const { data: usr, error: uerr } = await supabase.auth.getUser();
          if (uerr) {
            console.error("[AuthCallback] getUser error", uerr);
            throw uerr;
          }
          user = usr.user;
        }

        // Best-effort profile upsert. If your schema differs, we won't block signin.
        setStatus("Finalizing account…");
        try {
          const profile = {
            id: user.id,
            full_name: user.user_metadata?.full_name ?? null,
            phone: user.user_metadata?.phone ?? null,
            role: user.user_metadata?.role ?? "USER",
            is_admin: false,
            updated_at: new Date().toISOString(),
          };

          const { error: upsertErr } = await supabase
            .from("profiles") // ✅ Changed from "users" to "profiles"
            .upsert(profile, { onConflict: "id" });

          if (upsertErr) {
            console.warn("[AuthCallback] profiles upsert warning (non-fatal)", upsertErr);
          }
        } catch (soft) {
          console.warn("[AuthCallback] profiles upsert skipped (non-fatal)", soft);
        }

        // Clean the URL (remove #tokens & code) before navigating
        try {
          window.history.replaceState({}, document.title, "/auth/callback");
        } catch {}

        // Routing rules
        if (type === "invite" || type === "recovery" || type === "signup") {
          setStatus("Redirecting to set your password…");
          navigate("/set-password", { replace: true });
        } else {
          setStatus("Signed in. Redirecting…");
          navigate(next, { replace: true });
        }
      } catch (err) {
        console.error("[AuthCallback] Fatal error", err);
        setStatus(err?.message || "Something went wrong during sign-in.");
        setTimeout(() => navigate("/login", { replace: true }), 2000);
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen w-full grid place-items-center">
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold mb-2">Signing you in…</h1>
        <p className="text-sm text-zinc-300">{status}</p>
      </div>
    </div>
  );
}