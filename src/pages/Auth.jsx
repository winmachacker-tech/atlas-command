// FILE: src/pages/Auth.jsx
// Purpose:
// - Handle email/password Sign In and Sign Up with Supabase Auth.
// - Add a secure "Forgot password?" flow:
//    1) User clicks "Forgot password?"
//    2) Enters email → Supabase sends reset link
//    3) Link redirects back to /auth?type=recovery
//    4) Show "Set new password" form and call supabase.auth.updateUser.
//
// Notes:
// - This does NOT touch your RLS or MFA AuthGuard. Those stay exactly as-is.
// - After password reset, MFA (2FA) will still be enforced by AuthGuard.

import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowLeft,
} from "lucide-react";

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();

  // Which view are we in?
  // "auth"   -> normal Sign In / Sign Up screen
  // "forgot" -> ask for email to send reset link
  // "update" -> user came from email link (?type=recovery), set new password
  const [view, setView] = useState("auth");

  // Sign in / sign up mode
  const [mode, setMode] = useState("signin"); // "signin" | "signup"

  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // 1) On mount:
  //    - Check URL for ?type=recovery (coming from Supabase reset link)
  //    - If session already exists and not in recovery mode, send to app
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const type = searchParams.get("type");

    if (type === "recovery") {
      // User clicked reset password link in email
      setView("update");
      setInitialLoading(false);
      return;
    }

    async function checkSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("[Auth] getSession error:", error);
        }
        const session = data?.session;
        if (session) {
          // Already logged in → go straight to app
          navigate("/", { replace: true });
        } else {
          setView("auth");
        }
      } finally {
        setInitialLoading(false);
      }
    }

    checkSession();
  }, [location.search, navigate]);

  // Helper: clear transient messages/errors
  const resetMessages = () => {
    setError("");
    setMessage("");
  };

  // 2) Handle normal sign in / sign up
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    resetMessages();

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        // On success, navigate to main app. AuthGuard will handle MFA.
        navigate("/", { replace: true });
      } else {
        // Sign up
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        setMessage(
          "Account created. Check your email for a confirmation link."
        );
      }
    } catch (err) {
      console.error("[Auth] sign in/up error:", err);
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // 3) Handle "Forgot password?" → request reset email
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    resetMessages();

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }

    setSubmitting(true);

    try {
      // IMPORTANT:
      // - redirectTo MUST be whitelisted in Supabase Auth → URL Configuration.
      const redirectTo = `${window.location.origin}/auth?type=recovery`;

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo }
      );

      if (error) throw error;

      setMessage(
        "If that email is registered, a reset link has been sent. Check your inbox."
      );
    } catch (err) {
      console.error("[Auth] resetPasswordForEmail error:", err);
      setError(
        err.message ||
          "We couldn't send the reset email. Please try again in a moment."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // 4) Handle "Set new password" when coming from email link (?type=recovery)
  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    resetMessages();

    if (!password) {
      setError("Please enter your new password.");
      return;
    }
    if (password.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const { data, error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      setMessage("Your password has been updated successfully.");
      // After a short delay, send them into the app.
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 1200);
    } catch (err) {
      console.error("[Auth] updateUser (password) error:", err);
      setError(
        err.message ||
          "We couldn't update your password. Please try the link again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // 5) Render helpers

  const renderAuthForm = () => (
    <form onSubmit={handleAuthSubmit} className="space-y-4">
      {/* Email */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Email
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center">
            <Mail className="w-4 h-4 text-gray-500" />
          </span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="you@company.com"
          />
        </div>
      </div>

      {/* Password */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Password
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center">
            <Lock className="w-4 h-4 text-gray-500" />
          </span>
          <input
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-9 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder={mode === "signin" ? "••••••••" : "At least 8 characters"}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-3 flex items-center text-gray-500 hover:text-gray-300"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Confirm password (sign up only) */}
      {mode === "signup" && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Confirm password
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Repeat your password"
          />
        </div>
      )}

      {/* Error / message */}
      {error && (
        <div className="text-xs border border-red-500/70 bg-red-500/10 text-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="text-xs border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 rounded-lg px-3 py-2">
          {message}
        </div>
      )}

      {/* Actions */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-medium text-white"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {mode === "signin" ? "Signing in…" : "Creating account…"}
          </>
        ) : (
          <span>{mode === "signin" ? "Sign in" : "Create account"}</span>
        )}
      </button>

      {/* Footer links */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <button
          type="button"
          onClick={() => {
            resetMessages();
            setView("forgot");
          }}
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
        >
          Forgot password?
        </button>

        <button
          type="button"
          onClick={() => {
            resetMessages();
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setPassword("");
            setConfirmPassword("");
          }}
          className="hover:text-gray-200"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </form>
  );

  const renderForgotForm = () => (
    <form onSubmit={handleForgotSubmit} className="space-y-4">
      <p className="text-xs text-gray-400">
        Enter the email you use for Atlas Command. We&apos;ll send you a link to
        reset your password.
      </p>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Email
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center">
            <Mail className="w-4 h-4 text-gray-500" />
          </span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="you@company.com"
          />
        </div>
      </div>

      {error && (
        <div className="text-xs border border-red-500/70 bg-red-500/10 text-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="text-xs border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 rounded-lg px-3 py-2">
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-medium text-white"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Sending reset link…
          </>
        ) : (
          <span>Send reset link</span>
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          resetMessages();
          setView("auth");
        }}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 mt-2"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to sign in
      </button>
    </form>
  );

  const renderUpdatePasswordForm = () => (
    <form onSubmit={handleUpdatePassword} className="space-y-4">
      <p className="text-xs text-gray-400">
        Set a new password for your Atlas Command account.
      </p>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          New password
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center">
            <Lock className="w-4 h-4 text-gray-500" />
          </span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="At least 8 characters"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Confirm new password
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Repeat your new password"
        />
      </div>

      {error && (
        <div className="text-xs border border-red-500/70 bg-red-500/10 text-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="text-xs border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 rounded-lg px-3 py-2">
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-medium text-white"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Updating password…
          </>
        ) : (
          <span>Update password</span>
        )}
      </button>
    </form>
  );

  // 6) Overall page shell

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-gray-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }

  const title =
    view === "forgot"
      ? "Reset your password"
      : view === "update"
      ? "Set a new password"
      : mode === "signin"
      ? "Sign in to Atlas Command"
      : "Create your Atlas Command account";

  const subtitle =
    view === "forgot"
      ? "We’ll email you a secure password reset link."
      : view === "update"
      ? "You’re almost done. Choose a new password to secure your account."
      : "AI-powered TMS built by carriers, for carriers.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-gray-100 px-4">
      <div className="w-full max-w-md border border-slate-800 bg-slate-900/80 rounded-2xl shadow-xl shadow-black/40 p-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
        </div>

        {view === "auth" && renderAuthForm()}
        {view === "forgot" && renderForgotForm()}
        {view === "update" && renderUpdatePasswordForm()}
      </div>
    </div>
  );
}
