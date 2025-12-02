// FILE: src/pages/Drivers.jsx
// Purpose: Redesigned Drivers page with clean table view + slide-out detail panel
// Features:
// - Scannable table with compliance indicators
// - Slide-out panel for add/edit (DriverDetailPanel)
// - HOS simulation controls (kept visible)
// - Org-aware RLS-safe CRUD

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import DriverDetailPanel from "../components/DriverDetailPanel";
import {
  Plus,
  Trash2,
  RefreshCw,
  Search as SearchIcon,
  Loader2,
  AlertTriangle,
  Shuffle,
  CheckCircle,
  Clock,
  User,
  ChevronRight,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function cleanStr(v) {
  return (v ?? "").toString().trim();
}
function toast(setToast, tone, msg) {
  setToast({ tone, msg });
  setTimeout(() => setToast(null), 3500);
}

/* Format minutes -> "Xh Ym" */
function formatMinutesToHm(min) {
  if (min == null) return null;
  const total = Number(min);
  if (!Number.isFinite(total)) return null;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0 && minutes <= 0) return "0h";
  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/* Days until a date */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

/* Get expiration status for compliance badges */
function getExpirationStatus(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return { status: "unknown", color: "slate" };
  if (days < 0) return { status: "expired", color: "red" };
  if (days <= 30) return { status: "critical", color: "red" };
  if (days <= 60) return { status: "warning", color: "amber" };
  return { status: "valid", color: "emerald" };
}

/* Map DB status -> human UI label */
function getUiStatusLabel(dbStatus) {
  if (!dbStatus) return "—";
  if (dbStatus === "ACTIVE") return "AVAILABLE";
  return dbStatus;
}

/* Driver type display */
function getDriverTypeLabel(type) {
  const labels = {
    company: "Company",
    owner_op: "Owner-Op",
    lease: "Lease",
  };
  return labels[type] || type || "—";
}

/* ============================== PAGE ============================== */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export default function Drivers() {
  /* --------- base state --------- */
  const [userId, setUserId] = useState(null);
  const [orgId, setOrgId] = useState(null);

  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [toastState, setToast] = useState(null);
  const [fatalError, setFatalError] = useState("");

  /* --------- panel state --------- */
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDriver, setPanelDriver] = useState(null);
  const [panelIsNew, setPanelIsNew] = useState(false);
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelError, setPanelError] = useState("");

  /* --------- delete state --------- */
  const [deletingId, setDeletingId] = useState(null);

  /* --------- HOS simulation state --------- */
  const [hosTickMinutes, setHosTickMinutes] = useState(15);
  const [hosSimRunning, setHosSimRunning] = useState(false);

  /* --------- derive visible rows --------- */
  const visibleDrivers = useMemo(() => {
    const term = cleanStr(search).toLowerCase();
    if (!term) return drivers;
    return drivers.filter((d) => {
      const fields = [
        d.first_name,
        d.last_name,
        d.email,
        d.phone,
        d.cdl_number,
        d.license_number,
        d.status,
        d.driver_type,
      ];
      return fields.some((v) => cleanStr(v).toLowerCase().includes(term));
    });
  }, [drivers, search]);

  /* ================== INITIAL LOAD ================== */

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);

        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr) throw userErr;
        if (!user) {
          setFatalError("No authenticated user. Please log in again.");
          setLoading(false);
          return;
        }

        if (cancelled) return;
        setUserId(user.id);

        const { data: member, error: memberErr } = await supabase
          .from("team_members")
          .select("org_id, status, is_default")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (memberErr) throw memberErr;
        if (!member) {
          setFatalError("You do not belong to an active organization.");
          setLoading(false);
          return;
        }

        if (cancelled) return;
        setOrgId(member.org_id);

        await Promise.all([
          loadDrivers(member.org_id),
          loadVehicles(member.org_id),
        ]);
      } catch (err) {
        console.error("[Drivers] init error:", err);
        setFatalError(err?.message || "Something went wrong while loading drivers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ====================== LOAD DRIVERS ====================== */

  const loadDrivers = useCallback(
    async (orgIdParam) => {
      const oid = orgIdParam || orgId;
      if (!oid) return;

      try {
        if (!orgIdParam) setRefreshing(true);

        const { data, error } = await supabase
          .from("drivers")
          .select("*")
          .eq("org_id", oid)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setDrivers(data || []);
      } catch (err) {
        console.error("[Drivers] load error:", err);
        toast(setToast, "error", err?.message || "Failed to load drivers.");
      } finally {
        if (!orgIdParam) setRefreshing(false);
      }
    },
    [orgId]
  );

  /* ====================== LOAD VEHICLES ====================== */

  const loadVehicles = useCallback(async (orgIdParam) => {
    const oid = orgIdParam || orgId;
    if (!oid) return;

    try {
      // Try atlas_dummy_vehicles first (based on your FK)
      const { data, error } = await supabase
        .from("atlas_dummy_vehicles")
        .select("id, unit_number, make, model, year, vin")
        .order("unit_number", { ascending: true });

      if (error) {
        console.warn("[Drivers] vehicles load error:", error);
        return;
      }
      setVehicles(data || []);
    } catch (err) {
      console.warn("[Drivers] vehicles exception:", err);
    }
  }, [orgId]);

  /* ====================== PANEL HANDLERS ====================== */

  function openNewDriverPanel() {
    setPanelDriver(null);
    setPanelIsNew(true);
    setPanelError("");
    setPanelOpen(true);
  }

  function openEditDriverPanel(driver) {
    setPanelDriver(driver);
    setPanelIsNew(false);
    setPanelError("");
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setPanelDriver(null);
    setPanelIsNew(false);
    setPanelError("");
  }

  async function handlePanelSave(payload) {
    try {
      setPanelSaving(true);
      setPanelError("");

      if (!userId || !orgId) {
        setPanelError("Missing user/org context. Try refreshing the page.");
        return;
      }

      // Validate required fields
      if (!cleanStr(payload.last_name)) {
        setPanelError("Last name is required.");
        return;
      }

      if (panelIsNew) {
        // CREATE
        const insertPayload = {
          ...payload,
          org_id: orgId,
          created_by: userId,
          status: "ACTIVE",
        };

        const { data, error } = await supabase
          .from("drivers")
          .insert([insertPayload])
          .select("*")
          .single();

        if (error) {
          console.error("[Drivers] create error:", error);
          setPanelError(error.message || "Failed to create driver.");
          return;
        }

        setDrivers((prev) => [data, ...prev]);
        toast(setToast, "success", "Driver created successfully.");
      } else {
        // UPDATE
        const { data, error } = await supabase
          .from("drivers")
          .update(payload)
          .eq("id", panelDriver.id)
          .eq("org_id", orgId)
          .select("*")
          .single();

        if (error) {
          console.error("[Drivers] update error:", error);
          setPanelError(error.message || "Failed to update driver.");
          return;
        }

        setDrivers((prev) =>
          prev.map((d) => (d.id === panelDriver.id ? { ...d, ...data } : d))
        );
        toast(setToast, "success", "Driver updated successfully.");
      }

      closePanel();
    } catch (err) {
      console.error("[Drivers] save exception:", err);
      setPanelError(err?.message || "Unexpected error while saving.");
    } finally {
      setPanelSaving(false);
    }
  }

  /* ====================== DELETE DRIVER ====================== */

  async function deleteDriver(e, id) {
    e.stopPropagation();
    if (!id) return;
    if (!window.confirm("Delete this driver? This cannot be undone.")) return;

    try {
      setDeletingId(id);
      const { error } = await supabase
        .from("drivers")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId);

      if (error) {
        console.error("[Drivers] delete error:", error);
        toast(setToast, "error", error.message || "Delete failed.");
        return;
      }

      setDrivers((prev) => prev.filter((d) => d.id !== id));
      toast(setToast, "success", "Driver deleted.");
    } catch (err) {
      console.error("[Drivers] delete exception:", err);
      toast(setToast, "error", err?.message || "Unexpected error while deleting.");
    } finally {
      setDeletingId(null);
    }
  }

  /* ====================== HOS SIM HELPERS ====================== */

  async function callHosSimFunction(endpoint, body = {}) {
    if (!SUPABASE_URL) {
      toast(setToast, "error", "Missing VITE_SUPABASE_URL.");
      return;
    }

    try {
      setHosSimRunning(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("No active auth session.");
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body || {}),
      });

      const payload = res.headers.get("content-type")?.includes("application/json")
        ? await res.json().catch(() => null)
        : null;

      if (!res.ok) {
        throw new Error(payload?.error || `Edge function error (${res.status})`);
      }

      await loadDrivers();

      if (endpoint === "hos-sim-tick") {
        toast(setToast, "success", `Advanced HOS by ${body.tick_minutes || 15} minutes.`);
      } else if (endpoint === "hos-sim-reset") {
        toast(setToast, "success", "Reset HOS for all drivers (fresh day).");
      } else if (endpoint === "hos-sim-randomize") {
        toast(setToast, "success", "Randomized fleet HOS.");
      }
    } catch (err) {
      console.error("[Drivers] HOS sim error:", err);
      toast(setToast, "error", err?.message || "HOS simulation failed.");
    } finally {
      setHosSimRunning(false);
    }
  }

  /* =========================== RENDER =========================== */

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading drivers…</span>
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 flex items-start gap-3 text-sm text-red-100">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <div className="font-semibold mb-1">Cannot load drivers</div>
            <div>{fatalError}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Drivers</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage your fleet drivers, compliance, and pay settings
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadDrivers()}
            disabled={refreshing}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
              "border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800/80",
              refreshing && "opacity-70 cursor-not-allowed"
            )}
          >
            <RefreshCw className={cx("w-3.5 h-3.5", refreshing && "animate-spin")} />
            <span>Refresh</span>
          </button>

          <button
            onClick={openNewDriverPanel}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
              "border-emerald-500/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
            )}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Driver</span>
          </button>
        </div>
      </div>

      {/* HOS Simulation Panel */}
      <div className="rounded-xl border border-slate-700/80 bg-slate-950/80 px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-emerald-400" />
            <div>
              <span className="text-xs font-medium text-slate-100">HOS Simulation</span>
              <span className="text-[10px] text-slate-500 ml-2">(Demo only)</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Tick size buttons */}
            {[5, 15, 30, 60].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => setHosTickMinutes(min)}
                className={cx(
                  "rounded-full px-2.5 py-1 text-[10px] border transition",
                  hosTickMinutes === min
                    ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-100"
                    : "border-slate-700 bg-slate-900/80 text-slate-300 hover:bg-slate-800"
                )}
              >
                +{min}m
              </button>
            ))}

            <button
              onClick={() => callHosSimFunction("hos-sim-tick", { tick_minutes: hosTickMinutes })}
              disabled={hosSimRunning}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-medium",
                "border-emerald-500/60 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
                hosSimRunning && "opacity-60 cursor-not-allowed"
              )}
            >
              {hosSimRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              <span>Advance</span>
            </button>

            <button
              onClick={() => callHosSimFunction("hos-sim-reset")}
              disabled={hosSimRunning}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-medium",
                "border-slate-500/70 bg-slate-900/80 text-slate-200 hover:bg-slate-800",
                hosSimRunning && "opacity-60 cursor-not-allowed"
              )}
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reset</span>
            </button>

            <button
              onClick={() => callHosSimFunction("hos-sim-randomize")}
              disabled={hosSimRunning}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-medium",
                "border-purple-500/70 bg-purple-500/10 text-purple-100 hover:bg-purple-500/20",
                hosSimRunning && "opacity-60 cursor-not-allowed"
              )}
            >
              <Shuffle className="w-3 h-3" />
              <span>Randomize</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="w-full rounded-lg border border-slate-700 bg-slate-950/70 pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            placeholder="Search drivers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-slate-500">
          {visibleDrivers.length} of {drivers.length} drivers
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-950/70">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-950/90 border-b border-slate-800/80">
            <tr className="text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 text-left font-medium">Driver</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Contact</th>
              <th className="px-4 py-3 text-left font-medium">Compliance</th>
              <th className="px-4 py-3 text-left font-medium">HOS</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium w-20"></th>
            </tr>
          </thead>
          <tbody>
            {visibleDrivers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <div>No drivers found</div>
                  <button
                    onClick={openNewDriverPanel}
                    className="mt-2 text-emerald-400 hover:text-emerald-300 text-xs"
                  >
                    Add your first driver →
                  </button>
                </td>
              </tr>
            ) : (
              visibleDrivers.map((row) => {
                const cdlExp = getExpirationStatus(row.cdl_exp || row.license_expiry);
                const medExp = getExpirationStatus(row.med_exp || row.med_card_expiry);
                const hasComplianceIssue =
                  cdlExp.status === "expired" ||
                  cdlExp.status === "critical" ||
                  medExp.status === "expired" ||
                  medExp.status === "critical";

                const uiStatus = getUiStatusLabel(row.status);
                const isAssigned = row.status === "ASSIGNED";

                const drive = formatMinutesToHm(row.hos_drive_remaining_min);
                const shift = formatMinutesToHm(row.hos_shift_remaining_min);

                return (
                  <tr
                    key={row.id}
                    onClick={() => openEditDriverPanel(row)}
                    className="border-t border-slate-800/80 hover:bg-slate-900/60 cursor-pointer transition"
                  >
                    {/* DRIVER */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 text-xs font-medium">
                          {(row.first_name?.[0] || "").toUpperCase()}
                          {(row.last_name?.[0] || "").toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-slate-100">
                            {row.first_name} {row.last_name}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {row.cdl_number || row.license_number || "No CDL"}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* TYPE */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-300">
                        {getDriverTypeLabel(row.driver_type)}
                      </span>
                    </td>

                    {/* CONTACT */}
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-300">{row.phone || "—"}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[150px]">
                        {row.email || ""}
                      </div>
                    </td>

                    {/* COMPLIANCE */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* CDL indicator */}
                        <div
                          className={cx(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                            cdlExp.color === "red" && "border-red-500/60 bg-red-500/10 text-red-200",
                            cdlExp.color === "amber" && "border-amber-500/60 bg-amber-500/10 text-amber-200",
                            cdlExp.color === "emerald" && "border-emerald-500/60 bg-emerald-500/10 text-emerald-200",
                            cdlExp.color === "slate" && "border-slate-600 bg-slate-800/50 text-slate-400"
                          )}
                          title={`CDL: ${row.cdl_exp || row.license_expiry || "Not set"}`}
                        >
                          {cdlExp.status === "valid" ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : cdlExp.status === "unknown" ? null : (
                            <AlertTriangle className="w-3 h-3" />
                          )}
                          CDL
                        </div>

                        {/* Med card indicator */}
                        <div
                          className={cx(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                            medExp.color === "red" && "border-red-500/60 bg-red-500/10 text-red-200",
                            medExp.color === "amber" && "border-amber-500/60 bg-amber-500/10 text-amber-200",
                            medExp.color === "emerald" && "border-emerald-500/60 bg-emerald-500/10 text-emerald-200",
                            medExp.color === "slate" && "border-slate-600 bg-slate-800/50 text-slate-400"
                          )}
                          title={`Med Card: ${row.med_exp || row.med_card_expiry || "Not set"}`}
                        >
                          {medExp.status === "valid" ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : medExp.status === "unknown" ? null : (
                            <AlertTriangle className="w-3 h-3" />
                          )}
                          Med
                        </div>

                        {/* Endorsements */}
                        {row.endorsements && row.endorsements.length > 0 && (
                          <div className="text-[10px] text-slate-400">
                            {row.endorsements.join(", ")}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* HOS */}
                    <td className="px-4 py-3">
                      {row.hos_status ? (
                        <div className="space-y-0.5">
                          <span
                            className={cx(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
                              row.hos_status === "DRIVING" && "border-emerald-500/60 bg-emerald-500/10 text-emerald-100",
                              row.hos_status === "ON_DUTY" && "border-amber-500/60 bg-amber-500/10 text-amber-100",
                              (row.hos_status === "OFF_DUTY" || row.hos_status === "SLEEPER") &&
                                "border-slate-500/60 bg-slate-700/30 text-slate-200"
                            )}
                          >
                            {row.hos_status}
                          </span>
                          <div className="text-[10px] text-slate-400">
                            {drive && `D: ${drive}`}
                            {drive && shift && " · "}
                            {shift && `S: ${shift}`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">No HOS</span>
                      )}
                    </td>

                    {/* STATUS */}
                    <td className="px-4 py-3">
                      <span
                        className={cx(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium border",
                          isAssigned
                            ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/60"
                            : "bg-slate-700/30 text-slate-200 border-slate-500/40"
                        )}
                      >
                        {uiStatus}
                      </span>
                    </td>

                    {/* ACTIONS */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => deleteDriver(e, row.id)}
                          disabled={deletingId === row.id}
                          className={cx(
                            "inline-flex items-center justify-center rounded-md p-1.5 transition",
                            "text-slate-400 hover:text-red-300 hover:bg-red-500/10",
                            deletingId === row.id && "opacity-60 cursor-not-allowed"
                          )}
                          title="Delete driver"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Panel */}
      {panelOpen && (
        <DriverDetailPanel
          driver={panelDriver}
          isNew={panelIsNew}
          onClose={closePanel}
          onSave={handlePanelSave}
          saving={panelSaving}
          error={panelError}
          vehicles={vehicles}
        />
      )}

      {/* Toast */}
      {toastState && (
        <div className="fixed bottom-4 right-4 z-50">
          <div
            className={cx(
              "rounded-lg px-4 py-2.5 text-sm shadow-lg border backdrop-blur bg-slate-950/95",
              toastState.tone === "error"
                ? "border-red-500/60 text-red-100"
                : "border-emerald-500/60 text-emerald-100"
            )}
          >
            {toastState.msg}
          </div>
        </div>
      )}
    </div>
  );
}