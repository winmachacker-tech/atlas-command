// FILE: src/components/MfaAuthGate.jsx
// Purpose: Force 2FA after login for any user who has a verified TOTP factor.
// Simple version: on mount, if there is a Supabase session AND the user has
// a verified TOTP factor, we show the 6-digit code screen and block the app
// until they pass MFA.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, Shield, KeyRound, LogOut } from "lucide-react";

export default function MfaAuthGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [factorId, setFactorId] = useState(null);

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: On mount, decide if we should require MFA
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setChecking(true);
        setError(null);

        console.log("[MfaAuthGate] running check…");

        // Ensure there is an authenticated session
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const session = sessionData?.session;
        console.log("[MfaAuthGate] session:", !!session);

        if (!session) {
          // Not logged in (AuthGuard should handle this)
          if (!cancelled) {
            setRequiresMfa(false);
          }
          return;
        }

        // Check if the user has any verified TOTP factors
        const { data: factorsData, error: factorsError } =
          await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;

        const totpFactors = factorsData?.totp || [];
        console.log("[MfaAuthGate] totp factors:", totpFactors);

        const verifiedTotp = totpFactors.find(
          (f) => f.status === "verified"
        );

        if (verifiedTotp) {
          // User has 2FA set up => force MFA
          console.log(
            "[MfaAuthGate] verified TOTP found, requiring MFA. factorId=",
            verifiedTotp.id
          );
          if (!cancelled) {
            setFactorId(verifiedTotp.id);
            setRequiresMfa(true);
          }
        } else {
          console.log("[MfaAuthGate] no verified TOTP, allowing through.");
          // No 2FA set up => let them in
          if (!cancelled) {
            setRequiresMfa(false);
          }
        }
      } catch (e) {
        console.error("[MfaAuthGate] check failed:", e);
        // If something goes wrong, fail open (show app) but surface error
        if (!cancelled) {
          setError(e.message || "Failed to check 2FA status.");
          setRequiresMfa(false);
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2: Handle 6-digit code submit
  const handleVerify = async (e) => {
    e?.preventDefault();
    if (!factorId) {
      setError("No 2FA factor found for this account.");
      return;
    }
    if (!code.trim() || code.trim().length < 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      console.log("[MfaAuthGate] verifying MFA code…");
      // Single-call challenge + verify
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (error) throw error;

      console.log("[MfaAuthGate] MFA verified, unlocking app.");
      setRequiresMfa(false);
      setCode("");
    } catch (e) {
      console.error("[MfaAuthGate] MFA verify failed:", e);
      setError(
        e.message ||
          "Incorrect code. Make sure the code is current and try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      window.location.href = "/auth";
    } catch (e) {
      console.error("Sign out failed", e);
    }
  };

  // While we are checking whether MFA is needed, show a loader
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-gray-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
          <p className="text-sm text-gray-400">Checking 2FA status…</p>
        </div>
      </div>
    );
  }

  // If MFA is required, show the challenge screen and block the app
  if (requiresMfa) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-gray-200 px-4">
        <div className="w-full max-w-md border border-slate-700 rounded-2xl bg-slate-900/80 p-6 shadow-xl shadow-black/40">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-pink-400" />
            <h1 className="text-xl font-semibold">Two-Factor Verification</h1>
          </div>

          <p className="text-sm text-gray-400 mb-4">
            Enter the 6-digit code from your authenticator app to finish
            signing in to <span className="font-semibold">Atlas Command</span>.
          </p>

          {error && (
            <div className="mb-3 text-sm border border-red-500/70 bg-red-500/10 text-red-200 rounded-lg px-3 py-2 flex gap-2">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                6-digit code
              </label>
            <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, ""))
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-gray-100 text-center tracking-[0.3em] text-lg font-mono"
                placeholder="••••••"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-medium"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  Verify & Continue
                </>
              )}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Don&apos;t have access to your 2FA device?</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 hover:bg-slate-800/70"
            >
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Otherwise, render the actual app
  return children;
}

function AlertIcon() {
  return (
    <svg
      className="w-4 h-4 mt-[2px] flex-shrink-0 text-red-300"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M12 9v4m0 3h.01M10.29 3.86 2.82 17.01C2.18 18.12 2.99 19.5 4.29 19.5h15.42c1.3 0 2.11-1.38 1.47-2.49L13.71 3.86a1.7 1.7 0 0 0-2.98 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
