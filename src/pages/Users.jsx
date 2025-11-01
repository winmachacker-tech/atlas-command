// src/pages/Users.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Shield, User, Mail } from "lucide-react";
import AddUserModal from "../components/AddUserModal";

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("full_name");
    if (error) console.error(error);
    else setUsers(data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Users & Roles</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-2 bg-black text-white rounded-xl hover:bg-black/90"
        >
          <Plus size={16} /> Add User
        </button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left">
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-neutral-800/40">
                <td className="py-2 flex items-center gap-2">
                  <User size={14} /> {u.full_name || "-"}
                </td>
                <td className="text-neutral-400 flex items-center gap-2">
                  <Mail size={14} /> {u.email}
                </td>
                <td>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-lg text-xs ${
                      u.role === "admin"
                        ? "bg-red-900/40 text-red-300"
                        : u.role === "manager"
                        ? "bg-blue-900/40 text-blue-300"
                        : u.role === "dispatcher"
                        ? "bg-green-900/40 text-green-300"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    <Shield size={12} className="mr-1" /> {u.role}
                  </span>
                </td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AddUserModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => fetchUsers()}
      />
    </div>
  );
}
