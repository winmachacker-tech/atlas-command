// src/components/DriverFitChip.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2 } from "lucide-react";

/**
 * DriverFitChip
 * Shows: "Fit: 85% · good" and live-updates when feedback changes.
 *
 * Props:
 *  - driverId (uuid)
 */
export default function DriverFitChip({ driverId }) {
  const [score, setScore] = useState(null); // 0..100
  const [loading, setLoading] = useState(true);

  const fetchFit = async () => {
    if (!driverId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("v_driver_fit_metrics")
      .select("display_score_pct")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (error) {
      console.error("DriverFitChip fetch error:", error);
    }
    setScore(data?.display_score_pct ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    if (!driverId) return;
    let active = true;

    // initial load
    fetchFit();

    // live update when feedback rows change for this driver
    const channel = supabase
      .channel(`fitchip_${driverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_feedback", filter: `driver_id=eq.${driverId}` },
        () => {
          if (active) fetchFit();
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [driverId]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/60 px-2 py-1 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
        <span className="opacity-70">Fit: …</span>
      </span>
    );
  }

  const pct = Number(score ?? 0);
  const label = pct >= 80 ? "excellent" : pct >= 60 ? "good" : pct >= 40 ? "fair" : "poor";
  const tone =
    pct >= 80
      ? "bg-emerald-600/20 text-emerald-300 border-emerald-700/40"
      : pct >= 60
      ? "bg-amber-600/20 text-amber-300 border-amber-700/40"
      : "bg-rose-600/20 text-rose-300 border-rose-700/40";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-xl border px-2 py-1 text-xs font-medium ${tone}`}
      title={`Driver Fit: ${pct}%`}
    >
      {/* Use ASCII hyphen to avoid the stray "Â" character */}
      Fit: {pct}% - {label}
    </span>
  );
}
