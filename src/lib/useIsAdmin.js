// src/lib/useIsAdmin.js
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useIsAdmin() {
  const [status, setStatus] = useState("checking"); // checking | yes | no

  useEffect(() => {
    let mounted = true;

    async function run() {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) {
        if (mounted) setStatus("no");
        return;
      }

      // Confirm your profile row exists (helps catch backfill issues)
      const { data: me } = await supabase
        .from("users")
        .select("id,is_admin")
        .eq("id", sess.session.user.id)
        .maybeSingle();

      if (!me) {
        // no profile row -> not admin
        if (mounted) setStatus("no");
        return;
      }

      const { data: isAdmin, error } = await supabase.rpc("app_is_admin");
      if (mounted) setStatus(error ? "no" : (isAdmin ? "yes" : "no"));
    }

    run();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setStatus(s ? "checking" : "no");
      if (s) run();
    });

    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  return status;
}

