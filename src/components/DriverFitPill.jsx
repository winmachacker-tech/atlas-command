// src/components/DriverFitPill.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2 } from "lucide-react";

export default function DriverFitPill({ driverId }) {
  const [pct, setPct] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchFit() {
    if (!driverId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("v_driver_fit_metrics")
      .select("display_score_pct")
      .eq("driver_id", driverId)
      .maybeSingle();
    if (error) console.error("DriverFitPill fetch error:", error);
    setPct(data?.display_score_pct ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    if (!driverId) return;
    let active = true;
    fetchFit();

    const channel = supabase
      .channel(`fit_pill_${driverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_feedback", filter: `driver_id=eq.${driverId}` },
        () => active && fetchFit()
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [driverId]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-900/50 px-2 py-1 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
        <span className="opacity-70">Fit: …</span>
      </span>
    );
  }

  const score = Number(pct ?? 0);
  const label = score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "fair" : "poor";
  const tone =
    score >= 80
      ? "bg-emerald-600/20 text-emerald-300 border-emerald-700/40"
      : score >= 60
      ? "bg-amber-600/20 text-amber-300 border-amber-700/40"
      : "bg-rose-600/20 text-rose-300 border-rose-700/40";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-xl border px-2 py-1 text-xs font-medium ${tone}`}
      title={`Driver Fit: ${score}%`}
    >
      Fit: {score}% - {label}
    </span>
  );
}
