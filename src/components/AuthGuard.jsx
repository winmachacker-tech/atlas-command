import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthGuard() {
  const [status, setStatus] = useState("checking"); // checking | authed | anon

  useEffect(() => {
    let mounted = true;

    async function check() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setStatus(data?.session ? "authed" : "anon");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      setStatus(session ? "authed" : "anon");
    });

    check();
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  if (status === "checking") {
    return <div className="p-6 text-center">Loading…</div>;
  }
  if (status === "anon") {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
