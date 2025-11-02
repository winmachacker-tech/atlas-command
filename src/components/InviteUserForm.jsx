// src/components/InviteUserForm.jsx
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function InviteUserForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("dispatcher");
  const [message, setMessage] = useState(null);

  async function handleInvite(e) {
    e.preventDefault();
    setMessage("Sending invite…");

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return setMessage("You are not logged in as admin.");

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-invite-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email, role }),
      }
    );

    const out = await res.json();
    if (!res.ok) setMessage(`Error: ${out.error || "Invite failed"}`);
    else {
      setMessage(`✅ Invite sent to ${email}`);
      setEmail("");
    }
  }

  return (
    <form onSubmit={handleInvite} className="p-4 border rounded-xl space-y-3">
      <h3 className="font-semibold text-sm">Invite New User</h3>
      <input
        type="email"
        placeholder="user@company.com"
        className="w-full rounded-md border p-2 text-sm"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <select
        className="w-full rounded-md border p-2 text-sm"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      >
        <option value="dispatcher">Dispatcher</option>
        <option value="admin">Admin</option>
        <option value="viewer">Viewer</option>
      </select>
      <button type="submit" className="bg-black text-white rounded-md px-3 py-1 text-sm">
        Send Invite
      </button>
      {message && <p className="text-xs text-slate-500">{message}</p>}
    </form>
  );
}
