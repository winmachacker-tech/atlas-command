// FILE: src/components/OrgBootstrapGate.jsx
// Purpose:
//   After a user logs in, make sure:
//   1) They belong to an org (first-user or invite flow)
//   2) Their profile is marked complete in profiles.profile_complete
//      - If not complete -> redirect to /complete-account

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, AlertTriangle, Shield } from "lucide-react";

export default function OrgBootstrapGate({ children }) {
  const [status, setStatus] = useState("checking"); // "checking" | "ok" | "no-org" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setStatus("checking");

        // 1) Get current user
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(
              "No authenticated user found. Please sign in again."
            );
          }
          return;
        }

        // 2) Call the bootstrap function (first-user org or invite attach)
        const { error: bootstrapError } = await supabase.rpc(
          "rpc_bootstrap_org_for_user"
        );
        if (bootstrapError) {
          console.error("rpc_bootstrap_org_for_user error:", bootstrapError);
          // not fatal; keep going
        }

        // 3) Check org membership
        const { data: tmRows, error: tmError } = await supabase
          .from("team_members")
          .select("org_id, role")
          .eq("user_id", user.id)
          .limit(1);

        if (cancelled) return;

        if (tmError) {
          console.error("Error fetching team_members:", tmError);
          setStatus("error");
          setErrorMessage(
            "Could not verify your organization access. Please try again."
          );
          return;
        }

        if (!tmRows || tmRows.length === 0) {
          setStatus("no-org");
          return;
        }

        // 4) Check profile completeness from profiles table
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("profile_complete")
          .eq("id", user.id)
          .maybeSingle();

        if (profileErr && profileErr.code !== "PGRST116") {
          // PGRST116 = "No rows found" -> treat as not complete
          console.error("Error fetching profile:", profileErr);
        }

        const profileComplete = profile?.profile_complete === true;

        if (!profileComplete) {
          // Profile not complete -> redirect to onboarding page
          navigate("/complete-account", { replace: true });
          return;
        }

        // All good: org member + profile complete
        setStatus("ok");
      } catch (err) {
        console.error("Unexpected error in OrgBootstrapGate:", err);
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Something went wrong. Please refresh and try again.");
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // ---- UI states ----

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-2xl border border-slate-700 bg-slate-900 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-slate-100">
              Preparing your workspace…
            </p>
            <p className="text-xs text-slate-400">
              We&apos;re attaching your account to the correct organization.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "no-org") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Shield className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-50">
                No organization access
              </h1>
              <p className="text-xs text-slate-400">
                Your account is not linked to any Atlas organization yet.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-slate-300">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5" />
            <div className="space-y-1">
              <p>This usually means one of two things:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>You haven&apos;t been invited to an organization yet.</li>
                <li>
                  Or your invite email doesn&apos;t match the email you used to
                  sign in.
                </li>
              </ul>
            </div>
          </div>

          <div className="text-xs text-slate-400 space-y-2">
            <p>
              Ask your Atlas admin to send an invite to your exact email
              address. Once you accept the invite and sign in again, you&apos;ll
              automatically be attached to their organization.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-50">
                Something went wrong
              </h1>
              <p className="text-xs text-slate-400">
                We couldn&apos;t verify your organization access.
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-300">{errorMessage}</p>

          <button
            onClick={() => window.location.reload()}
            className="mt-2 inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors"
          >
            Refresh and try again
          </button>
        </div>
      </div>
    );
  }

  // status === "ok"
  return <>{children}</>;
}
