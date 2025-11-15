// FILE: src/components/PredictBestDriversButton.jsx
// Purpose: Rank the best drivers for a lane via rpc_ai_predict_best_drivers_for_lane.
// - Pass origin/destination strings from your load (free-form is OK).
// - Shows a compact result list with scores and source badges (learned/cold_start).

import { useCallback, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Brain, Loader2, ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }
function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function PredictBestDriversButton({
  origin,
  destination,
  limit = 5,
  modelVersion = "v1",
  className = "",
  size = "md",
  onResults, // optional callback(resultsArray)
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const pad = size === "sm" ? "px-3 py-1.5" : size === "lg" ? "px-5 py-3" : "px-4 py-2";
  const text = size === "sm" ? "text-sm" : size === "lg" ? "text-base" : "text-sm";

  const disabledReason = useMemo(() => {
    const o = (origin ?? "").toString().trim();
    const d = (destination ?? "").toString().trim();
    if (!o || !d) return "Set origin and destination first";
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
          "inline-flex items-center gap-2 rounded-xl border",
          "bg-white/5 hover:bg-white/10 border-white/10",
          "shadow-sm transition active:scale-[0.99]",
          disabledReason ? "opacity-60 cursor-not-allowed" : "",
          pad
        )}
        title={disabledReason ?? "Predict the best drivers for this lane"}
      >
        {loading ? <Loader2 className="animate-spin" size={16} /> : <Brain size={16} />}
        <span className={cx(text, "font-medium")}>Predict Drivers</span>
        <ChevronDown size={16} className={cx(open ? "rotate-180 transition" : "transition")} />
      </button>

      {open && (
        <div
          className={cx(
            "absolute z-50 mt-2 w-[420px] max-w-[90vw]",
            "rounded-xl border border-white/10 bg-black/70 backdrop-blur",
            "shadow-lg p-3"
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-white/70">
              <span className="font-semibold">Lane:</span>{" "}
              {(origin ?? "UNKNOWN").toString().trim() || "UNKNOWN"} →{" "}
              {(destination ?? "UNKNOWN").toString().trim() || "UNKNOWN"}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-white/50 hover:text-white/80"
            >
              Close
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2">
              <AlertTriangle size={16} />
              <span className="text-xs">{error}</span>
            </div>
          )}

          {!error && (rows?.length ?? 0) === 0 && (
            <div className="text-xs text-white/70">
              No predictions yet. Give a couple thumbs on this lane and run Train AI, or try another
              lane.
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
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[11px]">
                      {idx + 1}
                    </div>
                    <div className="flex flex-col">
                      <div className="text-sm font-medium">
                        {r.driver_id ?? "—"}
                      </div>
                      <div className="text-[11px] text-white/60">
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
            <div className="mt-2 text-[11px] text-white/50 flex items-center gap-2">
              <CheckCircle2 size={14} />
              Results from model <span className="font-mono">{rows[0]?.model_ver ?? "v1"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
