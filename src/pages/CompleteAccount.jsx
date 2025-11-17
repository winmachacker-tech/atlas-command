// FILE: src/pages/CompleteAccount.jsx
// Purpose:
// - Onboard newly invited / first-time users into Atlas Command.
// - Let them confirm their full name and phone, and (optionally) set a password.
// - Save data into:
//     • auth.user_metadata  (full_name, phone)
//     • public.profiles     (full_name, phone, profile_complete = true)
// - After successful submit:
//     • Call rpc_bootstrap_org_for_user() to attach them to the correct org
//       (inviter’s org for invited users, or create the very first org ever).
//     • Redirect to "/" (dashboard).
//
// SECURITY NOTES:
// - Uses supabase-js on the client with the logged-in user's session.
// - Does NOT bypass RLS or use any service role keys.
// - All org linking logic is enforced in the DB via rpc_bootstrap_org_for_user().

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function CompleteAccount() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // Load current user + profile
  useEffect(() => {
    async function init() {
      setLoading(true);
      setErr("");
      try {
        // 1) Get current session
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();

        if (sessionErr) throw sessionErr;
        if (!session || !session.user) {
          // No session → send them to login
          navigate("/login", { replace: true });
          return;
        }

        const user = session.user;
        setUserId(user.id);
        setEmail(user.email ?? "");

        const meta = user.user_metadata || {};
        setFullName(meta.full_name ?? "");
        setPhone(meta.phone ?? "");

        // 2) Load profiles row (if it exists)
        const { data: profileRows, error: profileErr } = await supabase
          .from("profiles")
          .select("full_name, phone, profile_complete")
          .eq("id", user.id)
          .maybeSingle();

        if (profileErr && profileErr.code !== "PGRST116") {
          // Ignore "no rows" (PGRST116), but surface other errors
          throw profileErr;
        }

        if (profileRows) {
          if (profileRows.full_name && !fullName) {
            setFullName(profileRows.full_name);
          }
          if (profileRows.phone && !phone) {
            setPhone(profileRows.phone);
          }

          // If profile is already complete, just send them to the app
          if (profileRows.profile_complete) {
            navigate("/", { replace: true });
            return;
          }
        }
      } catch (e) {
        console.error("[CompleteAccount] init error", e);
        setErr(e.message ?? "Failed to load account info.");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setErr("");
    setOk("");

    if (!fullName.trim()) {
      setErr("Full name is required.");
      return;
    }

    if (password && password.length < 6) {
      setErr("If you choose a password, it must be at least 6 characters.");
      return;
    }

    if (password && password !== passwordConfirm) {
      setErr("Password confirmation does not match.");
      return;
    }

    try {
      setSubmitting(true);

      // 1) Refresh session / user, in case something changed
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;
      if (!session || !session.user) {
        throw new Error("Your session expired. Please log in again.");
      }

      const user = session.user;
      const uid = user.id;

      // 2) Update auth.user_metadata (and optionally password)
      {
        const updatePayload = {
          data: {
            ...(user.user_metadata || {}),
            full_name: fullName.trim(),
            phone: phone.trim(),
          },
        };

        if (password) {
          updatePayload.password = password;
        }

        const { error: updateAuthErr } = await supabase.auth.updateUser(
          updatePayload
        );
        if (updateAuthErr) {
          throw updateAuthErr;
        }
      }

      // 3) Upsert into public.profiles and mark profile_complete = true
      {
        const { error: profileErr } = await supabase.from("profiles").upsert(
          {
            id: uid,
            email: user.email,
            full_name: fullName.trim(),
            phone: phone.trim(),
            profile_complete: true,
          },
          { onConflict: "id" }
        );

        if (profileErr) {
          throw profileErr;
        }
      }

      // 4) Call rpc_bootstrap_org_for_user to:
      //    - Link invited users to the inviter's org via team_members
      //    - Create a new org ONLY for the first user in the entire system
      {
        const { error: bootstrapErr } = await supabase.rpc(
          "rpc_bootstrap_org_for_user"
        );
        if (bootstrapErr) {
          // We log it but don't block the user from continuing.
          console.error(
            "[CompleteAccount] rpc_bootstrap_org_for_user error",
            bootstrapErr
          );
          // Optionally surface a mild warning:
          // setErr("We saved your profile, but failed to attach you to an organization. Please contact support.");
          // return;
        }
      }

      setOk("Account setup complete. Redirecting to your dashboard...");
      // Small delay so the user sees the success message (optional)
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 600);
    } catch (e) {
      console.error("[CompleteAccount] submit error", e);
      setErr(e.message ?? "Failed to complete your account setup.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3 text-slate-200">
          <Loader2 className="h-6 w-6 animate-spin" />
          <div className="text-sm text-slate-400">
            Loading your account setup…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-slate-50 mb-1">
          Complete your Atlas account
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          We just need a few details to finish setting up your profile.
        </p>

        {err && (
          <div className="mb-4 rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {err}
          </div>
        )}

        {ok && (
          <div className="mb-4 rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            {ok}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-slate-300 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Full name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Mark Tishkun"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500"
            />
          </div>

          <div className="pt-2 border-t border-slate-800/80 mt-4">
            <p className="text-xs text-slate-500 mb-3">
              Password (optional): You can set a password now or skip this and
              set it later from the Security page.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to keep existing (if any)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="Re-type your new password"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={cx(
              "mt-4 w-full inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium",
              "bg-emerald-500 text-slate-950 hover:bg-emerald-400",
              "focus:outline-none focus:ring-2 focus:ring-emerald-500/80 focus:ring-offset-2 focus:ring-offset-slate-950",
              submitting && "opacity-70 cursor-not-allowed"
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Finishing setup…
              </>
            ) : (
              "Finish account setup"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
