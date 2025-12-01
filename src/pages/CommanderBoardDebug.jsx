// FILE: src/pages/CommanderBoardDebug.jsx
// Purpose:
// - Visual "truth board" for Dipsy.
// - Calls rpc_dipsy_global_snapshot() and shows:
//   • Summary counts
//   • Drivers with truth_status
//   • Loads delivered without POD
//   • Active loads with/without drivers
//
// Route: /debug/board  (already wired in main.jsx)

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Users,
  Truck,
  ClipboardList,
  FileX,
} from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function CommanderBoardDebug() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  const loadSnapshot = useCallback(async (opts = { silent: false }) => {
    try {
      if (!opts.silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      const { data, error } = await supabase.rpc("rpc_dipsy_global_snapshot");

      if (error) {
        console.error("[CommanderBoardDebug] RPC error:", error);
        setError(error.message || "Failed to load snapshot");
        return;
      }

      if (!data || data.ok === false) {
        console.error("[CommanderBoardDebug] Bad payload:", data);
        setError(
          data?.message ||
            data?.error ||
            "Snapshot returned an unexpected response"
        );
        return;
      }

      setSnapshot(data);
    } catch (e) {
      console.error("[CommanderBoardDebug] exception:", e);
      setError(e.message || "Unexpected error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const summary = snapshot?.summary || {};
  const drivers = snapshot?.drivers || [];
  const loads = snapshot?.loads || [];
  const trucks = snapshot?.trucks || [];

  const deliveredNoPOD = loads.filter(
    (l) =>
      (l.load_status === "DELIVERED" || l.status === "DELIVERED") &&
      (l.pod_status === "NONE" || l.pod_status === null)
  );

  const activeLoads = loads.filter(
    (l) =>
      l.load_status === "IN_TRANSIT" ||
      l.status === "IN_TRANSIT" ||
      l.load_status === "AVAILABLE" ||
      l.status === "AVAILABLE"
  );

  const activeLoadsWithDriver = activeLoads.filter(
    (l) => l.has_assigned_driver || l.assigned_driver_id
  );
  const activeLoadsNoDriver = activeLoads.filter(
    (l) => !(l.has_assigned_driver || l.assigned_driver_id)
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            Commander Board Debug
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Truth-aligned view of loads, drivers, and trucks from
            rpc_dipsy_global_snapshot().
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadSnapshot({ silent: true })}
          className={cx(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs",
            "border-[var(--border-subtle)] bg-[var(--bg-surface)]",
            "hover:border-emerald-500/60 hover:bg-emerald-500/10 transition-colors",
            refreshing && "opacity-60 cursor-wait"
          )}
          disabled={refreshing}
        >
          <RefreshCw
            className={cx(
              "h-4 w-4",
              refreshing && "animate-spin"
            )}
          />
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <div>
            <div className="font-medium">Error loading snapshot</div>
            <div className="text-xs opacity-90">{error}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-32 grid place-items-center text-sm text-[var(--text-muted)]">
          Loading truth snapshot…
        </div>
      ) : !snapshot ? (
        <div className="h-32 grid place-items-center text-sm text-[var(--text-muted)]">
          No snapshot data available.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <section className="grid gap-4 md:grid-cols-4">
            <SummaryCard
              icon={ClipboardList}
              label="Total Loads"
              value={summary.total_loads ?? loads.length}
              hint={`Delivered w/o POD: ${deliveredNoPOD.length}`}
            />
            <SummaryCard
              icon={Users}
              label="Drivers"
              value={summary.total_drivers ?? drivers.length}
              hint={`Available by truth: ${
                drivers.filter((d) => d.truth_status === "AVAILABLE").length
              }`}
            />
            <SummaryCard
              icon={Truck}
              label="Trucks"
              value={summary.total_trucks ?? trucks.length}
              hint={summary.trucks_hint || "Across Motive / Atlas"}
            />
            <SummaryCard
              icon={CheckCircle2}
              label="Org"
              value={snapshot.org_id?.slice(0, 8) || "Current"}
              hint="Org context used by snapshot"
            />
          </section>

          {/* Delivered w/o POD */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileX className="h-4 w-4 text-amber-400" />
              Delivered without POD
              <span className="text-xs text-[var(--text-muted)]">
                ({deliveredNoPOD.length} loads)
              </span>
            </h2>
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
              {deliveredNoPOD.length === 0 ? (
                <div className="p-3 text-xs text-[var(--text-muted)]">
                  No delivered loads without POD. Nice. ✅
                </div>
              ) : (
                <table className="min-w-full text-xs">
                  <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                    <tr>
                      <Th>Reference</Th>
                      <Th>Origin → Destination</Th>
                      <Th>Status</Th>
                      <Th>Rate</Th>
                      <Th>Driver</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveredNoPOD.slice(0, 50).map((l) => (
                      <tr
                        key={l.load_id || l.id || l.load_reference}
                        className="border-t border-[var(--border-subtle)]"
                      >
                        <Td mono>{l.load_reference || l.reference}</Td>
                        <Td>
                          <div className="truncate">
                            {l.origin} → {l.destination}
                          </div>
                        </Td>
                        <Td>{l.pod_status || "NONE"}</Td>
                        <Td mono>
                          {typeof l.rate === "number"
                            ? `$${l.rate.toLocaleString()}`
                            : "—"}
                        </Td>
                        <Td>{l.driver_full_name || l.driver_name || "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Drivers truth table */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-400" />
              Drivers (truth status)
              <span className="text-xs text-[var(--text-muted)]">
                ({drivers.length} total)
              </span>
            </h2>
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
              {drivers.length === 0 ? (
                <div className="p-3 text-xs text-[var(--text-muted)]">
                  No drivers found.
                </div>
              ) : (
                <table className="min-w-full text-xs">
                  <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                    <tr>
                      <Th>Name</Th>
                      <Th>Truth Status</Th>
                      <Th>Raw Status</Th>
                      <Th>HOS Drive (min)</Th>
                      <Th>Active Load IDs</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((d) => (
                      <tr
                        key={d.driver_id || d.id || d.full_name}
                        className="border-t border-[var(--border-subtle)]"
                      >
                        <Td>{d.full_name || d.name || "Unnamed"}</Td>
                        <Td>
                          <span
                            className={cx(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                              badgeClassForTruthStatus(d.truth_status)
                            )}
                          >
                            {d.truth_status || "UNKNOWN"}
                          </span>
                        </Td>
                        <Td>{d.raw_status || d.status || "—"}</Td>
                        <Td mono>{d.hos_drive_remaining_min ?? "—"}</Td>
                        <Td mono className="max-w-xs truncate">
                          {Array.isArray(d.active_load_ids) &&
                          d.active_load_ids.length
                            ? d.active_load_ids.join(", ")
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Active loads by driver assignment */}
          <section className="grid gap-4 md:grid-cols-2">
            <BoardBucketCard
              title="Active loads WITH driver"
              icon={Truck}
              colorClass="text-emerald-400"
              count={activeLoadsWithDriver.length}
              loads={activeLoadsWithDriver}
            />
            <BoardBucketCard
              title="Active loads WITHOUT driver"
              icon={AlertCircle}
              colorClass="text-amber-400"
              count={activeLoadsNoDriver.length}
              loads={activeLoadsNoDriver}
            />
          </section>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
        </span>
        <span className="text-base font-semibold">{value}</span>
      </div>
      {hint && (
        <div className="text-[10px] text-[var(--text-muted)] truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({ children, mono = false, className = "" }) {
  return (
    <td
      className={cx(
        "px-3 py-2 align-top text-[11px]",
        mono && "font-mono",
        className
      )}
    >
      {children}
    </td>
  );
}

function badgeClassForTruthStatus(ts) {
  switch (ts) {
    case "AVAILABLE":
      return "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40";
    case "ON_LOAD":
      return "bg-blue-500/10 text-blue-300 border border-blue-500/40";
    case "SHOULD_BE_FREE":
      return "bg-amber-500/10 text-amber-300 border border-amber-500/40";
    case "UNKNOWN":
    default:
      return "bg-slate-500/10 text-slate-300 border border-slate-500/40";
  }
}

function BoardBucketCard({ title, icon: Icon, colorClass, count, loads }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className={cx("h-4 w-4", colorClass)} />}
          <span>{title}</span>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{count}</span>
      </div>
      <div className="max-h-64 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {count === 0 ? (
          <div className="p-3 text-[11px] text-[var(--text-muted)]">
            None right now.
          </div>
        ) : (
          <table className="min-w-full text-[11px]">
            <thead className="bg-[var(--bg-panel)] text-[var(--text-muted)]">
              <tr>
                <Th>Ref</Th>
                <Th>Origin → Destination</Th>
                <Th>Driver</Th>
              </tr>
            </thead>
            <tbody>
              {loads.slice(0, 50).map((l) => (
                <tr
                  key={l.load_id || l.id || l.load_reference}
                  className="border-t border-[var(--border-subtle)]"
                >
                  <Td mono>{l.load_reference || l.reference}</Td>
                  <Td>
                    <div className="truncate">
                      {l.origin} → {l.destination}
                    </div>
                  </Td>
                  <Td>{l.driver_full_name || l.driver_name || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
