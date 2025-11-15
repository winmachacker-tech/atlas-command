// FILE: src/components/AiAccuracyTrend.jsx
// Full-width (within content area) AI Accuracy Trend.
// - No viewport breakout; respects the page's content container.
// - Scales height by breakpoint; centers empty state; tidy header.
// - Collapsible chart to save space

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { TrendingUp, AlertTriangle, RefreshCw, Clock, ChevronDown, ChevronUp } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) { return a.filter(Boolean).join(" "); }
function pct(x) {
  if (x == null || Number.isNaN(Number(x))) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}
function startOfISOWeek(d) {
  const dt = new Date(d);
  const day = dt.getDay(); // 0..6, 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const ret = new Date(dt);
  ret.setDate(dt.getDate() + diff);
  ret.setHours(0, 0, 0, 0);
  return ret;
}
function weekKey(date) {
  const d = startOfISOWeek(date);
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const start = startOfISOWeek(jan1);
  const diffMs = d - start;
  const week = Math.floor(diffMs / (7 * 24 * 3600 * 1000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
function weekLabel(key) {
  const [y, w] = key.split("-W");
  const year = Number(y);
  const week = Number(w);
  const jan1 = new Date(year, 0, 1);
  const base = startOfISOWeek(jan1);
  const d = new Date(base.getTime() + (week - 1) * 7 * 24 * 3600 * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ---------------------------- component -------------------------- */
export default function AiAccuracyTrend({ weeks = 8, className = "" }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const abortRef = useRef(null);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const { data, error } = await supabase.rpc("rpc_ai_audit_summary");
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
      setUpdatedAt(new Date());
    } catch (e) {
      console.error("AiAccuracyTrend:", e);
      setErr(e?.message || "Failed to load audit summary.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudit();
    return () => abortRef.current?.abort();
  }, [fetchAudit]);

  // Aggregate to weeks
  const series = useMemo(() => {
    const byWeek = new Map();
    for (const r of rows) {
      const wk = weekKey(r.created_at || r.run_date || Date.now());
      const up = Number(r.thumbs_up || 0);
      const fb = Number(r.total_feedback || 0);
      const bucket = byWeek.get(wk) || { up: 0, fb: 0 };
      bucket.up += up;
      bucket.fb += fb;
      byWeek.set(wk, bucket);
    }
    const now = new Date();
    const keys = [];
    let cur = startOfISOWeek(now);
    for (let i = 0; i < weeks; i++) {
      keys.unshift(weekKey(cur));
      cur = new Date(cur.getTime() - 7 * 24 * 3600 * 1000);
    }
    return keys.map((k) => {
      const { up = 0, fb = 0 } = byWeek.get(k) || {};
      return { key: k, label: weekLabel(k), accuracy: fb ? up / fb : null, feedback: fb };
    });
  }, [rows, weeks]);

  const totals = useMemo(() => {
    let fb = 0, up = 0;
    for (const d of series) {
      fb += d.feedback || 0;
      if (Number.isFinite(d.accuracy) && d.feedback > 0) up += d.accuracy * d.feedback;
    }
    return { totalFeedback: fb, weightedAccuracy: fb ? up / fb : null };
  }, [series]);

  const hasAnyFeedback = totals.totalFeedback > 0;

  return (
    <div
      className={cx(
        "w-full max-w-none",
        "rounded-2xl border border-pink-400/40",
        "bg-black/30 p-4 sm:p-5 md:p-6 lg:p-8 shadow-md",
        className
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg md:text-xl font-semibold">AI Accuracy Trend</h2>
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs border border-zinc-700 hover:border-zinc-500 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            title={isCollapsed ? "Expand chart" : "Collapse chart"}
          >
            {isCollapsed ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show Chart
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Hide Chart
              </>
            )}
          </button>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && !loading && (
            <div className="flex items-center gap-1 text-xs text-zinc-400">
              <Clock className="h-3.5 w-3.5" />
              <span>Updated {updatedAt.toLocaleTimeString()}</span>
            </div>
          )}
          <button
            onClick={fetchAudit}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm border border-zinc-700 hover:border-zinc-500 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cx("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-zinc-400">Last {series.length} weeks</span>
        <span className="text-zinc-500">•</span>
        <span className="text-zinc-300">
          Total feedback: <strong>{totals.totalFeedback.toLocaleString()}</strong>
        </span>
        <span className="text-zinc-500">•</span>
        <span className="text-zinc-300">
          Weighted accuracy: <strong className="text-emerald-400">{pct(totals.weightedAccuracy)}</strong>
        </span>
      </div>

      {/* Collapsible content */}
      {!isCollapsed && (
        <>
          {/* States */}
          <div className="mt-3">
            {loading ? (
              <div className="text-zinc-400">Loading weekly accuracy…</div>
            ) : err ? (
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="h-5 w-5" />
                <span>{err}</span>
              </div>
            ) : !hasAnyFeedback ? (
              <div className="text-zinc-300 text-center text-base sm:text-lg py-10">
                No feedback recorded yet. Give a few 👍 / 👎 and this trend will light up.
              </div>
            ) : null}
          </div>

          {/* Chart */}
          <div className="mt-4 h-64 sm:h-80 md:h-[28rem] lg:h-[32rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 24, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#d4d4d8", fontSize: 13 }} // ✅ Much lighter!
                  axisLine={{ stroke: "#52525b" }}
                  tickLine={{ stroke: "#52525b" }}
                />
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tickFormatter={(v) => pct(v)}
                  domain={[0, 1]}
                  allowDecimals
                  tick={{ fill: "#d4d4d8", fontSize: 13 }} // ✅ Much lighter!
                  axisLine={{ stroke: "#52525b" }}
                  tickLine={{ stroke: "#52525b" }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: "#d4d4d8", fontSize: 13 }} // ✅ Much lighter!
                  axisLine={{ stroke: "#52525b" }}
                  tickLine={{ stroke: "#52525b" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0a0a0a",
                    border: "1px solid #27272a",
                    borderRadius: 12,
                    color: "#e4e4e7",
                  }}
                  formatter={(value, name) => {
                    if (name === "accuracy") return [pct(value), "Accuracy"];
                    if (name === "feedback") return [value, "Feedback"];
                    return [value, name];
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar
                  yAxisId="right"
                  dataKey="feedback"
                  name="Feedback"
                  fill="#10b981"
                  radius={[6, 6, 0, 0]}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="accuracy"
                  name="Accuracy"
                  stroke="#f472b6"
                  dot={{ r: 3 }}
                  strokeWidth={2}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-4 text-xs text-zinc-500 text-center">
            Weekly accuracy is weighted by total feedback in each week.
          </p>
        </>
      )}
    </div>
  );
}