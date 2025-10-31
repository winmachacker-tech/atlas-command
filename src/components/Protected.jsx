// src/components/Protected.jsx
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Protected({ children }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let active = true;

    // Safety net: if Supabase stalls, stop loading so <Navigate> can run
    const safety = setTimeout(() => {
      if (!active) return;
      setLoading(false);
    }, 6000);

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setAuthed(!!data?.session);
        setLoading(false);
      } catch {
        if (!active) return;
        setAuthed(false);
        setLoading(false);
      }
    })();

    // keep in sync with auth state changes
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!active) return;
      setAuthed(!!session);
      setLoading(false);
    });

    return () => {
      active = false;
      clearTimeout(safety);
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-neutral-500">
        <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none" />
        </svg>
        Checking session…
      </div>
    );
  }

  // ✅ Declarative redirect (no blank screen)
  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
