// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  LayoutDashboard,
  Truck,
  CheckCircle2,
  TriangleAlert,
  RefreshCcw,
} from "lucide-react";

/**
 * Atlas Command — Dashboard (safe v2)
 * - Fixes ".eq is not a function" by using the correct query builder chain
 * - Graceful with RLS: empty arrays simply render 0s instead of errors
 * - No external deps beyond Tailwind + lucide-react
 */

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function StatCard({ icon: Icon, label, value, hint, tone = "zinc", loading = false }) {
  const toneMap = {
    zinc:
      "border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/70",
    blue:
      "border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/40",
    green:
      "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/40",
    yellow:
      "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/40",
    red:
      "border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/40",
  };

  return (
    <div
      className={cx(
        "rounded-2xl border p-4 backdrop-blur-md shadow-sm",
        toneMap[tone] || toneMap.zinc
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-zinc-200/60 bg-white/70 p-2 dark:border-zinc-800/60 dark:bg-zinc-900/70">
            <Icon className="h-5 w-5 text-zinc-700 dark:text-zinc-200" />
          </div>
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {label}
          </div>
        </div>
        {loading ? (
          <RefreshCcw className="h-4 w-4 animate-spin text-zinc-400" />
        ) : null}
      </div>

      <div className="mt-3 text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {loading ? "—" : value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({
    all: 0,
    in_transit: 0,
    delivered: 0,
    problem: 0,
  });
  const [error, setError] = useState(null);

  const isLocal = useMemo(
    () => typeof window !== "undefined" && window.location.hostname === "localhost",
    []
  );

  // Fetch metrics safely
  useEffect(() => {
    let cancelled = false;

    async function fetchMetrics() {
      setLoading(true);
      setError(null);

      try {
        // 1) Ensure session (helps dev logs, not strictly required)
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;

        // 2) Base select — light payload; select only columns we need
        // Important: chain .select() before filters like .eq()
        const base = supabase
          .from("loads")
          .select("id,status", { count: "exact", head: false });

        // 3) Fetch all (we’ll count in JS; RLS may reduce visibility)
        const { data: allRows, error: allErr } = await base;
        if (allErr) throw allErr;

        const all = allRows?.length ?? 0;

        // Count by status (robust to unknown/missing statuses)
        let inTransit = 0;
        let delivered = 0;
        let problem = 0;

        for (const r of allRows || []) {
          const s = String(r.status || "").toLowerCase();
          if (s === "in_transit" || s === "in transit" || s === "dispatched") {
            inTransit += 1;
          } else if (s === "delivered") {
            delivered += 1;
          } else if (
            s === "problem" ||
            s === "issue" ||
            s === "hold" ||
            s === "exception"
          ) {
            problem += 1;
          }
        }

        if (cancelled) return;
        setCounts({
          all,
          in_transit: inTransit,
          delivered,
          problem,
        });

        // Dev-side visibility
        if (isLocal) {
          console.info("[Dashboard] uid =", uid);
          console.info("[Dashboard] sample rows:", (allRows || []).slice(0, 5));
        }
      } catch (e) {
        if (cancelled) return;
        console.error("[Dashboard] fetchMetrics error:", e);
        setError(e?.message || "Failed to load metrics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMetrics();
    return () => {
      cancelled = true;
    };
  }, [isLocal]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-zinc-200 bg-white/70 p-2 dark:border-zinc-800 dark:bg-zinc-900/70">
            <LayoutDashboard className="h-5 w-5 text-zinc-700 dark:text-zinc-200" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Dashboard
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              High-level view of current operations.
            </p>
          </div>
        </div>
      </div>

      {/* Error banner (non-blocking) */}
      {error ? (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="text-sm font-medium">Some metrics may be unavailable.</div>
          <div className="text-xs opacity-80">{String(error)}</div>
        </div>
      ) : null}

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={LayoutDashboard}
          label="All Loads"
          value={counts.all}
          hint="Visible under current RLS policies"
          loading={loading}
        />
        <StatCard
          icon={Truck}
          label="In Transit"
          value={counts.in_transit}
          tone="blue"
          hint="Dispatched / rolling"
          loading={loading}
        />
        <StatCard
          icon={CheckCircle2}
          label="Delivered"
          value={counts.delivered}
          tone="green"
          hint="POD received or marked delivered"
          loading={loading}
        />
        <StatCard
          icon={TriangleAlert}
          label="Problem Board"
          value={counts.problem}
          tone="yellow"
          hint="Issues / holds / exceptions"
          loading={loading}
        />
      </div>

      {/* Empty state helper */}
      {!loading && counts.all === 0 ? (
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white/70 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
          No loads visible. If you expect data, check RLS policies, your role, or the project’s
          table name (<span className="font-mono">loads</span>) and <span className="font-mono">status</span> values.
        </div>
      ) : null}
    </div>
  );
}
