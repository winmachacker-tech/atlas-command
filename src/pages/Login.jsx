// src/pages/Login.jsx
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const redirectTo = loc.state?.from || "/";

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setLoading(false);
    if (error) setErr(error.message);
    else nav(redirectTo, { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 bg-white dark:bg-neutral-950"
      >
        <h1 className="text-lg font-semibold">Sign in</h1>
        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}

        <label className="block">
          <div className="text-xs text-neutral-500 mb-1">Email</div>
          <input
            type="email"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
            required
          />
        </label>

        <label className="block">
          <div className="text-xs text-neutral-500 mb-1">Password</div>
          <input
            type="password"
            value={pw}
            onChange={(e)=>setPw(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 rounded-xl bg-black text-white disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
