import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function parseAuthTokens() {
  const frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const qs = new URLSearchParams(window.location.search);
  const get = (k) => frag.get(k) || qs.get(k);

  return {
    type: get("type"), // invite | recovery | signup
    access_token: get("access_token"),
    refresh_token: get("refresh_token"),
  };
}

export default function SetPassword() {
  const nav = useNavigate();
  const tokens = useMemo(() => parseAuthTokens(), []);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: s1 } = await supabase.auth.getSession();
        let session = s1?.session ?? null;

        if (!session && tokens.access_token && tokens.refresh_token) {
          const { data: s2, error: setErr } = await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          });
          if (setErr) throw setErr;
          session = s2?.session ?? null;
        }
      } catch (e) {
        setErr(e.message || "Authentication link is invalid or expired.");
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => (mounted = false);
  }, [tokens.access_token, tokens.refresh_token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    if (pwd.length < 8) return setErr("Password must be at least 8 characters.");
    if (pwd !== pwd2) return setErr("Passwords do not match.");

    try {
      setBusy(true);
      const { error: upErr } = await supabase.auth.updateUser({ password: pwd });
      if (upErr) throw upErr;

      await supabase.auth.refreshSession();

      try {
        const { data: ures } = await supabase.auth.getUser();
        const uid = ures?.user?.id;
        if (uid) {
          await supabase.from("users").upsert({
            id: uid,
            onboarded_at: new Date().toISOString(),
          });
        }
      } catch {}

      window.history.replaceState({}, "", window.location.origin + "/");
      nav("/", { replace: true });
    } catch (e) {
      setErr(e.message || "Could not set password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-2xl bg-neutral-900 p-8 text-neutral-100">
        <div className="animate-pulse text-neutral-400">Preparing your account…</div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-20 max-w-md rounded-2xl bg-neutral-900 p-8 text-neutral-100">
      <h1 className="mb-2 text-2xl font-semibold">Set your password</h1>
      <p className="mb-6 text-neutral-400">
        You were invited to Atlas Command. Create a password to finish setting up your account.
      </p>

      {err && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
          {err}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm">New password</label>
          <input
            type="password"
            className="w-full rounded-lg bg-neutral-800 p-3 outline-none"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm">Confirm password</label>
          <input
            type="password"
            className="w-full rounded-lg bg-neutral-800 p-3 outline-none"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <button
          className="w-full rounded-xl bg-white py-3 font-medium text-black disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </div>
  );
}
