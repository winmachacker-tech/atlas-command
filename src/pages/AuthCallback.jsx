// src/pages/AuthCallback.jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Preparing your account…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        // Some providers use code exchange; for email magic/invite,
        // Supabase usually sets the session from the URL hash automatically.
        // We just confirm there is a session and then continue.
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          setMessage("We couldn’t complete sign-in. Redirecting to login…");
          setTimeout(() => navigate("/login?reason=session_error", { replace: true }), 800);
          return;
        }

        const user = data?.session?.user;
        if (!user) {
          // No session found — likely expired or invalid link
          setMessage("This link is invalid or has expired. Redirecting to login…");
          setTimeout(() => navigate("/login?reason=no_session", { replace: true }), 800);
          return;
        }

        // Got a session from the invite — go force password setup next.
        setMessage("Signed in via invite. Redirecting to password setup…");
        setTimeout(() => navigate("/set-password", { replace: true }), 300);
      } catch {
        setMessage("Something went wrong. Redirecting to login…");
        setTimeout(() => navigate("/login?reason=unknown", { replace: true }), 800);
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-neutral-950 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-sm text-slate-600 dark:text-slate-300">
        {message}
      </div>
    </div>
  );
}
