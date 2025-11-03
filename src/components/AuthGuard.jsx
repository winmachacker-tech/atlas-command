// src/components/AuthGuard.jsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2 } from "lucide-react";

/**
 * AuthGuard
 * - Blocks access to protected pages.
 * - If not authenticated -> /login
 * - If authenticated but profile incomplete (no full_name) -> /onboarding
 * - Otherwise -> render children
 *
 * Usage: wrap protected routes with <AuthGuard>...</AuthGuard>
 */
export default function AuthGuard({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let alive = true;

    async function runCheck() {
      setChecking(true);

      try {
        // 1) Require auth
        const { data: sessionData, error: sErr } = await supabase.auth.getSession();
        if (sErr) throw sErr;
        const session = sessionData?.session;
        const user = session?.user;

        // If not logged in, send to /login with redirect back to where they were
        if (!user) {
          const redirectTo = encodeURIComponent(location.pathname + location.search);
          navigate(`/login?redirectTo=${redirectTo}`, { replace: true });
          return;
        }

        // 2) Ensure a users row exists (in case trigger didn't run)
        const { data: row, error: selErr } = await supabase
          .from("users")
          .select("id,email,full_name")
          .eq("id", user.id)
          .single();

        if (selErr && selErr.code !== "PGRST116") throw selErr;

        if (!row) {
          // create a stub row so onboarding form can upsert cleanly
          const seed = {
            id: user.id,
            email: user.email,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          const { error: insErr } = await supabase.from("users").insert(seed);
          if (insErr && insErr.code !== "23505") throw insErr;
        }

        // 3) Check completeness
        const { data: check, error: chkErr } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", user.id)
          .single();
        if (chkErr) throw chkErr;

        const needsOnboarding = !check?.full_name || !String(check.full_name).trim();

        // Allow visiting /onboarding itself; otherwise force onboarding
        const atOnboarding = location.pathname.startsWith("/onboarding");
        if (needsOnboarding && !atOnboarding) {
          navigate("/onboarding", { replace: true });
          return;
        }

        if (!alive) return;
        setAllowed(true);
      } catch (e) {
        console.error("[AuthGuard]", e);
        // fall back to login on any fatal error
        const redirectTo = encodeURIComponent(location.pathname + location.search);
        navigate(`/login?redirectTo=${redirectTo}`, { replace: true });
      } finally {
        if (alive) setChecking(false);
      }
    }

    runCheck();

    // 4) React to auth state changes (logout/login)
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      runCheck();
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
    // include pathname so moving between pages revalidates quickly
  }, [location.pathname, location.search, navigate]);

  if (checking) {
    return (
      <div className="p-6 md:p-8">
        <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
          <Loader2 className="size-6 animate-spin inline-block mr-2" />
          Checking access…
        </div>
      </div>
    );
  }

  return allowed ? children : null;
}
