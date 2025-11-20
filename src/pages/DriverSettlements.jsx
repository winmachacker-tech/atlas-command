// FILE: src/pages/DriverSettlements.jsx
// Purpose:
// - Manage driver settlements (list, filter, generate, view details)
// - Call rpc_generate_driver_settlement_week(p_driver_id, p_week_start)
// - Show line items and compute Gross / Deductions / Net Pay from them
//
// Notes:
// - DOES NOT touch any RLS or security on the backend.
// - All data access goes through Supabase with the current user session.
// - Totals are computed client-side from driver_settlement_lines:
//      • line_kind IN ('EARNING', 'REIMBURSEMENT')  => Gross
//      • line_kind IN ('DEDUCTION', 'ESCROW', 'ADJUSTMENT') => Deductions
//      • Net Pay = Gross - Deductions
//
// Dependencies:
// - React
// - lucide-react
// - supabase client at ../lib/supabase

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Loader2,
  Search,
  Calendar,
  Trash2,
} from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const STATUS_OPTIONS = ["ALL", "DRAFT", "APPROVED", "PAID"];

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateRange(start, end) {
  if (!start || !end) return "—";
  const s = new Date(start);
  const e = new Date(end);
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `Week ${formatter.format(s)} – ${formatter.format(e)}`;
}

function formatDate(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function DriverSettlements() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [drivers, setDrivers] = useState([]);
  const [driverSearch, setDriverSearch] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState(null);

  const [statusFilter, setStatusFilter] = useState("ALL");

  const [settlements, setSettlements] = useState([]);
  const [selectedSettlement, setSelectedSettlement] = useState(null);
  const [lineItems, setLineItems] = useState([]);

  const [weekStartInput, setWeekStartInput] = useState("2021-01-04"); // default value

  const [error, setError] = useState(null);

  // ---------------------------------------------------------------------------
  // Load drivers + settlements on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        // Load drivers for the filter + generator
        const { data: driversData, error: driversError } = await supabase
          .from("drivers")
          .select("id, full_name, status")
          .order("full_name", { ascending: true });

        if (driversError) {
          console.error("[DriverSettlements] drivers error", driversError);
          throw driversError;
        }

        setDrivers(driversData || []);

        // Load existing settlements (most recent first)
        const { data: settlementsData, error: settlementsError } = await supabase
          .from("driver_settlements")
          .select("*")
          .order("period_start", { ascending: false });

        if (settlementsError) {
          console.error("[DriverSettlements] settlements error", settlementsError);
          throw settlementsError;
        }

        setSettlements(settlementsData || []);

        // Preselect the first settlement if available
        if (settlementsData && settlementsData.length > 0) {
          setSelectedSettlement(settlementsData[0]);
        }
      } catch (err) {
        console.error("[DriverSettlements] init error", err);
        setError(err.message || "Failed to load settlements.");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  // ---------------------------------------------------------------------------
  // When selected settlement changes, load its line items
  // ---------------------------------------------------------------------------
  useEffect(() => {
    async function loadLines() {
      if (!selectedSettlement) {
        setLineItems([]);
        return;
      }

      try {
        const { data, error: linesError } = await supabase
          .from("driver_settlement_lines")
          .select("*")
          .eq("settlement_id", selectedSettlement.id)
          .order("created_at", { ascending: true });

        if (linesError) {
          console.error("[DriverSettlements] lines error", linesError);
          throw linesError;
        }

        setLineItems(data || []);
      } catch (err) {
        console.error("[DriverSettlements] loadLines error", err);
        setLineItems([]);
      }
    }

    loadLines();
  }, [selectedSettlement]);

  // ---------------------------------------------------------------------------
  // Compute totals from line items
  // ---------------------------------------------------------------------------
  const totals = useMemo(() => {
    let gross = 0;
    let deductions = 0;

    for (const line of lineItems || []) {
      const kind = (line.line_kind || line.kind || "").toUpperCase();
      const amount = Number(line.amount || 0);

      if (!amount) continue;

      // Treat earnings / reimbursements as gross
      if (kind === "EARNING" || kind === "REIMBURSEMENT") {
        gross += amount;
      }

      // Treat these as deductions
      if (kind === "DEDUCTION" || kind === "ESCROW" || kind === "ADJUSTMENT") {
        deductions += amount;
      }
    }

    const netPay = gross - deductions;
    return { gross, deductions, netPay };
  }, [lineItems]);

  // ---------------------------------------------------------------------------
  // Filtered settlements list
  // ---------------------------------------------------------------------------
  const filteredSettlements = useMemo(() => {
    return settlements.filter((s) => {
      if (statusFilter !== "ALL" && s.status && s.status !== statusFilter) {
        return false;
      }
      if (selectedDriverId && s.driver_id !== selectedDriverId) {
        return false;
      }
      return true;
    });
  }, [settlements, statusFilter, selectedDriverId]);

  const selectedDriver = useMemo(() => {
    if (!selectedSettlement) return null;
    const id = selectedSettlement.driver_id;
    return drivers.find((d) => d.id === id) || null;
  }, [selectedSettlement, drivers]);

  const driverOptions = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    return drivers.filter((d) => {
      if (!q) return true;
      return (d.full_name || "").toLowerCase().includes(q);
    });
  }, [drivers, driverSearch]);

  // ---------------------------------------------------------------------------
  // Generate settlement via RPC
  // ---------------------------------------------------------------------------
  async function handleGenerate() {
    setError(null);

    if (!selectedDriverId) {
      setError("Please choose a driver before generating a settlement.");
      return;
    }
    if (!weekStartInput) {
      setError("Please choose a week start date.");
      return;
    }

    try {
      setGenerating(true);

      console.log("[DriverSettlements] generating settlement", {
        driver: selectedDriverId,
        weekStart: weekStartInput,
      });

      const { data, error: rpcError } = await supabase.rpc(
        "rpc_generate_driver_settlement_week",
        {
          p_driver_id: selectedDriverId,
          p_week_start: weekStartInput,
        }
      );

      if (rpcError) {
        console.error(
          "[DriverSettlements] rpc_generate_driver_settlement_week error:",
          rpcError
        );
        throw rpcError;
      }

      const newSettlementId = data;

      // Reload settlements from DB so we have the new record
      const { data: settlementsData, error: settlementsError } =
        await supabase
          .from("driver_settlements")
          .select("*")
          .order("period_start", { ascending: false });

      if (settlementsError) {
        console.error(
          "[DriverSettlements] reload settlements error",
          settlementsError
        );
        throw settlementsError;
      }

      setSettlements(settlementsData || []);

      // Select the newly created settlement if we can find it
      const created = (settlementsData || []).find(
        (s) => s.id === newSettlementId
      );
      if (created) {
        setSelectedSettlement(created);
      }

    } catch (err) {
      console.error("[DriverSettlements] handleGenerate error", err);
      setError(
        err?.message ||
          "Failed to generate settlement. Check console / Supabase logs."
      );
    } finally {
      setGenerating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete settlement
  // ---------------------------------------------------------------------------
  async function handleDeleteSettlement() {
    if (!selectedSettlement) return;
    if (!window.confirm("Delete this settlement? This cannot be undone.")) {
      return;
    }

    try {
      setDeleting(true);

      // Delete lines first (FK safety)
      const { error: linesError } = await supabase
        .from("driver_settlement_lines")
        .delete()
        .eq("settlement_id", selectedSettlement.id);

      if (linesError) {
        console.error("[DriverSettlements] delete lines error", linesError);
        throw linesError;
      }

      const { error: headerError } = await supabase
        .from("driver_settlements")
        .delete()
        .eq("id", selectedSettlement.id);

      if (headerError) {
        console.error("[DriverSettlements] delete settlement error", headerError);
        throw headerError;
      }

      const remaining = settlements.filter(
        (s) => s.id !== selectedSettlement.id
      );
      setSettlements(remaining);
      setSelectedSettlement(remaining[0] || null);
      setLineItems([]);

    } catch (err) {
      console.error("[DriverSettlements] handleDeleteSettlement error", err);
      setError(err.message || "Failed to delete settlement.");
    } finally {
      setDeleting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function renderStatusBadge(status) {
    const value = (status || "DRAFT").toUpperCase();
    let color = "bg-slate-600/40 text-slate-100 border border-slate-500/60";

    if (value === "DRAFT") {
      color = "bg-slate-700/40 text-slate-100 border border-slate-500/60";
    } else if (value === "APPROVED") {
      color = "bg-emerald-500/10 text-emerald-300 border border-emerald-500/60";
    } else if (value === "PAID") {
      color = "bg-emerald-600/20 text-emerald-100 border border-emerald-500/80";
    }

    return (
      <span
        className={cx(
          "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
          color
        )}
      >
        {value}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#050816] text-slate-100 px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
        {/* Left column: Filters + Settlement list */}
        <div className="w-full space-y-4 lg:w-1/3">
          {/* Filters card */}
          <div className="rounded-2xl border border-yellow-500/40 bg-slate-900/60 p-4 shadow-lg shadow-black/40">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-yellow-300">
                Filters
              </h2>
            </div>

            {/* Status filter */}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Status
              </label>
              <div className="relative">
                <select
                  className="block w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "ALL" ? "All statuses" : opt}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>

            {/* Driver filter */}
            <div className="mb-2">
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Driver
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  className="block w-full rounded-xl border border-slate-700 bg-slate-900/70 py-2 pl-8 pr-2 text-sm text-slate-100 shadow-inner outline-none placeholder:text-slate-500 focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
                  placeholder="Search driver..."
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                />
              </div>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 text-xs">
                {driverOptions.length === 0 && (
                  <div className="px-3 py-2 text-slate-500">
                    No drivers match your search.
                  </div>
                )}
                {driverOptions.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedDriverId(d.id)}
                    className={cx(
                      "flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-800/70",
                      selectedDriverId === d.id && "bg-slate-800 text-yellow-200"
                    )}
                  >
                    <span>{d.full_name || "Unnamed driver"}</span>
                    <span className="text-[10px] uppercase text-slate-400">
                      {d.status || "ACTIVE"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-400">
              In future, status transitions will be restricted to accounting
              roles only. For now, any org member can move a settlement forward.
            </p>
          </div>

          {/* Settlement list */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-black/40">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
                Settlements
              </h2>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading settlements...
              </div>
            ) : filteredSettlements.length === 0 ? (
              <div className="py-6 text-sm text-slate-500">
                No settlements found. Generate a new one using the controls on
                the right.
              </div>
            ) : (
              <div className="space-y-1">
                {filteredSettlements.map((s) => {
                  const isActive = selectedSettlement?.id === s.id;
                  const range = formatDateRange(
                    s.week_start || s.period_start,
                    s.week_end || s.period_end
                  );
                  const driverName =
                    drivers.find((d) => d.id === s.driver_id)?.full_name ||
                    "Unknown driver";

                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSettlement(s)}
                      className={cx(
                        "flex w-full flex-col rounded-xl border px-3 py-2 text-left text-xs hover:bg-slate-800/70",
                        isActive
                          ? "border-yellow-400/80 bg-slate-900/80"
                          : "border-slate-800 bg-slate-900/40"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-100">
                          {driverName}
                        </span>
                        {renderStatusBadge(s.status)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {range}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        ID {s.id}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Details + Generate */}
        <div className="w-full space-y-4 lg:w-2/3">
          {/* Generate settlement card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-black/40">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
                Generate settlement
              </h2>
            </div>

            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div className="md:col-span-1">
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Driver
                </label>
                <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                  {selectedDriverId
                    ? drivers.find((d) => d.id === selectedDriverId)?.full_name ||
                      "Selected driver"
                    : "No driver selected"}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Pick a driver from the Filters list on the left.
                </p>
              </div>

              <div className="md:col-span-1">
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Week start
                </label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="date"
                    className="block w-full rounded-xl border border-slate-700 bg-slate-900/70 py-2 pl-8 pr-2 text-sm text-slate-100 shadow-inner outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
                    value={weekStartInput}
                    onChange={(e) => setWeekStartInput(e.target.value)}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Use the Monday of the payroll week.
                </p>
              </div>

              <div className="flex items-end md:col-span-1">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className={cx(
                    "inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold shadow-md shadow-black/40 transition",
                    generating
                      ? "cursor-wait border-slate-600 bg-slate-800 text-slate-200"
                      : "border-emerald-500/80 bg-emerald-600/90 text-emerald-50 hover:bg-emerald-500"
                  )}
                >
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    "Generate settlement"
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="mt-3 text-xs text-red-400">
                {error}
              </p>
            )}
          </div>

          {/* Settlement details card */}
          <div className="rounded-2xl border border-yellow-500/40 bg-slate-900/60 p-4 shadow-lg shadow-black/40">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-yellow-300">
                Settlement details
              </h2>
              {selectedSettlement && (
                <button
                  type="button"
                  onClick={handleDeleteSettlement}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 rounded-full border border-red-500/70 bg-red-900/30 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-800/60 disabled:cursor-wait disabled:opacity-70"
                >
                  <Trash2 className="h-3 w-3" />
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              )}
            </div>

            {!selectedSettlement ? (
              <div className="py-8 text-sm text-slate-400">
                Select a settlement from the list on the left to see details.
              </div>
            ) : (
              <>
                {/* Header summary */}
                <div className="mb-4">
                  <div className="mb-1 text-base font-semibold text-slate-50">
                    {selectedDriver?.full_name || "Unknown driver"}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                    <div className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-yellow-400" />
                      {formatDateRange(
                        selectedSettlement.week_start ||
                          selectedSettlement.period_start,
                        selectedSettlement.week_end ||
                          selectedSettlement.period_end
                      )}
                    </div>
                    <div className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-yellow-400" />
                      Created {formatDate(selectedSettlement.created_at)}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      ID {selectedSettlement.id}
                    </span>
                    {renderStatusBadge(selectedSettlement.status)}
                  </div>
                </div>

                {/* Totals */}
                <div className="mb-4 grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Gross
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-50">
                      {formatMoney(totals.gross)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Deductions
                    </div>
                    <div className="mt-1 text-lg font-semibold text-red-400">
                      {formatMoney(totals.deductions)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Net pay
                    </div>
                    <div className="mt-1 text-lg font-semibold text-emerald-400">
                      {formatMoney(totals.netPay)}
                    </div>
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Line items
                  </div>
                  {lineItems.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-4 text-sm text-slate-500">
                      No line items for this settlement yet.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 text-sm">
                      <div className="grid grid-cols-3 gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-300">
                        <div>Description</div>
                        <div>Type</div>
                        <div className="text-right">Amount</div>
                      </div>
                      {lineItems.map((line) => (
                        <div
                          key={line.id}
                          className="grid grid-cols-3 gap-2 border-t border-slate-900/80 px-3 py-2 text-xs text-slate-200"
                        >
                          <div>
                            {line.description || "—"}
                          </div>
                          <div className="uppercase text-[11px] text-slate-400">
                            {line.line_kind || line.kind || "—"}
                          </div>
                          <div className="text-right">
                            {formatMoney(line.amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
