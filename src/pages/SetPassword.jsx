import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

/* ----------------------------- Small Alert Box ---------------------------- */
function Alert({ tone = "info", children }) {
  const styles = {
    info: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-900",
    success:
      "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-900",
    error:
      "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-100 dark:border-rose-900",
    warn: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-900",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

/* -------------------------------- Component ------------------------------- */
export default function SetPassword() {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Make sure we have a valid session (the invite link should set it)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session?.user) {
        navigate("/login?reason=no_session", { replace: true });
      }
    });
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setNotice(null);

    if (pw1.length < 8) {
      setNotice({ tone: "warn", message: "Password must be at least 8 characters long." });
      return;
    }
    if (pw1 !== pw2) {
      setNotice({ tone: "warn", message: "Passwords do not match." });
      return;
    }

    setSubmitting(true);
    try {
      // Step 1: set password in Supabase Auth
      const { error: updateError } = await supabase.auth.updateUser({ password: pw1 });
      if (updateError) {
        setNotice({ tone: "error", message: updateError.message || "Could not set password." });
        return;
      }

      // Step 2: flip must_set_password = false in your users table
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (uid) {
        const { error: dbError } = await supabase
          .from("users")
          .update({ must_set_password: false })
          .eq("id", uid);

        if (dbError) {
          setNotice({
            tone: "error",
            message: dbError.message || "Password saved but profile update failed.",
          });
          return;
        }
      }

      setNotice({
        tone: "success",
        message: "Password set successfully! Redirecting to your dashboard…",
      });

      setTimeout(() => navigate("/", { replace: true }), 900);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-neutral-950 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">Set your password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          You were invited to Atlas Command. Create a password to finish setting up your account.
        </p>

        {notice && (
          <div className="mb-3">
            <Alert tone={notice.tone}>{notice.message}</Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">New password</label>
            <input
              type="password"
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-white/80 dark:bg-neutral-800 px-3 py-2 text-sm"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Confirm password</label>
            <input
              type="password"
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-white/80 dark:bg-neutral-800 px-3 py-2 text-sm"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-black text-white dark:bg-white dark:text-black py-2 text-sm font-medium disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save password"}
          </button>
        </form>
      </div>
    </div>
  );
}
