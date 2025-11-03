// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Truck,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
} from "lucide-react";

/* ------------------------------- UI Helpers ------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-2">
          <Icon className="size-5" />
        </div>
        <div className="text-sm text-zinc-500">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------ Date Helpers ------------------------------ */
function startOfDayISO(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function endOfDayISO(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}
function daysAgoISO(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x.toISOString();
}

/* --------------------------------- Page ---------------------------------- */
export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({
    activeCount: 0, // Pending + In Transit
    deliveredCount7d: 0,
    deliveredRevenue7d: 0,
    problemCount: 0,
    dwellAvg: { pickup: 0, delivery: 0 },
    revenueByDay: [], // [{date:'YYYY-MM-DD', total: number}]
  });

  // last 7 full days (Mon–Sun style rolling window)
  const range = useMemo(() => {
    const end = new Date(); // today
    const start = new Date();
    start.setDate(end.getDate() - 6);
    return {
      startISO: startOfDayISO(start),
      endISO: endOfDayISO(end),
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function fetchMetrics() {
      setLoading(true);
      setError("");

      try {
        // --------------------- 1) Active = Pending | In Transit ---------------------
        // Use head: true + count: 'exact' for fast count without payload
        const { count: activeCount, error: eActive } = await supabase
          .from("loads")
          .select("id", { count: "exact", head: true })
          .eq("deleted", false)
          .in("status", ["Pending", "In Transit"]);
        if (eActive) throw eActive;

        // -------------------- 2) Delivered last 7d (count + sum) --------------------
        const { data: deliveredRows, error: eDelivered } = await supabase
          .from("loads")
          .select("id,linehaul_total,delivered_at")
          .eq("deleted", false)
          .eq("status", "Delivered")
          .gte("delivered_at", range.startISO)
          .lte("delivered_at", range.endISO)
          .limit(2000);
        if (eDelivered) throw eDelivered;

        const deliveredCount7d = deliveredRows.length;
        const deliveredRevenue7d = deliveredRows.reduce(
          (acc, r) => acc + (Number(r.linehaul_total) || 0),
          0
        );

        // ---------------- 3) Problem loads (status=Problem OR flag) ----------------
        const { count: problemCount, error: eProblem } = await supabase
          .from("loads")
          .select("id", { count: "exact", head: true })
          .eq("deleted", false)
          .or("status.eq.Problem,has_problem.eq.true");
        if (eProblem) throw eProblem;

        // ------------- 4) Dwell averages (last 7d delivered or all rows) ----------
        const { data: dwellRows, error: eDwell } = await supabase
          .from("loads")
          .select("pickup_dwell_min,delivery_dwell_min,delivered_at")
          .eq("deleted", false)
          .gte("delivered_at", range.startISO)
          .lte("delivered_at", range.endISO)
          .limit(2000);
        if (eDwell) throw eDwell;

        const dwell = dwellRows.reduce(
          (acc, r) => {
            const p = Number(r.pickup_dwell_min) || 0;
            const d = Number(r.delivery_dwell_min) || 0;
            if (p > 0) {
              acc.pSum += p;
              acc.pN += 1;
            }
            if (d > 0) {
              acc.dSum += d;
              acc.dN += 1;
            }
            return acc;
          },
          { pSum: 0, pN: 0, dSum: 0, dN: 0 }
        );
        const dwellAvg = {
          pickup: dwell.pN ? Math.round(dwell.pSum / dwell.pN) : 0,
          delivery: dwell.dN ? Math.round(dwell.dSum / dwell.dN) : 0,
        };

        // ----------------------- 5) Revenue by day (7 buckets) ---------------------
        // Build YYYY-MM-DD buckets to avoid relying on missing view/RPC
        const buckets = {};
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          buckets[key] = 0;
        }
        for (const r of deliveredRows) {
          const key = new Date(r.delivered_at).toISOString().slice(0, 10);
          if (buckets[key] != null) {
            buckets[key] += Number(r.linehaul_total) || 0;
          }
        }
        const revenueByDay = Object.entries(buckets).map(([date, total]) => ({
          date,
          total,
        }));

        if (!alive) return;
        setStats({
          activeCount: activeCount ?? 0,
          deliveredCount7d,
          deliveredRevenue7d,
          problemCount: problemCount ?? 0,
          dwellAvg,
          revenueByDay,
        });
      } catch (err) {
        if (!alive) return;
        console.error(err);
        setError(err.message || "Failed to load dashboard metrics.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    fetchMetrics();
    return () => {
      alive = false;
    };
  }, [range.startISO, range.endISO]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Top row: stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          icon={Truck}
          label="Active Loads"
          value={loading ? <Skeleton /> : stats.activeCount.toLocaleString()}
          sub="Pending + In Transit"
        />
        <Stat
          icon={CheckCircle2}
          label="Delivered (7d)"
          value={loading ? <Skeleton /> : stats.deliveredCount7d.toLocaleString()}
          sub="Count last 7 days"
        />
        <Stat
          icon={DollarSign}
          label="Revenue (7d)"
          value={
            loading ? <Skeleton /> : `$${Math.round(stats.deliveredRevenue7d).toLocaleString()}`
          }
          sub="Sum of delivered linehaul"
        />
        <Stat
          icon={AlertTriangle}
          label="Problem Loads"
          value={loading ? <Skeleton /> : stats.problemCount.toLocaleString()}
          sub="Status=Problem or flagged"
        />
      </div>

      {/* Dwell + simple revenue sparkline */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm xl:col-span-1">
          <div className="text-sm text-zinc-500">Avg Dwell (7d)</div>
          <div className="mt-3 text-lg">
            Pickup:{" "}
            <span className="font-medium">
              {loading ? "…" : `${stats.dwellAvg.pickup} min`}
            </span>
          </div>
          <div className="mt-1 text-lg">
            Delivery:{" "}
            <span className="font-medium">
              {loading ? "…" : `${stats.dwellAvg.delivery} min`}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm xl:col-span-2">
          <div className="text-sm text-zinc-500 mb-3">Revenue by Day (7d)</div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {(loading ? Array.from({ length: 7 }) : stats.revenueByDay).map(
                  (row, idx) => (
                    <tr
                      key={idx}
                      className={cx(
                        "border-t border-zinc-100 dark:border-zinc-800",
                        "text-zinc-900 dark:text-zinc-100"
                      )}
                    >
                      <td className="py-2 pr-3">
                        {loading ? <Skeleton w={96} /> : row.date}
                      </td>
                      <td className="py-2">
                        {loading ? (
                          <Skeleton w={80} />
                        ) : (
                          `$${Math.round(row.total).toLocaleString()}`
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200/30 bg-red-50/40 dark:bg-red-900/20 p-4 text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------- Skeleton -------------------------------- */
function Skeleton({ w = 60, h = 20 }) {
  return (
    <span
      className="inline-block animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
      style={{ width: w, height: h }}
    />
  );
}
