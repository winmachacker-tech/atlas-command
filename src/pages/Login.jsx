import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin, // Supabase will append /auth/v1/callback
      },
    });
    if (error) return setErr(error.message);
    setSent(true);
  }

  return (
    <div className="mx-auto mt-20 max-w-md rounded-2xl bg-neutral-900 p-8 text-neutral-100">
      <h1 className="mb-2 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-neutral-400">
        Use your work email to receive a magic link.
      </p>

      {sent ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          Check your inbox for the magic link. Open it on this device to log in.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {err && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
              {err}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm">Email</label>
            <input
              type="email"
              className="w-full rounded-lg bg-neutral-800 p-3 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <button
            className="w-full rounded-xl bg-white py-3 font-medium text-black"
            type="submit"
          >
            Send magic link
          </button>
        </form>
      )}
    </div>
  );
}
