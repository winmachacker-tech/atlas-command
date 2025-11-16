// FILE: src/components/AiFeatureGate.jsx
// PURPOSE:
//  - Gate access to AI features (Dispatch AI, AI Recommendations, etc.)
//  - Checks per-user feature flag on team_members.ai_recommendations_enabled
//  - Only allows access when that flag is true for the current user
//
// HOW IT WORKS:
//  1) Get current auth user via supabase.auth.getUser()
//  2) Find their latest team_members row (current org membership)
//  3) Read ai_recommendations_enabled
//  4) If true  -> render children (AI page)
//     If false -> show "AI disabled" screen

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Lock, Sparkles, Loader2, AlertTriangle } from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function AiFeatureGate({ children }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      setLoading(true);
      setError("");

      // 1) Get current user
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (cancelled) return;

      if (authError || !authData?.user) {
        console.error("[AiFeatureGate] auth error:", authError);
        setError("You must be signed in to use AI features.");
        setAllowed(false);
        setLoading(false);
        return;
      }

      const userId = authData.user.id;

      // 2) Look up team_members row for this user
      //    (current implementation: just take the most recent membership)
      const { data: members, error: memberErr } = await supabase
        .from("team_members")
        .select("id, org_id, ai_recommendations_enabled, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (memberErr) {
        console.error("[AiFeatureGate] team_members error:", memberErr);
        setError(
          "Unable to check your AI access right now. Please try again later."
        );
        setAllowed(false);
        setLoading(false);
        return;
      }

      const member = members?.[0] ?? null;

      if (!member) {
        setError(
          "You are not associated with any organization. Contact your admin."
        );
        setAllowed(false);
        setLoading(false);
        return;
      }

      // 3) Actual gate: per-user flag controlled by Super Admin panel
      const enabled = !!member.ai_recommendations_enabled;

      setAllowed(enabled);
      setLoading(false);
    }

    checkAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  // 4) Render states
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="inline-flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-700 bg-slate-900/80">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-slate-100">
              Checking AI access…
            </span>
            <span className="text-xs text-slate-400">
              Verifying your account permissions and feature flags.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-950/80 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-full bg-slate-900 grid place-items-center">
              <Lock className="w-5 h-5 text-slate-300" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-100">
                AI features are disabled for your account
              </h1>
              <p className="text-xs text-slate-400">
                A platform super admin can enable AI recommendations and lab
                tools for individual users from the Super Admin Control Center.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-amber-300 mb-3">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <ul className="text-xs text-slate-400 space-y-1 mb-4">
            <li className="flex gap-2">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 text-emerald-400" />
              <span>
                To request access, contact your admin or platform owner and ask
                them to enable <code>AI Recommendations</code> for your user.
              </span>
            </li>
            <li className="flex gap-2">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 text-emerald-400" />
              <span>
                Once enabled, refresh this page and the AI tools will unlock
                automatically.
              </span>
            </li>
          </ul>

          <p className="text-[11px] text-slate-500">
            If you are the platform owner, sign in with your super admin
            account and use the{" "}
            <span className="font-medium text-emerald-300">
              Super Admin Control Center
            </span>{" "}
            to toggle per-user AI access.
          </p>
        </div>
      </div>
    );
  }

  // ✅ Allowed → show the actual AI page content
  return <>{children}</>;
}
