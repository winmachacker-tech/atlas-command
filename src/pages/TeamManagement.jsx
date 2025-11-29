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
// Extended: Org-level feature flags
//  - Reads from public.feature_flags (feature catalog)
//  - Reads/writes public.org_features (per-org enabled/disabled)
//  - Only ORG OWNER / ADMIN can change switches on this page
//  - RLS and current_org_id() still enforce org isolation on the backend
//
// Extended: Org switcher pill (top-right snapshot)
//  - Reads current org via public.current_org_id()
//  - Loads all orgs (RLS-scoped) from public.orgs
//  - Calls rpc_set_active_org(p_org_id) when user picks a different org
//  - Backend enforces that user must belong to that org or be a super admin

import { useEffect, useMemo, useRef, useState } from "react";
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
  Building2,
  ChevronDown,
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

  // Current logged-in user (Supabase auth user_id + email)
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserEmail, setCurrentUserEmail] = useState(null);

  // Current org_id (derived from team_members rows for this org)
  const [orgId, setOrgId] = useState(null);

  // Org-level feature flag data
  const [featureFlags, setFeatureFlags] = useState([]); // from feature_flags
  const [orgFeatures, setOrgFeatures] = useState([]); // from org_features for this org
  const [orgFeaturesLoading, setOrgFeaturesLoading] = useState(false);
  const [orgFeatureSavingKey, setOrgFeatureSavingKey] = useState(null);

  // Collapsible state
  const [orgFeaturesCollapsed, setOrgFeaturesCollapsed] = useState(false);
  const [membersCollapsed, setMembersCollapsed] = useState(false);

  // -------- Org switcher state (for the pill at the top) --------
  const [orgs, setOrgs] = useState([]); // all orgs this user can see (RLS-backed)
  const [currentOrgId, setCurrentOrgId] = useState(null); // from current_org_id()
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgSwitchingId, setOrgSwitchingId] = useState(null);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const orgDropdownRef = useRef(null);

  // -------------------------------------------------------------------
  // Load current user, members, and org list on mount
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          console.error("[TeamManagement] getUser error:", error);
        } else if (!cancelled) {
          const user = data?.user;
          setCurrentUserId(user?.id || null);
          setCurrentUserEmail(user?.email || null);
        }
      } catch (e) {
        console.error("[TeamManagement] getUser unexpected error:", e);
      } finally {
        if (!cancelled) {
          fetchMembers();
          fetchOrgs();
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
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

      // Derive org_id (all rows are scoped to same org by RLS)
      if (data && data.length > 0 && !orgId) {
        setOrgId(data[0].org_id || null);
      }
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

  // -------------------------------------------------------------------
  // Load org list + current org id for the org switcher pill
  // -------------------------------------------------------------------
  async function fetchOrgs() {
    try {
      setOrgsLoading(true);

      // 1) Ask the backend which org is currently active for this user
      const { data: activeOrgId, error: activeErr } = await supabase.rpc(
        "current_org_id",
        {}
      );

      if (activeErr) {
        console.error(
          "[TeamManagement] fetchOrgs current_org_id error:",
          activeErr
        );
      } else {
        setCurrentOrgId(activeOrgId || null);
      }

      // 2) Load all orgs the user can see (RLS handles scoping).
      // We select "*" so we get any billing fields the Stripe webhook writes
      // (billing_plan, billing_status, etc.) without guessing column names.
      const { data: orgRows, error: orgErr } = await supabase
        .from("orgs")
        .select("*")
        .order("name", { ascending: true });

      if (orgErr) {
        console.error("[TeamManagement] fetchOrgs orgs error:", orgErr);
        return;
      }

      setOrgs(orgRows || []);
    } catch (e) {
      console.error("[TeamManagement] fetchOrgs unexpected error:", e);
    } finally {
      setOrgsLoading(false);
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (!orgDropdownRef.current) return;
      if (!orgDropdownRef.current.contains(e.target)) {
        setOrgDropdownOpen(false);
      }
    }

    if (orgDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [orgDropdownOpen]);

  const currentOrg = useMemo(
    () => orgs.find((o) => o.id === currentOrgId) || null,
    [orgs, currentOrgId]
  );

  // Only Mark's main account should ever see the full org list.
  // Everyone else is restricted to their CURRENT org only in this UI.
  const isMarkPlatformOwner = useMemo(() => {
    if (!currentUserEmail) return false;
    return currentUserEmail.toLowerCase() === "mtishkun@hotmail.com";
  }, [currentUserEmail]);

  const displayOrgs = useMemo(() => {
    // Mark (platform owner) keeps the full global list for admin work
    if (isMarkPlatformOwner) {
      return orgs || [];
    }

    // For all other users, only show their CURRENT org in the UI,
    // even if the backend returns more rows.
    if (!currentOrgId) {
      return currentOrg ? [currentOrg] : [];
    }
    return (orgs || []).filter((o) => o.id === currentOrgId);
  }, [isMarkPlatformOwner, orgs, currentOrgId, currentOrg]);

  // Human-friendly plan label using Stripe-driven fields on the org row.
  const planDisplay = useMemo(() => {
    if (!currentOrg) {
      return orgsLoading ? "Loading…" : "Unknown";
    }

    // Try common plan fields you may have from the Stripe webhook.
    const rawPlan =
      currentOrg.billing_plan ||
      currentOrg.plan_name ||
      currentOrg.plan ||
      currentOrg.tier ||
      currentOrg.subscription_plan ||
      null;

    // Try common status fields (Stripe subscription status).
    const rawStatus =
      (currentOrg.billing_status ||
        currentOrg.subscription_status ||
        "") + "";
    const status = rawStatus.toLowerCase();

    const prettyStatus = (() => {
      if (!status) return "";
      if (status === "trialing") return "Trial";
      if (status === "active") return "Active";
      if (status === "past_due") return "Past due";
      if (status === "canceled" || status === "cancelled") return "Canceled";
      if (status === "incomplete" || status === "incomplete_expired")
        return "Incomplete";
      if (status === "unpaid") return "Unpaid";
      return status.charAt(0).toUpperCase() + status.slice(1);
    })();

    if (rawPlan) {
      // If we know the plan and the status is something other than "Active",
      // show both. Example: "Growth (Trial)" or "Starter (Past due)".
      if (prettyStatus && prettyStatus !== "Active") {
        return `${rawPlan} (${prettyStatus})`;
      }
      return rawPlan;
    }

    // No explicit plan, but we know the status (e.g., trialing).
    if (prettyStatus) {
      return prettyStatus;
    }

    // Nothing from Stripe yet.
    return "Unknown";
  }, [currentOrg, orgsLoading]);

  const membersCount = members.length || 0;

  async function handleSwitchOrg(targetOrgId) {
    // If user is not Mark, don't allow switching via this UI at all.
    if (!isMarkPlatformOwner) {
      setOrgDropdownOpen(false);
      return;
    }

    if (!targetOrgId || targetOrgId === currentOrgId) {
      setOrgDropdownOpen(false);
      return;
    }

    try {
      setOrgSwitchingId(targetOrgId);
      setMessage(null);

      // Use secure backend RPC that checks membership and updates user_active_org
      const { data, error } = await supabase.rpc("rpc_set_active_org", {
        p_org_id: targetOrgId,
      });

      if (error) {
        console.error("[TeamManagement] rpc_set_active_org error:", error);
        setMessage({
          type: "error",
          text:
            error.message ||
            "Could not switch organizations. You may not have access to that org.",
        });
        return;
      }

      // rpc_set_active_org returns a table (org_id uuid)
      const newOrgId =
        Array.isArray(data) && data.length > 0 && data[0]?.org_id
          ? data[0].org_id
          : targetOrgId;

      // Update local state then hard-refresh so RLS data (loads, drivers, etc.)
      // is re-queried under the new org.
      setCurrentOrgId(newOrgId);
      setOrgDropdownOpen(false);

      // Full reload keeps everything honest with RLS + caches.
      window.location.reload();
    } catch (e) {
      console.error("[TeamManagement] handleSwitchOrg unexpected error:", e);
      setMessage({
        type: "error",
        text:
          e?.message ||
          "Unexpected error while switching organizations. Please try again.",
      });
    } finally {
      setOrgSwitchingId(null);
    }
  }

  // -------------------------------------------------------------------
  // Org-level features
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!orgId) return;
    fetchOrgFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function fetchOrgFeatures() {
    try {
      setOrgFeaturesLoading(true);

      // 1) Load the feature catalog (global)
      const { data: flags, error: flagsError } = await supabase
        .from("feature_flags")
        .select("key, name, description, min_plan")
        .order("name", { ascending: true });

      if (flagsError) {
        console.error(
          "[TeamManagement] fetchOrgFeatures feature_flags error:",
          flagsError
        );
        setOrgFeaturesLoading(false);
        return;
      }

      // 2) Load this org's overrides
      const { data: orgRows, error: orgError } = await supabase
        .from("org_features")
        .select("feature_key, enabled, settings")
        .eq("org_id", orgId);

      if (orgError) {
        console.error(
          "[TeamManagement] fetchOrgFeatures org_features error:",
          orgError
        );
        setOrgFeaturesLoading(false);
        return;
      }

      setFeatureFlags(flags || []);
      setOrgFeatures(orgRows || []);
    } catch (e) {
      console.error("[TeamManagement] fetchOrgFeatures unexpected error:", e);
    } finally {
      setOrgFeaturesLoading(false);
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

  // Merge global feature catalog + org overrides into one array for the UI
  const mergedOrgFeatures = useMemo(() => {
    if (!featureFlags || featureFlags.length === 0) return [];
    return featureFlags.map((flag) => {
      const override = orgFeatures.find(
        (of) => of.feature_key === flag.key
      );
      const enabled = override?.enabled ?? true; // default to enabled if no row yet
      return {
        key: flag.key,
        name: flag.name,
        description: flag.description,
        min_plan: flag.min_plan,
        enabled,
      };
    });
  }, [featureFlags, orgFeatures]);

  // Toggle AI Recommendations feature for a member
  async function handleToggleAiRecommendations(member, nextValue) {
    const { id, email } = member;

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

  // Toggle an org-level feature flag via org_features
  async function handleToggleOrgFeature(featureKey, nextEnabled) {
    if (!canManageFeatures) return;
    if (!orgId) return;

    try {
      setOrgFeatureSavingKey(featureKey);

      const { error } = await supabase
        .from("org_features")
        .upsert(
          {
            org_id: orgId,
            feature_key: featureKey,
            enabled: nextEnabled,
          },
          {
            onConflict: "org_id,feature_key",
          }
        );

      if (error) {
        console.error(
          "[TeamManagement] handleToggleOrgFeature upsert error:",
          error
        );
        setMessage({
          type: "error",
          text:
            error.message ||
            "Could not update this feature toggle. Please try again.",
        });
        return;
      }

      await fetchOrgFeatures();
      setMessage({
        type: "success",
        text: "Feature settings updated for this organization.",
      });
    } catch (e) {
      console.error(
        "[TeamManagement] handleToggleOrgFeature unexpected error:",
        e
      );
      setMessage({
        type: "error",
        text:
          e?.message ||
          "Unexpected error while updating feature settings. Please try again.",
      });
    } finally {
      setOrgFeatureSavingKey(null);
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
        console.error(
          "[TeamManagement] rpc_admin_set_member_status error:",
          error
        );
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

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top header: Team card + Org snapshot with switcher pill */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.7fr),minmax(0,1.1fr)]">
          {/* Team & Organization summary */}
          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 md:p-5 flex items-start gap-3">
            <div className="mt-1">
              <Users className="w-6 h-6 text-emerald-500" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg md:text-xl font-semibold text-slate-900 dark:text-slate-50">
                  Team &amp; Organization
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700/60">
                  Admin controls
                </span>
              </div>
              {/* Increased contrast here */}
              <p className="text-xs md:text-sm text-slate-700 dark:text-slate-200 max-w-xl">
                Manage members and features for{" "}
                <span className="font-medium text-slate-900 dark:text-slate-50">
                  this organization
                </span>
                . To manage another org, use the org switcher on the right.
              </p>
              {/* Increased contrast here */}
              <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <Shield className="w-3.5 h-3.5" />
                <span>Access is enforced per org with Row Level Security.</span>
              </div>
            </div>
          </div>

          {/* Org snapshot + org switcher pill */}
          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 md:p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-500" />
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Org snapshot
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                RLS enforced per org
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* Org selector pill */}
              <div className="col-span-2" ref={orgDropdownRef}>
                <div className="text-[10px] mb-1 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Org
                </div>
                <button
                  type="button"
                  onClick={() =>
                    isMarkPlatformOwner &&
                    displayOrgs.length > 1 &&
                    !orgsLoading
                      ? setOrgDropdownOpen((s) => !s)
                      : null
                  }
                  disabled={
                    orgsLoading ||
                    displayOrgs.length <= 1 ||
                    !isMarkPlatformOwner
                  }
                  className={`w-full inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-full border text-xs ${
                    orgsLoading ||
                    displayOrgs.length <= 1 ||
                    !isMarkPlatformOwner
                      ? "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 cursor-default"
                      : "bg-slate-900 text-slate-50 border-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:border-slate-50 hover:opacity-90 transition"
                  }`}
                >
                  <span className="truncate">
                    {currentOrg?.name ||
                      (orgsLoading ? "Loading…" : "Current org")}
                  </span>
                  {orgsLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : isMarkPlatformOwner && displayOrgs.length > 1 ? (
                    <ChevronDown
                      className={`w-3 h-3 ${
                        orgDropdownOpen ? "rotate-180" : ""
                      } transition-transform`}
                    />
                  ) : null}
                </button>

                {/* Dropdown list of orgs (only ever for Mark) */}
                {orgDropdownOpen &&
                  isMarkPlatformOwner &&
                  displayOrgs.length > 1 && (
                    <div className="mt-2 w-full max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg text-xs z-20 relative">
                      {displayOrgs.map((org) => {
                        const isActive = org.id === currentOrgId;
                        const isSwitching = orgSwitchingId === org.id;
                        return (
                          <button
                            key={org.id}
                            type="button"
                            disabled={isSwitching}
                            onClick={() => handleSwitchOrg(org.id)}
                            className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${
                              isActive
                                ? "bg-slate-100 dark:bg-slate-800/70 font-medium"
                                : ""
                            }`}
                          >
                            <span className="truncate">
                              {org.name || "Unnamed org"}
                            </span>
                            <div className="flex items-center gap-1">
                              {isSwitching && (
                                <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                              )}
                              {isActive && !isSwitching && (
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>

              {/* Plan + members summary */}
              <div className="flex flex-col gap-2 text-[11px]">
                <div>
                  <div className="text-[10px] mb-1 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Plan
                  </div>
                  <div className="inline-flex items-center px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200">
                    <span className="truncate">{planDisplay}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] mb-1 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Members
                  </div>
                  <div className="inline-flex items-center px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200">
                    <span>{membersCount}</span>
                  </div>
                </div>
              </div>
            </div>

            {isMarkPlatformOwner && displayOrgs.length > 1 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Switch orgs from here. You’ll only see orgs you belong to, and
                all access is still enforced by backend permissions.
              </p>
            )}
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

        {/* Org-level Feature Flags (owner/admin only) */}
        {canManageFeatures && (
          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 md:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-sky-500" />
                <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-slate-50">
                  Org features &amp; AI access
                </h2>
              </div>
              <button
                type="button"
                onClick={() =>
                  setOrgFeaturesCollapsed((collapsed) => !collapsed)
                }
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <span>{orgFeaturesCollapsed ? "Expand" : "Collapse"}</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${
                    orgFeaturesCollapsed ? "-rotate-90" : "rotate-0"
                  }`}
                />
              </button>
            </div>

            {!orgFeaturesCollapsed && (
              <>
                {orgFeaturesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading features…</span>
                  </div>
                ) : mergedOrgFeatures.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No org-level features have been configured yet.
                  </p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {mergedOrgFeatures.map((f) => {
                      const isSaving = orgFeatureSavingKey === f.key;
                      return (
                        <div
                          key={f.key}
                          className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                                {f.name || f.key}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-900/5 dark:bg-slate-50/5 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60">
                                Min plan: {f.min_plan || "FREE"}
                              </span>
                            </div>
                            {f.description && (
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                                {f.description}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              handleToggleOrgFeature(f.key, !f.enabled)
                            }
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition shrink-0 ${
                              f.enabled
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/60"
                                : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                            } ${isSaving ? "opacity-60 cursor-wait" : ""}`}
                          >
                            {isSaving ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Bot className="w-3 h-3" />
                            )}
                            <span>{f.enabled ? "On" : "Off"}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
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
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 md:p-5 mt-2">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-sky-500" />
              <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-slate-50">
                Team members
              </h2>
            </div>
            <button
              type="button"
              onClick={() =>
                setMembersCollapsed((collapsed) => !collapsed)
              }
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              <span>{membersCollapsed ? "Expand" : "Collapse"}</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${
                  membersCollapsed ? "-rotate-90" : "rotate-0"
                }`}
              />
            </button>
          </div>

          {!membersCollapsed && (
            <>
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
                          <th className="pb-2 pr-4 whitespace-nowrap">
                            Actions
                          </th>
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
                          m.user_id &&
                          currentUserId &&
                          m.user_id === currentUserId;

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
                                      handleToggleAiRecommendations(
                                        m,
                                        !aiEnabled
                                      )
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
                                      disabled={
                                        isUpdatingStatus || isDeleting
                                      }
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
                                        disabled={
                                          isResendingInvite || isDeleting
                                        }
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
                                      <span>Remove from org</span>
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    —
                                  </span>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
