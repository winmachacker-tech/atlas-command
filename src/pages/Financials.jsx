// FILE: src/pages/Financials.jsx
// Purpose: Financial projections dashboard for Atlas Command
// Access: Super Admin only (platform owner)
// Data: Live from Stripe API via stripe-info edge function

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  TrendingUp,
  DollarSign,
  Users,
  Target,
  Calculator,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Building2,
  Rocket,
  PieChart,
  BarChart3,
  Calendar,
  AlertTriangle,
  CreditCard,
  Activity,
  CheckCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart as RechartsPie,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { supabase } from "../lib/supabase";

/* ---------------------- Utility ---------------------- */
function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatCurrency(value, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

/* ---------------------- Pricing Tiers (for projections) ---------------------- */
const PRICING_TIERS = [
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 1500,
    annualPrice: 18000,
    acv: 18000,
    mixPercent: 50,
    color: "#10b981", // emerald
    icon: Zap,
    features: ["Up to 15 trucks", "Basic AI dispatch", "50 OCR docs/mo", "Email support"],
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 2500,
    annualPrice: 30000,
    acv: 30000,
    mixPercent: 35,
    color: "#f59e0b", // amber
    icon: TrendingUp,
    features: ["Up to 40 trucks", "Full AI automation", "Unlimited OCR", "Priority + phone support", "ELD integration"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: 5000, // placeholder for projections
    annualPrice: 60000,
    acv: 60000,
    mixPercent: 15,
    color: "#8b5cf6", // violet
    icon: Building2,
    features: ["Unlimited trucks", "Custom AI training", "Dedicated CSM", "Custom integrations", "SLA guarantee"],
    isCustom: true,
  },
];

/* ---------------------- Projection Calculator ---------------------- */
function calculateProjections(tiers, months = 24, monthlyGrowthRate = 0.15, startingCustomers = 5) {
  const projections = [];
  let totalCustomers = startingCustomers;

  for (let month = 1; month <= months; month++) {
    if (month > 1) {
      totalCustomers = Math.round(totalCustomers * (1 + monthlyGrowthRate));
    }

    const customersByTier = tiers.map((tier) => ({
      ...tier,
      customers: Math.round(totalCustomers * (tier.mixPercent / 100)),
    }));

    const mrr = customersByTier.reduce(
      (sum, tier) => sum + tier.customers * tier.monthlyPrice,
      0
    );
    const arr = mrr * 12;

    const totalTierCustomers = customersByTier.reduce((sum, t) => sum + t.customers, 0);
    const blendedAcv =
      totalTierCustomers > 0
        ? customersByTier.reduce((sum, t) => sum + t.customers * t.acv, 0) / totalTierCustomers
        : 0;

    projections.push({
      month,
      monthLabel: `M${month}`,
      totalCustomers,
      customersByTier,
      mrr,
      arr,
      blendedAcv,
    });
  }

  return projections;
}

/* ---------------------- Metric Card ---------------------- */
function MetricCard({ title, value, subtitle, icon: Icon, trend, color = "emerald", loading = false }) {
  const colorClasses = {
    emerald: "text-emerald-500 bg-emerald-500/10",
    amber: "text-amber-500 bg-amber-500/10",
    violet: "text-violet-500 bg-violet-500/10",
    blue: "text-blue-500 bg-blue-500/10",
    pink: "text-pink-500 bg-pink-500/10",
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--text-muted)]">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
          ) : (
            <p className="text-2xl font-bold mt-1">{value}</p>
          )}
          {subtitle && (
            <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>
          )}
        </div>
        <div className={cx("p-2.5 rounded-lg", colorClasses[color])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {trend !== undefined && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          {trend >= 0 ? (
            <ChevronUp className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-red-500" />
          )}
          <span className={trend >= 0 ? "text-emerald-500" : "text-red-500"}>
            {Math.abs(trend)}%
          </span>
          <span className="text-[var(--text-muted)]">vs last month</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------- Tier Card ---------------------- */
function TierCard({ tier, customers = 0 }) {
  const Icon = tier.icon;
  
  return (
    <div
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5 relative overflow-hidden"
      style={{ borderTopColor: tier.color, borderTopWidth: "3px" }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="p-2 rounded-lg"
          style={{ backgroundColor: `${tier.color}20` }}
        >
          <Icon className="h-5 w-5" style={{ color: tier.color }} />
        </div>
        <div>
          <h3 className="font-semibold">{tier.name}</h3>
          <p className="text-xs text-[var(--text-muted)]">{tier.mixPercent}% of mix</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-baseline">
          <span className="text-sm text-[var(--text-muted)]">Monthly</span>
          <span className="text-xl font-bold">{formatCurrency(tier.monthlyPrice)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-sm text-[var(--text-muted)]">ACV</span>
          <span className="text-lg font-semibold text-[var(--text-muted)]">
            {formatCurrency(tier.acv)}
          </span>
        </div>
        {customers > 0 && (
          <div className="pt-3 border-t border-[var(--border-subtle)]">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-[var(--text-muted)]">Customers</span>
              <span className="text-lg font-semibold" style={{ color: tier.color }}>
                {customers}
              </span>
            </div>
            <div className="flex justify-between items-baseline mt-1">
              <span className="text-sm text-[var(--text-muted)]">MRR</span>
              <span className="font-semibold">
                {formatCurrency(customers * tier.monthlyPrice)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------- Custom Tooltip ---------------------- */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3 shadow-xl">
      <p className="text-sm font-medium mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[var(--text-muted)]">{entry.name}:</span>
          <span className="font-medium">
            {entry.name.includes("Customer") || entry.name === "Customers"
              ? formatNumber(entry.value)
              : formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------- Main Component ---------------------- */
export default function Financials() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [growthRate, setGrowthRate] = useState(15);
  const [startingCustomers, setStartingCustomers] = useState(5);
  const [projectionMonths, setProjectionMonths] = useState(24);

  // Live Stripe data
  const [stripeLoading, setStripeLoading] = useState(true);
  const [stripeError, setStripeError] = useState(null);
  const [stripeData, setStripeData] = useState({
    mrr: 0,
    arr: 0,
    activeSubscriptions: 0,
    trialingSubscriptions: 0,
    totalCustomers: 0,
    products: [],
    subscriptionsByStatus: {},
  });

  // Live data from Supabase
 const [liveMetrics, setLiveMetrics] = useState({
    totalOrgs: 0,
    totalLoads: 0,
    totalDrivers: 0,
    totalTrucks: 0,
    totalCustomers: 0,
    loadsThisMonth: 0,
    loadsLastMonth: 0,
  });
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Check super admin access
  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      try {
        const { data, error } = await supabase.rpc("rpc_is_super_admin");
        
        if (cancelled) return;

        if (error || !data) {
          console.warn("[Financials] Access denied - not super admin");
          navigate("/", { replace: true });
          return;
        }

        setAuthorized(true);
      } catch (err) {
        console.error("[Financials] Auth check failed:", err);
        if (!cancelled) navigate("/", { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    checkAccess();
    return () => { cancelled = true; };
  }, [navigate]);

  // Fetch live Stripe metrics
  async function fetchStripeData() {
    setStripeLoading(true);
    setStripeError(null);
    
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/stripe-info`);
      
      if (!res.ok) {
        throw new Error(`Stripe API error: ${res.status}`);
      }
      
      const data = await res.json();
      
      setStripeData({
        mrr: parseFloat(data.mrr_dollars) || 0,
        arr: parseFloat(data.arr_dollars) || 0,
        activeSubscriptions: data.subscriptions?.active || 0,
        trialingSubscriptions: data.subscriptions?.trialing || 0,
        totalSubscriptions: data.subscriptions?.total || 0,
        totalCustomers: data.customers?.total || 0,
        products: data.products || [],
        prices: data.prices || [],
        subscriptionsByStatus: data.subscriptions?.byStatus || {},
      });
    } catch (err) {
      console.error("[Financials] Failed to fetch Stripe data:", err);
      setStripeError(err.message);
    } finally {
      setStripeLoading(false);
    }
  }

  useEffect(() => {
    if (!authorized) return;
    fetchStripeData();
  }, [authorized]);

// Fetch live platform metrics (super admin only - bypasses RLS)
  useEffect(() => {
    if (!authorized) return;

    async function fetchPlatformMetrics() {
      setMetricsLoading(true);
      try {
        const { data, error } = await supabase.rpc("rpc_platform_metrics");

        if (error) {
          console.error("[Financials] rpc_platform_metrics error:", error);
          return;
        }

        setLiveMetrics({
          totalOrgs: data.total_orgs || 0,
          totalLoads: data.total_loads || 0,
          totalDrivers: data.total_drivers || 0,
          totalTrucks: data.total_trucks || 0,
          totalCustomers: data.total_customers || 0,
          loadsThisMonth: data.loads_this_month || 0,
          loadsLastMonth: data.loads_last_month || 0,
        });
      } catch (err) {
        console.error("[Financials] Failed to fetch platform metrics:", err);
      } finally {
        setMetricsLoading(false);
      }
    }

    fetchPlatformMetrics();
  }, [authorized]);

  // Calculate projections
  const projections = useMemo(() => {
    return calculateProjections(
      PRICING_TIERS,
      projectionMonths,
      growthRate / 100,
      startingCustomers
    );
  }, [growthRate, startingCustomers, projectionMonths]);

  const currentProjection = projections[0];
  const endProjection = projections[projections.length - 1];

  const blendedAcv = useMemo(() => {
    return PRICING_TIERS.reduce(
      (sum, tier) => sum + tier.acv * (tier.mixPercent / 100),
      0
    );
  }, []);

  const revenueChartData = useMemo(() => {
    return projections.map((p) => ({
      month: p.monthLabel,
      MRR: p.mrr,
      ARR: p.arr,
    }));
  }, [projections]);

  const customerChartData = useMemo(() => {
    return projections.map((p) => ({
      month: p.monthLabel,
      Customers: p.totalCustomers,
    }));
  }, [projections]);

  const tierMixData = useMemo(() => {
    return PRICING_TIERS.map((tier) => ({
      name: tier.name,
      value: tier.mixPercent,
      color: tier.color,
    }));
  }, []);

  // Export to CSV
  function handleExport() {
    const headers = ["Month", "Customers", "MRR", "ARR", "Blended ACV"];
    const rows = projections.map((p) => [
      p.monthLabel,
      p.totalCustomers,
      p.mrr.toFixed(2),
      p.arr.toFixed(2),
      p.blendedAcv.toFixed(2),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-financials-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="h-8 w-8 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <TrendingUp className="h-7 w-7 text-emerald-500" />
            Financial Dashboard
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            Live revenue metrics and growth projections
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchStripeData}
            disabled={stripeLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition text-sm disabled:opacity-50"
          >
            <RefreshCw className={cx("h-4 w-4", stripeLoading && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition text-sm"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Live Stripe Metrics */}
      <div className="rounded-xl border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Activity className="h-5 w-5 text-emerald-500" />
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-emerald-500 rounded-full animate-pulse" />
            </div>
            <span className="font-semibold text-emerald-500">Live Stripe Metrics</span>
            <span className="text-xs text-[var(--text-muted)] ml-2">
              (Sandbox)
            </span>
          </div>
          {stripeError && (
            <span className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {stripeError}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            title="Monthly Recurring Revenue"
            value={formatCurrency(stripeData.mrr)}
            subtitle="Active subscriptions"
            icon={DollarSign}
            color="emerald"
            loading={stripeLoading}
          />
          <MetricCard
            title="Annual Run Rate"
            value={formatCurrency(stripeData.arr)}
            subtitle="MRR × 12"
            icon={TrendingUp}
            color="violet"
            loading={stripeLoading}
          />
          <MetricCard
            title="Active Subscriptions"
            value={formatNumber(stripeData.activeSubscriptions)}
            subtitle={stripeData.trialingSubscriptions > 0 ? `+ ${stripeData.trialingSubscriptions} trialing` : "Paying customers"}
            icon={CreditCard}
            color="amber"
            loading={stripeLoading}
          />
          <MetricCard
            title="Total Customers"
            value={formatNumber(stripeData.totalCustomers)}
            subtitle="In Stripe"
            icon={Users}
            color="blue"
            loading={stripeLoading}
          />
        </div>
      </div>

{/* Platform Usage Metrics */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <span className="font-semibold text-amber-500">Platform-Wide Metrics</span>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            All organizations
          </span>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div>
            <p className="text-xs text-[var(--text-muted)]">Organizations</p>
            {metricsLoading ? (
              <div className="h-7 w-12 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
            ) : (
              <p className="text-2xl font-bold text-amber-500">{formatNumber(liveMetrics.totalOrgs)}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Total Loads</p>
            {metricsLoading ? (
              <div className="h-7 w-16 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
            ) : (
              <p className="text-2xl font-bold">{formatNumber(liveMetrics.totalLoads)}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Loads This Month</p>
            {metricsLoading ? (
              <div className="h-7 w-12 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
            ) : (
              <p className="text-2xl font-bold text-emerald-500">{formatNumber(liveMetrics.loadsThisMonth)}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Loads Last Month</p>
            {metricsLoading ? (
              <div className="h-7 w-12 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
            ) : (
              <p className="text-2xl font-bold text-[var(--text-muted)]">{formatNumber(liveMetrics.loadsLastMonth)}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Drivers</p>
            {metricsLoading ? (
              <div className="h-7 w-12 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
            ) : (
              <p className="text-2xl font-bold">{formatNumber(liveMetrics.totalDrivers)}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Trucks</p>
            {metricsLoading ? (
              <div className="h-7 w-12 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
            ) : (
              <p className="text-2xl font-bold">{formatNumber(liveMetrics.totalTrucks)}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Customers</p>
            {metricsLoading ? (
              <div className="h-7 w-12 bg-[var(--bg-surface)] animate-pulse rounded mt-1" />
            ) : (
              <p className="text-2xl font-bold">{formatNumber(liveMetrics.totalCustomers)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Subscription Status Breakdown */}
      {Object.keys(stripeData.subscriptionsByStatus).length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-[var(--text-muted)]" />
            Subscription Status Breakdown
          </h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stripeData.subscriptionsByStatus).map(([status, count]) => (
              <div
                key={status}
                className={cx(
                  "px-4 py-2 rounded-lg border",
                  status === "active" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-500",
                  status === "trialing" && "bg-blue-500/10 border-blue-500/30 text-blue-500",
                  status === "canceled" && "bg-red-500/10 border-red-500/30 text-red-500",
                  status === "past_due" && "bg-amber-500/10 border-amber-500/30 text-amber-500",
                  !["active", "trialing", "canceled", "past_due"].includes(status) && "bg-[var(--bg-surface)] border-[var(--border)]"
                )}
              >
                <span className="text-lg font-bold">{count}</span>
                <span className="text-sm ml-2 capitalize">{status.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-[var(--border-subtle)] pt-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Calculator className="h-5 w-5 text-[var(--text-muted)]" />
          Growth Projections
        </h2>
      </div>

      {/* Projection Controls */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calculator className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-sm font-medium">Projection Parameters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              Starting Customers
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={startingCustomers}
              onChange={(e) => setStartingCustomers(Number(e.target.value) || 1)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              Monthly Growth Rate (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={growthRate}
              onChange={(e) => setGrowthRate(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              Projection Period (months)
            </label>
            <select
              value={projectionMonths}
              onChange={(e) => setProjectionMonths(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm"
            >
              <option value={12}>12 months</option>
              <option value={24}>24 months</option>
              <option value={36}>36 months</option>
              <option value={48}>48 months</option>
            </select>
          </div>
        </div>
      </div>

      {/* Projected Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Blended ACV"
          value={formatCurrency(blendedAcv)}
          subtitle="Weighted average contract value"
          icon={Target}
          color="emerald"
        />
        <MetricCard
          title="Projected MRR (M1)"
          value={formatCurrency(currentProjection?.mrr || 0)}
          subtitle={`${currentProjection?.totalCustomers || 0} customers`}
          icon={DollarSign}
          color="amber"
        />
        <MetricCard
          title={`Projected ARR (M${projectionMonths})`}
          value={formatCurrency(endProjection?.arr || 0)}
          subtitle={`${endProjection?.totalCustomers || 0} customers`}
          icon={TrendingUp}
          color="violet"
        />
        <MetricCard
          title="Customer Growth"
          value={`${formatNumber(endProjection?.totalCustomers || 0)}`}
          subtitle={`From ${startingCustomers} → ${endProjection?.totalCustomers || 0}`}
          icon={Users}
          color="blue"
        />
      </div>

      {/* Pricing Tiers */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <PieChart className="h-5 w-5 text-[var(--text-muted)]" />
          Pricing Tiers & Mix
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PRICING_TIERS.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              customers={
                currentProjection?.customersByTier.find((t) => t.id === tier.id)
                  ?.customers || 0
              }
            />
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[var(--text-muted)]" />
            Projected Revenue Growth
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border-subtle)" }}
                />
                <YAxis
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border-subtle)" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="MRR"
                  stroke="#10b981"
                  fill="#10b98130"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Customer Growth Chart */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--text-muted)]" />
            Projected Customer Growth
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={customerChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border-subtle)" }}
                />
                <YAxis
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border-subtle)" }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="Customers" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tier Mix Pie Chart */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <PieChart className="h-4 w-4 text-[var(--text-muted)]" />
          Target Customer Mix by Tier
        </h3>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPie>
              <Pie
                data={tierMixData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}%`}
                labelLine={{ stroke: "var(--text-muted)" }}
              >
                {tierMixData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </RechartsPie>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Projection Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border-subtle)]">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[var(--text-muted)]" />
            Monthly Projections
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">
                  Month
                </th>
                <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">
                  Customers
                </th>
                <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">
                  MRR
                </th>
                <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">
                  ARR
                </th>
                <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">
                  Blended ACV
                </th>
              </tr>
            </thead>
            <tbody>
              {projections.slice(0, 12).map((p, idx) => (
                <tr
                  key={p.month}
                  className={cx(
                    "border-b border-[var(--border-subtle)]",
                    idx % 2 === 0 ? "bg-[var(--bg-panel)]" : "bg-[var(--bg-surface)]"
                  )}
                >
                  <td className="px-4 py-3 font-medium">{p.monthLabel}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(p.totalCustomers)}</td>
                  <td className="px-4 py-3 text-right text-emerald-500">
                    {formatCurrency(p.mrr)}
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(p.arr)}</td>
                  <td className="px-4 py-3 text-right text-[var(--text-muted)]">
                    {formatCurrency(p.blendedAcv)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {projections.length > 12 && (
          <div className="p-3 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)]">
            Showing first 12 months • Export CSV for full data
          </div>
        )}
      </div>
    </div>
  );
}