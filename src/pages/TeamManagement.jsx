// FILE: src/pages/TeamManagement.jsx
// Purpose: Manage org team members and invite new users directly from Atlas.
//
// Flow when you click "Send invite":
//  1) RPC: rpc_inv_invite_existing_user_to_org(p_email, p_org_role)
//     -> creates/updates a row in public.team_members for this org/email
//  2) Edge Function: admin-invite-user
//     -> sends Supabase Auth invite email using service role key
//
// This works for:
//  - Existing users (already in Auth → Users)   -> status "added"
//  - Brand new emails (no account yet)          -> status "pending_user"

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Users,
  Mail,
  UserPlus,
  Loader2,
  Shield,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export default function TeamManagementPage() {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // Load team members on mount
  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    try {
      setLoadingMembers(true);
      setMessage(null);

      const { data, error } = await supabase
        .from("team_members")
        .select(
          `
            id,
            email,
            role,
            status,
            invited_by,
            created_at,
            updated_at,
            user_id
          `
        )
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[TeamManagement] fetchMembers error:", error);
        setMessage({
          type: "error",
          text:
            error.message ||
            "Failed to load team members. Please try again or contact support.",
        });
        return;
      }

      setMembers(data || []);
    } catch (e) {
      console.error("[TeamManagement] fetchMembers unexpected error:", e);
      setMessage({
        type: "error",
        text: "Unexpected error loading team members.",
      });
    } finally {
      setLoadingMembers(false);
    }
  }

  function validateEmail(email) {
    if (!email) return false;
    const trimmed = email.trim();
    return /\S+@\S+\.\S+/.test(trimmed);
  }

  async function handleInviteSubmit(e) {
    e?.preventDefault?.();
    setMessage(null);

    const email = inviteEmail.trim().toLowerCase();
    const role = inviteRole || "member";

    if (!validateEmail(email)) {
      setMessage({
        type: "error",
        text: "Please enter a valid email address.",
      });
      return;
    }

    try {
      setInviteLoading(true);

      // 1) Ensure org membership via RPC
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "rpc_invite_existing_user_to_org",
        {
          p_email: email,
          p_org_role: role,
        }
      );

      if (rpcError) {
        console.error("[TeamManagement] RPC invite error:", rpcError);
        setMessage({
          type: "error",
          text:
            rpcError.message ||
            "Failed to add user to this organization. Please try again.",
        });
        return;
      }

      console.log(
        "[TeamManagement] rpc_invite_existing_user_to_org result:",
        rpcData
      );
      const statusFromRpc = rpcData?.status;

      // 2) Send Auth invite email via Supabase Edge Function
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "admin-invite-user",
        {
          body: { email },
        }
      );

      if (fnError) {
        console.error(
          "[TeamManagement] admin-invite-user function error:",
          fnError
        );
        setMessage({
          type: "error",
          text:
            fnError.message ||
            "Failed to send invite email, but the user may still have been added to the org.",
        });
        await fetchMembers();
        return;
      }

      console.log(
        "[TeamManagement] admin-invite-user function result:",
        fnData
      );

      // Friendly success message based on RPC status
      if (statusFromRpc === "added") {
        setMessage({
          type: "success",
          text:
            "User already has an account. They were added to this organization and an invite email was sent.",
        });
      } else if (statusFromRpc === "pending_user") {
        setMessage({
          type: "success",
          text:
            "Invite sent. This email will appear as 'Invited' until they create their account from the invite email.",
        });
      } else {
        setMessage({
          type: "success",
          text:
            "Invite processed and the user has been linked to this organization.",
        });
      }

      setInviteEmail("");
      setInviteRole("member");
      await fetchMembers();
    } catch (e) {
      console.error("[TeamManagement] handleInviteSubmit unexpected error:", e);
      setMessage({
        type: "error",
        text:
          e?.message ||
          "Unexpected error while sending the invite. Please try again.",
      });
    } finally {
      setInviteLoading(false);
    }
  }

  function renderStatusPill(status) {
    const normalized = (status || "").toLowerCase();
    let colorClasses =
      "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600";
    let label = status || "unknown";

    if (normalized === "active") {
      colorClasses =
        "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/60";
      label = "Active";
    } else if (normalized === "invited" || normalized === "pending_user") {
      colorClasses =
        "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/60";
      label = "Invited";
    } else if (normalized === "disabled") {
      colorClasses =
        "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700/60";
      label = "Disabled";
    }

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClasses}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
        {label}
      </span>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-6 h-6 text-sky-500" />
              <h1 className="text-xl md:text-2xl font-semibold text-slate-900 dark:text-slate-50">
                Team &amp; Organization
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage who has access to this Atlas organization and send invites
              directly from here.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Shield className="w-4 h-4" />
            <span>Org-scoped access via RLS</span>
          </div>
        </div>

        {/* Alert */}
        {message && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
              message.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-200"
                : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-700/60 dark:bg-rose-900/20 dark:text-rose-200"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <div>{message.text}</div>
          </div>
        )}

        {/* Invite Form */}
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 md:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-sky-500" />
            <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-slate-50">
              Invite team member
            </h2>
          </div>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
            Enter an email to invite them to this organization. If they already
            have an Atlas account, they&apos;ll be added immediately. If not,
            they&apos;ll get an email to set up their account and will appear as
            &quot;Invited&quot; until they sign up.
          </p>

          <form
            onSubmit={handleInviteSubmit}
            className="flex flex-col md:flex-row gap-3 md:items-end"
          >
            <div className="flex-1">
              <label
                htmlFor="invite-email"
                className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-slate-50 dark:bg-slate-900 dark:text-slate-50"
                  placeholder="person@company.com"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="w-full md:w-40">
              <label
                htmlFor="invite-role"
                className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Role
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={inviteLoading}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
            >
              {inviteLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Send invite
                </>
              )}
            </button>
          </form>
        </div>

        {/* Team members list */}
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 md:p-5 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-sky-500" />
            <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-slate-50">
              Team members
            </h2>
          </div>

          {loadingMembers ? (
            <div className="py-4 flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading...</span>
            </div>
          ) : members.length === 0 ? (
            <div className="py-4 text-slate-500 dark:text-slate-400 text-sm">
              No team members found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <th className="pb-2 pr-4">Email</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Added</th>
                  </tr>
                </thead>

                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-slate-200 dark:border-slate-800"
                    >
                      <td className="py-2 pr-4">{m.email}</td>
                      <td className="py-2 pr-4 capitalize">{m.role}</td>
                      <td className="py-2 pr-4">{renderStatusPill(m.status)}</td>
                      <td className="py-2 pr-4">
                        {new Date(m.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
