// src/components/PredictBestDriversButtonCompact.jsx
// Compact table-friendly version with better modal positioning
import { useCallback, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Brain, Loader2, X, AlertTriangle } from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }
function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function PredictBestDriversButtonCompact({
  origin,
  destination,
  limit = 5,
  modelVersion = "v1",
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

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
      setOpen(true);
    } catch (err) {
      console.error("Predict error:", err);
      setError(err?.message || "Prediction failed");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, limit, modelVersion, loading]);

  return (
    <div className="relative inline-block">
      <button
        onClick={predict}
        disabled={loading || !!disabledReason}
        className={cx(
          "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors whitespace-nowrap",
          disabledReason
            ? "bg-white/5 border-white/20 text-white/40 cursor-not-allowed"
            : "bg-white/5 hover:bg-white/10 border-white/10 text-white/80 hover:text-white"
        )}
        title={disabledReason ?? "Predict the best drivers for this lane"}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        ) : (
          <Brain className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span>Predict</span>
      </button>

      {open && (
        <>
          {/* Backdrop to close modal */}
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setOpen(false)}
          />
          
          {/* Modal */}
          <div
            className={cx(
              "absolute right-0 top-full z-[101] mt-1 w-[420px] max-w-[90vw]",
              "rounded-xl border border-white/10 bg-[#0B0B0F] backdrop-blur",
              "shadow-xl p-3"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-white/70 flex-1 min-w-0">
                <span className="font-semibold">Lane:</span>{" "}
                <span className="truncate inline-block max-w-[140px] align-bottom">
                  {(origin ?? "UNKNOWN").toString().trim() || "UNKNOWN"}
                </span>
                {" → "}
                <span className="truncate inline-block max-w-[140px] align-bottom">
                  {(destination ?? "UNKNOWN").toString().trim() || "UNKNOWN"}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-white/50 hover:text-white/80 flex-shrink-0 ml-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2">
                <AlertTriangle size={16} className="flex-shrink-0" />
                <span className="text-xs">{error}</span>
              </div>
            )}

            {!error && (rows?.length ?? 0) === 0 && (
              <div className="text-xs text-white/70">
                No predictions yet. Give a couple thumbs on this lane and run Train AI, or try another lane.
              </div>
            )}

            {!error && (rows?.length ?? 0) > 0 && (
              <ul className="space-y-2 max-h-[300px] overflow-y-auto">
                {rows.map((r, idx) => (
                  <li
                    key={`${r.driver_id}-${idx}`}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[11px] flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="text-sm font-medium truncate">
                          {r.driver_id ?? "—"}
                        </div>
                        <div className="text-[11px] text-white/60 truncate">
                          {r.o_norm} → {r.d_norm}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-semibold">{pct(r.score)}</span>
                      <span
                        className={cx(
                          "text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap",
                          r.source === "learned"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-sky-500/30 bg-sky-500/10 text-sky-300"
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
              <div className="mt-2 text-[11px] text-white/50">
                Model: <span className="font-mono">{rows[0]?.model_ver ?? "v1"}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}