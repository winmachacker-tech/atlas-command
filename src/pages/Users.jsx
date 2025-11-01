// src/pages/Users.jsx
import { useEffect, useState } from "react";
import {
  ShieldAlert,
  Loader2,
  Trash2,
  ShieldCheck,
  Shield,
  Plus,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useIsAdmin } from "../lib/useIsAdmin";

export default function Users() {
  const admin = useIsAdmin(); // 'yes' | 'no' | 'checking'
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteIsAdmin, setInviteIsAdmin] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select("id,email,is_admin,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load users failed:", error.message);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (admin === "yes") loadUsers();
  }, [admin]);

  async function toggleAdmin(u) {
    setSavingId(u.id);
    const { error } = await supabase
      .from("users")
      .update({ is_admin: !u.is_admin })
      .eq("id", u.id);
    setSavingId(null);
    if (error) return console.error("Update admin failed:", error.message);
    setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, is_admin: !u.is_admin } : r)));
  }

  async function deleteProfile(u) {
    if (!confirm(`Delete profile for ${u.email}? This ONLY removes public.users.`)) return;
    setSavingId(u.id);
    const { error } = await supabase.from("users").delete().eq("id", u.id);
    setSavingId(null);
    if (error) return console.error("Delete failed:", error.message);
    setRows((prev) => prev.filter((r) => r.id !== u.id));
  }

  // ✅ Clean 'invoke' version only
  async function submitInvite(e) {
    e.preventDefault();
    setInviting(true);
    setInviteMsg("");

    try {
      const { data, error } = await supabase.functions.invoke("admin-invite-user", {
        body: { email: inviteEmail.trim(), is_admin: inviteIsAdmin },
      });
      if (error) throw new Error(error.message || "Function call failed");

      setInviteMsg("Invite sent!");
      setInviteEmail("");
      setInviteIsAdmin(false);
      setShowInvite(false);
      await loadUsers(); // refresh list so the invited user appears
    } catch (err) {
      setInviteMsg(String(err.message || err));
    } finally {
      setInviting(false);
    }
  }

  if (admin === "checking") {
    return (
      <div className="p-6 flex items-center gap-2 text-zinc-500">
        <Loader2 className="animate-spin" size={16} />
        Checking permission…
      </div>
    );
  }

  if (admin === "no") {
    return (
      <div className="p-8">
        <div className="flex items-start gap-3 text-rose-500">
          <ShieldAlert size={20} className="mt-1" />
          <div>
            <h2 className="font-semibold text-lg">Access denied</h2>
            <p className="text-sm text-zinc-500">Only admins can view Users &amp; Roles.</p>
          </div>
        </div>
      </div>
    );
  }

  // admin === 'yes'
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users &amp; Roles</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-zinc-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            title="Invite user"
          >
            <Plus size={16} />
            Invite User
          </button>
          <button
            onClick={loadUsers}
            className="rounded-xl border px-3 py-2 text-sm dark:border-neutral-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 className="animate-spin" size={16} />
          Loading users…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-zinc-500">No users yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border dark:border-neutral-800">
          <table className="min-w-[820px] w-full text-sm">
            <thead className="bg-zinc-100/60 dark:bg-neutral-900">
              <tr className="text-left">
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Admin</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2 w-64">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t dark:border-neutral-800">
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2">
                    {u.is_admin ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[12px] text-emerald-600 dark:text-emerald-300">
                        <ShieldCheck size={14} />
                        Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[12px] text-zinc-600 dark:text-zinc-300">
                        <Shield size={14} />
                        User
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{new Date(u.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        disabled={savingId === u.id}
                        onClick={() => toggleAdmin(u)}
                        className="rounded-xl border px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-neutral-700 dark:hover:bg-neutral-800 disabled:opacity-60"
                        title={u.is_admin ? "Demote to user" : "Promote to admin"}
                      >
                        {u.is_admin ? "Demote" : "Make Admin"}
                      </button>
                      <button
                        disabled={savingId === u.id}
                        onClick={() => deleteProfile(u)}
                        className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-neutral-700 dark:hover:bg-neutral-800 disabled:opacity-60"
                        title="Delete profile (public.users only)"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <form
            onSubmit={submitInvite}
            className="w-full max-w-md space-y-4 rounded-2xl border bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950"
          >
            <h2 className="text-lg font-semibold">Invite user</h2>
            <input
              type="email"
              required
              autoFocus
              placeholder="user@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={inviteIsAdmin}
                onChange={(e) => setInviteIsAdmin(e.target.checked)}
              />
              Grant admin access
            </label>

            {inviteMsg && <p className="text-sm text-zinc-500">{inviteMsg}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="rounded-xl border px-3 py-2 text-sm dark:border-neutral-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="rounded-xl border px-3 py-2 text-sm dark:border-neutral-800 disabled:opacity-60"
              >
                {inviting ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
