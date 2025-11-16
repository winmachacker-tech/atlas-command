// src/pages/CompleteAccount.jsx
// Purpose:
// - Onboard newly invited / first-time users.
// - Let them confirm their name, phone, and (optionally) set a password.
// - Save data into auth.user_metadata AND profiles.profile_complete.
// - After successful submit, ALWAYS redirect to "/" (dashboard).

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
  const [password2, setPassword2] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      setOk("");

      // 1) Get current user
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const user = userData?.user || null;

      if (userError || !user) {
        setErr("No active session. Please sign in.");
        setLoading(false);
        return;
      }

      setUserId(user.id);
      setEmail(user.email || "");

      // 2) Pre-fill from metadata
      let metaFullName = user.user_metadata?.full_name || "";
      let metaPhone = user.user_metadata?.phone || "";

      // 3) Pre-fill from profiles if available
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("id", user.id)
        .maybeSingle();

      if (pErr && pErr.code !== "PGRST116") {
        console.error("Profile load error:", pErr);
      }

      if (profile) {
        metaFullName = metaFullName || profile.full_name || "";
        metaPhone = metaPhone || profile.phone || "";
      }

      setFullName(metaFullName);
      setPhone(metaPhone);

      setLoading(false);
    })();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId) return;

    setErr("");
    setOk("");
    setSubmitting(true);

    try {
      if (!fullName.trim()) {
        throw new Error("Please enter your full name.");
      }

      // 1) Build auth.updateUser payload (NO TYPE ANNOTATION)
      const updatePayload = {
        data: {
          full_name: fullName || "",
          phone: phone || "",
        },
      };

      // Optional: password update
      if (password || password2) {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
        if (password !== password2) {
          throw new Error("Passwords do not match.");
        }
        updatePayload.password = password;
      }

      // 2) Update user metadata + optional password
      const { error: userUpdateError } = await supabase.auth.updateUser(
        updatePayload
      );
      if (userUpdateError) throw userUpdateError;

      // 3) Update profiles table
      const { error: profErr } = await supabase
        .from("profiles")
        .update({
          full_name: fullName || "",
          phone: phone || "",
          profile_complete: true,
        })
        .eq("id", userId);

      if (profErr) throw profErr;

      setOk("Account setup complete. Redirecting…");

      try {
        localStorage.removeItem("atlas.redirectAfterAuth");
      } catch {}

      // 4) Always go to dashboard after setup
      setTimeout(() => navigate("/", { replace: true }), 500);
    } catch (e) {
      console.error("CompleteAccount error:", e);
      setErr(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 max-w-md w-full text-center shadow-lg shadow-black/40">
          <div className="flex items-center justify-center mb-3">
            <div className="h-9 w-9 rounded-xl border border-slate-700 bg-slate-800 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            </div>
          </div>
          <div className="text-sm text-slate-200">Loading your account…</div>
          <div className="text-xs text-slate-500 mt-1">
            Setting up your Atlas workspace.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-black/40">
        <h1 className="text-xl font-semibold mb-1 text-slate-50">
          Complete your Atlas account
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          You&apos;re signed in as{" "}
          <span className="font-mono text-slate-200">
            {email || "—"}
          </span>
          . Please confirm a few details to finish onboarding.
        </p>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1">
            <label className="text-sm text-slate-200">Full name</label>
            <input
              className="w-full rounded-md bg-black/30 border border-slate-800 px-3 py-2 text-sm outline-none focus:border-emerald-500/70"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm text-slate-200">Phone (optional)</label>
            <input
              className="w-full rounded-md bg-black/30 border border-slate-800 px-3 py-2 text-sm outline-none focus:border-emerald-500/70"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm text-slate-200">
              New password (optional)
            </label>
            <input
              type="password"
              className="w-full rounded-md bg-black/30 border border-slate-800 px-3 py-2 text-sm outline-none focus:border-emerald-500/70"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm text-slate-200">
              Confirm password (optional)
            </label>
            <input
              type="password"
              className="w-full rounded-md bg-black/30 border border-slate-800 px-3 py-2 text-sm outline-none focus:border-emerald-500/70"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="Re-enter password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={cx(
              "mt-2 w-full rounded-md border px-4 py-2 text-sm font-medium",
              "border-emerald-500/60 bg-emerald-500/20 hover:bg-emerald-500/30",
              "text-emerald-50 transition-colors",
              submitting && "opacity-60 cursor-not-allowed"
            )}
          >
            {submitting ? "Saving…" : "Finish setup"}
          </button>

          {ok && <p className="text-sm text-emerald-400 mt-1">{ok}</p>}
          {err && <p className="text-sm text-rose-400 mt-1">{err}</p>}

          <p className="text-xs text-slate-500 mt-4">
            You can change these later in your profile. If you didn&apos;t
            intend to create this account, you can{" "}
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                try {
                  localStorage.removeItem("atlas.redirectAfterAuth");
                } catch {}
                navigate("/auth", { replace: true });
              }}
              className="underline underline-offset-4 text-slate-300 hover:text-slate-100"
            >
              sign out
            </button>
            .
          </p>
        </form>
      </div>
    </div>
  );
}
