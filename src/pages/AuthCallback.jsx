// src/pages/AuthCallback.jsx
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // 1) Try hash-style links (#access_token, #refresh_token)
        await supabase.auth.getSessionFromUrl({ storeSession: true });
      } catch {
        // 2) Fallback for PKCE-style links (?code=...)
        const code = new URLSearchParams(loc.search).get("code");
        if (code) {
          await supabase.auth.exchangeCodeForSession({ authCode: code });
        }
      }

      // Decide where to land
      const { data } = await supabase.from("profiles").select("id,full_name").single();
      if (!data) return nav("/onboarding?first=1", { replace: true });
      return nav("/", { replace: true }); // or wherever you want
    })();
  }, [loc.search, nav]);

  return (
    <div className="grid place-items-center min-h-screen">
      <p className="text-sm opacity-70">Finalizing sign-in…</p>
    </div>
  );
}
