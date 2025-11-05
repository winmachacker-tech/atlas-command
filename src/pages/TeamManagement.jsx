// src/pages/TeamManagement.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ShieldCheck,
  AlertTriangle,
  Users,
  Loader2,
  LockKeyhole,
  UserPlus,
  Mail,
  Trash2,
  Check,
} from "lucide-react";

export default function TeamManagement() {
  const [state, setState] = useState({
    loading: true,
    isAdmin: false,
    error: null,
  });

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  // Check admin access
  useEffect(() => {
    let alive = true;

    async function checkAccess() {
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = authData?.user || null;
        if (!user) {
          if (!alive) return;
          setState({ loading: false, isAdmin: false, error: null });
          return;
        }

        const metaRole = user.user_metadata?.role;
        if (metaRole === "ADMIN") {
          if (!alive) return;
          setState({ loading: false, isAdmin: true, error: null });
          return;
        }

        const { data, error: dbErr } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (dbErr) {
          if (!alive) return;
          setState({
            loading: false,
            isAdmin: false,
            error: "Could not verify your role (DB error).",
          });
          return;
        }

        const role = data?.role ?? null;
        const isAdmin = role === "ADMIN";

        if (!alive) return;
        setState({ loading: false, isAdmin, error: null });
      } catch (err) {
        console.error("[TeamManagement] access check failed:", err);
        if (!alive) return;
        setState({
          loading: false,
          isAdmin: false,
          error: err?.message || "Unexpected error while checking access.",
        });
      }
    }

    checkAccess();
    return () => {
      alive = false;
    };
  }, []);

  // Load users
  useEffect(() => {
    if (state.isAdmin) {
      loadUsers();
    }
  }, [state.isAdmin]);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      // Use the view we created
      const { data, error } = await supabase
        .from('user_list_view')
        .select('*');

      if (error) throw error;

      setUsers(data || []);
    } catch (err) {
      console.error("Failed to load users:", err);
      alert("Failed to load users: " + err.message);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function handleRoleChange(userId, newRole) {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole })
        .eq("id", userId);

      if (error) throw error;

      // Update local state
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      
      if (selectedUser?.id === userId) {
        setSelectedUser((prev) => ({ ...prev, role: newRole }));
      }

      alert("Role updated successfully!");
    } catch (err) {
      console.error("Failed to update role:", err);
      alert("Failed to update role: " + err.message);
    }
  }

  async function handleInviteUser(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviteLoading(true);
    setInviteSuccess(false);

    try {
      // Get the session token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Call your edge function
      const response = await fetch(
        `${supabase.supabaseUrl}/functions/v1/admin-invite-user`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ 
            email: inviteEmail.trim(),
            role: "user",
            full_name: "", // You can add a name field to the form if needed
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to invite user");
      }

      setInviteSuccess(true);
      setInviteEmail("");
      
      const message = result.mode === "recovery_sent" 
        ? `User already exists. Recovery email sent to ${inviteEmail}`
        : `Invitation sent to ${inviteEmail}!`;
      
      alert(message);
      
      // Reload users after a short delay
      setTimeout(() => {
        loadUsers();
        setInviteSuccess(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to invite user:", err);
      alert("Failed to invite user: " + err.message);
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleDeleteUser(userId) {
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;

    alert("User deletion requires admin API access. For now, delete users directly in Supabase dashboard.");
  }

  // Loading state
  if (state.loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-sm opacity-80">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Checking access…</span>
        </div>
      </div>
    );
  }

  // Non-admin view
  if (!state.isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border shadow-sm p-6 bg-[var(--card-bg,white)]">
          <div className="flex items-start gap-3">
            <LockKeyhole className="h-5 w-5 mt-0.5 opacity-80" />
            <div>
              <h2 className="text-lg font-semibold">Restricted Area</h2>
              <p className="text-sm opacity-80">
                You don't have access to Team Management. If this is unexpected,
                ask an administrator to grant the <code>ADMIN</code> role.
              </p>
              {state.error && (
                <div className="mt-3 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="opacity-80">{state.error}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Admin view
  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6" />
          <div>
            <h1 className="text-xl font-semibold">Team Management</h1>
            <p className="text-sm opacity-75">
              Add users, set roles, and manage access.
            </p>
          </div>
        </div>
      </header>

      <div className="grid md:grid-cols-12 gap-4">
        {/* Left: Users list */}
        <section className="md:col-span-7 rounded-2xl border shadow-sm bg-[var(--card-bg,white)]">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <h2 className="font-medium">Users ({users.length})</h2>
              </div>
              {loadingUsers && (
                <Loader2 className="h-4 w-4 animate-spin opacity-50" />
              )}
            </div>
          </div>

          <div className="divide-y max-h-[600px] overflow-y-auto">
            {users.length === 0 && !loadingUsers && (
              <div className="p-8 text-center text-sm opacity-60">
                No users found
              </div>
            )}

            {users.map((user) => (
              <button
                key={user.id}
                onClick={() => setSelectedUser(user)}
                className={`w-full p-4 text-left hover:bg-[var(--bg-hover)] transition ${
                  selectedUser?.id === user.id ? "bg-[var(--bg-active)]" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{user.email}</div>
                    <div className="text-xs opacity-60 mt-1">
                      ID: {user.id.slice(0, 8)}...
                    </div>
                  </div>
                  <div
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      user.role === "ADMIN"
                        ? "bg-purple-500/20 text-purple-600 dark:text-purple-400"
                        : "bg-gray-500/20 text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {user.role || "USER"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Right: User details / Invite */}
        <aside className="md:col-span-5 space-y-4">
          {/* Invite new user */}
          <div className="rounded-2xl border shadow-sm bg-[var(--card-bg,white)]">
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                <h2 className="font-medium">Invite User</h2>
              </div>
            </div>
            <form onSubmit={handleInviteUser} className="p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                  className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={inviteLoading || !inviteEmail.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {inviteLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : inviteSuccess ? (
                  <>
                    <Check className="h-4 w-4" />
                    Invited!
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Send Invite
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Selected user details */}
          {selectedUser && (
            <div className="rounded-2xl border shadow-sm bg-[var(--card-bg,white)]">
              <div className="p-4 border-b">
                <h2 className="font-medium">User Details</h2>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <div className="text-xs opacity-60 mb-1">Email</div>
                  <div className="text-sm font-medium">{selectedUser.email}</div>
                </div>

                <div>
                  <div className="text-xs opacity-60 mb-1">User ID</div>
                  <div className="text-xs font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded break-all">
                    {selectedUser.id}
                  </div>
                </div>

                <div>
                  <label className="block text-xs opacity-60 mb-2">Role</label>
                  <select
                    value={selectedUser.role || "USER"}
                    onChange={(e) =>
                      handleRoleChange(selectedUser.id, e.target.value)
                    }
                    className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm"
                  >
                    <option value="USER">User</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>

                <div className="pt-2 border-t">
                  <button
                    onClick={() => handleDeleteUser(selectedUser.id)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-600 text-red-600 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950 transition"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete User
                  </button>
                  <p className="text-xs opacity-60 mt-2 text-center">
                    Deletion requires backend setup
                  </p>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}