// src/pages/Auth.jsx
import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const redirectTo = params.get("redirect") || "/";

  const [mode, setMode] = useState("signup"); // 'signup' | 'signin'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // If already signed in, go to intended destination
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        navigate(redirectTo, { replace: true });
      }
    })();
  }, [navigate, redirectTo]);

  async function handleSignUp(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName || "" },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;

      // Remember intended redirect for the callback/onboarding flow
      try {
        localStorage.setItem("atlas.redirectAfterAuth", redirectTo);
      } catch {}

      setMsg(
        data.user?.identities?.length
          ? "Check your email to confirm your account."
          : "If the email exists, a confirmation link has been sent."
      );
      setEmail("");
      setPassword("");
      setFullName("");
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Session is set; send to intended path (or "/")
      navigate(redirectTo, { replace: true });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[--bg] text-[--fg]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Atlas Command</h1>
          <div className="flex gap-2 text-sm">
            <button
              className={cx(
                "px-3 py-1 rounded-md border",
                mode === "signup"
                  ? "border-white/20 bg-white/10"
                  : "border-white/10 hover:border-white/20"
              )}
              onClick={() => setMode("signup")}
            >
              Sign Up
            </button>
            <button
              className={cx(
                "px-3 py-1 rounded-md border",
                mode === "signin"
                  ? "border-white/20 bg-white/10"
                  : "border-white/10 hover:border-white/20"
              )}
              onClick={() => setMode("signin")}
            >
              Sign In
            </button>
          </div>
        </div>

        {mode === "signup" ? (
          <form onSubmit={handleSignUp} className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-sm opacity-80">Full name</span>
              <input
                className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm opacity-80">Email</span>
              <input
                required
                type="email"
                className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm opacity-80">Password</span>
              <input
                required
                type="password"
                className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-md border border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30 px-4 py-2"
            >
              {busy ? "Workingâ€¦" : "Create account"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-sm opacity-80">Email</span>
              <input
                required
                type="email"
                className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm opacity-80">Password</span>
              <input
                required
                type="password"
                className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-md border border-sky-500/40 bg-sky-500/20 hover:bg-sky-500/30 px-4 py-2"
            >
              {busy ? "Workingâ€¦" : "Sign in"}
            </button>

            {/* NEW: Forgot password link (preserves redirect) */}
            <div className="mt-3 text-xs opacity-80 text-right">
              <Link
                to={`/forgot-password?redirect=${encodeURIComponent(redirectTo)}`}
                className="underline underline-offset-4"
              >
                Forgot password?
              </Link>
            </div>
          </form>
        )}

        {msg && <p className="mt-4 text-sm text-emerald-400">{msg}</p>}
        {err && <p className="mt-2 text-sm text-rose-400">{err}</p>}

        <p className="mt-6 text-xs opacity-60">
          Signup links will redirect to <code>/auth/callback</code>. Make sure
          you have a route for that page and that it sends users to{" "}
          <code>/complete-account</code> until onboarding is finished.
        </p>
      </div>
    </div>
  );
}

