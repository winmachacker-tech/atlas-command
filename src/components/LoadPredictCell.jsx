// FILE: src/components/LoadPredictCell.jsx
// Purpose:
//   Show an AI "Predict Best Driver" button on each load row,
//   call the V2 lane-based AI RPC, and render the ranked driver list.
//
// Backend function used (V2):
//   rpc_ai_best_drivers_for_lane_v2(p_load_id uuid, p_limit integer)
//
// V2 internally:
//   - Looks up the load by id (and current_org_id())
//   - Builds a lane key from loads.origin / loads.destination
//   - Blends three signals per driver on that lane:
//       • Historical assignments (loads.driver_id)
//       • Thumbs feedback (dispatch_feedback_events.rating)
//       • Simple availability (busy vs not busy)
//   - Returns (per driver):
//       driver_id      uuid
//       driver_name    text
//       score          numeric
//       source         text   -- 'v2_assign+thumbs', 'v2_assign_only', etc.
//       o_norm         text   -- normalized origin
//       d_norm         text   -- normalized destination
//       model_ver      text   -- 'v2'
//       is_busy        boolean
//       thumbs_up      integer
//       thumbs_down    integer
//       assign_count   integer
//
// IMPORTANT:
//   The Supabase RPC call MUST use argument names that match the SQL function:
//     { p_load_id: <uuid>, p_limit: 5 }
//
// NOTE:
//   - We do NOT block predictions if origin/dest are missing on the frontend.
//     Backend still uses loads.origin / loads.destination.
//   - We try multiple prop shapes for loadId so this can be used in different tables.
//   - Extra fields from V2 (is_busy, thumbs_up, assign_count) are safe to ignore
//     if you don't want to display them yet.

import { useState, useMemo, useCallback, memo } from "react";
import { supabase } from "../lib/supabase";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
} from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

// Make source string human-readable for V2 sources
function describeSource(source) {
  if (!source) return "No data";
  if (source === "v2_assign+thumbs") return "Assignments + thumbs";
  if (source === "v2_assign_only") return "Assignments only";
  if (source === "v2_thumbs_only") return "Thumbs-only data";
  if (source === "v2_fallback") return "Heuristic fallback";
  // backwards-compatible with any old sources
  if (source === "model") return "Learned model";
  if (source === "thumbs") return "Thumbs-only fallback";
  return source;
}

function LoadPredictCell(props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState([]);
  const [hasAttemptedPredict, setHasAttemptedPredict] = useState(false);

  // Memoize expensive prop extraction
  const { loadId, originText, destinationText, hasOriginDest } = useMemo(() => {
    // Pull "load" if it exists
    const load = props?.load ?? undefined;

    // Robust load ID detection
    const id =
      (load && (load.id || load.load_id || load.loadID || load.loadId)) ||
      props?.load_id ||
      props?.loadId ||
      props?.id ||
      null;

    // Try to be smart about origin / destination labels
    const origin =
      load?.origin ||
      load?.origin_city ||
      load?.pickup_city ||
      load?.origin_label ||
      load?.origin_display ||
      null;

    const destination =
      load?.destination ||
      load?.dest_city ||
      load?.delivery_city ||
      load?.destination_label ||
      load?.destination_display ||
      null;

    return {
      loadId: id,
      originText: origin,
      destinationText: destination,
      hasOriginDest: !!(origin && destination),
    };
  }, [
    props?.load?.id,
    props?.load?.load_id,
    props?.load?.loadID,
    props?.load?.loadId,
    props?.load_id,
    props?.loadId,
    props?.id,
    props?.load?.origin,
    props?.load?.origin_city,
    props?.load?.pickup_city,
    props?.load?.origin_label,
    props?.load?.origin_display,
    props?.load?.destination,
    props?.load?.dest_city,
    props?.load?.delivery_city,
    props?.load?.destination_label,
    props?.load?.destination_display,
  ]);

  const handlePredict = useCallback(async () => {
    setErr("");
    setHasAttemptedPredict(true);

    if (!loadId) {
      console.warn(
        "[LoadPredictCell] Missing loadId. Cannot call rpc_ai_best_drivers_for_lane_v2."
      );
      setErr("This load is missing an ID, so Atlas can't run AI on it.");
      return;
    }

    setLoading(true);
    try {
      // ⬇️ IMPORTANT: call the V2 RPC (does NOT remove or modify V1 on the backend)
      const { data, error } = await supabase.rpc(
        "rpc_ai_best_drivers_for_lane_v2",
        {
          p_load_id: loadId,
          p_limit: 5,
        }
      );

      if (error) {
        console.error("Predict V2 error:", error);
        setErr(error.message || "Prediction failed.");
        setResults([]);
      } else {
        const arr = Array.isArray(data) ? data : [];
        setResults(arr);
        // Only open the drawer when we actually have ranked drivers to show.
        if (arr.length > 0) {
          setOpen(true);
        } else {
          setOpen(false);
        }
      }
    } catch (e) {
      console.error("Predict V2 error (exception):", e);
      setErr(e.message || "Unexpected error.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [loadId]);

  const handleToggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  // Memoize computed values
  const top = results[0];

  const laneLabel =
    top && (top.o_norm || top.d_norm)
      ? `${top.o_norm || "Unknown"} → ${top.d_norm || "Unknown"}`
      : hasOriginDest
      ? `${originText} → ${destinationText}`
      : "Lane unknown";

  const modelVer = top?.model_ver || "N/A";
  const sourceLabel = describeSource(top?.source);

  return (
    <div className="flex flex-col gap-2 text-xs">
      <button
        type="button"
        disabled={loading}
        onClick={handlePredict}
        className={cx(
          "inline-flex items-center justify-center rounded-full px-3 py-1 border text-xs font-medium",
          "border-emerald-500/60 text-emerald-100 hover:bg-emerald-500/10",
          loading && "opacity-70 cursor-wait"
        )}
        title="Let Atlas AI predict your best drivers for this lane"
      >
        {loading ? (
          <>
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Predicting…
          </>
        ) : (
          <>
            <Bot className="mr-1 h-3 w-3" />
            Predict
          </>
        )}
      </button>

      {err && (
        <p className="text-[10px] text-rose-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {err}
        </p>
      )}

      {/* Summary pill when we have results */}
      {results.length > 0 && (
        <button
          type="button"
          onClick={handleToggle}
          className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 flex items-center justify-between hover:bg-slate-800/80"
        >
          <div className="flex flex-col text-left">
            <span className="text-[11px] text-slate-300">{laneLabel}</span>
            <span className="text-[10px] text-slate-400">
              Top {results.length} driver{results.length === 1 ? "" : "s"} ·{" "}
              <span className="font-medium text-emerald-300">
                {sourceLabel}
              </span>
            </span>
          </div>
          {open ? (
            <ChevronUp className="h-3 w-3 text-slate-400" />
          ) : (
            <ChevronDown className="h-3 w-3 text-slate-400" />
          )}
        </button>
      )}

      {/* Detail list */}
      {open && results.length > 0 && (
        <div className="mt-1 rounded-lg border border-slate-800 bg-slate-950/80 px-2 py-2 space-y-1.5">
          {results.map((r, idx) => (
            <div
              key={r.driver_id || idx}
              className="flex items-center justify-between text-[11px]"
            >
              <div className="flex flex-col">
                <span className="font-medium text-slate-100">
                  #{idx + 1} · {r.driver_name || "Unknown driver"}
                  {r.is_busy ? (
                    <span className="ml-1 text-[10px] text-amber-400">
                      (busy)
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] text-slate-400">
                  Score:{" "}
                  <span className="text-emerald-300">
                    {r.score != null ? r.score.toFixed(3) : "N/A"}
                  </span>{" "}
                  · Source: {describeSource(r.source)}
                </span>
                {(r.assign_count || r.thumbs_up || r.thumbs_down) && (
                  <span className="text-[10px] text-slate-500">
                    History:{" "}
                    {r.assign_count
                      ? `${r.assign_count} lane assignment${
                          r.assign_count === 1 ? "" : "s"
                        }`
                      : "no assignments"}{" "}
                    · 👍 {r.thumbs_up ?? 0} · 👎 {r.thumbs_down ?? 0}
                  </span>
                )}
              </div>
            </div>
          ))}

          <div className="mt-2 border-t border-slate-800 pt-1.5 flex justify-between text-[10px] text-slate-500">
            <span>Model version: {modelVer}</span>
            <span>Lane: {laneLabel}</span>
          </div>
        </div>
      )}

      {/* "No data yet" state ONLY after we've tried to predict and got nothing */}
      {hasAttemptedPredict && !loading && !err && results.length === 0 && (
        <p className="text-[10px] text-slate-500">
          No AI matches yet for this lane. Keep running loads and giving 👍 / 👎
          feedback so Atlas can learn this lane over time.
        </p>
      )}
    </div>
  );
}

// 🔥 CRITICAL: Memoize the component to prevent unnecessary re-renders
export default memo(LoadPredictCell, (prevProps, nextProps) => {
  // Custom comparison - only re-render if load data actually changed
  const prevLoad = prevProps?.load;
  const nextLoad = nextProps?.load;
  
  // Compare load IDs
  const prevId = prevLoad?.id || prevLoad?.load_id || prevProps?.load_id || prevProps?.id;
  const nextId = nextLoad?.id || nextLoad?.load_id || nextProps?.load_id || nextProps?.id;
  
  if (prevId !== nextId) return false; // Props changed, re-render
  
  // Compare origin/destination
  const prevOrigin = prevLoad?.origin || prevLoad?.origin_city;
  const nextOrigin = nextLoad?.origin || nextLoad?.origin_city;
  const prevDest = prevLoad?.destination || prevLoad?.dest_city;
  const nextDest = nextLoad?.destination || nextLoad?.dest_city;
  
  if (prevOrigin !== nextOrigin || prevDest !== nextDest) return false;
  
  return true; // Props are the same, skip re-render
});