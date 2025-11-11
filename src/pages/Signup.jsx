// src/pages/Signup.jsx
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Signup() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  const strength =
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0) +
    (password.length >= 12 ? 1 : 0);

  async function onSignup(e) {
    e.preventDefault();
    console.log("ðŸš€ Signup form submitted"); // DEBUG
    
    if (busy) {
      console.log("â³ Already busy, ignoring");
      return;
    }
    
    setErr("");
    setOkMsg("");

    // Validation
    if (!email.trim()) {
      console.log("âŒ Email missing");
      return setErr("Email is required.");
    }
    if (!password) {
      console.log("âŒ Password missing");
      return setErr("Password is required.");
    }
    if (password.length < 8) {
      console.log("âŒ Password too short");
      return setErr("Use at least 8 characters.");
    }
    if (password !== confirm) {
      console.log("âŒ Passwords don't match");
      return setErr("Passwords do not match.");
    }
    if (!agree) {
      console.log("âŒ Terms not accepted");
      return setErr("Please accept the Terms to continue.");
    }

    try {
      setBusy(true);
      console.log("ðŸ“§ Calling supabase.auth.signUp with:", email);
      
      await supabase.auth.signUp({
  email,
  password,
  options: {
    data: { full_name },
    emailRedirectTo: `${window.location.origin}/auth/callback`,
  },
});


      console.log("ðŸ“Š Signup response:", { data, error });

      if (error) {
        console.error("âŒ Signup error:", error);
        throw error;
      }

      if (data?.user) {
        console.log("âœ… User created:", data.user.id);
        
        if (!data.user.confirmed_at) {
          console.log("ðŸ“¨ Email confirmation required");
          setOkMsg(
            "Account created! Check your email and click the verification link to finish signing up."
          );
        } else {
          console.log("âœ… Account confirmed immediately");
          setOkMsg("Account created successfully!");
        }
      }
    } catch (e2) {
      console.error("ðŸ’¥ Signup exception:", e2);
      setErr(e2?.message || "Sign up failed");
    } finally {
      setBusy(false);
      console.log("ðŸ Signup process complete");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md p-6 shadow-xl text-[var(--text-base,#E5E7EB)]">
        {/* Back button */}
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white mb-4 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>

        <div className="mb-6 text-center">
          <h1 className="text-3xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-white/60">Join Atlas Command</p>
        </div>

        {err && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {err}
          </div>
        )}
        {okMsg && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {okMsg}
          </div>
        )}

        <form onSubmit={onSignup} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm">Full name (optional)</label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 outline-none focus:border-blue-500/60"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm">Email</label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 outline-none focus:border-blue-500/60"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm">Password</label>
            <div className="relative">
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 pr-20 outline-none focus:border-blue-500/60"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-white/70 hover:text-white"
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>

            {/* strength meter */}
            <div className="mt-1 grid grid-cols-5 gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`h-1 rounded ${i < strength ? "bg-blue-500" : "bg-white/10"}`}
                />
              ))}
            </div>
            <p className="text-xs text-white/50">
              Tip: 12+ chars with upper/lower, number, and symbol is strongest.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm">Confirm password</label>
            <div className="relative">
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 pr-20 outline-none focus:border-blue-500/60"
                type={showPw2 ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw2((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-white/70 hover:text-white"
              >
                {showPw2 ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5"
            />
            <span>
              I agree to the{" "}
              <a href="/terms" className="text-blue-400 underline underline-offset-2">
                Terms
              </a>{" "}
              and{" "}
              <a href="/privacy" className="text-blue-400 underline underline-offset-2">
                Privacy Policy
              </a>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {busy && (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
            )}
            {busy ? "Creatingâ€¦" : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-white/80">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-400 underline underline-offset-2">
            Sign in
          </Link>
        </div>

        <div className="mt-6 text-center text-xs text-white/40">
          Â© {new Date().getFullYear()} Atlas Command Systems
        </div>
      </div>
    </div>
  );
}
