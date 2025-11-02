import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Navigate, useLocation } from "react-router-dom";

export default function AuthGuard({ children, requireAdmin = false }) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (mounted) { setOk(false); setLoading(false); }
        return;
      }
      // fetch profile for role gate
      const { data: me } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (mounted) {
        const isAdmin = me?.role === "admin";
        setOk(requireAdmin ? isAdmin : true);
        setLoading(false);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess) { setOk(false); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [requireAdmin]);

  if (loading) return <div className="p-6">Loading…</div>;
  if (!ok) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}
