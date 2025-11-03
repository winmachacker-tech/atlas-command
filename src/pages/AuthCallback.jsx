import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Handles ALL Supabase auth callbacks:
 * - invite / recovery: verifyOtp(token_hash) ➜ upsert users row ➜ /set-password
 * - code (OAuth/PKCE): exchangeCodeForSession(code) ➜ upsert ➜ /
 * - hash tokens (access_token in URL hash): setSession ➜ upsert ➜ /
 *
 * Make sure you have a route to this page, e.g.:
 * <Route path="/auth/callback" element={<AuthCallback />} />
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Processing sign-in…");

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);

        // Params can arrive as search params (?type=invite&token_hash=...)
        // or in the hash fragment (#access_token=...).
        const search = url.searchParams;
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));

        const type = search.get("type");           // "invite" | "recovery" | "magiclink" | ...
        const token_hash = search.get("token_hash");
        const code = search.get("code");           // OAuth/PKCE
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");

        console.log("[AuthCallback] incoming params", { type, token_hash, code, access_token: !!access_token });

        let session = null;
        let user = null;

        if (type && token_hash) {
          // Handle invite / recovery / magiclink / email_change via verifyOtp
          setStatus(`Verifying ${type} link…`);
          const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
          if (error) {
            console.error("[AuthCallback] verifyOtp error", error);
            throw error;
          }
          session = data.session ?? null;
          user = data.user ?? session?.user ?? null;
          console.log("[AuthCallback] verifyOtp ok", { hasSession: !!session, hasUser: !!user });

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
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) {
            console.error("[AuthCallback] setSession error", error);
            throw error;
          }
          session = data.session;
          user = data.user ?? session?.user ?? null;
          console.log("[AuthCallback] setSession ok");

        } else {
          // Nothing we can handle — send to login
          console.warn("[AuthCallback] No recognizable params, redirecting to /login");
          navigate("/login", { replace: true });
          return;
        }

        if (!user) {
          // In some cases session exists but user is null; refetch.
          const { data: usr, error: uerr } = await supabase.auth.getUser();
          if (uerr) {
            console.error("[AuthCallback] getUser error", uerr);
            throw uerr;
          }
          user = usr.user;
        }

        // Upsert the user's row for onboarding (RLS requires id = auth.uid()).
        // This pairs with the policies we just installed.
        setStatus("Finalizing account…");
        const profile = {
          id: user.id,
          email: user.email,
          // add safe defaults; these columns can be optional in your schema
          full_name: user.user_metadata?.full_name ?? null,
          is_admin: false, // admins can promote later
          updated_at: new Date().toISOString(),
        };

        const { error: upsertErr } = await supabase
          .from("users")
          .upsert(profile, { onConflict: "id" }); // hits /rest/v1/users?on_conflict=id
        if (upsertErr) {
          console.error("[AuthCallback] users upsert error", upsertErr);
          throw upsertErr;
        }

        // Routing rules
        if (type === "invite" || type === "recovery") {
          // brand-new / password reset: send to Set Password flow
          setStatus("Redirecting to set your password…");
          navigate("/set-password", { replace: true });
        } else {
          // all other cases
          setStatus("Signed in. Redirecting…");
          navigate("/", { replace: true });
        }
      } catch (err) {
        console.error("[AuthCallback] Fatal error", err);
        setStatus(err?.message || "Something went wrong during sign-in.");
        // Give the user an escape hatch
        setTimeout(() => navigate("/login", { replace: true }), 2500);
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
