import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2, ShieldCheck, Phone, KeyRound, CheckCircle2, XCircle } from "lucide-react";

/* ------------------------------ tiny helpers ------------------------------ */
function cx(...a) { return a.filter(Boolean).join(" "); }
function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}
const siteTitle = import.meta.env.VITE_APP_NAME || "Atlas Command";

/** Normalize common US inputs to E.164 (+1XXXXXXXXXX). Leaves + prefixed as-is. */
function normalizePhone(input) {
  const raw = (input || "").replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return raw; // assume caller included country code
  // If 11 digits starting with 1, or 10 digits → US
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  // Fallback (let validation catch it)
  return raw;
}

function isE164(s) {
  return /^\+?[1-9]\d{6,14}$/.test(s || "");
}

async function ensureUserRow(profile = {}) {
  try {
    const { data: { user }, error: meErr } = await supabase.auth.getUser();
    if (meErr || !user) return { ok: false, error: meErr?.message || "No user after verify." };

    const payload = {
      id: user.id,
      email: user.email ?? null,
      full_name: profile.full_name ?? user.user_metadata?.full_name ?? null,
      is_admin: false,
    };
    const { error } = await supabase.from("users").upsert(payload, { onConflict: "id" });
    if (error && !/duplicate key/i.test(error.message)) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* --------------------------------- Page ----------------------------------- */
export default function PhoneSignup() {
  const q = useQuery();
  const navigate = useNavigate();

  const [phase, setPhase] = useState("enter"); // "enter" | "verify" | "done"
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const [fullName, setFullName] = useState(q.get("name") || "");
  const [role, setRole] = useState(q.get("role") || "dispatcher");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" }); // type: "good" | "bad" | ""

  useEffect(() => {
    document.title = `${siteTitle} — Phone Signup`;
  }, []);

  async function requestOtp(e) {
    e?.preventDefault?.();
    setMsg({ type: "", text: "" });

    const normalized = normalizePhone(phone);
    setPhone(normalized);

    if (!isE164(normalized) || !normalized.startsWith("+")) {
      setMsg({ type: "bad", text: "Enter a valid phone in E.164 format (e.g. +14155551234)." });
      return;
    }

    try {
      setBusy(true);

      const { error } = await supabase.auth.signInWithOtp({
        phone: normalized,
        options: { data: { full_name: fullName || null, role: role || "dispatcher" } },
      });

      if (error) {
        // Special-case common provider/config errors (HTTP 400 from /auth/v1/otp)
        const t = String(error.message || "").toLowerCase();
        if (
          t.includes("sms") ||
          t.includes("phone") ||
          t.includes("provider") ||
          t.includes("unsupported")
        ) {
          setMsg({
            type: "bad",
            text:
              "Unsupported phone provider. In Supabase: Auth → Providers → Phone → enable & configure SMS (Twilio/Vonage). Then retry.",
          });
          return;
        }
        throw error;
      }

      setPhase("verify");
      setMsg({ type: "good", text: "Code sent via SMS. Enter the 6-digit code to continue." });
    } catch (e) {
      setMsg({ type: "bad", text: typeof e?.message === "string" ? e.message : "Failed to send code." });
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e) {
    e?.preventDefault?.();
    setMsg({ type: "", text: "" });

    const normalized = normalizePhone(phone);
    const token = code.trim();

    if (!isE164(normalized)) {
      setMsg({ type: "bad", text: "Invalid phone format." });
      return;
    }
    if (token.length < 4) {
      setMsg({ type: "bad", text: "Enter the code you received via SMS." });
      return;
    }

    try {
      setBusy(true);

      const { error } = await supabase.auth.verifyOtp({
        phone: normalized,
        token,
        type: "sms",
      });
      if (error) throw error;

      const ok = await ensureUserRow({ full_name: fullName });
      if (!ok.ok) {
        setMsg({ type: "bad", text: `Signed in, but profile init failed: ${ok.error}` });
      } else {
        setMsg({ type: "good", text: "Phone verified. You’re in!" });
      }

      setPhase("done");
      setTimeout(() => navigate("/"), 1200);
    } catch (e) {
      setMsg({ type: "bad", text: typeof e?.message === "string" ? e.message : "Verification failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-emerald-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Sign up with SMS</h1>
        </div>

        {msg.text ? (
          <div
            className={cx(
              "mb-4 rounded-lg border px-3 py-2 text-sm",
              msg.type === "good"
                ? "border-emerald-800 bg-emerald-900/30 text-emerald-100"
                : "border-amber-800 bg-amber-900/30 text-amber-100"
            )}
          >
            <span className="inline-flex items-center gap-2">
              {msg.type === "good" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {msg.text}
            </span>
          </div>
        ) : null}

        {phase === "enter" && (
          <form onSubmit={requestOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Full name (optional)</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-700"
              >
                <option value="dispatcher">Dispatcher</option>
                <option value="admin">Admin</option>
                <option value="ops">Ops</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Phone number</label>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+14155551234 or 4155551234"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-8 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700"
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                We’ll text you a verification code. US numbers auto-format to +1.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-900/20 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                <span>Send code</span>
              </button>
            </div>
          </form>
        )}

        {phase === "verify" && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Phone</label>
              <input
                value={phone}
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">6-digit code</label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="123456"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-8 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700 tracking-widest"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setPhase("enter")}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900/50"
                disabled={busy}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-900/20 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>Verify & Continue</span>
              </button>
            </div>
          </form>
        )}

        {phase === "done" && (
          <div className="mt-4 text-sm text-emerald-100">You’re signed in. Redirecting…</div>
        )}
      </div>
    </div>
  );
}
