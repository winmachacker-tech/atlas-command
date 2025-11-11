// src/pages/CompleteAccount.jsx
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function CompleteAccount() {
  const navigate = useNavigate();

  // Read intended redirect once
  const redirectTo = useMemo(() => {
    try {
      return localStorage.getItem("atlas.redirectAfterAuth") || "/";
    } catch {
      return "/";
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      setOk("");

      const { data: sessionData } = await supabase.auth.getUser();
      const user = sessionData?.user || null;

      if (!user) {
        setErr("No active session. Please sign in.");
        setLoading(false);
        return;
      }

      setUserId(user.id);
      setEmail(user.email || "");

      // Pre-fill from profiles if present
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("full_name, phone, profile_complete")
        .eq("id", user.id)
        .maybeSingle();

      if (pErr) {
        setErr(pErr.message);
      } else if (profile) {
        setFullName(profile.full_name || "");
        setPhone(profile.phone || "");
        // If already complete, go to intended destination immediately
        if (profile.profile_complete === true) {
          try { localStorage.removeItem("atlas.redirectAfterAuth"); } catch {}
          navigate(redirectTo || "/", { replace: true });
          return;
        }
      }

      setLoading(false);
    })();
  }, [navigate, redirectTo]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId) return;

    setErr("");
    setOk("");
    setSubmitting(true);
    try {
      // 1) Optional: set password (only if provided)
      if (password || password2) {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
        if (password !== password2) {
          throw new Error("Passwords do not match.");
        }
        const { error: uErr } = await supabase.auth.updateUser({ password });
        if (uErr) throw uErr;
      }

      // 2) Update profile + mark complete
      const { error: profErr } = await supabase
        .from("profiles")
        .update({
          full_name: fullName || "",
          phone: phone || "",
          profile_complete: true,
        })
        .eq("id", userId);

      if (profErr) throw profErr;

      setOk("Account setup complete. Redirectingâ€¦");

      // Clear redirect key and go to intended page
      try { localStorage.removeItem("atlas.redirectAfterAuth"); } catch {}
      const target = redirectTo || "/";
      setTimeout(() => navigate(target, { replace: true }), 500);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[--bg] text-[--fg]">
        <div className="rounded-2xl border border-white/10 p-8 max-w-md w-full text-center">
          <div className="animate-pulse text-sm opacity-80">Loadingâ€¦</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[--bg] text-[--fg]">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 p-6">
        <h1 className="text-xl font-semibold mb-1">Complete Your Account</h1>
        <p className="text-sm opacity-70 mb-6">
          Youâ€™re signed in as <span className="font-mono">{email || "â€”"}</span>.{" "}
          Set your details below to finish onboarding.
        </p>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1">
            <label className="text-sm opacity-80">Full name</label>
            <input
              className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm opacity-80">Phone</label>
            <input
              className="w-full rounded-md bg_black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm opacity-80">New password (optional)</label>
            <input
              type="password"
              className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm opacity-80">Confirm password</label>
            <input
              type="password"
              className="w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="Re-enter password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={cx(
              "mt-2 w-full rounded-md border px-4 py-2",
              "border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30",
              submitting && "opacity-60 cursor-not-allowed"
            )}
          >
            {submitting ? "Savingâ€¦" : "Finish setup"}
          </button>

          {ok && <p className="text-sm text-emerald-400">{ok}</p>}
          {err && <p className="text-sm text-rose-400">{err}</p>}

          <p className="text-xs opacity-60 mt-4">
            You can change these later in your profile. If you didnâ€™t intend to
            create this account, you can{" "}
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                try { localStorage.removeItem("atlas.redirectAfterAuth"); } catch {}
                navigate("/auth", { replace: true });
              }}
              className="underline underline-offset-4"
            >
              sign out
            </button>
            .
          </p>
        </form>
      </div>
    </div>
  );
}

