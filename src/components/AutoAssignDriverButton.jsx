// FILE: src/components/AutoAssignDriverButton.jsx
// Purpose: One-click "Auto-assign driver" for a load.
// - Predicts best driver via rpc_ai_predict_best_drivers_for_lane
// - Updates loads.driver_id to the top candidate
// - Calls onAssigned() so the parent can refresh the row

import { useCallback, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Wand2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }

export default function AutoAssignDriverButton({
  load,                // expects { id, origin, destination }
  modelVersion = "v1",
  className = "",
  size = "md",
  onAssigned,          // optional callback(updatedLoad)
  disabled = false,
  title,
}) {
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState(null);

  const pad = size === "sm" ? "px-3 py-1.5" : size === "lg" ? "px-5 py-3" : "px-4 py-2";
  const text = size === "sm" ? "text-sm" : size === "lg" ? "text-base" : "text-sm";

  const needsLane = useMemo(() => {
    const o = (load?.origin ?? "").toString().trim();
    const d = (load?.destination ?? "").toString().trim();
    return !o || !d;
  }, [load]);

  const canRun = !working && !needsLane && !disabled && !!load?.id;

  const run = useCallback(async () => {
    if (!canRun) return;
    setWorking(true);
    setToast(null);

    try {
      // 1) Predict the best driver for this lane
      const { data: preds, error: predErr } = await supabase.rpc(
        "rpc_ai_predict_best_drivers_for_lane",
        {
          p_origin: load.origin,
          p_dest: load.destination,
          p_limit: 1,
          p_model_version: modelVersion,
        }
      );
      if (predErr) throw predErr;

      const best = Array.isArray(preds) && preds[0] ? preds[0] : null;
      if (!best?.driver_id) {
        setToast({ tone: "error", msg: "No predictions yet for this lane." });
        return;
      }

      // Fetch the driver's display name (optional, for the toast)
      let driverName = best.driver_id;
      try {
        const { data: drv } = await supabase
          .from("drivers")
          .select("id, first_name, last_name")
          .eq("id", best.driver_id)
          .single();
        if (drv) {
          const fn = drv.first_name?.trim() || "";
          const ln = drv.last_name?.trim() || "";
          driverName = [ln, fn].filter(Boolean).join(", ") || drv.id;
        }
      } catch { /* non-blocking */ }

      // 2) Assign the driver to this load
      const { data: updated, error: updErr } = await supabase
        .from("loads")
        .update({ driver_id: best.driver_id, updated_at: new Date().toISOString() })
        .eq("id", load.id)
        .select(`
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `)
        .single();
      if (updErr) throw updErr;

      setToast({
        tone: "success",
        msg: `Assigned ${driverName} to this load.`,
      });

      onAssigned?.(updated);
    } catch (e) {
      console.error("Auto-assign error:", e);
      setToast({ tone: "error", msg: e?.message || "Auto-assign failed" });
    } finally {
      setWorking(false);
    }
  }, [canRun, load, modelVersion, onAssigned]);

  return (
    <div className={cx("inline-flex flex-col gap-2", className)}>
      <button
        onClick={run}
        disabled={!canRun}
        title={
          title ??
          (needsLane
            ? "Set origin and destination first"
            : disabled
            ? "Unavailable"
            : "Predict the best driver and auto-assign")
        }
        className={cx(
          "inline-flex items-center gap-2 rounded-xl border",
          "bg-emerald-600/90 hover:bg-emerald-500 text-black border-emerald-700/40",
          "shadow-sm transition active:scale-[0.99]",
          !canRun ? "opacity-60 cursor-not-allowed" : "",
          pad
        )}
      >
        {working ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
        <span className={cx(text, "font-semibold")}>Auto-assign driver</span>
      </button>

      {toast && (
        <div
          className={cx(
            "flex items-center gap-2 rounded-lg border px-3 py-2",
            toast.tone === "success"
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-amber-500/10 border-amber-500/30"
          )}
        >
          {toast.tone === "success" ? (
            <CheckCircle2 size={16} className="shrink-0" />
          ) : (
            <AlertTriangle size={16} className="shrink-0" />
          )}
          <span className="text-xs leading-tight">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
