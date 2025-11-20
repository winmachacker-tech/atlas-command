// FILE: src/pages/DriverSettlements.jsx
// Purpose: Accounting view for driver settlements.
// - Org-scoped (uses team_members -> org_id).
// - Lists driver_settlements for the current org.
// - Shows driver name, week, gross, deductions, net, status.
// - Lets user open a settlement and see all line items.
// - Simple "Generate weekly settlement" form that calls
//   rpc_generate_driver_settlement_week(driver, week_start).
//
// Security:
// - All reads/writes are scoped by org_id.
// - Relies on existing RLS (org_id = current_org_id()).
// - Does NOT change any RLS or security rules.

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  Calendar,
  DollarSign,
  User,
  Filter,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  FileText,
  ArrowRight,
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

function formatMoney(v) {
  if (v == null || isNaN(Number(v))) return "$0.00";
  const num = Number(v);
  return num.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const STATUS_BADGE = {
  DRAFT: {
    label: "Draft",
    className:
      "bg-slate-700/40 text-slate-100 border border-slate-500/60",
  },
  REVIEW: {
    label: "In review",
    className:
      "bg-amber-500/10 text-amber-200 border border-amber-500/50",
  },
  APPROVED: {
    label: "Approved",
    className:
      "bg-emerald-500/10 text-emerald-200 border border-emerald-500/50",
  },
  PAID: {
    label: "Paid",
    className:
      "bg-emerald-600/15 text-emerald-100 border border-emerald-500/70",
  },
  VOID: {
    label: "Void",
    className: "bg-red-500/10 text-red-100 border border-red-500/60",
  },
};

/* ============================== PAGE ============================== */

export default function DriverSettlements() {
  const [userId, setUserId] = useState(null);
  const [orgId, setOrgId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");

  const [toastState, setToast] = useState(null);

  const [settlements, setSettlements] = useState([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);

  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);

  const [selectedSettlementId, setSelectedSettlementId] = useState(null);
  const [selectedLines, setSelectedLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchDriver, setSearchDriver] = useState("");

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    driver_id: "",
    week_start: "",
  });

  const [updatingStatusId, setUpdatingStatusId] = useState(null);

  /* ================== INITIAL LOAD: USER + ORG ================== */

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
          setFatalError(
            "You do not belong to an active organization. Ask your admin to add you to an org."
          );
          setLoading(false);
          return;
        }

        if (cancelled) return;
        setOrgId(member.org_id);

        await Promise.all([
          loadDrivers(member.org_id),
          loadSettlements(member.org_id),
        ]);
      } catch (err) {
        console.error("[DriverSettlements] init error:", err);
        setFatalError(
          err?.message ||
            "Something went wrong while loading settlements. Please try again."
        );
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
        setDriversLoading(true);

        const { data, error } = await supabase
          .from("drivers")
          .select(`
            id,
            org_id,
            first_name,
            last_name,
            status
          `)
          .eq("org_id", oid)
          .order("last_name", { ascending: true });

        if (error) throw error;
        setDrivers(data || []);
      } catch (err) {
        console.error("[DriverSettlements] loadDrivers error:", err);
        toast(
          setToast,
          "error",
          err?.message || "Failed to load drivers for this organization."
        );
      } finally {
        setDriversLoading(false);
      }
    },
    [orgId]
  );

  /* ==================== LOAD SETTLEMENTS ==================== */

  const loadSettlements = useCallback(
    async (orgIdParam) => {
      const oid = orgIdParam || orgId;
      if (!oid) return;

      try {
        setSettlementsLoading(true);

        const { data, error } = await supabase
          .from("driver_settlements")
          .select(
            `
              id,
              org_id,
              driver_id,
              period_type,
              period_start,
              period_end,
              gross_earnings,
              total_deductions,
              net_pay,
              status,
              created_at,
              paid_at,
              driver:drivers (
                first_name,
                last_name
              )
            `
          )
          .eq("org_id", oid)
          .order("period_start", { ascending: false })
          .order("created_at", { ascending: false });

        if (error) throw error;

        setSettlements(data || []);
      } catch (err) {
        console.error("[DriverSettlements] loadSettlements error:", err);
        toast(
          setToast,
          "error",
          err?.message || "Failed to load settlements."
        );
      } finally {
        setSettlementsLoading(false);
      }
    },
    [orgId]
  );

  /* ================= LOAD LINES FOR ONE SETTLEMENT ================ */

  async function openSettlement(id) {
    if (!id || !orgId) return;

    setSelectedSettlementId((prev) => (prev === id ? null : id));
    setSelectedLines([]);
    if (selectedSettlementId === id) {
      // just collapsed
      return;
    }

    try {
      setLinesLoading(true);

      const { data, error } = await supabase
        .from("driver_settlement_lines")
        .select(
          `
            id,
            org_id,
            settlement_id,
            line_kind,
            description,
            load_id,
            amount,
            is_deduction,
            code,
            created_at,
            load:loads (
              reference,
              origin,
              destination
            )
          `
        )
        .eq("org_id", orgId)
        .eq("settlement_id", id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setSelectedLines(data || []);
    } catch (err) {
      console.error("[DriverSettlements] openSettlement error:", err);
      toast(
        setToast,
        "error",
        err?.message || "Failed to load settlement lines."
      );
    } finally {
      setLinesLoading(false);
    }
  }

  /* ====================== FILTERED SETTLEMENTS ====================== */

  const filteredSettlements = useMemo(() => {
    return settlements.filter((s) => {
      if (statusFilter !== "ALL" && s.status !== statusFilter) return false;

      if (searchDriver) {
        const drv = s.driver;
        const name = `${drv?.first_name || ""} ${
          drv?.last_name || ""
        }`.toLowerCase();
        if (!name.includes(searchDriver.toLowerCase())) return false;
      }

      return true;
    });
  }, [settlements, statusFilter, searchDriver]);

  /* ====================== GENERATE WEEKLY ====================== */

  async function handleGenerate(e) {
    e.preventDefault();
    if (!orgId || !generateForm.driver_id || !generateForm.week_start) {
      toast(
        setToast,
        "error",
        "Select a driver and a week start date first."
      );
      return;
    }

    try {
      setGenerateLoading(true);

      const { data, error } = await supabase.rpc(
        "rpc_generate_driver_settlement_week",
        {
          p_driver_id: generateForm.driver_id,
          p_week_start: generateForm.week_start,
        }
      );

      if (error) {
        console.error(
          "[DriverSettlements] rpc_generate_driver_settlement_week error:",
          error
        );
        toast(
          setToast,
          "error",
          error.message || "Failed to generate settlement."
        );
        return;
      }

      toast(
        setToast,
        "success",
        "Settlement generated. Loading latest data…"
      );

      await loadSettlements();
      if (data) {
        // auto-expand the new one if it exists in the refreshed list
        setSelectedSettlementId(data);
        await openSettlement(data);
      }
    } catch (err) {
      console.error("[DriverSettlements] handleGenerate exception:", err);
      toast(
        setToast,
        "error",
        err?.message || "Unexpected error while generating settlement."
      );
    } finally {
      setGenerateLoading(false);
    }
  }

  /* ====================== UPDATE STATUS ====================== */

  async function updateStatus(id, nextStatus) {
    if (!id || !orgId) return;

    try {
      setUpdatingStatusId(id);

      const { data, error } = await supabase
        .from("driver_settlements")
        .update({ status: nextStatus })
        .eq("id", id)
        .eq("org_id", orgId)
        .select(
          `
            id,
            org_id,
            driver_id,
            period_type,
            period_start,
            period_end,
            gross_earnings,
            total_deductions,
            net_pay,
            status,
            created_at,
            paid_at,
            driver:drivers (
              first_name,
              last_name
            )
          `
        )
        .single();

      if (error) {
        console.error("[DriverSettlements] updateStatus error:", error);
        toast(
          setToast,
          "error",
          error.message || "Failed to update settlement status."
        );
        return;
      }

      setSettlements((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...data } : s))
      );
      toast(setToast, "success", "Status updated.");
    } catch (err) {
      console.error("[DriverSettlements] updateStatus exception:", err);
      toast(
        setToast,
        "error",
        err?.message || "Unexpected error while updating status."
      );
    } finally {
      setUpdatingStatusId(null);
    }
  }

  /* ======================== RENDER HELPERS ======================== */

  function renderStatusBadge(status) {
    const meta = STATUS_BADGE[status] || STATUS_BADGE.DRAFT;
    return (
      <span
        className={cx(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
          meta.className
        )}
      >
        {meta.label}
      </span>
    );
  }

  function getNextStatus(status) {
    if (status === "DRAFT") return "REVIEW";
    if (status === "REVIEW") return "APPROVED";
    if (status === "APPROVED") return "PAID";
    return null;
  }

  /* =========================== RENDER =========================== */

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading settlements…</span>
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
            <div className="font-semibold mb-1">
              Cannot load driver settlements
            </div>
            <div>{fatalError}</div>
          </div>
        </div>
      </div>
    );
  }

  const selectedSettlement = settlements.find(
    (s) => s.id === selectedSettlementId
  );

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">
            Driver settlements
          </h1>
          <p className="text-xs text-slate-400">
            Accounting view of weekly driver settlements. All data is
            scoped to your organization via Row Level Security.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadSettlements()}
            disabled={settlementsLoading}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
              "border-slate-700 bg-slate-900/60 hover:bg-slate-800/80",
              settlementsLoading && "opacity-70 cursor-not-allowed"
            )}
          >
            <RefreshCw
              className={cx(
                "w-3.5 h-3.5",
                settlementsLoading && "animate-spin"
              )}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Top row: Generate + Filters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Generate weekly settlement */}
        <div className="lg:col-span-2 rounded-xl border border-slate-700/80 bg-slate-950/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <div>
                <div className="text-xs font-medium text-slate-100">
                  Generate weekly settlement
                </div>
                <p className="text-[11px] text-slate-400">
                  Pick a driver and the Monday (or first day) of the
                  week. Atlas will calculate earnings based on their pay
                  model and create a draft settlement.
                </p>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleGenerate}
            className="flex flex-wrap items-end gap-3 text-xs"
          >
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-[11px] text-slate-400">Driver</label>
              <select
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                value={generateForm.driver_id}
                onChange={(e) =>
                  setGenerateForm((f) => ({
                    ...f,
                    driver_id: e.target.value,
                  }))
                }
              >
                <option value="">Select driver…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.first_name} {d.last_name}
                    {d.status === "INACTIVE" ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-[11px] text-slate-400">
                Week start date
              </label>
              <input
                type="date"
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                value={generateForm.week_start}
                onChange={(e) =>
                  setGenerateForm((f) => ({
                    ...f,
                    week_start: e.target.value,
                  }))
                }
              />
            </div>

            <button
              type="submit"
              disabled={generateLoading || !orgId}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
                "border-emerald-500/60 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
                (generateLoading || !orgId) &&
                  "opacity-60 cursor-not-allowed"
              )}
            >
              {generateLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>Generate settlement</span>
            </button>
          </form>
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <div className="text-xs font-medium text-slate-100">
              Filters
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">
                Status
              </label>
              <select
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="REVIEW">In review</option>
                <option value="APPROVED">Approved</option>
                <option value="PAID">Paid</option>
                <option value="VOID">Void</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">
                Driver name
              </label>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  className="w-full rounded-md border border-slate-700 bg-slate-900 pl-7 pr-2 py-1 text-xs text-slate-100 placeholder-slate-500"
                  placeholder="Search driver…"
                  value={searchDriver}
                  onChange={(e) => setSearchDriver(e.target.value)}
                />
              </div>
            </div>

            <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/70 mt-2">
              Note: In future, status transitions will be restricted to
              accounting roles only. For now, any org member can move a
              settlement forward.
            </p>
          </div>
        </div>
      </div>

      {/* Main table + details */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Table */}
        <div className="xl:col-span-2 rounded-xl border border-slate-800 bg-slate-950/70 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5" />
              <span>
                Settlements{" "}
                <span className="text-slate-500">
                  ({filteredSettlements.length} of {settlements.length})
                </span>
              </span>
            </div>
          </div>

          <div className="overflow-auto max-h-[480px]">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-950/90 border-b border-slate-800/80">
                <tr className="text-[11px] text-slate-400">
                  <th className="px-3 py-2 text-left">Week</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Deductions</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right w-12"></th>
                </tr>
              </thead>
              <tbody>
                {settlementsLoading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-4 text-center text-slate-400"
                    >
                      <div className="inline-flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Loading settlements…</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredSettlements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      No settlements match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredSettlements.map((s) => {
                    const isOpen = selectedSettlementId === s.id;
                    const drvName = `${s.driver?.first_name || ""} ${
                      s.driver?.last_name || ""
                    }`.trim();

                    const nextStatus = getNextStatus(s.status);

                    return (
                      <tr
                        key={s.id}
                        className={cx(
                          "border-t border-slate-800/80 hover:bg-slate-900/40",
                          isOpen && "bg-slate-900/50"
                        )}
                      >
                        {/* Week */}
                        <td className="px-3 py-1.5 align-top">
                          <div className="flex flex-col">
                            <span className="text-slate-100">
                              {formatDate(s.period_start)} –{" "}
                              {formatDate(s.period_end)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Created {formatDate(s.created_at)}
                            </span>
                          </div>
                        </td>

                        {/* Driver */}
                        <td className="px-3 py-1.5 align-top">
                          <div className="flex flex-col">
                            <span className="text-slate-100">
                              {drvName || "Unknown driver"}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ID: {s.id.slice(0, 8)}
                            </span>
                          </div>
                        </td>

                        {/* Gross */}
                        <td className="px-3 py-1.5 text-right align-top text-slate-100">
                          {formatMoney(s.gross_earnings)}
                        </td>

                        {/* Deductions */}
                        <td className="px-3 py-1.5 text-right align-top text-slate-100">
                          {formatMoney(s.total_deductions)}
                        </td>

                        {/* Net */}
                        <td className="px-3 py-1.5 text-right align-top text-emerald-200">
                          {formatMoney(s.net_pay)}
                        </td>

                        {/* Status */}
                        <td className="px-3 py-1.5 align-top">
                          <div className="flex flex-col gap-1">
                            {renderStatusBadge(s.status)}
                            {nextStatus && (
                              <button
                                onClick={() =>
                                  updateStatus(s.id, nextStatus)
                                }
                                disabled={updatingStatusId === s.id}
                                className={cx(
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                                  "border-slate-600/70 text-slate-200 hover:bg-slate-800/80",
                                  updatingStatusId === s.id &&
                                    "opacity-60 cursor-not-allowed"
                                )}
                              >
                                {updatingStatusId === s.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <ArrowRight className="w-3 h-3" />
                                )}
                                <span>Mark {nextStatus}</span>
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Expand */}
                        <td className="px-3 py-1.5 text-right align-top">
                          <button
                            onClick={() => openSettlement(s.id)}
                            className="inline-flex items-center justify-center rounded-md border border-slate-600 bg-slate-900/80 px-1.5 py-0.5 text-slate-200 hover:bg-slate-800"
                          >
                            {isOpen ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Details panel */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-300" />
            <div className="text-xs font-medium text-slate-100">
              Settlement details
            </div>
          </div>

          {!selectedSettlement ? (
            <p className="text-[11px] text-slate-500">
              Select a settlement from the table to view line items and a
              breakdown of earnings and deductions.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-slate-300" />
                    <div className="flex flex-col">
                      <span className="text-slate-100">
                        {selectedSettlement.driver?.first_name}{" "}
                        {selectedSettlement.driver?.last_name}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Week {formatDate(selectedSettlement.period_start)} –{" "}
                        {formatDate(selectedSettlement.period_end)}
                      </span>
                    </div>
                  </div>
                  {renderStatusBadge(selectedSettlement.status)}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/70 mt-2">
                  <div>
                    <div className="text-[10px] text-slate-500">
                      Gross
                    </div>
                    <div className="text-xs text-slate-100">
                      {formatMoney(selectedSettlement.gross_earnings)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">
                      Deductions
                    </div>
                    <div className="text-xs text-rose-200">
                      {formatMoney(selectedSettlement.total_deductions)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">
                      Net pay
                    </div>
                    <div className="text-xs text-emerald-200">
                      {formatMoney(selectedSettlement.net_pay)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Line items</span>
                  {linesLoading && (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Loading…</span>
                    </span>
                  )}
                </div>

                <div className="max-h-[280px] overflow-auto rounded-lg border border-slate-800 bg-slate-950/80">
                  {selectedLines.length === 0 && !linesLoading ? (
                    <div className="px-3 py-4 text-[11px] text-slate-500">
                      No line items found for this settlement.
                    </div>
                  ) : (
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-slate-950/90 border-b border-slate-800/80 text-slate-400">
                        <tr>
                          <th className="px-3 py-1.5 text-left">
                            Description
                          </th>
                          <th className="px-3 py-1.5 text-left">Load</th>
                          <th className="px-3 py-1.5 text-right">Amount</th>
                          <th className="px-3 py-1.5 text-left">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLines.map((ln) => {
                          const isDed = ln.is_deduction;
                          const loadRef =
                            ln.load?.reference ||
                            `${ln.load?.origin || ""} → ${
                              ln.load?.destination || ""
                            }`.trim() ||
                            "—";

                          return (
                            <tr
                              key={ln.id}
                              className="border-t border-slate-800/70"
                            >
                              <td className="px-3 py-1.5 text-slate-100">
                                {ln.description || "—"}
                              </td>
                              <td className="px-3 py-1.5 text-slate-300">
                                {loadRef}
                              </td>
                              <td
                                className={cx(
                                  "px-3 py-1.5 text-right",
                                  isDed
                                    ? "text-rose-200"
                                    : "text-emerald-200"
                                )}
                              >
                                {formatMoney(ln.amount)}
                              </td>
                              <td className="px-3 py-1.5 text-slate-400">
                                {ln.line_kind}
                                {ln.code ? ` · ${ln.code}` : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <p className="text-[10px] text-slate-500">
                Future steps: add PDF export + &ldquo;Send via Atlas&rdquo;
                so accounting can send approved settlements to drivers by
                email or SMS.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Toast */}
      {toastState && (
        <div className="fixed bottom-4 right-4 z-40">
          <div
            className={cx(
              "rounded-lg px-3 py-2 text-xs shadow-lg border backdrop-blur bg-slate-950/90",
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
