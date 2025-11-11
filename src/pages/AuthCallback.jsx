// src/pages/AuthCallback.jsx
import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Safe, single-run handler for all Supabase auth callback shapes.
 * ALWAYS checks profile_complete and sends to /complete-account if false.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [status, setStatus] = useState("Processing sign-inâ€¦");

  // Intended destination priority:
  // 1) localStorage.atlas.redirectAfterAuth (set by Auth.jsx)
  // 2) ?next or ?redirect_to from the URL
  // 3) "/"
  const redirectTo = useMemo(() => {
    try {
      const stored = localStorage.getItem("atlas.redirectAfterAuth");
      if (stored) return stored;
    } catch {}
    try {
      const url = new URL(window.location.href);
      const next = url.searchParams.get("next");
      const alt = url.searchParams.get("redirect_to");
      return next || alt || "/";
    } catch {
      return "/";
    }
  }, []);

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
          setTimeout(() => navigate("/auth", { replace: true }), 2000);
          return;
        }

        // Supabase callback shapes:
        const rawType = (search.get("type") || "").toLowerCase();
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
          redirectTo,
        });

        let session = null;
        let user = null;

        if (type && token_hash) {
          // invite / recovery / magiclink / email_change / signup
          setStatus(`Verifying ${type} linkâ€¦`);
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
          setStatus("Exchanging authorization codeâ€¦");
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
          setStatus("Restoring sessionâ€¦");
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
          console.warn("[AuthCallback] No recognizable params, redirecting to /auth");
          navigate("/auth", { replace: true });
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
        setStatus("Finalizing accountâ€¦");
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
            .from("profiles")
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

        // ALWAYS check profile_complete - ignore link type
        setStatus("Checking your profileâ€¦");
        const { data: p, error: pErr } = await supabase
          .from("profiles")
          .select("profile_complete")
          .eq("id", user.id)
          .maybeSingle();

        if (pErr) {
          console.warn("[AuthCallback] Profile check error, sending to onboarding", pErr);
          setStatus("Preparing your accountâ€¦");
          navigate("/complete-account", { replace: true });
          return;
        }

        // If profile is incomplete OR doesn't exist, send to onboarding
        if (!p || p.profile_complete === false) {
          setStatus("Finish setting up your accountâ€¦");
          navigate("/complete-account", { replace: true });
          return;
        }

        // Profile complete â†’ go to intended destination, clear the stored redirect
        try { localStorage.removeItem("atlas.redirectAfterAuth"); } catch {}
        setStatus("All set. Redirectingâ€¦");
        navigate(redirectTo || "/", { replace: true });
      } catch (err) {
        console.error("[AuthCallback] Fatal error", err);
        setStatus(err?.message || "Something went wrong during sign-in.");
        setTimeout(() => navigate("/auth", { replace: true }), 2000);
      }
    })();
  }, [navigate, redirectTo]);

  return (
    <div className="min-h-screen w-full grid place-items-center">
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold mb-2">Signing you inâ€¦</h1>
        <p className="text-sm text-zinc-300">{status}</p>
      </div>
    </div>
  );
}
