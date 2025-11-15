// src/pages/Auth.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Auth Page (loop-safe)
 * - Reads ?redirect=... once and uses it after sign-in.
 * - If already signed in, sends the user to redirect target (or "/") exactly once.
 * - Provides email/password sign-in (adjust to your flow as needed).
 * - Does not bounce back to /auth; never self-redirects.
 */

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function Auth() {
  const nav = useNavigate();
  const location = useLocation();
  const query = useQuery();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  // Remember the intended redirect once on mount (default "/")
  const targetRef = useRef("/");
  if (!targetRef.current) targetRef.current = "/";
  useEffect(() => {
    const param = query.get("redirect");
    targetRef.current = param && param.startsWith("/") ? param : "/";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: if already signed in, go to target once. Otherwise, show form.
  const redirectedRef = useRef(false);
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      // Ensure session is loaded
      const { data } = await supabase.auth.getSession();
      const hasSession = !!data?.session;

      if (hasSession && !redirectedRef.current) {
        redirectedRef.current = true;
        nav(targetRef.current, { replace: true });
        return;
      }

      // Watch for sign-in events and go to target exactly once
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session && !redirectedRef.current) {
          redirectedRef.current = true;
          nav(targetRef.current, { replace: true });
        }
      });
      unsub = () => sub.subscription.unsubscribe();

      setBusy(false);
    })();

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, location.key]);

  async function handlePasswordSignIn(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange will handle the redirect
    } catch (e) {
      setErr(e?.message || "Sign-in failed");
      setBusy(false);
    }
  }

  // Minimal, neutral UI
  return (
    <div className="min-h-dvh grid place-items-center bg-[var(--bg-base)] text-[var(--text-base)] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-lg">
        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          You’ll be redirected to <code className="text-[var(--text-dim)]">{targetRef.current}</code> after login.
        </p>

        {err && (
          <div className="mb-4 text-sm text-red-400 border border-red-500/30 rounded-md p-2 bg-red-500/10">
            {err}
          </div>
        )}

        <form onSubmit={handlePasswordSignIn} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="username"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 outline-none focus:ring-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 outline-none focus:ring-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg px-3 py-2 bg-[var(--brand)] text-[var(--brand-contrast)] font-medium hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Working…" : "Sign in"}
          </button>
        </form>

        {/* Optional: Magic link (comment out if unused)
        <div className="mt-4 text-xs text-[var(--text-muted)]">
          Need magic link instead? Ask me and I’ll add it.
        </div>
        */}
      </div>
    </div>
  );
}
