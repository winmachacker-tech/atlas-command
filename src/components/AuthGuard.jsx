import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import LoadingScreen from "./LoadingScreen";

export default function AuthGuard({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const loc = useLocation();

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setSession(data.session ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  if (loading) return <LoadingScreen label="Authenticating…" />;

  const path = loc.pathname.toLowerCase();
  const isAuthRoute =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/set-password");

  if (!session && !isAuthRoute) {
    return <Navigate to="/login" replace />;
  }

  if (session && (path.startsWith("/set-password") || path.startsWith("/auth"))) {
    return <Navigate to="/" replace />;
  }

  return children;
}
