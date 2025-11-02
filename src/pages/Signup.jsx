import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

export default function Signup() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSignup(e) {
    e.preventDefault();
    try {
      setBusy(true);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          // relying on Supabase Auth → Site URL for redirects
        }
      });
      if (error) throw error;
      alert("Check your email to confirm your account.");
    } catch (err) {
      alert(err.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm bg-white/70 dark:bg-zinc-900/70">
        <h1 className="text-2xl font-semibold mb-1">Create your account</h1>
        <p className="text-sm text-zinc-500 mb-6">Set a password you'll remember.</p>

        <form onSubmit={onSignup} className="space-y-4">
          <div>
            <label className="text-sm block mb-1">Full name</label>
            <input className="w-full border rounded-lg px-3 py-2" value={fullName} onChange={(e)=>setFullName(e.target.value)} />
          </div>
          <div>
            <label className="text-sm block mb-1">Email</label>
            <input className="w-full border rounded-lg px-3 py-2" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required/>
          </div>
          <div>
            <label className="text-sm block mb-1">Password</label>
            <input className="w-full border rounded-lg px-3 py-2" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required/>
          </div>
          <button disabled={busy} className="w-full rounded-xl border py-2 font-medium hover:shadow">
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>

        <div className="text-sm mt-4 text-center">
          Already have an account? <Link to="/login" className="underline">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
