// src/components/AuthGuard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * AuthGuard
 * - Defers any redirect until the initial auth check completes.
 * - Preserves the user's intended route via ?redirect=...
 * - Avoids loops by never redirecting while "checking".
 *
 * Usage:
 *   <AuthGuard><MainLayout /></AuthGuard>
 *
 * Optional props:
 *   - requireAuth (default: true)
 *   - loginPath   (default: "/login")
 *   - graceMs     (default: 600)  // time to allow session to load
 */
export default function AuthGuard({
  children,
  requireAuth = true,
  loginPath = "/login",
  graceMs = 600,
}) {
  const nav = useNavigate();
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  // prevent multiple redirects
  const redirectedRef = useRef(false);
  // start time for a tiny grace window (avoids flicker/loops)
  const mountAtRef = useRef(Date.now());

  const intendedPath = useMemo(() => {
    // Use full path+query so we can return precisely
    const qp = location.search || "";
    return `${location.pathname}${qp}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    let unsub = () => {};

    (async () => {
      // 1) Initial session check
      const { data, error } = await supabase.auth.getSession();
      if (!error && data?.session) {
        setHasSession(true);
      } else {
        setHasSession(false);
      }

      // 2) Subscribe to auth changes
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setHasSession(!!session);
      });
      unsub = () => sub.subscription.unsubscribe();

      // 3) After grace window, we consider checking done
      const elapsed = Date.now() - mountAtRef.current;
      const delay = Math.max(0, graceMs - elapsed);
      const t = setTimeout(() => setChecking(false), delay);
      return () => clearTimeout(t);
    })();

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!requireAuth) return;

    // Don't redirect while we're still checking
    if (checking) return;

    // Only redirect once
    if (redirectedRef.current) return;

    if (!hasSession) {
      redirectedRef.current = true;

      // Preserve intended destination
      const params = new URLSearchParams();
      params.set("redirect", intendedPath);

      nav(`${loginPath}?${params.toString()}`, { replace: true });
    }
  }, [checking, hasSession, requireAuth, nav, intendedPath, loginPath]);

  // While checking, render a neutral shell (no redirects)
  if (requireAuth && checking) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[var(--bg-base)] text-[var(--text-muted)]">
        <div className="flex items-center gap-3 opacity-80">
          <svg
            className="h-5 w-5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" />
          </svg>
          <span>Checking access…</span>
        </div>
      </div>
    );
  }

  // If auth is required and no session after checking, we already navigated.
  if (requireAuth && !hasSession) return null;

  // Auth ok → render app
  return <>{children}</>;
}
