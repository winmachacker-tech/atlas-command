import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) nav("/dashboard", { replace: true });
    });
  }, [nav]);

  async function signIn(e) {
    e.preventDefault();
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }, // or `${window.location.origin}/dashboard`
    });
    if (error) setMsg(error.message);
    else setMsg("Check your email for the magic link.");
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={signIn} className="w-full max-w-sm space-y-4 rounded-2xl border p-6 dark:border-zinc-800">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-xl border px-3 py-2 dark:border-zinc-700 dark:bg-neutral-900"
        />
        <button type="submit" className="w-full rounded-xl border px-3 py-2 font-medium dark:border-zinc-700 dark:bg-neutral-900">
          Send magic link
        </button>
        {msg && <p className="text-sm text-zinc-500">{msg}</p>}
      </form>
    </div>
  );
}
