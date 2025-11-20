// FILE: src/components/FuelPriceSettings.jsx
// PURPOSE: Super Admin panel for managing diesel fuel prices from EIA API
// - View current diesel price and last updated date
// - Manually fetch latest price from EIA
// - Display default truck MPG setting
// - Show info about automatic updates

import { useState, useEffect } from "react";
import { getLatestDieselPrice, fetchLatestDieselPrice } from "../services/fuelPriceService";
import { Fuel, RefreshCw, Loader2, CheckCircle2, XCircle, Info, TrendingUp } from "lucide-react";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function FuelPriceSettings() {
  const [currentPrice, setCurrentPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    loadCurrentPrice();
  }, []);

  const loadCurrentPrice = async () => {
    setLoading(true);
    const price = await getLatestDieselPrice();
    setCurrentPrice(price);
    setLoading(false);
  };

  const handleRefreshPrice = async () => {
    setRefreshing(true);
    setMessage({ type: "", text: "" });

    const result = await fetchLatestDieselPrice();

    if (result.success) {
      setMessage({ 
        type: "success", 
        text: "✓ Diesel price updated successfully from EIA" 
      });
      await loadCurrentPrice();
    } else {
      setMessage({ 
        type: "error", 
        text: `✗ Error: ${result.error}` 
      });
    }

    setRefreshing(false);

    // Clear message after 5 seconds
    setTimeout(() => setMessage({ type: "", text: "" }), 5000);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Fuel className="w-4 h-4 text-emerald-300" />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
            Fuel Price Management
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading fuel price data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Fuel className="w-4 h-4 text-emerald-300" />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
            Fuel Price Management
          </span>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full border border-slate-700 bg-slate-950/60 text-slate-300">
          EIA API Integration
        </span>
      </div>

      {/* Current Diesel Price Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-slate-950/60 border border-slate-700/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400">Current U.S. Diesel Price</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-emerald-300">
            ${currentPrice?.price?.toFixed(2) || "3.87"}/gal
          </div>
          <div className="text-[10px] text-slate-500 mt-2">
            Last updated: {formatDate(currentPrice?.effectiveDate)}
          </div>
          <div className="text-[10px] text-slate-500">
            Source: U.S. Energy Information Administration
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-700/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400">Default Truck Fuel Efficiency</span>
            <Info className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-3xl font-bold text-slate-100">
            6.5 MPG
          </div>
          <div className="text-[10px] text-slate-500 mt-2">
            Used for calculating fuel costs on loads
          </div>
          <div className="text-[10px] text-slate-500">
            Industry standard for Class 8 semi trucks
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          onClick={handleRefreshPrice}
          disabled={refreshing}
          className={cx(
            "w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition",
            refreshing
              ? "border-slate-700 bg-slate-900/60 text-slate-400 cursor-not-allowed"
              : "border-emerald-500/70 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
          )}
        >
          {refreshing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Fetching Latest Price from EIA...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>Fetch Latest Diesel Price from EIA</span>
            </>
          )}
        </button>

        {/* Status Message */}
        {message.text && (
          <div
            className={cx(
              "text-xs p-3 rounded-xl border flex items-start gap-2",
              message.type === "success"
                ? "bg-emerald-900/20 border-emerald-500/40 text-emerald-300"
                : "bg-red-900/20 border-red-500/40 text-red-300"
            )}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            )}
            <span>{message.text}</span>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-900/10 border border-blue-500/30 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-300/90 space-y-1">
            <p className="font-medium">About Diesel Price Updates</p>
            <p className="text-blue-300/70">
              The U.S. Energy Information Administration (EIA) publishes new weekly diesel prices 
              every <span className="font-semibold">Tuesday at 10am EST</span>. This price is automatically 
              used across all organizations for fuel cost calculations in load profitability metrics.
            </p>
            <p className="text-blue-300/70 mt-2">
              You can manually refresh the price here at any time, or set up a weekly automatic fetch 
              using Supabase cron jobs.
            </p>
          </div>
        </div>
      </div>

      {/* Impact Note */}
      <div className="bg-slate-950/40 border border-slate-700/60 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-1.5" />
          <div className="text-[11px] text-slate-400">
            <span className="font-medium text-slate-300">System-wide impact:</span> This diesel price 
            affects profitability calculations for all loads across all organizations in Atlas Command. 
            Updated prices take effect immediately on all new page loads.
          </div>
        </div>
      </div>
    </div>
  );
}