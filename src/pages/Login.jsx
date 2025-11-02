import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useLocation, useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  async function onLogin(e) {
    e.preventDefault();
    try {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      nav(from, { replace: true });
    } catch (err) {
      alert(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm bg-white/70 dark:bg-zinc-900/70">
        <h1 className="text-2xl font-semibold mb-1">Welcome back</h1>
        <p className="text-sm text-zinc-500 mb-6">Sign in to Atlas Command</p>

        <form onSubmit={onLogin} className="space-y-4">
          <div>
            <label className="text-sm block mb-1">Email</label>
            <input className="w-full border rounded-lg px-3 py-2" type="email" value={email}
                   onChange={(e)=>setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="text-sm block mb-1">Password</label>
            <input className="w-full border rounded-lg px-3 py-2" type="password" value={password}
                   onChange={(e)=>setPassword(e.target.value)} required />
          </div>
          <button disabled={busy} className="w-full rounded-xl border py-2 font-medium hover:shadow">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="text-sm mt-4 text-center">
          No account? <Link to="/signup" className="underline">Create one</Link>
        </div>
      </div>
    </div>
  );
}
