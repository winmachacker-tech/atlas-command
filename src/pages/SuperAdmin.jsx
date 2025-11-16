// FILE: src/pages/SuperAdmin.jsx
// PURPOSE:
// Super Admin Panel for Atlas Command
// - Uses ONLY Supabase Edge Functions (no service keys, no RLS bypass in browser)
// - Lets a verified super admin:
//    • See all orgs (via super-admin-orgs)
//    • Select an org and see its team members (via super-admin-org-members)
//    • Toggle per-user AI feature flags like ai_recommendations_enabled (via super-admin-set-feature)
//
// SECURITY:
// - All real access control is enforced in the Edge Functions.
// - If the current user is not in public.super_admins, the functions return 403.
// - This page ALSO calls rpc_is_super_admin on mount, and shows a friendly
//   "not authorized" message if the user is not a platform super admin.

import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  Shield,
  Users,
  ActivitySquare,
  AlertTriangle,
  Loader2,
  Sparkles,
  Settings2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function fmtDate(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}

function fmtStatus(status) {
  if (!status) return "Unknown";
  return String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

function fmtPlan(plan) {
  if (!plan) return "Unassigned";
  return String(plan).toUpperCase();
}

export default function SuperAdmin() {
  // Overall auth/permission state
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState("");

  // Orgs state
  const [orgs, setOrgs] = useState([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [orgsError, setOrgsError] = useState("");

  // Selected org
  const [selectedOrgId, setSelectedOrgId] = useState(null);

  // Members state
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState("");

  // Busy state for toggling a specific member
  const [toggleBusy, setToggleBusy] = useState({}); // { [memberId]: true }

  // ------------------------------------------------------------
  // HARD GATE: Check rpc_is_super_admin on mount
  // ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function checkSuperAdmin() {
      try {
        const { data, error } = await supabase.rpc("rpc_is_super_admin");

        if (cancelled) return;

        if (error) {
          console.error("[SuperAdmin] rpc_is_super_admin error:", error);
          setAuthorized(false);
          setAuthError(
            "You are not authorized to use the Super Admin Panel. If you believe this is a mistake, contact the platform owner."
          );
        } else {
          const ok = !!data;
          setAuthorized(ok);
          if (!ok) {
            setAuthError(
              "You are not authorized to use the Super Admin Panel. If you believe this is a mistake, contact the platform owner."
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[SuperAdmin] rpc_is_super_admin exception:", err);
          setAuthorized(false);
          setAuthError(
            "There was a problem verifying your permissions. Please try again or contact the platform owner."
          );
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
        }
      }
    }

    checkSuperAdmin();

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------
  // Load all orgs once we KNOW user is authorized
  // ------------------------------------------------------------
  useEffect(() => {
    if (!authChecked || !authorized) return;

    let cancelled = false;

    async function loadOrgs() {
      setLoadingOrgs(true);
      setOrgsError("");

      const { data, error } = await supabase.functions.invoke(
        "super-admin-orgs",
        { body: {} }
      );

      if (cancelled) return;

      if (error) {
        console.error("[SuperAdmin] super-admin-orgs error:", error);
        // Double check – if backend says not authorized, lock page
        if (error.status === 403) {
          setAuthorized(false);
          setAuthError(
            "You are not authorized to use the Super Admin Panel. If you believe this is a mistake, contact the platform owner."
          );
        } else if (error.status === 401) {
          setAuthorized(false);
          setAuthError("You must be signed in to use the Super Admin Panel.");
        } else {
          setOrgsError(
            error.message || "Failed to load organizations. Please try again."
          );
        }
        setLoadingOrgs(false);
        return;
      }

      console.log("[SuperAdmin] orgs response:", data);

      const orgsArray = Array.isArray(data) ? data : data?.orgs ?? [];
      setOrgs(orgsArray);
      setLoadingOrgs(false);

      // Auto-select first org if none selected yet
      if (!selectedOrgId && orgsArray.length > 0) {
        setSelectedOrgId(orgsArray[0].id);
      }
    }

    loadOrgs();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, authorized]); // only run AFTER auth is checked & allowed

  // ------------------------------------------------------------
  // Load members when selectedOrgId changes (and user is authorized)
  // ------------------------------------------------------------
  useEffect(() => {
    if (!authorized) return;
    if (!selectedOrgId) {
      setMembers([]);
      return;
    }

    let cancelled = false;

    async function loadMembers() {
      setLoadingMembers(true);
      setMembersError("");

      const { data, error } = await supabase.functions.invoke(
        "super-admin-org-members",
        {
          body: { org_id: selectedOrgId },
        }
      );

      if (cancelled) return;

      if (error) {
        console.error(
          "[SuperAdmin] super-admin-org-members error:",
          error
        );
        if (error.status === 403) {
          setAuthorized(false);
          setAuthError(
            "You are not authorized to view team members. Super admin access required."
          );
        } else if (error.status === 401) {
          setAuthorized(false);
          setAuthError("You must be signed in to use the Super Admin Panel.");
        } else {
          setMembersError(
            error.message ||
              "Failed to load team members for this org. Please try again."
          );
        }
        setLoadingMembers(false);
        return;
      }

      console.log("[SuperAdmin] members raw response:", data);

      // Handle both shapes: array OR { members: [...] }
      const membersArray = Array.isArray(data) ? data : data?.members ?? [];

      setMembers(membersArray);
      setLoadingMembers(false);
    }

    loadMembers();

    return () => {
      cancelled = true;
    };
  }, [selectedOrgId, authorized]);

  // ------------------------------------------------------------
  // Derived selected org object
  // ------------------------------------------------------------
  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) || null,
    [orgs, selectedOrgId]
  );

  // ------------------------------------------------------------
  // Toggle AI Recommendations for a member
  // ------------------------------------------------------------
  async function handleToggleAiRecs(member) {
    const memberId = member.id;
    const current = !!member.ai_recommendations_enabled;
    const next = !current;

    // Optimistic UI: mark this row as busy
    setToggleBusy((prev) => ({ ...prev, [memberId]: true }));

    // Optimistic local update
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? { ...m, ai_recommendations_enabled: next }
          : m
      )
    );

    const { data, error } = await supabase.functions.invoke(
      "super-admin-set-feature",
      {
        body: {
          target: "user",
          team_member_id: memberId,
          feature_key: "ai_recommendations_enabled",
          value: next,
        },
      }
    );

    if (error) {
      console.error("[SuperAdmin] super-admin-set-feature error:", error);

      // Revert optimistic update on error
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? { ...m, ai_recommendations_enabled: current }
            : m
        )
      );

      // If this is a permission issue, surface clearly
      if (error.status === 403 || error.status === 401) {
        setAuthorized(false);
        setAuthError(
          "You are not authorized to change feature flags. Super admin access required."
        );
      } else {
        alert(
          error.message ||
            "Failed to update AI Recommendations flag for this user."
        );
      }
    } else {
      // Use the updated row from backend if provided
      const updated = data?.updated;
      if (updated && updated.id) {
        setMembers((prev) =>
          prev.map((m) => (m.id === updated.id ? updated : m))
        );
      }
    }

    setToggleBusy((prev) => {
      const copy = { ...prev };
      delete copy[memberId];
      return copy;
    });
  }

  // ------------------------------------------------------------
  // RENDER: While checking auth
  // ------------------------------------------------------------
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
          <span>Checking Super Admin permissions…</span>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------
  // RENDER: Not authorized view
  // ------------------------------------------------------------
  if (authChecked && !authorized) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-slate-900/80 border border-red-500/40 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-6 h-6 text-red-400" />
            <h1 className="text-xl font-semibold tracking-tight">
              Super Admin Access Required
            </h1>
          </div>
          <p className="text-sm text-slate-300 mb-3">
            This page is reserved for platform-level administrators. It allows
            viewing all organizations and toggling AI features across tenants.
          </p>
          <p className="text-sm text-slate-400">
            {authError ||
              "You are not currently authorized to access this tool. If you believe this is an error, contact the platform owner to be added as a super admin."}
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------
  // RENDER: Main layout (authorized)
  // ------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-6 flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-xs text-emerald-300">
            <Shield className="w-3.5 h-3.5" />
            <span>Platform Super Admin</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight flex itemsCenter gap-2">
            Super Admin Control Center
            <Sparkles className="w-5 h-5 text-emerald-400" />
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            View all organizations, inspect their teams, and manage AI feature
            access from a single secure console. All sensitive operations run on
            the server via Edge Functions — no secrets in the browser.
          </p>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-1 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-700/60">
            <ActivitySquare className="w-3.5 h-3.5 text-emerald-300" />
            <span>AI Feature Governance</span>
          </span>
          {orgsError && (
            <span className="inline-flex items-center gap-1 text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{orgsError}</span>
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[270px,1fr] gap-4">
        {/* Orgs list */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-300" />
              <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
                Organizations
              </span>
            </div>
            {loadingOrgs && (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            )}
          </div>

          <div className="space-y-1 overflow-y-auto max-h-[540px] pr-1">
            {orgs.length === 0 && !loadingOrgs && (
              <div className="text-xs text-slate-400 px-1 py-2">
                No organizations found.
              </div>
            )}

            {orgs.map((org) => {
              const isActive = org.id === selectedOrgId;
              return (
                <button
                  key={org.id}
                  onClick={() => setSelectedOrgId(org.id)}
                  className={cx(
                    "w-full text-left px-3 py-2 rounded-xl border text-xs mb-1 transition",
                    isActive
                      ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-50"
                      : "bg-slate-950/40 border-slate-800 text-slate-200 hover:bg-slate-900/80 hover:border-slate-700"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">
                      {org.name || "Unnamed org"}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-slate-600/60 text-slate-300">
                      {fmtPlan(org.plan)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Created {fmtDate(org.created_at)}</span>
                    <span
                      className={cx(
                        "px-1.5 py-0.5 rounded-full border text-[10px]",
                        org.status === "active"
                          ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                          : "border-slate-600 text-slate-300 bg-slate-900/80"
                      )}
                    >
                      {fmtStatus(org.status)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right side: org details + members */}
        <div className="space-y-4">
          {/* Selected org summary */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-slate-300" />
                <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
                  Org Overview
                </span>
              </div>
              {loadingMembers && (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading team…
                </span>
              )}
            </div>

            {selectedOrg ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-50">
                    {selectedOrg.name || "Unnamed org"}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    ID:{" "}
                    <span className="font-mono text-[11px] text-slate-300">
                      {selectedOrg.id}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="px-2 py-1 rounded-full border border-slate-700 bg-slate-950/60 text-slate-200">
                    Plan:{" "}
                    <span className="font-semibold">
                      {fmtPlan(selectedOrg.plan)}
                    </span>
                  </span>
                  <span
                    className={cx(
                      "px-2 py-1 rounded-full border text-slate-200",
                      selectedOrg.status === "active"
                        ? "border-emerald-500/60 bg-emerald-500/10"
                        : "border-slate-700 bg-slate-950/60"
                    )}
                  >
                    Status:{" "}
                    <span className="font-semibold">
                      {fmtStatus(selectedOrg.status)}
                    </span>
                  </span>
                  <span className="px-2 py-1 rounded-full border border-slate-700 bg-slate-950/60 text-slate-300">
                    Members:{" "}
                    <span className="font-semibold">{members.length}</span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-400">
                Select an organization from the left to view details and team
                members.
              </div>
            )}
          </div>

          {/* Members table */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-300" />
                <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
                  Team Members
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Toggle AI Recommendations per user. Future flags can be wired
                here as well.
              </span>
            </div>

            {membersError && (
              <div className="mb-3 text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{membersError}</span>
              </div>
            )}

            {(!members || members.length === 0) && !loadingMembers ? (
              <div className="text-sm text-slate-400">
                No team members found for this organization.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-slate-400">
                      <th className="py-2 pr-3 text-left font-medium">User</th>
                      <th className="py-2 px-3 text-left font-medium">Role</th>
                      <th className="py-2 px-3 text-left font-medium">
                        Status
                      </th>
                      <th className="py-2 px-3 text-left font-medium">
                        AI Recommendations
                      </th>
                      <th className="py-2 px-3 text-left font-medium">
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => {
                      const busy = !!toggleBusy[member.id];
                      const enabled = !!member.ai_recommendations_enabled;

                      return (
                        <tr
                          key={member.id}
                          className="border-b border-slate-800/60 last:border-b-0"
                        >
                          <td className="py-2 pr-3 align-middle">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-100">
                                {member.email || "Unknown"}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">
                                {member.user_id || "no user_id"}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3 align-middle">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-slate-700 bg-slate-950/60 text-[11px] text-slate-200">
                              {member.role || "member"}
                            </span>
                          </td>
                          <td className="py-2 px-3 align-middle">
                            <span
                              className={cx(
                                "inline-flex items-center px-2 py-0.5 rounded-full border text-[11px]",
                                member.status === "active"
                                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                                  : "border-slate-700 bg-slate-950/60 text-slate-300"
                              )}
                            >
                              {member.status || "unknown"}
                            </span>
                          </td>
                          <td className="py-2 px-3 align-middle">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleToggleAiRecs(member)}
                              className={cx(
                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] transition",
                                enabled
                                  ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                  : "border-slate-700 bg-slate-950/60 text-slate-300 hover:bg-slate-900/80",
                                busy && "opacity-70 cursor-wait"
                              )}
                            >
                              {busy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : enabled ? (
                                <ToggleRight className="w-3.5 h-3.5" />
                              ) : (
                                <ToggleLeft className="w-3.5 h-3.5" />
                              )}
                              <span>{enabled ? "Enabled" : "Disabled"}</span>
                            </button>
                          </td>
                          <td className="py-2 px-3 align-middle text-slate-400">
                            {fmtDate(member.created_at)}
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
    </div>
  );
}
