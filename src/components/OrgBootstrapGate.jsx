// FILE: src/components/OrgBootstrapGate.jsx
// Purpose:
//   After a user logs in, make sure they belong to an org.
//   If they don't, show a clear "no org" screen.
//
// IMPORTANT:
//   - We DO NOT check profile_complete here anymore.
//   - No redirects to /complete-account (prevents loops).
//   - Org membership + your existing RLS remain the real security boundary.
//
// Flow:
//   1) Get current user via supabase.auth.getUser().
//   2) Check public.team_members for a row with this user_id.
//   3) If found -> status "ok" -> render children (Main app).
//   4) If not found:
//        a) Call rpc_bootstrap_org_for_user() once (idempotent).
//        b) Re-check team_members.
//        c) If still no org -> show "no org" message.
//   5) On any hard auth error -> show error + sign-out button.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, AlertTriangle, Shield } from "lucide-react";

export default function OrgBootstrapGate({ children }) {
  const [status, setStatus] = useState("checking"); // "checking" | "ok" | "no-org" | "error"
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function ensureOrg() {
      try {
        setStatus("checking");
        setMessage("");

        // 1) Get current user (AuthGuard should already enforce this,
        //    but we keep the check to be safe).
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr || !user) {
          console.error("[OrgBootstrapGate] getUser error or no user:", userErr);
          if (!cancelled) {
            setStatus("error");
            setMessage(
              "We couldn’t find an active session. Please log in again."
            );
          }
          return;
        }

        const userId = user.id;

        // Helper: check if this user has at least one org membership
        async function hasOrgMembership() {
          const { data, error } = await supabase
            .from("team_members")
            .select("org_id")
            .eq("user_id", userId)
            .limit(1);

          if (error) {
            console.error(
              "[OrgBootstrapGate] team_members select error:",
              error
            );
            return { ok: false, hasOrg: false };
          }

          const hasOrg =
            Array.isArray(data) &&
            data.length > 0 &&
            Boolean(data[0]?.org_id);

          return { ok: true, hasOrg };
        }

        // 2) First membership check
        const firstCheck = await hasOrgMembership();

        if (!firstCheck.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(
              "We had trouble verifying your organization. Please try again."
            );
          }
          return;
        }

        if (firstCheck.hasOrg) {
          if (!cancelled) {
            setStatus("ok");
          }
          return;
        }

        // 3) No org yet → try bootstrapping once.
        //    This covers first-user flow or any missed invite linking.
        try {
          const { error: bootErr } = await supabase.rpc(
            "rpc_bootstrap_org_for_user"
          );
          if (bootErr) {
            console.error(
              "[OrgBootstrapGate] rpc_bootstrap_org_for_user error:",
              bootErr
            );
          } else {
            console.log(
              "[OrgBootstrapGate] rpc_bootstrap_org_for_user completed"
            );
          }
        } catch (bootUnexpected) {
          console.error(
            "[OrgBootstrapGate] Unexpected bootstrap RPC error:",
            bootUnexpected
          );
        }

        // 4) Re-check membership after bootstrap attempt
        const secondCheck = await hasOrgMembership();

        if (!secondCheck.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(
              "We had trouble verifying your organization. Please try again."
            );
          }
          return;
        }

        if (secondCheck.hasOrg) {
          if (!cancelled) {
            setStatus("ok");
          }
          return;
        }

        // 5) Still no org → show no-org screen (do NOT redirect anywhere).
        if (!cancelled) {
          setStatus("no-org");
          setMessage(
            "Your account is active, but it’s not linked to an Atlas organization yet."
          );
        }
      } catch (err) {
        console.error("[OrgBootstrapGate] Unhandled error:", err);
        if (!cancelled) {
          setStatus("error");
          setMessage(
            "Something went wrong while checking your organization. Please try again."
          );
        }
      }
    }

    ensureOrg();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------- UI STATES ----------------

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl shadow-black/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-50">
                Preparing your workspace
              </h1>
              <p className="text-xs text-slate-400">
                We&apos;re verifying your organization access…
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "no-org") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl shadow-black/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Shield className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-50">
                No organization found
              </h1>
              <p className="text-xs text-slate-400">
                {message ||
                  "Your login is working, but we couldn’t find an Atlas organization for your account."}
              </p>
            </div>
          </div>

          <ul className="text-xs text-slate-400 list-disc pl-5 space-y-1">
            <li>Ask your Atlas admin to invite you to their organization.</li>
            <li>
              If you think this is a mistake, sign out and try the invite link
              again.
            </li>
          </ul>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors"
            >
              Refresh and try again
            </button>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-800/60 rounded-2xl p-6 space-y-4 shadow-xl shadow-black/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-900 border border-red-700/70 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-50">
                We couldn&apos;t verify your organization
              </h1>
              <p className="text-xs text-slate-400">
                {message ||
                  "Please try refreshing the page or signing out and logging in again."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // status === "ok"
  return <>{children}</>;
}
