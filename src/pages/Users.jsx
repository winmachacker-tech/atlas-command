// src/pages/Users.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Search,
  Filter,
  MailPlus,
  RefreshCcw,
  ShieldCheck,
  Shield,
  CheckCircle2,
  XCircle,
  X,
  Wrench,
  RotateCcw,
  KeyRound,
} from "lucide-react";

/* -------------------------------- utilities ------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

/* ------------------------------ admin resolver ---------------------------- */
async function resolveIsAdmin() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session ?? null;
  const user = session?.user ?? null;
  const token = session?.access_token ?? "";
  const email = (user?.email || "").toLowerCase();

  if (!user) return { isAdmin: false, email: "", token: "" };

  // 1) ENV allowlist
  try {
    const envList = (import.meta.env.VITE_ADMIN_EMAILS || "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (email && envList.includes(email)) {
      return { isAdmin: true, email, token };
    }
  } catch {
    /* ignore */
  }

  // 2) app/user metadata
  const am = user.app_metadata || {};
  const um = user.user_metadata || {};
  const metaAdmin =
    am.is_admin === true ||
    am.role === "admin" ||
    (Array.isArray(am.roles) && am.roles.includes("admin")) ||
    um.is_admin === true ||
    um.role === "admin" ||
    (Array.isArray(um.roles) && um.roles.includes("admin"));
  if (metaAdmin) return { isAdmin: true, email, token };

  // 3) RPC is_admin() if present
  try {
    const { data, error } = await supabase.rpc("is_admin");
    if (!error && typeof data === "boolean") {
      return { isAdmin: !!data, email, token };
    }
  } catch {
    /* ignore */
  }

  // 4) users table fallback
  try {
    const { data, error } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      return { isAdmin: !!data.is_admin, email, token };
    }
  } catch {
    /* ignore */
  }

  return { isAdmin: false, email, token };
}

/* --------------------------------- UI bits -------------------------------- */
function Badge({ tone = "zinc", children }) {
  const cls = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-700/50",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100 border border-emerald-800/70",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100 border border-amber-800/70",
    red: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100 border border-rose-800/70",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs", cls)}>
      {children}
    </span>
  );
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-zinc-800">
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- Page ----------------------------------- */
export default function Users() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [meEmail, setMeEmail] = useState("");
  const [userToken, setUserToken] = useState("");

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("dispatcher");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState({ type: "", text: "" });

  /* ------------------------------- init/load ------------------------------ */
  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { isAdmin, email, token } = await resolveIsAdmin();
        if (ignore) return;
        setIsAdmin(isAdmin);
        setMeEmail(email);
        setUserToken(token);
        await loadUsers(isAdmin);
      } catch (e) {
        if (!ignore) setError(e?.message || "Failed to initialize.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const loadUsers = useCallback(
    async (_adminFlag = isAdmin) => {
      setRefreshing(true);
      setError("");
      try {
        const { data, error } = await supabase
          .from("users")
          .select("id,email,full_name,is_admin,created_at")
          .order("created_at", { ascending: false })
          .limit(300);
        if (error) throw error;

        let list = data || [];
        if (q.trim()) {
          const term = q.trim().toLowerCase();
          list = list.filter(
            (r) =>
              (r.email || "").toLowerCase().includes(term) ||
              (r.full_name || "").toLowerCase().includes(term)
          );
        }
        setRows(list);
      } catch (e) {
        console.error("[Users] load error:", e);
        setRows([]);
        setError(
          /permission denied/i.test(e?.message || "")
            ? "Permission denied loading users. You may not have admin access."
            : e?.message || "Failed to load users."
        );
      } finally {
        setRefreshing(false);
      }
    },
    [q, isAdmin]
  );

  /* -------------------------------- invite -------------------------------- */
  async function handleInviteSubmit(e) {
    e?.preventDefault?.();
    setInviteMsg({ type: "", text: "" });

    if (!inviteEmail || !inviteEmail.includes("@")) {
      setInviteMsg({ type: "error", text: "Please enter a valid email." });
      return;
    }

    try {
      setInviting(true);

      const { data, error } = await supabase.functions.invoke("admin-invite-user", {
        body: {
          email: inviteEmail.trim(),
          full_name: inviteName.trim() || null,
          role: inviteRole || null,
        },
        headers: userToken ? { Authorization: `Bearer ${userToken}` } : {},
      });

      if (error) throw error;

      const mode = data?.mode || "invited";
      const successText =
        mode === "recovery_sent"
          ? `Existing user detected. Sent password reset email to ${inviteEmail.trim()}.`
          : `Invite email sent to ${inviteEmail.trim()}.`;

      setInviteMsg({ type: "success", text: successText });

      // Clear fields and refresh list
      setInviteEmail("");
      setInviteName("");
      setInviteRole("dispatcher");
      await loadUsers();

      // Auto-close modal after a brief toast display
      setTimeout(() => {
        setInviteOpen(false);
        setInviteMsg({ type: "", text: "" });
      }, 1200);
    } catch (e) {
      console.error("[Users] invite error:", e);
      const raw =
        typeof e?.message === "string" ? e.message :
        typeof e?.error === "string" ? e.error : "";

      const msg =
        /forbidden|admin only/i.test(raw)
          ? "Unauthorized. Only admins can send invites."
          : /unauthorized|no user token/i.test(raw)
          ? "Unauthorized. Your session may have expired—refresh your token."
          : raw || "Failed to send invite.";

      setInviteMsg({ type: "error", text: msg });
    } finally {
      setInviting(false);
    }
  }

  async function refreshAuth() {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      const next = await resolveIsAdmin();
      setIsAdmin(next.isAdmin);
      setMeEmail(next.email);
      setUserToken(next.token);
      await loadUsers(next.isAdmin);
    } catch (e) {
      console.error("[Users] refreshAuth error:", e);
      setError("Auth refresh failed. You may need to sign in again.");
    }
  }

  function hardReload() {
    location.reload();
  }

  /* ----------------------------- header actions ---------------------------- */
  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <button
          onClick={() => loadUsers()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900/50"
          title="Refresh"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          <span>Refresh</span>
        </button>

        {isAdmin && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-900/20 px-2.5 py-1.5 text-sm text-emerald-100 hover:bg-emerald-900/40"
            title="Invite a new user"
          >
            <MailPlus className="h-4 w-4" />
            <span>Invite User</span>
          </button>
        )}
      </div>
    ),
    [isAdmin, loadUsers, refreshing]
  );

  /* --------------------------------- render -------------------------------- */
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">User Management</h1>
          <p className="mt-1 text-sm text-zinc-400">
            View users and send invites. {isAdmin ? "You have admin access." : "Read-only access."}
          </p>
        </div>
        {headerActions}
      </div>

      {/* Tools row */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              className="w-72 rounded-lg border border-zinc-800 bg-zinc-950/60 px-8 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700"
              placeholder="Search by email or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadUsers()}
            />
          </div>
          <button
            onClick={() => loadUsers()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900/50"
          >
            <Filter className="h-4 w-4" />
            <span>Apply</span>
          </button>
        </div>

        {/* Repair panel */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-500">
            <Wrench className="h-4 w-4" />
            <span>Repair:</span>
          </div>
          <button
            onClick={refreshAuth}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900/50"
            title="Refresh auth session/token"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Token
          </button>
          <button
            onClick={hardReload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900/50"
            title="Reload this page"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reload
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800">
          <thead className="bg-zinc-900/50">
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-400">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900/70">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center">
                  <Badge tone="amber">
                    <XCircle className="h-4 w-4" />
                    {error}
                  </Badge>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-400">
                  No users found.
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3 text-sm text-zinc-200">{u.email || "—"}</td>
                  <td className="px-4 py-3 text-sm text-zinc-300">{u.full_name || "—"}</td>
                  <td className="px-4 py-3">
                    {u.is_admin ? (
                      <Badge tone="green">
                        <ShieldCheck className="h-4 w-4" />
                        Admin
                      </Badge>
                    ) : (
                      <Badge tone="zinc">
                        <Shield className="h-4 w-4" />
                        User
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{fmtDate(u.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Invite Modal */}
      <Modal
        open={inviteOpen && isAdmin}
        onClose={() => {
          if (!inviting) setInviteOpen(false);
          setInviteMsg({ type: "", text: "" });
        }}
        title="Invite a New User"
      >
        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Full name (optional)</label>
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-700"
            >
              <option value="dispatcher">Dispatcher</option>
              <option value="admin">Admin</option>
              <option value="ops">Ops</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          {inviteMsg.text ? (
            <div
              className={cx(
                "rounded-lg border px-3 py-2 text-sm",
                inviteMsg.type === "success"
                  ? "border-emerald-800 bg-emerald-900/30 text-emerald-100"
                  : "border-amber-800 bg-amber-900/30 text-amber-100"
              )}
            >
              {inviteMsg.type === "success" ? (
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> {inviteMsg.text}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> {inviteMsg.text}
                </span>
              )}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => !inviting && setInviteOpen(false)}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900/50"
              disabled={inviting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviting}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-900/20 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-60"
            >
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
              <span>Send Invite</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
