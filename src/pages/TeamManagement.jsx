// FILE: src/pages/TeamManagement.jsx
// Purpose: Manage org team members and invite new users directly from Atlas.
//
// Flow when you click "Send invite":
//  1) RPC: rpc_invite_existing_user_to_org(p_email, p_org_role)
//     -> creates/updates a row in public.team_members for THIS org/email,
//        using the inviter's org + role from team_members (never from client)
//  2) Edge Function: admin-invite-user
//     -> sends Supabase Auth invite email using service role key
//
// This works for:
//  - Existing users (already in Auth → Users)
//     -> team_members row is "active" (or your default status for existing users)
//  - Brand new emails (no account yet)
//     -> team_members.status should typically be "pending_user" or "invited"
//
// Extended: Per-user feature toggles
//  - Uses team_members.ai_recommendations_enabled boolean
//  - Only ORG OWNER / ADMIN can see and change toggles
//  - Nobody can flip their OWN toggle from this page
//
// Admin controls per member (all enforced server-side):
//  - Role change dropdown (owner/admin/member) via RPC rpc_admin_set_member_role
//  - Enable / disable user via RPC rpc_admin_set_member_status
//  - Resend invite via Edge Function admin-invite-user
//  - Remove from organization via RPC rpc_admin_delete_member
//  - All permission checks and org-scoping are enforced INSIDE those RPCs / functions

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
  Bot,
  Trash2,
} from "lucide-react";

export default function TeamManagementPage() {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLoading, setInviteLoading] = useState(false);

  const [message, setMessage] = useState(null);

  // Track which member row is being updated for AI toggle
  const [featureUpdatingId, setFeatureUpdatingId] = useState(null);

  // Track which member is being updated for role / status / resend invite / delete
  const [roleUpdatingId, setRoleUpdatingId] = useState(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [resendInviteId, setResendInviteId] = useState(null);
  const [deleteMemberId, setDeleteMemberId] = useState(null);

  // Current logged-in user (Supabase auth user_id)
  const [currentUserId, setCurrentUserId] = useState(null);

  // Load current user + team members on mount
  useEffect(() => {
    async function init() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          console.error("[TeamManagement] getUser error:", error);
        } else {
          setCurrentUserId(data?.user?.id || null);
        }
      } catch (e) {
        console.error("[TeamManagement] getUser unexpected error:", e);
      } finally {
        // Regardless of auth user fetch result, load members
        fetchMembers();
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            user_id,
            org_id,
            ai_recommendations_enabled
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

      // 1) Ensure org membership via secure RPC (org + role enforced server-side)
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

      // rpcData is a team_members row; we can look at its status if it exists
      const statusFromRpc = (rpcData?.status || "").toLowerCase();
      const orgIdFromRpc = rpcData?.org_id;

      if (!orgIdFromRpc) {
        console.error(
          "[TeamManagement] Missing org_id from rpc_invite_existing_user_to_org result:",
          rpcData
        );
        setMessage({
          type: "error",
          text:
            "Invite created, but organization ID was missing from the server response. Please contact support or try again.",
        });
        return;
      }

      // 2) Send Auth invite email via Supabase Edge Function
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "admin-invite-user",
        {
          body: {
            email,
            org_role: role,
            org_id: orgIdFromRpc,
          },
        }
      );

      if (fnError) {
        console.error(
          "[TeamManagement] admin-invite-user function error:",
          fnError
        );

        const context = fnError?.context || {};
        const msg =
          context.error ||
          context.details ||
          fnError.message ||
          "Failed to send invite email, but the user may still have been added to the org.";

        setMessage({
          type: "error",
          text: msg,
        });

        await fetchMembers();
        return;
      }

      console.log(
        "[TeamManagement] admin-invite-user function result:",
        fnData
      );

      // Friendly success message based on membership status
      if (statusFromRpc === "pending_user" || statusFromRpc === "invited") {
        setMessage({
          type: "success",
          text:
            "Invite sent. This email will appear as 'Invited' until they create their account from the invite email.",
        });
      } else {
        setMessage({
          type: "success",
          text:
            "User has been linked to this organization and an invite email was sent.",
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

  // Find the current member row for this user (in this org)
  const currentMember = members.find(
    (m) => m.user_id && currentUserId && m.user_id === currentUserId
  );
  const currentRole = (currentMember?.role || "").toLowerCase();

  // Only org OWNER or ADMIN can manage feature flags and member controls (frontend guard).
  // Backend RPCs STILL enforce all real permission checks.
  const canManageFeatures =
    currentRole === "owner" || currentRole === "admin";

  // Toggle AI Recommendations feature for a member
  async function handleToggleAiRecommendations(member, nextValue) {
    const { id, email } = member;

    // Guard: only allow if we already decided this row is toggle-able
    if (!canManageFeatures) return;
    if (member.user_id && currentUserId && member.user_id === currentUserId) {
      // No self-toggling from this page
      return;
    }

    try {
      setFeatureUpdatingId(id);

      const { error } = await supabase
        .from("team_members")
        .update({ ai_recommendations_enabled: nextValue })
        .eq("id", id);

      if (error) {
        console.error(
          "[TeamManagement] toggle ai_recommendations_enabled error:",
          error
        );
        setMessage({
          type: "error",
          text:
            error.message ||
            `Could not update AI recommendations for ${email}. Please try again.`,
        });
        return;
      }

      // On success, just refresh members (keeps UI honest with DB)
      await fetchMembers();
    } catch (e) {
      console.error(
        "[TeamManagement] handleToggleAiRecommendations unexpected error:",
        e,
        "for",
        email
      );
      setMessage({
        type: "error",
        text:
          e?.message ||
          `Unexpected error while updating AI recommendations for ${email}.`,
      });
    } finally {
      setFeatureUpdatingId(null);
    }
  }

  // Change a member's role via secure RPC
  async function handleChangeRole(member, nextRole) {
    if (!canManageFeatures) return;
    if (!nextRole || nextRole === member.role) return;

    // Never allow changing your own role from this page
    if (member.user_id && currentUserId && member.user_id === currentUserId) {
      return;
    }

    const { id, email } = member;

    try {
      setRoleUpdatingId(id);

      const { error } = await supabase.rpc("rpc_admin_set_member_role", {
        p_member_id: id,
        p_role: nextRole,
      });

      if (error) {
        console.error("[TeamManagement] rpc_admin_set_member_role error:", error);
        setMessage({
          type: "error",
          text:
            error.message ||
            `Could not change role for ${email}. Please try again.`,
        });
        return;
      }

      await fetchMembers();
      setMessage({
        type: "success",
        text: `Updated role for ${email} to ${nextRole}.`,
      });
    } catch (e) {
      console.error(
        "[TeamManagement] handleChangeRole unexpected error:",
        e,
        "for",
        email
      );
      setMessage({
        type: "error",
        text:
          e?.message ||
          `Unexpected error while changing role for ${email}.`,
      });
    } finally {
      setRoleUpdatingId(null);
    }
  }

  // Enable / disable a member via secure RPC
  async function handleToggleMemberStatus(member) {
    if (!canManageFeatures) return;

    // Never allow disabling your own account from this page
    if (member.user_id && currentUserId && member.user_id === currentUserId) {
      return;
    }

    const { id, email } = member;
    const statusNorm = (member.status || "").toLowerCase();
    const nextStatus = statusNorm === "disabled" ? "active" : "disabled";

    try {
      setStatusUpdatingId(id);

      const { error } = await supabase.rpc("rpc_admin_set_member_status", {
        p_member_id: id,
        p_status: nextStatus,
      });

      if (error) {
        console.error("[TeamManagement] rpc_admin_set_member_status error:", error);
        setMessage({
          type: "error",
          text:
            error.message ||
            `Could not update status for ${email}. Please try again.`,
        });
        return;
      }

      await fetchMembers();
      setMessage({
        type: "success",
        text:
          nextStatus === "disabled"
            ? `Disabled access for ${email}.`
            : `Re-enabled access for ${email}.`,
      });
    } catch (e) {
      console.error(
        "[TeamManagement] handleToggleMemberStatus unexpected error:",
        e,
        "for",
        email
      );
      setMessage({
        type: "error",
        text:
          e?.message ||
          `Unexpected error while updating status for ${email}.`,
      });
    } finally {
      setStatusUpdatingId(null);
    }
  }

  // Resend invite email via existing Edge Function
  async function handleResendInvite(member) {
    if (!canManageFeatures) return;

    const { id, email, org_id, role } = member;

    if (!org_id) {
      console.error(
        "[TeamManagement] Missing org_id on member while attempting resend invite:",
        member
      );
      setMessage({
        type: "error",
        text:
          "Cannot resend invite because the organization ID is missing for this member. Please contact support.",
      });
      return;
    }

    try {
      setResendInviteId(id);

      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "admin-invite-user",
        {
          body: {
            email,
            org_role: role,
            org_id,
          },
        }
      );

      if (fnError) {
        console.error(
          "[TeamManagement] admin-invite-user (resend) error:",
          fnError
        );

        const context = fnError?.context || {};
        const msg =
          context.error ||
          context.details ||
          fnError.message ||
          `Failed to resend invite email to ${email}. Please try again.`;

        setMessage({
          type: "error",
          text: msg,
        });
        return;
      }

      console.log(
        "[TeamManagement] admin-invite-user (resend) result:",
        fnData
      );

      setMessage({
        type: "success",
        text: `Invite email resent to ${email}.`,
      });
    } catch (e) {
      console.error(
        "[TeamManagement] handleResendInvite unexpected error:",
        e,
        "for",
        email
      );
      setMessage({
        type: "error",
        text:
          e?.message ||
          `Unexpected error while resending invite to ${email}.`,
      });
    } finally {
      setResendInviteId(null);
    }
  }

  // Remove member from organization via secure RPC
  async function handleRemoveFromOrganization(member) {
    if (!canManageFeatures) return;

    // Never allow removing your own membership from this page
    if (member.user_id && currentUserId && member.user_id === currentUserId) {
      return;
    }

    const { id, email } = member;

    const confirmed = window.confirm(
      `Remove ${email} from this organization?\n\nThey will lose access to this org, but their Atlas account will remain.`
    );
    if (!confirmed) return;

    try {
      setDeleteMemberId(id);

      const { error } = await supabase.rpc("rpc_admin_delete_member", {
        p_member_id: id,
      });

      if (error) {
        console.error(
          "[TeamManagement] rpc_admin_delete_member error:",
          error
        );
        setMessage({
          type: "error",
          text:
            error.message ||
            `Could not remove ${email} from this organization. Please try again.`,
        });
        return;
      }

      await fetchMembers();
      setMessage({
        type: "success",
        text: `Removed ${email} from this organization.`,
      });
    } catch (e) {
      console.error(
        "[TeamManagement] handleRemoveFromOrganization unexpected error:",
        e,
        "for",
        email
      );
      setMessage({
        type: "error",
        text:
          e?.message ||
          `Unexpected error while removing ${email} from this organization.`,
      });
    } finally {
      setDeleteMemberId(null);
    }
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
              Manage who has access to this Atlas organization, control feature
              access, and send invites directly from here.
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

        {/* Invite Form (owner/admin only on the frontend; backend still enforces) */}
        {canManageFeatures ? (
          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 md:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-sky-500" />
              <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-slate-50">
                Invite team member
              </h2>
            </div>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              Enter an email to invite them to this organization. If they
              already have an Atlas account, they&apos;ll be added immediately.
              If not, they&apos;ll get an email to set up their account and will
              appear as &quot;Invited&quot; until they sign up.
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
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 md:p-5 text-sm text-slate-500 dark:text-slate-400">
            Only organization owners or admins can invite new team members.
            Contact your admin if you need access.
          </div>
        )}

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
                    {canManageFeatures && (
                      <th className="pb-2 pr-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Bot className="w-3 h-3 text-sky-500" />
                          AI Recs
                        </span>
                      </th>
                    )}
                    {canManageFeatures && (
                      <th className="pb-2 pr-4 whitespace-nowrap">Actions</th>
                    )}
                    <th className="pb-2 pr-4">Added</th>
                  </tr>
                </thead>

                <tbody>
                  {members.map((m) => {
                    const aiEnabled = !!m.ai_recommendations_enabled;
                    const isUpdatingFeature = featureUpdatingId === m.id;
                    const isUpdatingRole = roleUpdatingId === m.id;
                    const isUpdatingStatus = statusUpdatingId === m.id;
                    const isResendingInvite = resendInviteId === m.id;
                    const isDeleting = deleteMemberId === m.id;

                    const isSelf =
                      m.user_id && currentUserId && m.user_id === currentUserId;

                    // OWNER / ADMIN can manage others, but not themselves
                    const canToggleThisRow =
                      canManageFeatures && !isSelf;

                    const statusNorm = (m.status || "").toLowerCase();
                    const isInvited =
                      statusNorm === "invited" ||
                      statusNorm === "pending_user";
                    const isDisabled = statusNorm === "disabled";

                    return (
                      <tr
                        key={m.id}
                        className="border-b border-slate-200 dark:border-slate-800"
                      >
                        <td className="py-2 pr-4">{m.email}</td>

                        {/* Role cell */}
                        <td className="py-2 pr-4 capitalize">
                          {canToggleThisRow ? (
                            <div className="inline-flex items-center gap-2">
                              <select
                                value={m.role}
                                disabled={isUpdatingRole}
                                onChange={(e) =>
                                  handleChangeRole(m, e.target.value)
                                }
                                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                              >
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                                <option value="owner">Owner</option>
                              </select>
                              {isUpdatingRole && (
                                <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                              )}
                            </div>
                          ) : (
                            <span>{m.role}</span>
                          )}
                        </td>

                        {/* Status pill */}
                        <td className="py-2 pr-4">
                          {renderStatusPill(m.status)}
                        </td>

                        {/* AI Recs toggle */}
                        {canManageFeatures && (
                          <td className="py-2 pr-4">
                            {canToggleThisRow ? (
                              <button
                                type="button"
                                disabled={isUpdatingFeature}
                                onClick={() =>
                                  handleToggleAiRecommendations(m, !aiEnabled)
                                }
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition ${
                                  aiEnabled
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/60"
                                    : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                                } ${
                                  isUpdatingFeature
                                    ? "opacity-60 cursor-wait"
                                    : ""
                                }`}
                              >
                                {isUpdatingFeature ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Bot className="w-3 h-3" />
                                )}
                                <span>{aiEnabled ? "On" : "Off"}</span>
                              </button>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border opacity-70 cursor-not-allowed ${
                                  aiEnabled
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/60"
                                    : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                                }`}
                              >
                                <Bot className="w-3 h-3" />
                                <span>{aiEnabled ? "On" : "Off"}</span>
                              </span>
                            )}
                          </td>
                        )}

                        {/* Admin actions */}
                        {canManageFeatures && (
                          <td className="py-2 pr-4">
                            {canToggleThisRow ? (
                              <div className="flex flex-wrap gap-2">
                                {/* Enable / Disable */}
                                <button
                                  type="button"
                                  disabled={isUpdatingStatus || isDeleting}
                                  onClick={() =>
                                    handleToggleMemberStatus(m)
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {isUpdatingStatus ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : null}
                                  <span>
                                    {isDisabled ? "Enable" : "Disable"}
                                  </span>
                                </button>

                                {/* Resend invite */}
                                {isInvited && (
                                  <button
                                    type="button"
                                    disabled={isResendingInvite || isDeleting}
                                    onClick={() => handleResendInvite(m)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-sky-300 text-xs text-sky-700 dark:border-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950 disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    {isResendingInvite ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : null}
                                    <span>Resend invite</span>
                                  </button>
                                )}

                                {/* Remove from organization */}
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() =>
                                    handleRemoveFromOrganization(m)
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-300 text-xs text-rose-700 dark:border-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {isDeleting ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3 h-3" />
                                  )}
                                  <span>Remove from organization</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        )}

                        <td className="py-2 pr-4">
                          {m.created_at
                            ? new Date(m.created_at).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
