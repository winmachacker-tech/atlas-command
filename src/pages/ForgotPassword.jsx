// src/pages/ForgotPassword.jsx
// Drop-in page for sending password reset emails.
// Flow: user enters email â†’ Supabase sends link â†’ link lands on /auth/callback
// Our AuthCallback routes type=recovery â†’ /set-password (already implemented).

import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, Mail, CheckCircle2, AlertCircle } from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setErr("");
    setOk(false);

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) throw error;
      setOk(true);
    } catch (e) {
      setErr(e?.message || "Failed to send reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[--bg] text-[--fg]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Reset your password</h1>
          <p className="text-sm opacity-70 mt-1">
            Enter the email associated with your account. We&apos;ll send a link to set a new password.
          </p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm opacity-80">Email</span>
            <input
              type="email"
              required
              className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <button
            type="submit"
            disabled={busy || !email}
            className={cx(
              "mt-2 w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2",
              "border border-sky-500/40 bg-sky-500/20 hover:bg-sky-500/30",
              busy && "opacity-60 cursor-not-allowed"
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {busy ? "Sendingâ€¦" : "Send reset link"}
          </button>
        </form>

        {ok && (
          <div className="mt-4 text-sm rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5" />
            <div>
              Email sent! Check your inbox for a link to reset your password. The link will bring you back here to finish the process.
            </div>
          </div>
        )}

        {err && (
          <div className="mt-4 text-sm rounded-md border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <div>{err}</div>
          </div>
        )}

        <div className="mt-6 text-sm flex items-center justify-between">
          <Link to="/auth" className="opacity-80 hover:opacity-100 underline underline-offset-4">
            Back to Sign In
          </Link>
          <Link to="/auth?mode=signup" className="opacity-80 hover:opacity-100 underline underline-offset-4">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

