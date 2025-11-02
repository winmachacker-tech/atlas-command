// src/pages/Users.jsx
// Full drop-in page (401 fix):
// - Invite modal now uses `supabase.functions.invoke('admin-invite-user', { body })`
//   so the Authorization/apikey headers are automatically included (no more 401).
// - Shows invite link, Resend status, copy/open actions.
// - Users table reading from public.users.
//
// Requirements:
// - src/lib/supabase.js exports an initialized v2 client
// - VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set in your env
// - Edge Function deployed: /functions/v1/admin-invite-user

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2, Search, Filter, Plus, RefreshCcw, X, Check, Copy, Mail, Link as LinkIcon, AlertCircle,
  UserCircle2
} from "lucide-react";

/* ---------------------------- Utilities & UI bits --------------------------- */

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function EmptyState({ title = "No data", subtitle = "Nothing to show yet." }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <UserCircle2 className="mb-3" size={40} />
      <div className="text-lg font-medium">{title}</div>
      <div className="text-sm text-zinc-400">{subtitle}</div>
    </div>
  );
}

/* -------------------------------- Invite Modal ------------------------------ */

function InviteUserModal({ open, onClose }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [result, setResult] = useState(null); // success JSON
  const [err, setErr] = useState(null);       // error JSON/message

  if (!open) return null;

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setResult(null);
    setCopied(false);

    try {
      const { data, error } = await supabase.functions.invoke("admin-invite-user", {
        body: {
          email,
          full_name: fullName || undefined,
          phone: phone || undefined,
        },
      });

      if (error || data?.ok === false) {
        // Surface exact details from function
        setErr(data?.detail || data || error || { message: "Unknown error" });
      } else {
        setResult(data);
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

  function closeAll() {
    setEmail("");
    setFullName("");
    setPhone("");
    setResult(null);
    setErr(null);
    setCopied(false);
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 text-zinc-100 shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold">Invite User</h2>
          <button
            onClick={closeAll}
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
              onClick={closeAll}
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
                {"email_sent_via_resend" in result && (
                  <div className="text-sm text-zinc-300">
                    Email sent via Resend:{" "}
                    <span className={result.email_sent_via_resend ? "text-green-400" : "text-zinc-300"}>
                      {String(!!result.email_sent_via_resend)}
                    </span>
                  </div>
                )}
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
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={copyLink}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "Copied" : "Copy Link"}
                  </button>
                  <a
                    href={result.invite_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5"
                  >
                    <LinkIcon size={16} />
                    Open
                  </a>
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

/* -------------------------------- Users Page -------------------------------- */

export default function Users() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data, error } = await supabase
          .from("users")
          .select("id, email, full_name, phone, role, is_admin, created_at, updated_at")
          .order("created_at", { ascending: false });

        if (!alive) return;
        if (error) {
          setErr(error);
          setRows([]);
        } else {
          setRows(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!alive) return;
        setErr({ message: e?.message || String(e) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      (r.email || "").toLowerCase().includes(needle) ||
      (r.full_name || "").toLowerCase().includes(needle) ||
      (r.phone || "").toLowerCase().includes(needle) ||
      (r.role || "").toLowerCase().includes(needle)
    );
  }, [q, rows]);

  return (
    <div className="p-4 md:p-6">
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div className="text-xl font-semibold">Users</div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl bg-zinc-900 border border-white/10 px-3 py-2">
            <Search size={16} className="text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search users…"
              className="bg-transparent outline-none text-sm w-56"
            />
            <button
              className="px-2 py-1 rounded-lg hover:bg-white/5 transition"
              title="Filters (placeholder)"
            >
              <Filter size={16} />
            </button>
          </div>
          <button
            onClick={() => setRefreshKey((x) => x + 1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5"
            title="Refresh"
          >
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500"
            title="Invite user"
          >
            <Plus size={16} />
            Invite
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/40 border-b border-white/10 text-zinc-300">
              <tr>
                <th className="text-left font-medium px-4 py-3">Email</th>
                <th className="text-left font-medium px-4 py-3">Name</th>
                <th className="text-left font-medium px-4 py-3">Phone</th>
                <th className="text-left font-medium px-4 py-3">Role</th>
                <th className="text-left font-medium px-4 py-3">Admin</th>
                <th className="text-left font-medium px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="animate-spin" size={16} />
                      Loading…
                    </div>
                  </td>
                </tr>
              )}

              {!loading && err && (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 p-4 text-rose-200">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5" size={18} />
                        <div className="space-y-1">
                          <div className="font-medium">Error loading users</div>
                          <pre className="text-xs whitespace-pre-wrap break-words">
{JSON.stringify(err, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && !err && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <EmptyState
                      title="No users found"
                      subtitle={q ? `No results for “${q}”.` : "Invite your first teammate."}
                    />
                  </td>
                </tr>
              )}

              {!loading && !err && filtered.map((u) => (
                <tr key={u.id} className="border-b border-white/5">
                  <td className="px-4 py-3">{u.email || "—"}</td>
                  <td className="px-4 py-3">{u.full_name || "—"}</td>
                  <td className="px-4 py-3">{u.phone || "—"}</td>
                  <td className="px-4 py-3">{u.role || "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cx(
                        "inline-flex items-center px-2 py-0.5 rounded-md text-xs",
                        u.is_admin
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/20"
                          : "bg-zinc-700/30 text-zinc-300 border border-white/10"
                      )}
                    >
                      {u.is_admin ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.created_at
                      ? new Date(u.created_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      <InviteUserModal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          // After invite, refresh; if the user completes sign-up later you still have minimal row
          setTimeout(() => setRefreshKey((x) => x + 1), 500);
        }}
      />
    </div>
  );
}
