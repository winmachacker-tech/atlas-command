// FILE: src/components/RunAutoTrainButton.jsx
// Purpose: Let Mark trigger the auto-training RPC from the UI.
// - Calls rpc_ai_autofeedback_from_loads(p_days_back, p_max_rows)
// - Shows a small status summary: scanned / inserted / up / down
// - Styled to match the dark "Atlas" page theme.

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { RefreshCw, Sparkles, AlertTriangle } from "lucide-react";

export default function RunAutoTrainButton({
  daysBack = 30,
  maxRows = 500,
  className = "",
}) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError("");
    setSummary(null);

    try {
      const { data, error } = await supabase.rpc(
        "rpc_ai_autofeedback_from_loads",
        {
          p_days_back: daysBack,
          p_max_rows: maxRows,
        }
      );

      if (error) {
        console.error("Auto-train error:", error);
        setError(error.message || "Failed to run auto-train.");
        return;
      }

      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!row) {
        setError("Auto-train returned no data.");
        return;
      }

      setSummary({
        inserted: row.inserted_count ?? 0,
        up: row.up_count ?? 0,
        down: row.down_count ?? 0,
        scanned: row.scanned_count ?? 0,
      });
    } catch (e) {
      console.error("Auto-train exception:", e);
      setError(e?.message || "Unexpected error running auto-train.");
    } finally {
      setLoading(false);
    }
  }

  const btnLabel = loading ? "Running auto-train..." : "Run Auto-Train from Loads";

  return (
    <div
      className={[
        "max-w-xl w-full rounded-xl border border-white/10 bg-white/5",
        "px-3 py-3 text-sm shadow-sm backdrop-blur",
        "flex flex-col gap-2",
        className,
      ].join(" ")}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span className="font-medium text-slate-50">
            AI Auto-Training
          </span>
        </div>

        <button
          type="button"
          onClick={handleClick}
          disabled={loading}
          className={[
            "inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/40 px-3 py-1.5 text-xs font-medium",
            "bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/20",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-colors",
          ].join(" ")}
        >
          <RefreshCw
            className={
              "h-3.5 w-3.5" + (loading ? " animate-spin" : "")
            }
          />
          <span>{btnLabel}</span>
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-300">
        Looks at recent loads with drivers and automatically adds 👍 / 👎
        feedback based on the final load status, so the AI keeps learning
        without manual clicking.
      </p>

      {/* Summary (only shows after a run) */}
      {summary && (
        <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-100">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="font-semibold">{summary.scanned}</span> loads
              scanned
            </span>
            <span>
              <span className="font-semibold">{summary.inserted}</span> feedback
              inserted
            </span>
            <span>
              👍 <span className="font-semibold">{summary.up}</span>
            </span>
            <span>
              👎 <span className="font-semibold">{summary.down}</span>
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
