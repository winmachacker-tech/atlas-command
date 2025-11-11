import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AddUserModal({ open, onClose, onCreated }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("dispatcher");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Reset fields when modal opens
  useEffect(() => {
    if (open) {
      setFullName("");
      setEmail("");
      setRole("dispatcher");
      setError("");
      setSending(false);
    }
  }, [open]);

  if (!open) return null;

  // Submit invite request
  async function handleSubmit(e) {
    e.preventDefault();
    setSending(true);
    setError("");

    try {
      // Get current session for JWT
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) throw new Error("Not authenticated.");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite_user`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          role,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Invite failed (${res.status})`);
      }

      // Refresh user list on success
      onCreated?.();
      onClose?.();
    } catch (err) {
      setError(err.message || "Failed to create user.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-lg">
        <h2 className="text-lg font-semibold mb-4 text-neutral-900 dark:text-neutral-100">
          Invite New User
        </h2>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm mb-1 text-neutral-600 dark:text-neutral-300">
              Full name
            </label>
            <input
              className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-neutral-900 dark:text-neutral-100"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g., Jane Doe"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1 text-neutral-600 dark:text-neutral-300">
              Email
            </label>
            <input
              type="email"
              className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-neutral-900 dark:text-neutral-100"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1 text-neutral-600 dark:text-neutral-300">
              Role
            </label>
            <select
              className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-neutral-900 dark:text-neutral-100"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              disabled={sending}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="rounded-xl bg-black text-white px-4 py-2 hover:bg-black/90 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {sending ? "Invitingâ€¦" : "Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

