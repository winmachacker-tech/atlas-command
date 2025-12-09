// FILE: src/components/loads/StatusTimeline.jsx
// Purpose:
// - Visual status timeline for a load.
// - Shows a richer, step-by-step journey:
//
//   AVAILABLE → DISPATCHED → EN_ROUTE_TO_PICKUP → AT_SHIPPER → LOADING
//   → LOADED → IN_TRANSIT → ARRIVED_AT_RECEIVER → UNLOADING → DELIVERED
//
// Notes:
// - This component is **display-only**. It does NOT update the database.
// - It is safe to use before we extend the DB status check constraint.
// - If the current status is AT_RISK / PROBLEM / CANCELLED, we show a
//   special badge next to the timeline so dispatchers still see that state.

import React from "react";

// Ordered list of the "happy path" statuses for the timeline.
const STATUS_SEQUENCE = [
  "AVAILABLE",
  "DISPATCHED",
  "EN_ROUTE_TO_PICKUP",
  "AT_SHIPPER",
  "LOADING",
  "LOADED",
  "IN_TRANSIT",
  "ARRIVED_AT_RECEIVER",
  "UNLOADING",
  "DELIVERED",
];

// Human-friendly labels for display.
const STATUS_LABELS = {
  AVAILABLE: "Available",
  DISPATCHED: "Dispatched",
  EN_ROUTE_TO_PICKUP: "En route to pickup",
  AT_SHIPPER: "At shipper",
  LOADING: "Loading",
  LOADED: "Loaded / departed shipper",
  IN_TRANSIT: "In transit",
  ARRIVED_AT_RECEIVER: "At receiver",
  UNLOADING: "Unloading",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  AT_RISK: "At risk",
  PROBLEM: "Problem",
};

// Status values that represent an overlay/flag rather than a step
// on the normal journey. We still show them, but as separate badges.
const SPECIAL_FLAG_STATUSES = new Set(["CANCELLED", "AT_RISK", "PROBLEM"]);

function StatusTimeline({ status }) {
  const rawStatus = status || "AVAILABLE";

  // If status is a special flag (CANCELLED / AT_RISK / PROBLEM),
  // we still want the timeline to show a "normal" position.
  // For now, we assume those typically happen while "IN_TRANSIT".
  const timelineStatus = SPECIAL_FLAG_STATUSES.has(rawStatus)
    ? "IN_TRANSIT"
    : rawStatus;

  const currentIndex = STATUS_SEQUENCE.indexOf(timelineStatus);
  const isKnownStatus = currentIndex !== -1;

  // If we somehow get an unknown status, we'll just treat it like AVAILABLE.
  const safeCurrentIndex = isKnownStatus ? currentIndex : 0;

  // Determine which special badges (if any) to show.
  const specialBadges = [];
  if (rawStatus === "CANCELLED") specialBadges.push("CANCELLED");
  if (rawStatus === "AT_RISK") specialBadges.push("AT_RISK");
  if (rawStatus === "PROBLEM") specialBadges.push("PROBLEM");

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Timeline */}
      <div className="flex items-center gap-2">
        {STATUS_SEQUENCE.map((s, idx) => {
          const isActive = idx <= safeCurrentIndex;
          const isCurrent = idx === safeCurrentIndex;

          // Base pill styles
          let pillClasses =
            "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors border";

          if (isCurrent) {
            // Current status: bright and obvious.
            pillClasses +=
              " bg-emerald-500/20 text-emerald-200 border-emerald-500/60 shadow-sm";
          } else if (isActive) {
            // Completed steps: subtle but clearly done.
            pillClasses +=
              " bg-emerald-950/40 text-emerald-300 border-emerald-700/70";
          } else {
            // Future steps: muted.
            pillClasses +=
              " bg-slate-900/40 text-slate-400 border-slate-700/70";
          }

          // Connector line between pills (except before first)
          const showConnector = idx > 0;

          return (
            <div key={s} className="flex items-center">
              {showConnector && (
                <div
                  className={
                    "h-[1px] w-6 md:w-8 " +
                    (idx <= safeCurrentIndex
                      ? "bg-emerald-500/60"
                      : "bg-slate-700/70")
                  }
                />
              )}

              <div className={pillClasses}>
                {/* Little dot indicator */}
                <span
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (isActive
                      ? "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                      : "bg-slate-500")
                  }
                />
                <span>{STATUS_LABELS[s] || s}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right-side special status badges (cancelled / at risk / problem) */}
      {specialBadges.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {specialBadges.map((flag) => {
            let badgeClasses =
              "rounded-full px-3 py-1 text-xs font-semibold border";

            if (flag === "CANCELLED") {
              badgeClasses +=
                " bg-red-900/50 text-red-200 border-red-500/70";
            } else if (flag === "PROBLEM") {
              badgeClasses +=
                " bg-amber-900/60 text-amber-100 border-amber-500/80";
            } else if (flag === "AT_RISK") {
              badgeClasses +=
                " bg-rose-900/50 text-rose-100 border-rose-500/80";
            }

            return (
              <span key={flag} className={badgeClasses}>
                {STATUS_LABELS[flag] || flag}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StatusTimeline;
