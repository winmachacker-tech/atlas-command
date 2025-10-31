// src/components/Protected.jsx
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Protected({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const loc = useLocation();

  useEffect(() => {
    let unsub;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setLoading(false);

      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        setSession(s ?? null);
      });
      unsub = () => sub.subscription.unsubscribe();
    })();
    return () => unsub?.();
  }, []);

  if (loading) return <div className="p-6">Checking session…</div>;
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}
