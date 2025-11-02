import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { Plus, RefreshCcw } from "lucide-react";

async function inviteUser(email, role = "user") {
  // Use the SDK: it handles the base URL + headers automatically
  const { data, error } = await supabase.functions.invoke("admin-invite-user", {
    body: { email, role, redirectUrl: window.location.origin },
  });
  if (error) throw error;
  return data;
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    setErr(""); setOk("");
    const { data, error } = await supabase.from("users").select("*").order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setUsers(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onInvite(e) {
    e.preventDefault();
    setErr(""); setOk("");

    if (!email) return setErr("Enter an email.");

    try {
      setBusy(true);
      await inviteUser(email, role);
      setOk("Invite sent.");
      setEmail("");
      await load();
    } catch (e) {
      setErr(e.message || "Invite failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-900"
        >
          <RefreshCcw size={16} /> Refresh
        </button>
      </div>

      <form onSubmit={onInvite} className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <input
          type="email"
          className="rounded-lg bg-neutral-900 p-3 text-neutral-100 outline-none"
          placeholder="new.user@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className="rounded-lg bg-neutral-900 p-3 text-neutral-100 outline-none"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-white p-3 font-medium text-black disabled:opacity-50"
        >
          <Plus size={16} /> {busy ? "Sending…" : "Invite User"}
        </button>
      </form>

      {err && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{err}</div>}
      {ok && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{ok}</div>}

      <div className="overflow-hidden rounded-xl border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-300">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Invited</th>
              <th className="px-4 py-3">Onboarded</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-neutral-800">
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{u.role || "user"}</td>
                <td className="px-4 py-3">{u.invited_at ? new Date(u.invited_at).toLocaleString() : "-"}</td>
                <td className="px-4 py-3">{u.onboarded_at ? new Date(u.onboarded_at).toLocaleString() : "-"}</td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
