// src/pages/AuthCallback.jsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2 } from "lucide-react";

/**
 * AuthCallback
 * - Handles Supabase OAuth/email invite redirect.
 * - Guarantees a public.users row for the auth user.
 * - If profile is incomplete (missing full_name), redirects to /onboarding.
 * - Else, redirects to ?redirectTo=... or "/".
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // 1) Ensure we have a session after redirect
        const { data: sessionData, error: sErr } = await supabase.auth.getSession();
        if (sErr) throw sErr;
        const session = sessionData?.session;
        const user = session?.user;
        if (!user) {
          // no session -> go to login
          navigate("/login");
          return;
        }

        // 2) Make sure a public.users row exists for this auth user (id=email sync)
        //    (If your trigger already creates it, select will just find it.)
        const { data: row, error: selErr } = await supabase
          .from("users")
          .select("id, email, full_name")
          .eq("id", user.id)
          .single();

        if (selErr && selErr.code !== "PGRST116") throw selErr; // ignore "not found"

        if (!row) {
          // Create a minimal row so onboarding can upsert cleanly
          const seed = {
            id: user.id,
            email: user.email,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          const { error: insErr } = await supabase.from("users").insert(seed);
          if (insErr && insErr.code !== "23505") throw insErr; // ignore dup
        }

        // 3) Re-read to check completeness
        const { data: check, error: checkErr } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", user.id)
          .single();
        if (checkErr) throw checkErr;

        const forceOnboard = params.get("onboard") === "1"; // optional escape hatch
        const needsOnboarding = forceOnboard || !check?.full_name || !String(check.full_name).trim();

        if (!alive) return;

        if (needsOnboarding) {
          navigate("/onboarding", { replace: true });
          return;
        }

        // 4) Otherwise go where they intended (if provided), else dashboard
        const dest = params.get("redirectTo") || "/";
        navigate(dest, { replace: true });
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setErr(e.message || "Authentication callback failed.");
        // Soft fallback after a short pause
        setTimeout(() => navigate("/"), 1200);
      }
    })();

    return () => {
      alive = false;
    };
  }, [navigate, params]);

  return (
    <div className="p-6 md:p-8">
      <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
        <Loader2 className="size-6 animate-spin inline-block mr-2" />
        Finishing sign-in…
        {err ? (
          <div className="mt-3 text-red-600 dark:text-red-300 text-sm">{err}</div>
        ) : null}
      </div>
    </div>
  );
}
