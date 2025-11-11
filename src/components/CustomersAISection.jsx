import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  RefreshCw,
  Brain,
  TrendingUp,
  AlertCircle,
  Loader2,
  Search,
  CheckCircle2,
  Repeat,
  ShieldCheck,
} from "lucide-react";

/**
 * CustomersAISection
 * - Fetches public.rpc_ai_customer_training()
 * - Renders ranked customers with key KPIs
 * - Includes search, sort, and a "Train AI" refresh button
 *
 * Drop this into your Customers page:
 *   import CustomersAISection from "../components/CustomersAISection.jsx";
 *   ...
 *   <CustomersAISection />
 */

function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fmtNum(n, d = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  try {
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return String(n);
  }
}
function fmtPct(n, d = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${fmtNum(n, d)}%`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

const SORT_CHOICES = [
  { key: "recent_90d_rows", label: "Recent 90d Loads" },
  { key: "total_history_rows", label: "Total History Rows" },
  { key: "avg_margin_all_time", label: "Avg Margin (All-time)" },
  { key: "avg_rate_all_time", label: "Avg Rate (All-time)" },
];

export default function CustomersAISection() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState(SORT_CHOICES[0].key);
  const [sortDir, setSortDir] = useState("desc"); // 'asc' | 'desc'

  const fetchData = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await supabase.rpc("rpc_ai_customer_training", {
        limit_rows: 5000,
      });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to load AI training data.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = Array.isArray(rows) ? rows : [];
    const picked = needle
      ? base.filter((r) => (r?.name || "").toLowerCase().includes(needle))
      : base;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...picked].sort((a, b) => {
      const va = a?.[sortKey] ?? 0;
      const vb = b?.[sortKey] ?? 0;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      // tie-breaker: recent_90d_rows then total_history_rows
      const t1 = (a?.recent_90d_rows ?? 0) - (b?.recent_90d_rows ?? 0);
      if (t1 !== 0) return -Math.sign(t1);
      const t2 = (a?.total_history_rows ?? 0) - (b?.total_history_rows ?? 0);
      return -Math.sign(t2);
    });
  }, [rows, q, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <section className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 opacity-80" />
          <h2 className="text-lg font-semibold">Customers · AI Training</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 opacity-60" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search customers…"
              className="pl-8 pr-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-700/60 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <button
            onClick={fetchData}
            disabled={busy}
            className={cx(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 border text-sm",
              "bg-zinc-900/40 border-zinc-700/60 hover:bg-zinc-900/60",
              "transition"
            )}
            title="Re-run training fetch"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Training…
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Train AI
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs opacity-70">Sort by:</span>
        <div className="flex flex-wrap gap-2">
          {SORT_CHOICES.map((opt) => (
            <button
              key={opt.key}
              onClick={() => toggleSort(opt.key)}
              className={cx(
                "text-xs rounded-full px-3 py-1 border transition",
                sortKey === opt.key
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-zinc-700/60 bg-zinc-900/40 hover:bg-zinc-900/60"
              )}
              title={`Sort by ${opt.label}`}
            >
              {opt.label}
              {sortKey === opt.key ? (
                <span className="ml-1 opacity-70">({sortDir})</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {err ? (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/40 bg-red-500/10 mb-3">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <div>
            <div className="text-sm font-medium">Couldn’t load AI data</div>
            <div className="text-xs opacity-80">{String(err)}</div>
          </div>
        </div>
      ) : null}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-700/60">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Region</th>
              <th className="px-3 py-2 font-medium">Recent 90d</th>
              <th className="px-3 py-2 font-medium">Total Rows</th>
              <th className="px-3 py-2 font-medium">Avg Margin</th>
              <th className="px-3 py-2 font-medium">Avg Rate</th>
              <th className="px-3 py-2 font-medium">Signals</th>
              <th className="px-3 py-2 font-medium">Last Activity</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {busy && filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center opacity-70">
                  <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
                  Loading AI training…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center opacity-70">
                  No customers found. Try importing `customer_name` or seeding
                  `customers`, then click <b>Train AI</b>.
                </td>
              </tr>
            ) : (
              filtered.map((r, idx) => (
                <tr
                  key={`${r.customer_id || r.name || idx}-${idx}`}
                  className={cx(
                    "border-t border-zinc-800/70 hover:bg-zinc-900/30"
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 opacity-70" />
                      <div className="font-medium">{r?.name || "—"}</div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{r?.region || "—"}</td>
                  <td className="px-3 py-2">{fmtNum(r?.recent_90d_rows)}</td>
                  <td className="px-3 py-2">{fmtNum(r?.total_history_rows)}</td>
                  <td className="px-3 py-2">{fmtPct(r?.avg_margin_all_time)}</td>
                  <td className="px-3 py-2">{fmtNum(r?.avg_rate_all_time, 2)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-emerald-600/40 bg-emerald-500/10"
                        title="Profitable rows"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {fmtNum(r?.profitable_rows)}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-sky-600/40 bg-sky-500/10"
                        title="Repeat rows"
                      >
                        <Repeat className="w-3.5 h-3.5" />
                        {fmtNum(r?.repeat_rows)}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-violet-600/40 bg-violet-500/10"
                        title="Government rows"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {fmtNum(r?.government_rows)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{fmtDate(r?.last_history_at)}</td>
                  <td className="px-3 py-2 text-right">
                    {/* Placeholder for future “Open” or “Recommend Carriers” action */}
                    <button
                      className="text-xs px-2 py-1 rounded-md border border-zinc-700/60 bg-zinc-900/40 hover:bg-zinc-900/60 transition"
                      onClick={() => {
                        // Hook: later you can navigate to `/customers/:id` or open a side panel
                        // For now we just no-op
                      }}
                      title="Open details"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer hint */}
      <div className="flex items-center gap-2 mt-3 text-xs opacity-70">
        <Brain className="w-4 h-4" />
        <span>
          Data is coming from <code>rpc_ai_customer_training()</code>. Click{" "}
          <b>Train AI</b> after importing new records.
        </span>
      </div>
    </section>
  );
}
