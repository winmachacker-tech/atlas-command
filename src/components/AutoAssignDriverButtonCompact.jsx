// src/components/AutoAssignDriverButtonCompact.jsx
// Compact table-friendly version of AutoAssignDriverButton
import { useCallback, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Wand2, Loader2 } from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }

export default function AutoAssignDriverButtonCompact({
  load,
  modelVersion = "v1",
  onAssigned,
  disabled = false,
}) {
  const [working, setWorking] = useState(false);

  const needsLane = useMemo(() => {
    const o = (load?.origin ?? "").toString().trim();
    const d = (load?.destination ?? "").toString().trim();
    return !o || !d;
  }, [load]);

  const canRun = !working && !needsLane && !disabled && !!load?.id;

  const run = useCallback(async () => {
    if (!canRun) return;
    setWorking(true);

    try {
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
        alert("No predictions yet for this lane.");
        return;
      }

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

      onAssigned?.(updated);
    } catch (e) {
      console.error("Auto-assign error:", e);
      alert(e?.message || "Auto-assign failed");
    } finally {
      setWorking(false);
    }
  }, [canRun, load, modelVersion, onAssigned]);

  return (
    <button
      onClick={run}
      disabled={!canRun}
      title={
        needsLane
          ? "Set origin and destination first"
          : disabled
          ? "Unavailable"
          : "AI auto-assign driver"
      }
      className={cx(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors whitespace-nowrap",
        canRun
          ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30"
          : "bg-white/5 border-white/20 text-white/40 cursor-not-allowed"
      )}
    >
      {working ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
      ) : (
        <Wand2 className="w-3.5 h-3.5 flex-shrink-0" />
      )}
      <span>Auto-assign</span>
    </button>
  );
}