// src/pages/Users.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Search,
  Plus,
  MailPlus,
  ShieldCheck,
  Shield,
  X,
  CheckCircle2,
  XCircle,
} from "lucide-react";

/* --------------------------------- helpers -------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function Badge({ tone = "zinc", className = "", children }) {
  const map = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700",
    green:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800",
    red: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200/60 dark:border-red-800",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs",
        map[tone] || map.zinc,
        className
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------- page ---------------------------------- */
export default function UsersPage() {
  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [loadingMe, setLoadingMe] = useState(true);

  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [err, setErr] = useState("");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null); // {ok:boolean, text:string}

  /* ----------------------------- load my admin ---------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingMe(true);
      try {
        const { data: session } = await supabase.auth.getSession();
        const uid = session?.session?.user?.id;
        if (!uid) throw new Error("Not authenticated.");

        // Your schema: public.users has boolean column is_admin
        const { data, error } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", uid)
          .single();

        if (error) throw error;
        if (!alive) return;
        setMeIsAdmin(Boolean(data?.is_admin));
      } catch (e) {
        if (!alive) return;
        console.error(e);
        // Fail closed: no admin features if we can't confirm
        setMeIsAdmin(false);
      } finally {
        if (alive) setLoadingMe(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ------------------------------- load rows ------------------------------ */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingRows(true);
      setErr("");
      try {
        const { data, error } = await supabase
          .from("users")
          .select("id,email,full_name,is_admin,created_at,last_sign_in_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        if (!alive) return;
        setRows(data || []);
      } catch (e) {
        if (!alive) return;
        console.error(e);
        setErr(e.message || "Failed to load users.");
      } finally {
        if (alive) setLoadingRows(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------------------- invite handling --------------------------- */
  const openInvite = () => {
    setInviteMsg(null);
    setInviteEmail("");
    setInviteOpen(true);
  };

  const sendInvite = async (e) => {
    e?.preventDefault?.();
    if (!inviteEmail) return;

    setInviteSending(true);
    setInviteMsg(null);
    try {
      // IMPORTANT: this calls your Edge Function. No “configure flow” here.
      const { data, error } = await supabase.functions.invoke(
        "admin-invite-user",
        {
          body: { email: inviteEmail },
        }
      );
      if (error) throw error;

      // If your function returns a code like {status:'already_configured'} we treat it as success.
      const msg =
        data?.message ||
        data?.status ||
        "Invite sent. If the user already exists, they will receive an email.";

      setInviteMsg({ ok: true, text: String(msg) });
      // optionally refresh list after short delay
      setTimeout(async () => {
        const { data: refreshed } = await supabase
          .from("users")
          .select("id,email,full_name,is_admin,created_at,last_sign_in_at")
          .order("created_at", { ascending: false })
          .limit(200);
        setRows(refreshed || []);
      }, 600);
    } catch (e) {
      console.error(e);
      // Normalize the “Invite flow already configured” message as non-fatal
      const txt = String(e?.message || e);
      if (/already configured/i.test(txt)) {
        setInviteMsg({
          ok: true,
          text: "Invite flow already configured. You can continue inviting users.",
        });
      } else {
        setInviteMsg({ ok: false, text: txt });
      }
    } finally {
      setInviteSending(false);
    }
  };

  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q) return rows;
    const s = q.toLowerCase();
    return rows.filter(
      (r) =>
        r.email?.toLowerCase().includes(s) ||
        r.full_name?.toLowerCase().includes(s)
    );
  }, [rows, q]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-zinc-500">
            Manage team members and access.
          </p>
        </div>

        {/* Invite button only for admins */}
        {!loadingMe && meIsAdmin ? (
          <button
            onClick={openInvite}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Plus className="size-4" />
            Invite User
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-2.5 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center">
                    <Loader2 className="size-5 animate-spin inline-block mr-2" />
                    Loading users…
                  </td>
                </tr>
              ) : err ? (
                <tr>
                  <td colSpan={5} className="py-4 text-red-600">
                    {err}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-zinc-500">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr
                    key={u.id}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-2 pr-3">{u.full_name || "—"}</td>
                    <td className="py-2 pr-3">{u.email}</td>
                    <td className="py-2 pr-3">
                      {u.is_admin ? (
                        <Badge tone="blue">
                          <ShieldCheck className="size-3" />
                          Admin
                        </Badge>
                      ) : (
                        <Badge tone="zinc">
                          <Shield className="size-3" />
                          User
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {u.created_at
                        ? new Date(u.created_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {u.last_sign_in_at
                        ? new Date(u.last_sign_in_at).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------------------- Invite Modal ---------------------------- */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setInviteOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">Invite a user</div>
              <button
                className="rounded-lg p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setInviteOpen(false)}
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={sendInvite} className="mt-4 space-y-3">
              <label className="block text-sm">
                Email
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </label>

              {inviteMsg ? (
                <div
                  className={cx(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm border",
                    inviteMsg.ok
                      ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800"
                      : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-800"
                  )}
                >
                  {inviteMsg.ok ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  <span>{inviteMsg.text}</span>
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteSending}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {inviteSending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <MailPlus className="size-4" />
                      Send invite
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
