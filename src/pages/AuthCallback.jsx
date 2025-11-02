import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        nav("/", { replace: true });
      } else {
        nav("/login", { replace: true });
      }
    })();
  }, [nav]);

  return null;
}
