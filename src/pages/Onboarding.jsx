// src/pages/Onboarding.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function Onboarding() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [uid, setUid] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      setOk("");
      try {
        // get current session/user
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        const user = session?.user ?? null;
        if (!user) {
          // not signed in → AuthGuard should catch, but be safe:
          nav("/login");
          return;
        }
        if (cancelled) return;

        setUid(user.id);
        setEmail(user.email || "");
        
        // Prefill from metadata or existing profile
        const { data: profile } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", user.id)
          .single();

        const existingName = profile?.full_name || 
                            user.user_metadata?.full_name ||
                            user.user_metadata?.name ||
                            "";
        
        setFullName(existingName);
      } catch (e) {
        console.error("[Onboarding] init error:", e);
        if (!cancelled) setErr(e.message || "Failed to initialize onboarding.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nav]);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    async function handleSubmit(e) {
  e?.preventDefault?.();
  setErr("");
  setOk("");
  setSaving(true);

  // ADD THIS DEBUG BLOCK HERE:
  const { data: sessionData } = await supabase.auth.getSession();
  const sessionUser = sessionData?.session?.user;
  console.log("🔍 DEBUG SESSION:");
  console.log("Session user ID:", sessionUser?.id);
  console.log("State UID:", uid);
  console.log("Match:", sessionUser?.id === uid);
  console.log("Session:", sessionData?.session);
  // END DEBUG BLOCK

  try {
    console.log("🔍 Onboarding Update:");
    // ... rest of your code
    setErr("");
    setOk("");
    setSaving(true);

    try {
      console.log("🔍 Onboarding Update:");
      console.log("UID:", uid);
      console.log("Email:", email);
      console.log("Full Name:", fullName);

      // Update the existing row (trigger already created it during invite)
      const { data, error } = await supabase
        .from("users")
        .update({
          full_name: fullName?.trim() || null,
          onboarded_at: new Date().toISOString(),
        })
        .eq("id", uid)
        .select("*")
        .single();

      if (error) {
        console.error("❌ Update error:", error);
        console.error("Error code:", error.code);
        console.error("Error message:", error.message);
        throw error;
      }

      console.log("✅ Profile updated successfully:", data);
      setOk("Profile saved.");
      
      // Redirect to dashboard after brief success message
      setTimeout(() => nav("/"), 800);
    } catch (e) {
      console.error("💥 Caught error:", e);
      setErr(e.message || "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
        Finish Setup
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Confirm your details to complete your profile.
      </p>

      {/* Alerts */}
      {err ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-800 bg-amber-900/30 p-3 text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-sm">{err}</div>
        </div>
      ) : null}

      {ok ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-800 bg-emerald-900/30 p-3 text-emerald-100">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-sm">{ok}</div>
        </div>
      ) : null}

      {/* Form */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="text-xs text-zinc-400">Email</label>
          <input
            type="email"
            value={email}
            disabled
            className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400"
          />
        </div>

        <div>
          <label className="text-xs text-zinc-400">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
            className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700"
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving || loading || !uid}
            className={cx(
              "inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-900/40",
              (saving || loading || !uid) && "opacity-60"
            )}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{saving ? "Saving…" : "Save & Continue"}</span>
          </button>
        </div>
      </form>

      {/* Debug panel (dev only) */}
      {import.meta.env.DEV && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
          <div>uid: {uid || "—"}</div>
          <div>email: {email || "—"}</div>
          <div>fullName: {fullName || "—"}</div>
        </div>
      )}
    </div>
  );
}