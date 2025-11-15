// FILE: src/components/AuthGuard.jsx
// Purpose: Protect routes AND enforce 2FA (TOTP) per browser session, per user,
// with support for one-time backup codes.
// Behavior:
//  - If no Supabase session: redirect to login.
//  - For each user in this browser session:
//      -> If user has verified TOTP factor and has NOT yet passed 2FA here,
//         require a 6-digit MFA code OR a valid backup code.
//      -> After successful MFA (either method), mark this user as verified in
//         sessionStorage.
//  - Page refreshes do NOT re-prompt 2FA.
//  - Sign-out clears all MFA flags for this tab, so next login requires 2FA again.

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, Shield, KeyRound, LogOut } from "lucide-react";

export default function AuthGuard({ children, loginPath = "/auth" }) {
  // --- Session state ---
  const [loadingSession, setLoadingSession] = useState(true);
  const [session, setSession] = useState(null);

  // --- MFA state ---
  const [checkingMfa, setCheckingMfa] = useState(false);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // --- Backup code state ---
  const [isUsingBackupCode, setIsUsingBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [backupSubmitting, setBackupSubmitting] = useState(false);

  // 1) Track auth session (login / logout / token refresh)
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) {
          console.error("[AuthGuard] getSession error:", error);
        }
        setSession(data?.session ?? null);
      } finally {
        if (mounted) setLoadingSession(false);
      }
    }

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setLoadingSession(false);

        // Reset MFA + backup state whenever session changes
        setCheckingMfa(false);
        setRequiresMfa(false);
        setFactorId(null);
        setCode("");
        setBackupCode("");
        setIsUsingBackupCode(false);
        setError(null);
        setSubmitting(false);
        setBackupSubmitting(false);
      }
    );

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  // 2) Whenever the session changes, decide if we need MFA for this user
  useEffect(() => {
    let cancelled = false;

    async function checkMfaForUser() {
      if (!session || !session.user) {
        if (!cancelled) {
          setCheckingMfa(false);
          setRequiresMfa(false);
        }
        return;
      }

      const userId = session.user.id;
      if (!userId) {
        if (!cancelled) {
          setCheckingMfa(false);
          setRequiresMfa(false);
        }
        return;
      }

      const storageKey = `atlas_mfa_verified_user_${userId}`;

      // If this user already passed MFA in this browser session, skip
      const alreadyVerified =
        window.sessionStorage.getItem(storageKey) === "true";
      if (alreadyVerified) {
        if (!cancelled) {
          setCheckingMfa(false);
          setRequiresMfa(false);
        }
        return;
      }

      try {
        setCheckingMfa(true);

        // 🛡️ Safety: Supabase MFA API may not be available in all environments
        const hasMfaApi =
          supabase.auth &&
          supabase.auth.mfa &&
          typeof supabase.auth.mfa.listFactors === "function";

        if (!hasMfaApi) {
          console.warn(
            "[AuthGuard] supabase.auth.mfa.listFactors not available — skipping MFA check (fail open)."
          );
          if (!cancelled) {
            setRequiresMfa(false);
          }
          return;
        }

        const { data: factorsData, error: factorsError } =
          await supabase.auth.mfa.listFactors();

        if (factorsError) throw factorsError;

        const totpFactors = factorsData?.totp || [];
        const verifiedTotp = totpFactors.find(
          (f) => f.status === "verified"
        );

        if (verifiedTotp) {
          // User HAS 2FA set up → require MFA (TOTP or backup code)
          if (!cancelled) {
            setFactorId(verifiedTotp.id);
            setRequiresMfa(true);
          }
        } else {
          // No 2FA → allow straight through
          if (!cancelled) {
            setRequiresMfa(false);
          }
        }
      } catch (e) {
        console.error("[AuthGuard] MFA check error:", e);
        // Fail open but surface the error once
        if (!cancelled) {
          setError(e.message || "Failed to check 2FA status.");
          setRequiresMfa(false);
        }
      } finally {
        if (!cancelled) setCheckingMfa(false);
      }
    }

    checkMfaForUser();

    return () => {
      cancelled = true;
    };
  }, [session]);

  // 2b) Hard timeout: never let checkingMfa hang forever
  useEffect(() => {
    if (!checkingMfa) return;

    const timeout = setTimeout(() => {
      console.warn(
        "[AuthGuard] MFA check timed out after 15s — failing open."
      );
      setCheckingMfa(false);
      setRequiresMfa(false);
    }, 15000);

    return () => clearTimeout(timeout);
  }, [checkingMfa]);

  // Helper: mark current user as MFA-verified in this browser session
  const markUserMfaVerified = () => {
    const userId = session?.user?.id;
    if (userId) {
      const storageKey = `atlas_mfa_verified_user_${userId}`;
      window.sessionStorage.setItem(storageKey, "true");
    }
    setRequiresMfa(false);
    setCode("");
    setBackupCode("");
    setIsUsingBackupCode(false);
  };

  // 3) Handle 6-digit TOTP code submit
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
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (error) throw error;

      // MFA passed via TOTP
      markUserMfaVerified();
    } catch (e) {
      console.error("[AuthGuard] MFA verify error:", e);
      setError(
        e.message ||
          "Incorrect code. Make sure the code is current and try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // 3b) Handle backup code submit
  const handleBackupSubmit = async (e) => {
    e?.preventDefault();

    if (!backupCode.trim()) {
      setError("Enter a backup code.");
      return;
    }

    setBackupSubmitting(true);
    setError(null);

    try {
      const { data, error } = await supabase.rpc("rpc_use_backup_code", {
        p_code: backupCode.trim(),
      });

      if (error) {
        console.error("[AuthGuard] backup code RPC error:", error);
        throw error;
      }

      if (data !== true) {
        setError("Invalid or already-used backup code.");
        return;
      }

      // Backup code accepted → treat as MFA passed
      markUserMfaVerified();
    } catch (e) {
      console.error("[AuthGuard] backup code verify error:", e);
      setError(
        e.message ||
          "Failed to verify backup code. Check the code and try again."
      );
    } finally {
      setBackupSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      // Clear all MFA flags for this tab
      Object.keys(window.sessionStorage)
        .filter((k) => k.startsWith("atlas_mfa_verified_user_"))
        .forEach((k) => window.sessionStorage.removeItem(k));

      window.location.href = loginPath;
    } catch (e) {
      console.error("[AuthGuard] signOut error:", e);
    }
  };

  // 4) Render logic (no hooks below this line)

  // Still loading session?
  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-gray-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
          <p className="text-sm text-gray-400">Checking session…</p>
        </div>
      </div>
    );
  }

  // No session → redirect to login
  if (!session) {
    return <Navigate to={loginPath} replace />;
  }

  // Session exists, and we are (maybe) checking MFA for this user
  if (checkingMfa) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-gray-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
          <p className="text-sm text-gray-400">Checking 2FA status…</p>
          {error && (
            <p className="text-[11px] text-red-300 max-w-xs text-center">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Session exists & MFA required → show 2FA screen
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
            signing in to{" "}
            <span className="font-semibold">Atlas Command</span>.
          </p>

          {error && (
            <div className="mb-3 text-sm border border-red-500/70 bg-red-500/10 text-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!isUsingBackupCode ? (
            <>
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
                      Verify &amp; Continue
                    </>
                  )}
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <button
                  type="button"
                  onClick={() => {
                    setIsUsingBackupCode(true);
                    setError(null);
                    setBackupCode("");
                  }}
                  className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                >
                  Use a backup code instead
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 hover:bg-slate-800/70"
                >
                  <LogOut className="w-3 h-3" />
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <form onSubmit={handleBackupSubmit} className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Backup code
                  </label>
                  <input
                    type="text"
                    value={backupCode}
                    onChange={(e) =>
                      setBackupCode(e.target.value.trim().toUpperCase())
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-gray-100 font-mono text-sm tracking-[0.2em]"
                    placeholder="E.g. ABCD-2345..."
                    autoFocus
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    Each backup code can only be used once.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={backupSubmitting}
                  className="w-full mt-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-medium"
                >
                  {backupSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Checking backup code…
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      Use backup code
                    </>
                  )}
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <button
                  type="button"
                  onClick={() => {
                    setIsUsingBackupCode(false);
                    setError(null);
                    setCode("");
                  }}
                  className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                >
                  Back to authenticator code
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 hover:bg-slate-800/70"
                >
                  <LogOut className="w-3 h-3" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Authenticated + either no MFA or MFA already passed for this user → render app
  return children;
}
