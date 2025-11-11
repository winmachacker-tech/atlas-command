// src/hooks/useRequirePasswordSetup.js
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Gate unfinished invitees:
 * - If user has a session but users.must_set_password = true â†’ force /set-password
 * - Returns { loading, profile } for UI states
 */
export default function useRequirePasswordSetup() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const user = sess?.session?.user;

        // If not logged in, nothing to do here; AuthGuard (or your routes) will handle it.
        if (!user) {
          if (alive) setLoading(false);
          return;
        }

        // Pull the app-side profile (public.users)
        const { data, error } = await supabase
          .from("users")
          .select("id, must_set_password, role, is_admin, is_active")
          .eq("id", user.id)
          .single();

        if (error) {
          // If profile missing, treat as loading done (AuthGuard/UI may handle)
          if (alive) setLoading(false);
          return;
        }

        if (!alive) return;

        setProfile(data);

        // Force password setup if required and we're not already on the page
        if (data?.must_set_password && location.pathname !== "/set-password") {
          navigate("/set-password", { replace: true });
          return;
        }

        setLoading(false);
      } catch {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [navigate, location.pathname]);

  return { loading, profile };
}

