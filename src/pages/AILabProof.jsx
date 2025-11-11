import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
  Info,
  ExternalLink,
} from "lucide-react";

console.log("[AIProof] mounted");
/** Tiny helpers */
function cls(...a) { return a.filter(Boolean).join(" "); }
function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(num)) return "—";
  return `${num.toFixed(2)}%`;
}
function fmtInt(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString();
}

/**
 * AIProof page
 * - Reads rpc_ai_learning_summary() (single row)
 * - Reads rpc_ai_driver_trend_7d() (leaderboard)
 * - Shows a clear "Learning: +X pp" indicator and table
 */
export default function AIProof() {
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [leaders, setLeaders] = useState([]);

  const loadData = useCallback(async () => {
    setError("");
    try {
      setLoading(true);
      // 1) Global summary (single row)
      const { data: sumData, error: sumErr } = await supabase.rpc("rpc_ai_learning_summary");
      if (sumErr) throw sumErr;

      // sumData is an array with a single object (or empty if no data)
      const summaryRow = Array.isArray(sumData) && sumData.length ? sumData[0] : null;

      // 2) Per-driver leaderboard
      const { data: drvData, error: drvErr } = await supabase.rpc("rpc_ai_driver_trend_7d");
      if (drvErr) throw drvErr;

      // Sort by net_delta desc (safety if DB doesn’t already)
      const sorted = (drvData || []).slice().sort((a, b) => (b?.net_delta ?? 0) - (a?.net_delta ?? 0));

      setSummary(summaryRow);
      setLeaders(sorted);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("AIProof load failed:", e);
      setError(e?.message || "Failed to load data");
      setSummary(null);
      setLeaders([]);
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const upDelta = summary?.up_rate_delta_pp ?? null;
  const positive = typeof upDelta === "number" ? upDelta > 0 : false;
  const negative = typeof upDelta === "number" ? upDelta < 0 : false;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">AI Learning Proof</h1>
          <p className="text-sm text-zinc-400">
            Based on thumbs feedback in the last 7 days vs the previous 7 days.
          </p>
        </div>
        <button
          onClick={() => { setReloading(true); loadData(); }}
          className={cls(
            "inline-flex items-center gap-2 rounded-xl px-3 py-2 border",
            "border-zinc-700/50 bg-zinc-800 hover:bg-zinc-700/60 transition"
          )}
          title="Reload"
        >
          {reloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="text-sm">Refresh</span>
        </button>
      </div>

      {/* Error */}
      {!!error && (
        <div className="rounded-xl border border-rose-700/50 bg-rose-900/20 text-rose-200 p-3 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="flex items-center gap-3 text-zinc-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading learning metrics…</span>
        </div>
      )}

      {/* Summary KPI */}
      {!loading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Big Learning badge */}
          <div className={cls(
            "rounded-2xl border p-5",
            positive && "border-emerald-700/60 bg-emerald-900/20",
            negative && "border-rose-700/60 bg-rose-900/20",
            !positive && !negative && "border-zinc-700/60 bg-zinc-900/30"
          )}>
            <div className="flex items-center gap-3">
              {positive && <TrendingUp className="w-5 h-5 text-emerald-400" />}
              {negative && <TrendingDown className="w-5 h-5 text-rose-400" />}
              {!positive && !negative && <Info className="w-5 h-5 text-zinc-400" />}
              <div className="text-lg font-medium">
                Learning: {typeof upDelta === "number" ? `${upDelta.toFixed(2)} pp` : "—"}
              </div>
            </div>
            <div className="mt-3 text-sm text-zinc-300">
              {positive && "Great! Up-rate improved over the prior week."}
              {negative && "Up-rate fell vs the prior week."}
              {!positive && !negative && "No change detected yet."}
            </div>
          </div>

          {/* Current period stats */}
          <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/30 p-5">
            <div className="text-sm text-zinc-400 mb-2">This 7 days</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Events" value={fmtInt(summary?.total_events_7d)} />
              <Stat label="Up-rate" value={fmtPct(summary?.up_rate_7d_pct)} />
              <Stat label="Ups" value={fmtInt(summary?.ups_7d)} />
              <Stat label="Downs" value={fmtInt(summary?.downs_7d)} />
              <Stat label="Drivers" value={fmtInt(summary?.unique_drivers_7d)} />
              <Stat label="Window Start" value={summary?.first_event_7d ? new Date(summary.first_event_7d).toLocaleString() : "—"} />
            </div>
          </div>

          {/* Prior period stats */}
          <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/30 p-5">
            <div className="text-sm text-zinc-400 mb-2">Previous 7 days</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Events" value={fmtInt(summary?.total_events_prev_7d)} />
              <Stat label="Up-rate" value={fmtPct(summary?.up_rate_prev_7d_pct)} />
              <div className="col-span-2 text-xs text-zinc-400">
                Benchmark window for comparison.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {!loading && !error && (
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/30">
          <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="font-medium">Top Improving Drivers (net delta)</div>
            <div className="text-xs text-zinc-400">Last 7d vs prior 7d</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-zinc-400">
                <tr className="border-b border-zinc-800/60">
                  <Th>Name / ID</Th>
                  <Th className="text-right">Ups (7d)</Th>
                  <Th className="text-right">Downs (7d)</Th>
                  <Th className="text-right">Net (7d)</Th>
                  <Th className="text-right">Net (prev 7d)</Th>
                  <Th className="text-right">Δ Net</Th>
                  <Th className="text-right pr-5">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {leaders.slice(0, 25).map((r) => (
                  <tr key={r.driver_id} className="hover:bg-zinc-800/30">
                    <td className="py-3 pl-5 pr-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-zinc-100">
                          {/* If you have driver names in cache, replace with name */}
                          Driver
                        </span>
                        <code className="text-[11px] text-zinc-400">{r.driver_id}</code>
                      </div>
                    </td>
                    <TdRight>{fmtInt(r.ups_7d)}</TdRight>
                    <TdRight>{fmtInt(r.downs_7d)}</TdRight>
                    <TdRight>{fmtInt(r.net_7d)}</TdRight>
                    <TdRight>{fmtInt(r.net_prev_7d)}</TdRight>
                    <td className="py-3 px-3 text-right">
                      <DeltaBadge value={r.net_delta} />
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/drivers/${r.driver_id}`}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-zinc-700/60 hover:bg-zinc-800/50"
                          title="Open Driver"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View
                        </Link>
                        <button
                          onClick={() => navigator.clipboard?.writeText(r.driver_id)}
                          className="text-xs px-2 py-1 rounded-md border border-zinc-700/60 hover:bg-zinc-800/50"
                          title="Copy Driver ID"
                        >
                          Copy ID
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {leaders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-zinc-400">
                      No driver feedback found for the selected windows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Small subcomponents ---------- */

function Stat({ label, value }) {
  return (
    <div className="flex flex-col">
      <div className="text-zinc-400">{label}</div>
      <div className="text-zinc-100 font-medium">{value}</div>
    </div>
  );
}

function Th({ children, className }) {
  return (
    <th className={cls("py-2 pl-5 pr-3 text-xs font-medium uppercase tracking-wide", className)}>
      {children}
    </th>
  );
}

function TdRight({ children }) {
  return <td className="py-3 px-3 text-right">{children}</td>;
}

function DeltaBadge({ value }) {
  if (value === null || value === undefined) return <span className="text-zinc-400">—</span>;
  const n = Number(value);
  const pos = n > 0;
  const neg = n < 0;
  return (
    <span
      className={cls(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs",
        pos && "border-emerald-700/60 bg-emerald-900/30 text-emerald-200",
        neg && "border-rose-700/60 bg-rose-900/30 text-rose-200",
        !pos && !neg && "border-zinc-700/60 bg-zinc-900/30 text-zinc-200"
      )}
      title="Net (this 7d) - Net (prev 7d)"
    >
      {pos && <TrendingUp className="w-3.5 h-3.5" />}
      {neg && <TrendingDown className="w-3.5 h-3.5" />}
      <span>{n}</span>
    </span>
  );
}
