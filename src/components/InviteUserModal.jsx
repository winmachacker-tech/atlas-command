import { useState } from "react";
import { X, Loader2, Check, Copy, Mail, Link as LinkIcon, AlertCircle } from "lucide-react";

/**
 * InviteUserModal
 * - Calls your Edge Function at {VITE_SUPABASE_URL}/functions/v1/admin-invite-user
 * - Shows success with `invite_link` and whether Resend sent the email
 * - Provides a "Copy Link" button
 *
 * Props:
 *   - open: boolean
 *   - onClose: () => void
 */
export default function InviteUserModal({ open, onClose }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [result, setResult] = useState(null); // success JSON
  const [err, setErr] = useState(null);       // error JSON/message

  if (!open) return null;

  const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-invite-user`;

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setResult(null);
    setCopied(false);

    try {
      const res = await fetch(FUNCTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName || undefined,
          phone: phone || undefined,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || json?.ok === false) {
        // Surface exact details from function
        setErr(json?.detail || json || { message: "Unknown error" });
      } else {
        setResult(json);
      }
    } catch (e) {
      setErr({ message: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!result?.invite_link) return;
    try {
      await navigator.clipboard.writeText(result.invite_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 text-zinc-100 shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold">Invite User</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Full name (optional)</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Phone (optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                className="w-full rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}
              Send Invite
            </button>
          </div>
        </form>

        {/* Success */}
        {result && (
          <div className="px-5 py-4 border-t border-white/10 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-green-400">
                <Check size={18} />
              </div>
              <div>
                <div className="font-medium">Invite generated</div>
                <div className="text-sm text-zinc-300">
                  Mode: <span className="font-mono">{result.mode}</span>
                </div>
                <div className="text-sm text-zinc-300">
                  Email sent via Resend:{" "}
                  <span className={result.email_sent_via_resend ? "text-green-400" : "text-zinc-300"}>
                    {String(!!result.email_sent_via_resend)}
                  </span>
                </div>
                {result.email_error && (
                  <div className="text-sm text-amber-400">
                    Email error: {result.email_error}
                  </div>
                )}
              </div>
            </div>

            {result.invite_link && (
              <div className="rounded-xl bg-zinc-800 border border-white/10 p-3">
                <div className="flex items-start gap-2">
                  <LinkIcon size={16} className="mt-1 shrink-0" />
                  <div className="text-xs break-all">{result.invite_link}</div>
                </div>
                <div className="mt-3">
                  <button
                    onClick={copyLink}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "Copied" : "Copy Link"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {err && (
          <div className="px-5 py-4 border-t border-white/10">
            <div className="flex items-start gap-3 text-rose-300">
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
              <div className="space-y-1">
                <div className="font-medium text-rose-300">Invite failed</div>
                <pre className="text-xs whitespace-pre-wrap break-words bg-rose-950/40 border border-rose-900/40 rounded-lg p-2 text-rose-200">
{JSON.stringify(err, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
