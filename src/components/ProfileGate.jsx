import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const REQUIRED_FIELDS = ["full_name", "phone", "employee_id"];

export default function ProfileGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // AuthGuard should already redirect, but be defensive:
        nav("/login", { replace: true, state: { from: location } });
        return;
      }
      const { data: me, error } = await supabase
        .from("users")
        .select("full_name, phone, employee_id")
        .eq("id", session.user.id)
        .single();

      if (error) {
        console.error("profile check error:", error);
        if (alive) { setOk(true); setChecking(false); } // donâ€™t block app if read fails
        return;
      }

      const incomplete = REQUIRED_FIELDS.some((k) => !String(me?.[k] ?? "").trim());
      if (incomplete) {
        if (alive) {
          setOk(false);
          setChecking(false);
          nav("/onboarding", { replace: true, state: { from: location } });
        }
        return;
      }

      if (alive) { setOk(true); setChecking(false); }
    })();

    return () => { alive = false; };
  }, [nav, location]);

  if (checking) return <div className="p-6">Loadingâ€¦</div>;
  if (!ok) return null;
  return children;
}

