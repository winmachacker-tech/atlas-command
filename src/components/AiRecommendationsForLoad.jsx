// FILE: src/components/AiRecommendationsForLoad.jsx
// Purpose:
//   - Show AI driver recommendations for a single load.
//   - Uses rpc_ai_best_drivers_for_load(p_load_id, p_limit)
//   - Handles:
//       * Lane-trained drivers (source = 'lane')
//       * Global-trained drivers (source = 'global')
//       * Untrained drivers (source = 'untrained')
//   - Always tries to show *something* as long as drivers exist.
//
// Props:
//   - loadId: UUID of the current load
//   - originCity, originState, destCity, destState (optional, used only for nicer empty-state message)

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  RefreshCw,
  AlertTriangle,
  Info,
  Loader2,
  UserCheck,
} from "lucide-react";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

function fmtNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString();
}

function fmtScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(3);
}

function sourceLabel(source) {
  if (source === "lane") return "Lane-trained";
  if (source === "global") return "Global AI";
  return "Untrained";
}

function sourceChipClasses(source) {
  if (source === "lane") {
    return "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40";
  }
  if (source === "global") {
    return "bg-sky-500/10 text-sky-300 border border-sky-500/40";
  }
  return "bg-slate-700/40 text-slate-200 border border-slate-600/60";
}

export default function AiRecommendationsForLoad({
  loadId,
  originCity,
  originState,
  destCity,
  destState,
}) {
  const [rows, setRows] = useState([]);
  const [laneInfo, setLaneInfo] = useState(null); // { lane_key, o_norm, d_norm }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hasBasicLaneFields = useMemo(() => {
    const oc = (originCity || "").trim();
    const os = (originState || "").trim();
    const dc = (destCity || "").trim();
    const ds = (destState || "").trim();
    return !!(oc && os && dc && ds);
  }, [originCity, originState, destCity, destState]);

  const loadRecommendations = useCallback(
    async (opts = { silent: false }) => {
      if (!loadId) return;
      if (!opts.silent) setLoading(true);
      setError("");

      const { data, error } = await supabase.rpc(
        "rpc_ai_best_drivers_for_load",
        {
          p_load_id: loadId,
          p_limit: 10,
        }
      );

      if (error) {
        console.error("AI recs RPC error:", error);
        setError(
          error.message ||
            "Could not load AI driver recommendations for this load."
        );
        setRows([]);
        setLaneInfo(null);
      } else {
        const arr = Array.isArray(data) ? data : [];
        setRows(arr);

        if (arr.length > 0) {
          const first = arr[0];
          setLaneInfo({
            lane_key: first.lane_key || null,
            o_norm: first.o_norm || null,
            d_norm: first.d_norm || null,
          });
        } else {
          setLaneInfo(null);
        }
      }

      if (!opts.silent) setLoading(false);
    },
    [loadId]
  );

  // Auto-load whenever loadId changes
  useEffect(() => {
    if (!loadId) {
      setRows([]);
      setLaneInfo(null);
      setError("");
      setLoading(false);
      return;
    }
    // Silent pre-load (no spinner flash)
    loadRecommendations({ silent: true });
  }, [loadId, loadRecommendations]);

  // ---------- Render helpers ----------

  if (!loadId) {
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-5">
        <div className="flex items-center gap-2 text-slate-300">
          <Info className="h-4 w-4 text-slate-400" />
          <p className="text-sm">
            Open a load to see AI driver recommendations.
          </p>
        </div>
      </div>
    );
  }

  const showNoLaneWarning =
    !hasBasicLaneFields && (!laneInfo || !laneInfo.lane_key);

  const headerLaneText = laneInfo?.lane_key
    ? laneInfo.lane_key
    : hasBasicLaneFields
    ? `${originCity}, ${originState} → ${destCity}, ${destState}`
    : "Lane not fully specified";

  return (
    <div className="w-full rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-emerald-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
              AI Recommendations
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Ranked drivers for{" "}
            <span className="font-medium text-slate-100">{headerLaneText}</span>
            . Uses lane training when available, otherwise global AI and
            untrained drivers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {loading && (
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Refreshing</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => loadRecommendations()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700/80 active:scale-[0.98] transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Warnings / info */}
      {showNoLaneWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-100">
            To give the AI a clear lane, add{" "}
            <span className="font-semibold">origin + destination city &amp; state</span>{" "}
            to this load. Until then, recommendations are based only on global
            behavior where possible.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-rose-300 mt-0.5" />
          <p className="text-xs text-rose-100">
            {error} Try refreshing, or check the{" "}
            <span className="font-mono">rpc_ai_best_drivers_for_load</span>{" "}
            function in Supabase if the issue persists.
          </p>
        </div>
      )}

      {/* Results */}
      {rows.length === 0 && !error && (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-4">
          <p className="text-xs text-slate-300">
            No AI training data yet. As you give thumbs up/down on loads, Atlas
            will start ranking drivers automatically.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((row, idx) => (
            <div
              key={`${row.driver_id}-${idx}`}
              className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5 md:flex-row md:items-center md:justify-between"
            >
              {/* Left: driver + source */}
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-100">
                  {row.driver_name
                    ? row.driver_name
                        .split(" ")
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)
                    : "DR"}
                </div>
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">
                      {row.driver_name || "Unnamed driver"}
                    </span>
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        sourceChipClasses(row.source)
                      }
                    >
                      {sourceLabel(row.source)}
                    </span>
                    {idx === 0 && (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-300/90">
                        Top pick
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Score:{" "}
                    <span className="font-mono font-semibold text-slate-100">
                      {fmtScore(row.score)}
                    </span>{" "}
                    · Feedback events:{" "}
                    <span className="font-mono">{fmtNum(row.fb_events)}</span>
                  </p>
                </div>
              </div>

              {/* Right: stats */}
              <div className="mt-2 flex flex-wrap items-center gap-2 md:mt-0 md:justify-end">
                <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[11px] text-emerald-100">
                    Up:{" "}
                    <span className="font-mono font-semibold">
                      {fmtNum(row.fb_up)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  <span className="text-[11px] text-rose-100">
                    Down:{" "}
                    <span className="font-mono font-semibold">
                      {fmtNum(row.fb_down)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-slate-700/60 px-2.5 py-1">
                  <span className="text-[11px] text-slate-200">
                    Last fb:{" "}
                    <span className="font-mono">
                      {fmtDate(row.last_feedback_at)}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
