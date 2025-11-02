import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Mail, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

/* ------------------------------ Small Helpers ----------------------------- */
function isSignupDisabledError(err) {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  const code = (err.code || "").toLowerCase();
  return (
    code.includes("signup_disabled") ||
    msg.includes("signups not allowed") ||
    msg.includes("signups are disabled") ||
    msg.includes("signup is disabled")
  );
}

function Alert({ tone = "info", children }) {
  const map = {
    info: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-900",
    success:
      "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-900",
    warn: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-900",
    error:
      "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-100 dark:border-rose-900",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${map[tone]}`}>
      {children}
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */
export default function Login() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // redirect if already signed in
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) navigate("/", { replace: true });
    });
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setNotice(null);

    if (!email || !email.includes("@")) {
      setNotice({ tone: "warn", message: "Enter a valid email address." });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) {
        if (isSignupDisabledError(error)) {
          setNotice({
            tone: "error",
            message:
              "Signups are invite-only. Ask an admin to send you an invite link.",
          });
          return;
        }
        setNotice({
          tone: "error",
          message:
            error.message || "Could not start the login. Please try again.",
        });
        return;
      }

      setNotice({
        tone: "success",
        message:
          "Check your inbox for the magic link. Open it on this device to log in.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 dark:bg-neutral-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Enter your email to receive a magic link.
          </p>
        </div>

        {notice && (
          <div className="mb-4">
            <Alert tone={notice.tone}>{notice.message}</Alert>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm"
        >
          <label className="block text-sm font-medium mb-2">Email</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="email"
                placeholder="name@company.com"
                className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-white/80 dark:bg-neutral-800 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-slate-200 dark:focus:ring-neutral-800"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send link"
              )}
            </button>
          </div>

          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
          Trouble logging in? Contact an administrator for an invite.
        </p>
      </div>
    </div>
  );
}
