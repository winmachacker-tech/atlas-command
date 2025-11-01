// src/pages/Onboarding.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Onboarding() {
  const nav = useNavigate();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      // set password for the just-authenticated invited user
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw upErr;

      // upsert profile
      const { data: { user } } = await supabase.auth.getUser();
      const { error: pErr } = await supabase
        .from("profiles")
        .upsert({ id: user.id, full_name: fullName })
        .eq("id", user.id);
      if (pErr) throw pErr;

      nav("/", { replace: true });
    } catch (e) {
      setErr(e.message || "Failed to complete onboarding");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">Finish creating your account</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input className="w-full border rounded p-2" placeholder="Full name"
               value={fullName} onChange={(e)=>setFullName(e.target.value)} required/>
        <input className="w-full border rounded p-2" placeholder="Create a password"
               type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required/>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button disabled={loading} className="px-4 py-2 rounded bg-black text-white">
          {loading ? "Saving…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
