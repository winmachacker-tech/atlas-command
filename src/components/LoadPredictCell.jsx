// FILE: src/components/LoadPredictCell.jsx
// Purpose: Tiny, row-friendly Predict button for the Loads page.
// - Calls rpc_ai_predict_best_drivers_for_lane for this load's lane.
// - Shows a compact dropdown with top drivers + scores.
// - Safe even if origin/destination are blank (disables itself).

import { useCallback, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Brain, Loader2, ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }
function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function LoadPredictCell({
  origin,
  destination,
  limit = 5,
  modelVersion = "v1",
  className = "",
  size = "sm",
  onResults, // optional callback(resultsArray)
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const pad = size === "sm" ? "px-2.5 py-1.5" : size === "lg" ? "px-5 py-3" : "px-3.5 py-2";
  const text = size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm";

  const disabledReason = useMemo(() => {
    const o = (origin ?? "").toString().trim();
    const d = (destination ?? "").toString().trim();
    if (!o || !d) return "Set origin & destination first";
    return null;
  }, [origin, destination]);

  const predict = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setRows(null);

    try {
      const { data, error } = await supabase.rpc("rpc_ai_predict_best_drivers_for_lane", {
        p_origin: origin,
        p_dest: destination,
        p_limit: limit,
        p_model_version: modelVersion,
      });
      if (error) throw error;

      const arr = Array.isArray(data) ? data : [];
      setRows(arr);
      onResults?.(arr);
      setOpen(true);
    } catch (err) {
      console.error("Predict error:", err);
      setError(err?.message || "Prediction failed");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, limit, modelVersion, loading, onResults]);

  return (
    <div className={cx("relative inline-block", className)}>
      <button
        onClick={predict}
        disabled={loading || !!disabledReason}
        className={cx(
          "inline-flex items-center gap-2 rounded-lg border",
          "bg-white/5 hover:bg-white/10 border-white/10",
          "shadow-sm transition active:scale-[0.99]",
          disabledReason ? "opacity-60 cursor-not-allowed" : "",
          pad
        )}
        title={disabledReason ?? "Predict the best drivers for this lane"}
      >
        {loading ? <Loader2 className="animate-spin" size={14} /> : <Brain size={14} />}
        <span className={cx(text, "font-medium")}>Predict</span>
        <ChevronDown size={14} className={cx(open ? "rotate-180 transition" : "transition")} />
      </button>

      {open && (
        <div
          className={cx(
            "absolute right-0 z-50 mt-2 w-[360px] max-w-[90vw]",
            "rounded-xl border border-white/10 bg-black/70 backdrop-blur",
            "shadow-lg p-3"
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-white/70">
              <span className="font-semibold">Lane:</span>{" "}
              {(origin ?? "UNKNOWN").toString().trim() || "UNKNOWN"} →{" "}
              {(destination ?? "UNKNOWN").toString().trim() || "UNKNOWN"}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] text-white/50 hover:text-white/80"
            >
              Close
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2">
              <AlertTriangle size={14} />
              <span className="text-[11px]">{error}</span>
            </div>
          )}

          {!error && (rows?.length ?? 0) === 0 && (
            <div className="text-[11px] text-white/70">
              No predictions yet. Give a couple thumbs on this lane and click Train AI, or try
              another lane.
            </div>
          )}

          {!error && (rows?.length ?? 0) > 0 && (
            <ul className="space-y-2">
              {rows.map((r, idx) => (
                <li
                  key={`${r.driver_id}-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </div>
                    <div className="flex flex-col">
                      {/* Replace driver_id with driver display data if you have it */}
                      <div className="text-sm font-medium truncate max-w-[180px]">
                        {r.driver_id ?? "—"}
                      </div>
                      <div className="text-[10px] text-white/60">
                        {r.o_norm} → {r.d_norm}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{pct(r.score)}</span>
                    <span
                      className={cx(
                        "text-[10px] px-2 py-0.5 rounded-full border",
                        r.source === "learned"
                          ? "border-emerald-500/30 bg-emerald-500/10"
                          : "border-sky-500/30 bg-sky-500/10"
                      )}
                      title={r.source === "learned" ? "Model-trained score" : "Thumbs fallback"}
                    >
                      {r.source}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loading && !error && (rows?.length ?? 0) > 0 && (
            <div className="mt-2 text-[10.5px] text-white/50 flex items-center gap-2">
              <CheckCircle2 size={12} />
              Results from model <span className="font-mono">{rows[0]?.model_ver ?? "v1"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
