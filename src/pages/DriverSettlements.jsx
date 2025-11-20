// FILE: src/pages/DriverSettlements.jsx
// Purpose:
// - Accounting view of weekly driver settlements
// - Generate weekly settlement via rpc_generate_driver_settlement_week
// - List settlements for the org with filters
// - Show settlement details + line items
// - Delete settlement button (org-scoped, RLS-safe)
// - Show settlement ID + week range + created-at badges

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  CalendarDays,
  DollarSign,
  Filter,
  Loader2,
  Trash2,
  User,
  Hash,
  Clock,
} from "lucide-react";

/* ------------------------ tiny helpers ------------------------ */

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtMoney(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function toast(setter, tone, msg) {
  setter({ tone, msg });
  setTimeout(() => setter(null), 4000);
}

/* ======================= MAIN COMPONENT ======================= */

export default function DriverSettlements() {
  const [userId, setUserId] = useState(null);
  const [orgId, setOrgId] = useState(null);

  const [drivers, setDrivers] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [lines, setLines] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // generate form
  const [genDriverId, setGenDriverId] = useState("");
  const [genWeekStart, setGenWeekStart] = useState("");
  const [generating, setGenerating] = useState(false);

  // filters / selection
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchDriver, setSearchDriver] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // delete state
  const [deleting, setDeleting] = useState(false);

  // toast
  const [toastState, setToastState] = useState(null);

  /* ----------------- derive selected settlement ----------------- */

  const selectedSettlement = useMemo(
    () => settlements.find((s) => s.id === selectedId) || null,
    [settlements, selectedId]
  );

  const visibleSettlements = useMemo(() => {
    return settlements.filter((s) => {
      if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
      if (searchDriver.trim()) {
        const t = searchDriver.trim().toLowerCase();
        const name = `${s.driver_first_name || ""} ${
          s.driver_last_name || ""
        }`.toLowerCase();
        if (!name.includes(t)) return false;
      }
      return true;
    });
  }, [settlements, statusFilter, searchDriver]);

  /* ====================== INITIAL LOAD ====================== */

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);

        // 1) current user
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!user) {
          toast(
            setToastState,
            "error",
            "No authenticated user. Please log in again."
          );
          setLoading(false);
          return;
        }
        if (cancelled) return;
        setUserId(user.id);

        // 2) org from team_members
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
          toast(
            setToastState,
            "error",
            "You do not belong to an active organization."
          );
          setLoading(false);
          return;
        }
        if (cancelled) return;
        setOrgId(member.org_id);

        // 3) load drivers + settlements
        await Promise.all([
          loadDrivers(member.org_id),
          loadSettlements(member.org_id),
        ]);
      } catch (err) {
        console.error("[DriverSettlements] init error:", err);
        toast(
          setToastState,
          "error",
          err?.message || "Failed to load driver settlements."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =================== LOAD DRIVERS/SETTLEMENTS =================== */

  const loadDrivers = useCallback(
    async (orgIdParam) => {
      const oid = orgIdParam || orgId;
      if (!oid) return;
      try {
        const { data, error } = await supabase
          .from("drivers")
          .select(
            "id, org_id, first_name, last_name, status, pay_model, pay_rate_percent, pay_rate_per_mile, pay_flat_per_load, escrow_percent"
          )
          .eq("org_id", oid)
          .order("last_name", { ascending: true });

        if (error) throw error;
        setDrivers(data || []);

        // default driver for generate form
        if (!genDriverId && data && data.length > 0) {
          setGenDriverId(data[0].id);
        }
      } catch (err) {
        console.error("[DriverSettlements] loadDrivers error:", err);
        toast(
          setToastState,
          "error",
          err?.message || "Failed to load drivers."
        );
      }
    },
    [orgId, genDriverId]
  );

  const loadSettlements = useCallback(
    async (orgIdParam) => {
      const oid = orgIdParam || orgId;
      if (!oid) return;
      try {
        if (!orgIdParam) setRefreshing(true);

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
            updated_at,
            drivers:driver_id ( first_name, last_name )
          `
          )
          .eq("org_id", oid)
          .order("period_start", { ascending: false });

        if (error) throw error;

        const mapped =
          (data || []).map((row) => ({
            id: row.id,
            org_id: row.org_id,
            driver_id: row.driver_id,
            period_type: row.period_type,
            period_start: row.period_start,
            period_end: row.period_end,
            gross_earnings: row.gross_earnings,
            total_deductions: row.total_deductions,
            net_pay: row.net_pay,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            driver_first_name: row.drivers?.first_name || "",
            driver_last_name: row.drivers?.last_name || "",
          })) || [];

        setSettlements(mapped);

        // if nothing selected, auto-select first
        if (!selectedId && mapped.length > 0) {
          setSelectedId(mapped[0].id);
        }
      } catch (err) {
        console.error("[DriverSettlements] loadSettlements error:", err);
        toast(
          setToastState,
          "error",
          err?.message || "Failed to load settlements."
        );
      } finally {
        if (!orgIdParam) setRefreshing(false);
      }
    },
    [orgId, selectedId]
  );

  const loadLinesForSettlement = useCallback(
    async (settlementId) => {
      if (!settlementId || !orgId) {
        setLines([]);
        return;
      }
      try {
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
            created_at
          `
          )
          .eq("org_id", orgId)
          .eq("settlement_id", settlementId)
          .order("created_at", { ascending: true });

        if (error) throw error;
        setLines(data || []);
      } catch (err) {
        console.error("[DriverSettlements] loadLines error:", err);
        toast(
          setToastState,
          "error",
          err?.message || "Failed to load settlement details."
        );
      }
    },
    [orgId]
  );

  // whenever selection changes, load its lines
  useEffect(() => {
    if (!selectedSettlement) {
      setLines([]);
      return;
    }
    loadLinesForSettlement(selectedSettlement.id);
  }, [selectedSettlement, loadLinesForSettlement]);

  /* ================== GENERATE WEEKLY SETTLEMENT ================== */

  async function handleGenerate() {
    if (!genDriverId || !genWeekStart) {
      toast(
        setToastState,
        "error",
        "Pick a driver and a week start date first."
      );
      return;
    }
    if (!orgId) {
      toast(
        setToastState,
        "error",
        "Missing organization context. Try reloading the page."
      );
      return;
    }

    try {
      setGenerating(true);

      console.log("[DriverSettlements] generating settlement", {
        driver: genDriverId,
        weekStart: genWeekStart,
      });

      const { data, error } = await supabase.rpc(
        "rpc_generate_driver_settlement_week",
        {
          p_driver_id: genDriverId,
          p_week_start: genWeekStart, // 'YYYY-MM-DD'
        }
      );

      if (error) {
        console.error(
          "[DriverSettlements] rpc_generate_driver_settlement_week error:",
          error
        );
        toast(
          setToastState,
          "error",
          error.message || "Failed to generate settlement."
        );
        return;
      }

      const newId = data; // function returns uuid

      toast(
        setToastState,
        "success",
        "Draft settlement generated for that driver/week."
      );

      // reload settlements and auto-select the new one
      await loadSettlements(orgId);
      if (newId) {
        setSelectedId(newId);
      }
    } catch (err) {
      console.error("[DriverSettlements] handleGenerate exception:", err);
      toast(
        setToastState,
        "error",
        err?.message || "Unexpected error generating settlement."
      );
    } finally {
      setGenerating(false);
    }
  }

  /* ====================== DELETE SETTLEMENT ====================== */

  async function handleDeleteSettlement() {
    if (!selectedSettlement || !orgId) return;

    const confirmDelete = window.confirm(
      "Delete this settlement and all its line items? This cannot be undone."
    );
    if (!confirmDelete) return;

    try {
      setDeleting(true);

      // 1) delete lines (org-scoped)
      const { error: linesErr } = await supabase
        .from("driver_settlement_lines")
        .delete()
        .eq("org_id", orgId)
        .eq("settlement_id", selectedSettlement.id);

      if (linesErr) throw linesErr;

      // 2) delete header (org-scoped)
      const { error: headErr } = await supabase
        .from("driver_settlements")
        .delete()
        .eq("org_id", orgId)
        .eq("id", selectedSettlement.id);

      if (headErr) throw headErr;

      // update local state
      setSettlements((prev) =>
        prev.filter((s) => s.id !== selectedSettlement.id)
      );
      setLines([]);
      setSelectedId((prevId) =>
        prevId === selectedSettlement.id ? null : prevId
      );

      toast(setToastState, "success", "Settlement deleted.");
    } catch (err) {
      console.error("[DriverSettlements] delete settlement error:", err);
      toast(
        setToastState,
        "error",
        err?.message || "Failed to delete settlement."
      );
    } finally {
      setDeleting(false);
    }
  }

  /* =========================== RENDER =========================== */

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-300 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading driver settlements…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">
            Driver settlements
          </h1>
          <p className="text-xs text-slate-400">
            Accounting view of weekly driver settlements. All data is scoped to
            your organization via Row Level Security.
          </p>
        </div>

        <button
          onClick={() => loadSettlements()}
          disabled={refreshing}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
            "border-slate-700 bg-slate-950/70 hover:bg-slate-900/80",
            refreshing && "opacity-60 cursor-not-allowed"
          )}
        >
          <Loader2
            className={cx("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Top: generate + filters */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr),minmax(0,1fr)] gap-4">
        {/* Generate weekly settlement */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <CalendarDays className="h-4 w-4 text-emerald-400" />
            <span>Generate weekly settlement</span>
          </div>
          <p className="text-xs text-slate-400">
            Pick a driver and the Monday (or first day) of the week. Atlas will
            calculate earnings based on their pay model and create a draft
            settlement.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs">
            {/* Driver select */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 w-10">Driver</span>
              <select
                className="min-w-[200px] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                value={genDriverId}
                onChange={(e) => setGenDriverId(e.target.value)}
              >
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.first_name} {d.last_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Week start date */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 w-24">Week start date</span>
              <input
                type="date"
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                value={genWeekStart}
                onChange={(e) => setGenWeekStart(e.target.value)}
              />
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating || !genDriverId || !genWeekStart}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
                "border-emerald-500/60 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25",
                (generating || !genDriverId || !genWeekStart) &&
                  "opacity-60 cursor-not-allowed"
              )}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <DollarSign className="h-3.5 w-3.5" />
              )}
              <span>Generate settlement</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <Filter className="h-4 w-4 text-amber-400" />
            <span>Filters</span>
          </div>

          <div className="space-y-2 text-xs">
            {/* Status */}
            <div className="flex items-center gap-2">
              <span className="w-10 text-slate-400">Status</span>
              <select
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="IN_REVIEW">In review</option>
                <option value="APPROVED">Approved</option>
                <option value="PAID">Paid</option>
              </select>
            </div>

            {/* Driver search */}
            <div className="flex items-center gap-2">
              <span className="w-10 text-slate-400">Driver</span>
              <div className="flex-1 relative">
                <User className="h-3.5 w-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-7 pr-2 py-1.5 text-xs text-slate-100 placeholder-slate-500"
                  placeholder="Search driver…"
                  value={searchDriver}
                  onChange={(e) => setSearchDriver(e.target.value)}
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500 pt-1">
              In future, status transitions will be restricted to accounting
              roles only. For now, any org member can move a settlement forward.
            </p>
          </div>
        </div>
      </div>

      {/* Main: settlements list + details */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr),minmax(0,1.3fr)] gap-4">
        {/* Settlements table */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                Settlements ({visibleSettlements.length} of{" "}
                {settlements.length})
              </span>
            </div>
          </div>

          <div className="overflow-auto max-h-[420px]">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-950/90 border-b border-slate-800">
                <tr className="text-[11px] text-slate-400">
                  <th className="px-3 py-2 text-left">Week</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Deductions</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleSettlements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      No settlements match your filters.
                    </td>
                  </tr>
                ) : (
                  visibleSettlements.map((s) => {
                    const isActive = s.id === selectedId;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedId(s.id)}
                        className={cx(
                          "border-t border-slate-800 cursor-pointer",
                          isActive
                            ? "bg-emerald-500/5"
                            : "hover:bg-slate-900/40"
                        )}
                      >
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="text-slate-100">
                              {fmtDate(s.period_start)} –{" "}
                              {fmtDate(s.period_end)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Created {fmtDate(s.created_at)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="text-slate-100">
                              {s.driver_first_name} {s.driver_last_name}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ID: {s.id.slice(0, 8)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-100">
                          {fmtMoney(s.gross_earnings)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-100">
                          {fmtMoney(s.total_deductions)}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-300">
                          {fmtMoney(s.net_pay)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cx(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
                              s.status === "PAID"
                                ? "bg-emerald-500/10 border-emerald-500/60 text-emerald-200"
                                : s.status === "APPROVED"
                                ? "bg-sky-500/10 border-sky-500/60 text-sky-200"
                                : s.status === "IN_REVIEW"
                                ? "bg-amber-500/10 border-amber-500/60 text-amber-200"
                                : "bg-slate-700/40 border-slate-500/60 text-slate-200"
                            )}
                          >
                            {s.status || "DRAFT"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Settlement details */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 flex flex-col min-h-[260px]">
          <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <Clock className="h-4 w-4 text-emerald-400" />
              <span>Settlement details</span>
            </div>

            {selectedSettlement && (
              <button
                onClick={handleDeleteSettlement}
                disabled={deleting}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium",
                  "border-red-500/70 bg-red-500/10 text-red-100 hover:bg-red-500/20",
                  deleting && "opacity-60 cursor-not-allowed"
                )}
                title="Delete this settlement and all its line items"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span>Delete</span>
              </button>
            )}
          </div>

          {!selectedSettlement ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500 px-4 py-4">
              Select a settlement from the table to view line items and a
              breakdown of earnings and deductions.
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              {/* Header summary */}
              <div className="px-4 pt-3 pb-2 border-b border-slate-800 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      {selectedSettlement.driver_first_name}{" "}
                      {selectedSettlement.driver_last_name}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Week {fmtDate(selectedSettlement.period_start)} –{" "}
                        {fmtDate(selectedSettlement.period_end)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        Created {fmtDate(selectedSettlement.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Hash className="h-3.5 w-3.5" />
                        ID {selectedSettlement.id}
                      </span>
                    </div>
                  </div>

                  <div className="text-right text-[11px] space-y-1">
                    <div className="text-slate-400">Status</div>
                    <div>
                      <span
                        className={cx(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
                          selectedSettlement.status === "PAID"
                            ? "bg-emerald-500/10 border-emerald-500/60 text-emerald-200"
                            : selectedSettlement.status === "APPROVED"
                            ? "bg-sky-500/10 border-sky-500/60 text-sky-200"
                            : selectedSettlement.status === "IN_REVIEW"
                            ? "bg-amber-500/10 border-amber-500/60 text-amber-200"
                            : "bg-slate-700/40 border-slate-500/60 text-slate-200"
                        )}
                      >
                        {selectedSettlement.status || "DRAFT"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Totals */}
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2">
                    <div className="text-[11px] text-slate-400">Gross</div>
                    <div className="text-slate-100 font-semibold">
                      {fmtMoney(selectedSettlement.gross_earnings)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2">
                    <div className="text-[11px] text-slate-400">
                      Deductions
                    </div>
                    <div className="text-rose-300 font-semibold">
                      {fmtMoney(selectedSettlement.total_deductions)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2">
                    <div className="text-[11px] text-slate-400">Net pay</div>
                    <div className="text-emerald-300 font-semibold">
                      {fmtMoney(selectedSettlement.net_pay)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Line items */}
              <div className="flex-1 overflow-auto px-4 py-3">
                <div className="text-xs text-slate-400 mb-2">Line items</div>

                {lines.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    No line items for this settlement yet.
                  </div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-[11px]">
                      <thead className="border-b border-slate-800 text-slate-400">
                        <tr>
                          <th className="text-left px-2 py-1.5 w-1/2">
                            Description
                          </th>
                          <th className="text-left px-2 py-1.5">Load</th>
                          <th className="text-right px-2 py-1.5 w-24">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((ln) => (
                          <tr
                            key={ln.id}
                            className="border-b border-slate-900/70"
                          >
                            <td className="px-2 py-1.5 text-slate-100">
                              {ln.description || "—"}
                            </td>
                            <td className="px-2 py-1.5 text-slate-400">
                              {ln.load_id ? ln.load_id.slice(0, 8) : "—"}
                            </td>
                            <td
                              className={cx(
                                "px-2 py-1.5 text-right",
                                ln.is_deduction
                                  ? "text-rose-300"
                                  : "text-emerald-200"
                              )}
                            >
                              {fmtMoney(ln.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toastState && (
        <div className="fixed bottom-4 right-4 z-40">
          <div
            className={cx(
              "rounded-lg px-3 py-2 text-xs shadow-lg border backdrop-blur bg-slate-950/95",
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
