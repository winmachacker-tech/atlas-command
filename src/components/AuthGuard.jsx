// src/components/AuthGuard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * AuthGuard
 * - Prevents redirect loops by separating "checking" vs "unauthenticated".
 * - Defers redirect until initial session stabilizes (grace window).
 * - Restores the intended route via ?redirect=...
 * - 🔹PLUS: tiny bridge → if Supabase sends hash/search tokens to "/", forward to /auth/callback.
 */
export default function AuthGuard({
  children,
  requireAuth = true,
  loginPath = "/login",
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Where we are & whether we should ever redirect
  const pathname = location.pathname + location.search + location.hash;
  const isLogin = location.pathname === loginPath;
  const isCallback =
    location.pathname.startsWith("/auth/callback") ||
    location.pathname.startsWith("/set-password"); // allow your auth callback pages

  // Session state machine
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  // Guards against duplicate navigations
  const lastNavRef = useRef("");
  const didInitialEventRef = useRef(false);

  // Small grace window so "INITIAL_SESSION" → "SIGNED_IN" doesn't cause a flash redirect
  const GRACE_MS = 900;
  const graceTimerRef = useRef(null);

  /* ---------- NEW: very small, safe bridge to /auth/callback ---------- */
  useEffect(() => {
    if (isCallback) return;
    const hash = window.location.hash || "";
    const hasHashTokens =
      hash.includes("access_token=") || hash.includes("refresh_token=");
    const qs = new URLSearchParams(location.search || "");
    const hasSearchTokens = qs.has("code") || qs.has("token_hash") || qs.has("type");

    if (hasHashTokens) {
      // Preserve the exact hash so AuthCallback can read tokens
      navigate(`/auth/callback${hash}`, { replace: true });
    } else if (hasSearchTokens) {
      // Preserve the search params exactly
      navigate(`/auth/callback${location.search}`, { replace: true });
    }
  }, [isCallback, location.search, navigate]);
  /* ------------------------------------------------------------------- */

  // Initial session fetch
  useEffect(() => {
    let active = true;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;

      if (error) {
        console.warn("[AuthGuard] getSession error:", error);
      }

      setSession(data?.session ?? null);
      setChecking(true); // still "checking" until we either get an auth event or grace passes

      // Start grace window
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = setTimeout(() => {
        setChecking(false);
      }, GRACE_MS);
    })();

    // Subscribe to auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Mark that we've seen an auth event
      didInitialEventRef.current = true;

      setSession(s ?? null);

      // When we get any event, we can stop "checking"
      clearTimeout(graceTimerRef.current);
      setChecking(false);

      // Handle sign-out immediately (avoid stale screens)
      if (event === "SIGNED_OUT") {
        safeNavigate(loginPathWithRedirect(loginPath, pathname));
      }

      // Handle sign-in from login page: send them to redirect or dashboard/root
      if (event === "SIGNED_IN" && isLogin) {
        const search = new URLSearchParams(location.search);
        const dest = search.get("redirect") || "/";
        safeNavigate(dest);
      }
    });

    return () => {
      active = false;
      clearTimeout(graceTimerRef.current);
      sub?.subscription?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  // Helper: build login path with redirect param
  const loginPathWithRedirect = (base, target) => {
    try {
      const u = new URL(window.location.origin + base);
      // If already includes redirect, keep it; else set it
      if (!u.searchParams.get("redirect")) {
        u.searchParams.set("redirect", target || "/");
      }
      return u.pathname + "?" + u.searchParams.toString();
    } catch {
      // fallback
      const enc = encodeURIComponent(target || "/");
      return `${base}?redirect=${enc}`;
    }
  };

  // Helper: navigate only if target differs from current
  const safeNavigate = (to) => {
    if (!to) return;
    const current = location.pathname + location.search + location.hash;
    if (to === current || lastNavRef.current === to) return;
    lastNavRef.current = to;
    navigate(to, { replace: true });
  };

  // Decide what to render / where to redirect
  const shouldGuard = requireAuth && !isLogin && !isCallback;

  // If guarding, while checking auth, render nothing (or a tiny placeholder)
  if (shouldGuard && checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Checking authentication…
      </div>
    );
  }

  // If guarding and unauthenticated after checking → send to login with redirect
  if (shouldGuard && !session) {
    safeNavigate(loginPathWithRedirect(loginPath, pathname));
    return null;
  }

  // If on /login but already authenticated → bounce to redirect or home
  if (isLogin && session) {
    const search = new URLSearchParams(location.search);
    const dest = search.get("redirect") || "/";
    safeNavigate(dest);
    return null;
  }

  // Otherwise render children
  return <>{children}</>;
}
