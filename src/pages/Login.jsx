import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { trackLogin, trackFailedLogin } from "../lib/activityTracker";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login"); // "login" | "forgot" | "reset"
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const nav = useNavigate();
  const location = useLocation();

  // Read query params
  const params = new URLSearchParams(location.search);
  const redirectTo =
    params.get("redirect") || location.state?.from?.pathname || "/";

  // If Supabase sends us back with ?type=recovery, show the reset password form
  useEffect(() => {
    const type = params.get("type");
    if (type === "recovery") {
      setMode("reset");
    }
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearMessages() {
    setError("");
    setMessage("");
  }

  async function onLogin(e) {
    e.preventDefault();
    clearMessages();

    try {
      setBusy(true);
      const { error: supaError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (supaError) throw supaError;

      // Track successful login
      trackLogin().catch((err) =>
        console.error("Failed to track login:", err)
      );

      nav(redirectTo, { replace: true });
    } catch (err) {
      // Track failed login
      trackFailedLogin(err.message).catch((e) =>
        console.error("Failed to track failed login:", e)
      );

      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword(e) {
    e.preventDefault();
    clearMessages();

    if (!email.trim()) {
      setError("Please enter the email you use for Atlas Command.");
      return;
    }

    try {
      setBusy(true);

      // Include redirect so the email link comes back here in "reset" mode
      const base = window.location.origin;
      const resetRedirect = `${base}/login?type=recovery&redirect=${encodeURIComponent(
        redirectTo
      )}`;

      const { error: supaError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: resetRedirect }
      );

      if (supaError) throw supaError;

      setMessage(
        "If that email is registered, a reset link has been sent. Check your inbox."
      );
    } catch (err) {
      setError(
        err.message ||
          "We couldn't send the reset email. Please try again shortly."
      );
    } finally {
      setBusy(false);
    }
  }

  async function onResetPassword(e) {
    e.preventDefault();
    clearMessages();

    if (!password) {
      setError("Please enter a new password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setBusy(true);

      const { error: supaError } = await supabase.auth.updateUser({
        password,
      });

      if (supaError) throw supaError;

      setMessage("Your password has been updated.");

      // Short delay so the user can see the success message
      setTimeout(() => {
        nav(redirectTo, { replace: true });
      }, 1200);
    } catch (err) {
      setError(
        err.message ||
          "We couldn't update your password. Please try the link again."
      );
    } finally {
      setBusy(false);
    }
  }

  // ---------------- UI SECTION ----------------

  function renderErrorMessage() {
    if (!error) return null;
    return (
      <div className="mt-3 text-xs rounded-lg border border-red-500/70 bg-red-900/40 px-3 py-2 text-red-100">
        {error}
      </div>
    );
  }

  function renderInfoMessage() {
    if (!message) return null;
    return (
      <div className="mt-3 text-xs rounded-lg border border-emerald-500/60 bg-emerald-900/30 px-3 py-2 text-emerald-100">
        {message}
      </div>
    );
  }

  function renderLoginForm() {
    return (
      <form onSubmit={onLogin} className="space-y-4">
        <div>
          <label className="text-sm block mb-1 text-gray-200">Email</label>
          <input
            className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label className="text-sm block mb-1 text-gray-200">Password</label>
          <input
            className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {renderErrorMessage()}
        {renderInfoMessage()}

        <button
          disabled={busy}
          className="w-full mt-4 rounded-xl bg-blue-600 hover:bg-blue-700 py-2 font-medium text-white shadow transition-colors disabled:opacity-70"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="mt-3 text-xs text-center text-gray-300">
          <button
            type="button"
            onClick={() => {
              clearMessages();
              setMode("forgot");
            }}
            className="underline text-blue-300 hover:text-blue-200"
          >
            Forgot your password?
          </button>
        </div>
      </form>
    );
  }

  function renderForgotForm() {
    return (
      <form onSubmit={onForgotPassword} className="space-y-4">
        <p className="text-xs text-gray-200 mb-1">
          Enter the email you use for Atlas Command. If it’s in our system,
          we’ll email you a secure link to reset your password.
        </p>

        <div>
          <label className="text-sm block mb-1 text-gray-200">Email</label>
          <input
            className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        {renderErrorMessage()}
        {renderInfoMessage()}

        <button
          disabled={busy}
          className="w-full mt-4 rounded-xl bg-blue-600 hover:bg-blue-700 py-2 font-medium text-white shadow transition-colors disabled:opacity-70"
        >
          {busy ? "Sending reset link…" : "Send reset link"}
        </button>

        <div className="mt-3 text-xs text-center text-gray-300">
          <button
            type="button"
            onClick={() => {
              clearMessages();
              setMode("login");
            }}
            className="underline text-blue-300 hover:text-blue-200"
          >
            Back to sign in
          </button>
        </div>
      </form>
    );
  }

  function renderResetForm() {
    return (
      <form onSubmit={onResetPassword} className="space-y-4">
        <p className="text-xs text-gray-200 mb-1">
          Choose a new password for your Atlas Command account.
        </p>

        <div>
          <label className="text-sm block mb-1 text-gray-200">
            New password
          </label>
          <input
            className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
          />
        </div>

        <div>
          <label className="text-sm block mb-1 text-gray-200">
            Confirm new password
          </label>
          <input
            className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        {renderErrorMessage()}
        {renderInfoMessage()}

        <button
          disabled={busy}
          className="w-full mt-4 rounded-xl bg-blue-600 hover:bg-blue-700 py-2 font-medium text-white shadow transition-colors disabled:opacity-70"
        >
          {busy ? "Updating password…" : "Update password"}
        </button>
      </form>
    );
  }

  const title =
    mode === "login"
      ? "Welcome back"
      : mode === "forgot"
      ? "Reset your password"
      : "Set a new password";

  const subtitle =
    mode === "login"
      ? "Sign in to Atlas Command"
      : mode === "forgot"
      ? "We’ll email you a secure reset link."
      : "You’re almost done. Choose a new password.";

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage:
            "url('/575e3959-3cc9-4263-9cde-6cfa0477cb81.png')",
          backgroundSize: "cover",
          filter: "brightness(0.6)",
        }}
      ></div>

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/70"></div>

      {/* Card */}
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl p-8 shadow-2xl">
          <h1 className="text-2xl font-semibold text-white mb-1 text-center">
            {title}
          </h1>
          <p className="text-sm text-gray-300 mb-6 text-center">{subtitle}</p>

          {mode === "login" && renderLoginForm()}
          {mode === "forgot" && renderForgotForm()}
          {mode === "reset" && renderResetForm()}

          {mode !== "reset" && (
            <div className="text-sm mt-6 text-center text-gray-300">
              No account?{" "}
              <Link to="/signup" className="underline text-blue-400">
                Create one
              </Link>
            </div>
          )}

          <p className="text-xs text-center text-gray-400 mt-8">
            © {new Date().getFullYear()} Atlas Command Systems
          </p>
        </div>
      </div>
    </div>
  );
}
