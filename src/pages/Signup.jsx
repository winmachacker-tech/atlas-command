// FILE: src/pages/Signup.jsx
// Purpose: Invite-only signup using the new invite-validate Edge Function
// Flow:
// 1) User enters an invite code
// 2) We call the Edge Function via supabase.functions.invoke
// 3) If valid → returns org_id
// 4) Create Supabase Auth user with metadata
//
// SECURITY:
// - No service-role key on frontend
// - Supabase client sends anon JWT automatically
// - Edge Function runs fully server-side

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Lock,
  Mail,
  User,
  Building2,
  KeyRound,
} from "lucide-react";

export default function SignupPage() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");

  async function onSignup(e) {
    e.preventDefault();
    console.log("🚀 Signup form submitted");

    setFormError("");
    setFormMessage("");

    // Basic validation
    if (!fullName.trim()) {
      setFormError("Please enter your full name.");
      return;
    }
    if (!inviteCode.trim()) {
      setFormError("Invite code is required to sign up.");
      return;
    }
    if (!email.trim()) {
      setFormError("Please enter your email.");
      return;
    }
    if (!password) {
      setFormError("Please enter a password.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== passwordConfirm) {
      setFormError("Passwords do not match.");
      return;
    }

    try {
      setIsSubmitting(true);

      console.log("🎟️ Validating invite via Edge Function (invoke):", inviteCode);

      //
      // STEP 1 — Validate invite code via supabase.functions.invoke
      //
      const {
        data: invite,
        error: inviteError,
      } = await supabase.functions.invoke("invite-validate", {
        body: {
          code: inviteCode.trim(),
        },
      });

      console.log("ℹ️ invite-validate response:", { invite, inviteError });

      if (inviteError) {
        console.error("💥 invite-validate error:", inviteError);
        setFormError(
          inviteError.message || "Error validating invite code. Please try again."
        );
        return;
      }

      if (!invite || !invite.success) {
        setFormError(invite?.error || "Invalid invite code.");
        return;
      }

      const orgId = invite.org_id;
      console.log("✅ Invite valid. org_id:", orgId);

      //
      // STEP 2 — Create Supabase Auth user
      //
      console.log("📧 Calling supabase.auth.signUp with:", email);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            company_name: companyName || null,
            invite_code_used: inviteCode.trim().toUpperCase(),
            invited_org_id: orgId,
          },
        },
      });

      if (error) {
        console.error("💥 Supabase signup error:", error);
        setFormError(error.message || "Signup failed. Please try again.");
        return;
      }

      console.log("✅ Supabase signup success:", data);

      setFormMessage(
        "Signup successful! Please check your email to confirm your account. Redirecting..."
      );

      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      console.error("💥 Signup exception:", err);
      setFormError(err.message || "Unexpected error during signup.");
    } finally {
      setIsSubmitting(false);
      console.log("🏁 Signup process complete");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Join Atlas Command (Invite Only)
          </h1>
          <p className="text-sm text-slate-400">
            Enter your invite code to create your account.
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl shadow-lg p-6 space-y-4">
          {formError && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}
          {formMessage && (
            <div className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 rounded-lg px-3 py-2">
              {formMessage}
            </div>
          )}

          <form onSubmit={onSignup} className="space-y-4">
            {/* Invite code */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-200">
                Invite code
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500">
                  <KeyRound className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 uppercase tracking-wide"
                  placeholder="ATLAS-BETA-2025"
                  autoComplete="off"
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Don&apos;t have one? Contact Mark to request access.
              </p>
            </div>

            {/* Full name */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-200">
                Full name
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500">
                  <User className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Jane Doe"
                  autoComplete="name"
                  required
                />
              </div>
            </div>

            {/* Company */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-200">
                Company / Fleet name{" "}
                <span className="text-slate-500">(optional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500">
                  <Building2 className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Ridge41 Holdings"
                  autoComplete="organization"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-200">
                Work email
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500">
                  <Mail className="w-4 h-4" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-200">
                Password
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-200">
                Confirm password
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Re-type your password"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 text-sm font-medium px-3 py-2.5 mt-2 transition"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating your account...
                </>
              ) : (
                <>Create account</>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
