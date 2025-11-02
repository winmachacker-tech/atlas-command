// src/pages/SetPassword.jsx
// For invited / recovered users to set their password after AuthCallback established a session.
// - Reads ?next for post-success redirect (defaults to "/").
// - Requires an active Supabase session (set by AuthCallback). If missing, prompts to reopen invite link.
// - Validates password + confirm, calls supabase.auth.updateUser({ password }).
// - On success, redirects to ?next and shows a quick success state.
// Drop-in ready.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, Check, AlertCircle, Eye, EyeOff, Lock } from "lucide-react";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function SetPassword() {
  const nav = useNavigate();
  const qs = useQuery();
  const next = qs.get("next") || "/";

  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data?.session) {
        setHasSession(true);
      } else {
        setHasSession(false);
      }
      setSessionChecked(true);
    })();
  }, []);

  function validate(p1, p2) {
    if (!p1 || p1.length < 8) {
      return "Password must be at least 8 characters.";
    }
    if (p1 !== p2) {
      return "Passwords do not match.";
    }
    return "";
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    const v = validate(pw, pw2);
    if (v) {
      setErr(v);
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        setErr(error.message || "Failed to set password.");
        setSubmitting(false);
        return;
      }
      setOk(true);
      // brief success, then redirect
      setTimeout(() => nav(next, { replace: true }), 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  if (!sessionChecked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl bg-zinc-900 text-zinc-100 shadow-2xl ring-1 ring-white/10 p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin" />
            <div className="text-lg font-medium">Checking session…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl bg-zinc-900 text-zinc-100 shadow-2xl ring-1 ring-white/10 p-6">
          <div className="flex items-start gap-3 text-amber-300">
            <AlertCircle className="mt-0.5 shrink-0" />
            <div>
              <div className="text-lg font-semibold">Session not found</div>
              <p className="mt-2 text-sm text-zinc-300">
                Please open your <b>invite link</b> again (or the latest email link) so we can
                establish your session, then you’ll be redirected here to set a password.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={() => nav("/login")}
              className="px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pwStrongHint =
    pw.length >= 12 ? "Strong" : pw.length >= 10 ? "Good" : pw.length >= 8 ? "Okay" : "Too short";

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 text-zinc-100 shadow-2xl ring-1 ring-white/10 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-zinc-800 border border-white/10">
            <Lock size={18} />
          </div>
          <div>
            <div className="text-lg font-semibold">Set your password</div>
            <div className="text-sm text-zinc-400">
              Your account is almost ready. Create a password to finish.
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">New password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Enter a strong password"
                className="w-full rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/5"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="mt-1 text-xs text-zinc-400">Strength: {pwStrongHint}</div>
          </div>

          <div>
            <label className="block text-sm mb-1">Confirm password</label>
            <input
              type={showPw ? "text" : "password"}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="Re-enter your password"
              className="w-full rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              minLength={8}
              required
            />
          </div>

          {err && (
            <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-rose-200 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5" size={16} />
                <div>{err}</div>
              </div>
            </div>
          )}

          {ok && (
            <div className="rounded-xl border border-emerald-900/30 bg-emerald-950/30 p-3 text-emerald-200 text-sm">
              <div className="flex items-start gap-2">
                <Check className="mt-0.5" size={16} />
                <div>Password updated. Redirecting…</div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
              Save Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
