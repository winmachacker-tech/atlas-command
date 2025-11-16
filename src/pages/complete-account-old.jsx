// FILE: src/pages/CompleteAccount.jsx
// Purpose:
// - When an invited / first-time user lands here from the email link,
//   automatically finish their account setup and then send them
//   straight to the Profile page.
//
// New Flow:
//   1) User clicks invite email → /complete-account
//   2) This page runs auto-setup:
//        - Mark auth.user_metadata.profile_complete = true
//        - Upsert public.profiles with profile_complete = true
//        - Link pending org invites (rpc_link_invited_user_to_orgs)
//        - Bootstrap org if needed (rpc_bootstrap_org_for_user)
//   3) Then navigate("/profile") so they can review details / password.
//
// Security:
// - No service keys, no RLS bypass. All writes go through normal Supabase
//   client + your existing RLS + secure RPCs.
// - This route is still wrapped in <AuthGuard> in main.jsx, so only an
//   authenticated invited user can hit it.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function CompleteAccount() {
  const navigate = useNavigate();

  // status: "running" | "done" | "error"
  const [status, setStatus] = useState("running");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function finishSetup() {
      try {
        setStatus("running");
        setErrorMessage("");

        // 1) Get current user (must exist because of AuthGuard)
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr || !user) {
          console.error("[CompleteAccount] getUser error or no user:", userErr);
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(
              "We couldn't find an active session. Please log in again from your invite email."
            );
          }
          return;
        }

        const userId = user.id;
        const email = user.email || "";

        // 2) Ensure metadata has profile_complete = true
        const hasProfileCompleteMeta =
          user.user_metadata && user.user_metadata.profile_complete === true;

        if (!hasProfileCompleteMeta) {
          const { data: updatedUser, error: updErr } =
            await supabase.auth.updateUser({
              data: {
                ...user.user_metadata,
                profile_complete: true,
              },
            });

          if (updErr) {
            console.error("[CompleteAccount] updateUser error:", updErr);
            // Not fatal; org membership + RLS are stronger guards.
          } else {
            console.log(
              "[CompleteAccount] user_metadata.profile_complete set",
              updatedUser
            );
          }
        }

        // 3) Upsert profiles row with profile_complete = true
        try {
          const { error: profErr } = await supabase.from("profiles").upsert(
            {
              id: userId,
              email,
              full_name: user.user_metadata?.full_name || email,
              phone: user.user_metadata?.phone || "",
              profile_complete: true,
            },
            { onConflict: "id" }
          );

          if (profErr) {
            console.error("[CompleteAccount] profiles upsert error:", profErr);
          } else {
            console.log("[CompleteAccount] profiles upsert ok for", userId);
          }
        } catch (profUnexpected) {
          console.error(
            "[CompleteAccount] Unexpected profiles upsert error:",
            profUnexpected
          );
        }

        // 4) Link any pending org invites to this user (email-based invites)
        try {
          const { error: linkErr } = await supabase.rpc(
            "rpc_link_invited_user_to_orgs"
          );
          if (linkErr) {
            console.error(
              "[CompleteAccount] rpc_link_invited_user_to_orgs error:",
              linkErr
            );
          } else {
            console.log(
              "[CompleteAccount] rpc_link_invited_user_to_orgs completed"
            );
          }
        } catch (linkUnexpected) {
          console.error(
            "[CompleteAccount] Unexpected error linking invites:",
            linkUnexpected
          );
        }

        // 5) Bootstrap org if needed (first-user flow, etc.)
        try {
          const { error: bootErr } = await supabase.rpc(
            "rpc_bootstrap_org_for_user"
          );
          if (bootErr) {
            console.error(
              "[CompleteAccount] rpc_bootstrap_org_for_user error:",
              bootErr
            );
          } else {
            console.log(
              "[CompleteAccount] rpc_bootstrap_org_for_user completed"
            );
          }
        } catch (bootUnexpected) {
          console.error(
            "[CompleteAccount] Unexpected bootstrap RPC error:",
            bootUnexpected
          );
        }

        // 6) Clean any stored redirect hints (optional safety)
        try {
          localStorage.removeItem("atlas.redirectAfterAuth");
        } catch {
          // ignore localStorage issues
        }

        if (cancelled) return;

        setStatus("done");

        // 7) Send them to /profile (not /)
        // This lets them immediately see their account + org and optionally
        // set password / tweak details.
        setTimeout(() => {
          navigate("/profile", { replace: true });
        }, 300);
      } catch (err) {
        console.error("[CompleteAccount] Unhandled error:", err);
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            "Something went wrong while finishing your setup. Please try again or log in from your invite email."
          );
        }
      }
    }

    finishSetup();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // ---------------- UI STATES ----------------

  if (status === "running") {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-black/40">
          <h1 className="text-xl font-semibold mb-1 text-slate-50">
            Finishing your Atlas setup
          </h1>
          <p className="text-sm text-slate-400 mb-4">
            We&apos;re linking your invite, preparing your organization, and
            getting your profile ready.
          </p>

          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl border border-slate-700 bg-slate-800 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            </div>
            <div className="text-sm text-slate-300">
              This usually only takes a moment…
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-rose-800/60 bg-slate-900/80 p-6 shadow-xl shadow-black/40 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl border border-rose-700/70 bg-slate-900 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-50">
                We couldn&apos;t finish your setup
              </h1>
              <p className="text-xs text-slate-400">
                {errorMessage ||
                  "Please close this window and try logging in again from your invite email."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/login", { replace: true });
            }}
            className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  // status === "done" (very brief before navigate kicks in)
  return (
    <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-black/40">
        <h1 className="text-xl font-semibold mb-1 text-slate-50">
          You&apos;re all set
        </h1>
        <p className="text-sm text-slate-400">
          Redirecting you to your profile so you can review your account
          details…
        </p>
      </div>
    </div>
  );
}
