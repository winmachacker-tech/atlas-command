// src/pages/CompleteAccount.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, Check, AlertCircle, User } from "lucide-react";

export default function CompleteAccount() {
  const navigate = useNavigate();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        setUser(data.user);
        setFullName(data.user.user_metadata?.full_name || "");
        setPhone(data.user.user_metadata?.phone || "");
      }
      setSessionChecked(true);
    })();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    setErr("");

    try {
      const updates = {
        id: user.id,
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("profiles").upsert(updates);
      if (error) throw error;
      setMsg("Account setup complete! Redirecting...");
      setTimeout(() => navigate("/", { replace: true }), 1000);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!sessionChecked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm opacity-80">
        Session not found. Please sign in again.
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 text-zinc-100 shadow-2xl ring-1 ring-white/10 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-zinc-800 border border-white/10">
            <User size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Complete your profile</h1>
            <p className="text-sm text-zinc-400">One last step before you start using Atlas Command.</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {msg && (
            <div className="text-emerald-400 text-sm flex items-center gap-2">
              <Check size={16} /> {msg}
            </div>
          )}
          {err && (
            <div className="text-rose-400 text-sm flex items-center gap-2">
              <AlertCircle size={16} /> {err}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
              Save & Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

