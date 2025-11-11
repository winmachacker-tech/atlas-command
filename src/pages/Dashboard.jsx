// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import AiLearningCard from "../components/AiLearningCard.jsx";
import {
  LayoutDashboard,
  Truck,
  CheckCircle2,
  TriangleAlert,
  RefreshCcw,
  ClipboardList,
  Clock,
  DollarSign,
  TrendingUp,
  Users,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";

/**
 * Atlas Command — Dashboard (Enterprise v1)
 * - Theme-matched styling
 * - Real-time data updates
 * - Interactive stat cards
 * - KPI metrics with trends
 * - Alerts & warnings
 */

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function StatCard({ icon: Icon, label, value, hint, tone = "zinc", loading = false, onClick, trend }) {
  const toneMap = {
    zinc: "border-[var(--border)] bg-[var(--bg-panel)]",
    blue: "border-blue-500/20 bg-blue-500/10",
    green: "border-emerald-500/20 bg-emerald-500/10",
    yellow: "border-amber-500/20 bg-amber-500/10",
    red: "border-rose-500/20 bg-rose-500/10",
  };

  const Component = onClick ? "button" : "div";

  const getTrendIcon = () => {
    if (!trend || trend.change === 0) return Minus;
    return trend.change > 0 ? ArrowUp : ArrowDown;
  };

  const getTrendColor = () => {
    if (!trend || trend.change === 0) return "text-[var(--text-muted)]";
    return trend.change > 0 ? "text-emerald-500" : "text-rose-500";
  };

  const TrendIcon = getTrendIcon();

  return (
    <Component
      onClick={onClick}
      className={cx(
        "rounded-2xl border p-4 backdrop-blur-md shadow-sm transition-all",
        toneMap[tone] || toneMap.zinc,
        onClick && "cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] text-left w-full"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-2">
            <Icon className="h-5 w-5 text-[var(--text-base)]" />
          </div>
          <div className="text-sm font-medium text-[var(--text-base)]">
            {label}
          </div>
        </div>
        {loading ? (
          <RefreshCcw className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
        ) : null}
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div className="text-3xl font-semibold tabular-nums text-[var(--text-base)]">
          {loading ? "—" : value}
        </div>
        {trend && !loading && (
          <div className={cx("flex items-center gap-1 text-sm font-medium", getTrendColor())}>
            <TrendIcon className="h-4 w-4" />
            <span>{Math.abs(trend.change)}{trend.isPercentage ? "%" : ""}</span>
          </div>
        )}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div>
      ) : null}
    </Component>
  );
}

function KPICard({ icon: Icon, label, value, subtitle, loading = false }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 backdrop-blur-md">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-[var(--text-muted)]" />
        <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-[var(--text-base)]">
        {loading ? "—" : value}
      </div>
      {subtitle && (
        <div className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</div>
      )}
    </div>
  );
}

function AlertItem({ icon: Icon, title, message, severity = "warning", onClick }) {
  const severityStyles = {
    warning: "border-amber-500/20 bg-amber-500/10",
    error: "border-rose-500/20 bg-rose-500/10",
    info: "border-blue-500/20 bg-blue-500/10",
  };

  const iconStyles = {
    warning: "text-amber-500",
    error: "text-rose-500",
    info: "text-blue-500",
  };

  const Component = onClick ? "button" : "div";

  return (
    <Component
      onClick={onClick}
      className={cx(
        "rounded-xl border p-3 w-full text-left transition-all",
        severityStyles[severity],
        onClick && "cursor-pointer hover:shadow-md"
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cx("h-5 w-5 shrink-0 mt-0.5", iconStyles[severity])} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-base)]">{title}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{message}</p>
        </div>
      </div>
    </Component>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [counts, setCounts] = useState({
    all: 0,
    in_transit: 0,
    delivered: 0,
    problem: 0,
  });
  const [kpis, setKpis] = useState({
    onTimeRate: 0,
    revenue: 0,
    activeDrivers: 0,
  });
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);

  const isLocal = useMemo(
    () => typeof window !== "undefined" && window.location.hostname === "localhost",
    []
  );

  // Fetch metrics safely
  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;

      const base = supabase
        .from("loads")
        .select("id,status", { count: "exact", head: false });

      const { data: allRows, error: allErr } = await base;
      if (allErr) throw allErr;

      const all = allRows?.length ?? 0;

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

      setCounts({
        all,
        in_transit: inTransit,
        delivered,
        problem,
      });

      if (isLocal) {
        console.info("[Dashboard] uid =", uid);
        console.info("[Dashboard] sample rows:", (allRows || []).slice(0, 5));
      }
    } catch (e) {
      console.error("[Dashboard] fetchMetrics error:", e);
      setError(e?.message || "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  };

  // Fetch KPIs
  const fetchKPIs = async () => {
    setKpiLoading(true);

    try {
      // Fetch delivered loads to calculate on-time rate
      const { data: deliveredLoads, error: deliveredError } = await supabase
        .from("loads")
        .select("*")
        .eq("status", "delivered");

      console.log("[Dashboard] Delivered loads:", deliveredLoads);
      console.log("[Dashboard] Delivered error:", deliveredError);
      console.log("[Dashboard] Sample load:", deliveredLoads?.[0]);

      // Calculate on-time delivery rate
      let onTimeCount = 0;
      const total = deliveredLoads?.length || 0;

      for (const load of deliveredLoads || []) {
        if (load.expected_delivery && load.delivered_at) {
          const expected = new Date(load.expected_delivery);
          const actual = new Date(load.delivered_at);
          if (actual <= expected) onTimeCount++;
        }
      }

      const onTimeRate = total > 0 ? Math.round((onTimeCount / total) * 100) : 0;

      // Get active drivers count
      const { count: driverCount } = await supabase
        .from("drivers")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");

      // Calculate revenue (fallback across possible fields)
      let revenue = 0;
      for (const load of deliveredLoads || []) {
        const amount = load.rate || load.price || load.revenue || load.amount || 0;
        revenue += parseFloat(amount) || 0;
      }

      setKpis({
        onTimeRate,
        revenue,
        activeDrivers: driverCount || 0,
      });

      // Generate alerts based on data
      const generatedAlerts = [];

      if (counts.problem > 0) {
        generatedAlerts.push({
          id: "problem-loads",
          icon: AlertCircle,
          title: `${counts.problem} Load${counts.problem > 1 ? "s" : ""} Need Attention`,
          message: "Issues, holds, or exceptions require immediate action",
          severity: "error",
          onClick: () => navigate("/loads"),
        });
      }

      if (onTimeRate < 90 && total > 0) {
        generatedAlerts.push({
          id: "low-ontime",
          icon: Clock,
          title: "On-Time Delivery Below Target",
          message: `Current rate: ${onTimeRate}% (Target: 90%+)`,
          severity: "warning",
        });
      }

      setAlerts(generatedAlerts);
    } catch (e) {
      console.error("[Dashboard] fetchKPIs error:", e);
    } finally {
      setKpiLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchMetrics();
    fetchKPIs();
  }, []);

  // Real-time subscriptions for loads
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-loads")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loads",
        },
        () => {
          fetchMetrics();
          fetchKPIs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Real-time subscriptions for drivers
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-drivers")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "drivers",
        },
        () => {
          fetchKPIs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-2">
            <LayoutDashboard className="h-5 w-5 text-[var(--text-base)]" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-base)]">
              Dashboard
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              High-level view of current operations. Click any card to drill down.
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            fetchMetrics();
            fetchKPIs();
          }}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="text-sm font-medium text-[var(--text-base)]">Some metrics may be unavailable.</div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">{String(error)}</div>
        </div>
      ) : null}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <AlertItem key={alert.id} {...alert} />
          ))}
        </div>
      )}

      {/* KPIs Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          icon={TrendingUp}
          label="On-Time Delivery Rate"
          value={`${kpis.onTimeRate}%`}
          subtitle={kpis.onTimeRate >= 90 ? "Target met ✓" : "Below target (90%)"}
          loading={kpiLoading}
        />
        <KPICard
          icon={DollarSign}
          label="Total Revenue (Delivered)"
          value={`$${kpis.revenue.toLocaleString()}`}
          subtitle="From completed loads"
          loading={kpiLoading}
        />
        <KPICard
          icon={Users}
          label="Active Drivers"
          value={kpis.activeDrivers}
          subtitle="Currently available"
          loading={kpiLoading}
        />
      </div>

      {/* NEW: AI Learning Proof — full width */}
      <AiLearningCard />

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ClipboardList}
          label="All Loads"
          value={counts.all}
          hint="Click to view all loads"
          loading={loading}
          onClick={() => navigate("/loads")}
        />
        <StatCard
          icon={Truck}
          label="In Transit"
          value={counts.in_transit}
          tone="blue"
          hint="Click to view in-transit loads"
          loading={loading}
          onClick={() => navigate("/in-transit")}
        />
        <StatCard
          icon={CheckCircle2}
          label="Delivered"
          value={counts.delivered}
          tone="green"
          hint="Click to view delivered loads"
          loading={loading}
          onClick={() => navigate("/delivered")}
        />
        <StatCard
          icon={TriangleAlert}
          label="Problem Board"
          value={counts.problem}
          tone="yellow"
          hint="Click to view problem loads"
          loading={loading}
          onClick={() => navigate("/loads")}
        />
      </div>

      {/* Empty state helper */}
      {!loading && counts.all === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--text-muted)]">
          No loads visible. If you expect data, check RLS policies, your role, or the project's
          table name (<span className="font-mono">loads</span>) and <span className="font-mono">status</span> values.
        </div>
      ) : null}
    </div>
  );
}
