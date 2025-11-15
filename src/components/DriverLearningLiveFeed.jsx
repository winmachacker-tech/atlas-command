// FILE: src/components/DriverLearningLiveFeed.jsx
// PURPOSE: Tenant-safe "Recent Feedback (All Drivers)" table for Driver Learning.
// - Reads from v_driver_feedback_events (already scoped by org_id = current_org_id())
// - Uses the anon Supabase client from src/lib/supabase
// - Shows When, Driver, Result, Load, Lane, Equip, Miles, Note

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const RESULT_BADGE_CLASSES = {
  up: "inline-flex items-center rounded-full bg-emerald-900/40 text-emerald-300 px-3 py-1 text-xs font-medium",
  down: "inline-flex items-center rounded-full bg-rose-900/40 text-rose-300 px-3 py-1 text-xs font-medium",
  default:
    "inline-flex items-center rounded-full bg-zinc-800/80 text-zinc-200 px-3 py-1 text-xs font-medium",
};

function formatDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatResult(vote) {
  if (!vote) return { label: "—", cls: RESULT_BADGE_CLASSES.default };
  const norm = String(vote).toLowerCase();

  if (
    ["up", "thumb_up", "thumbs_up", "upvote", "positive", "true", "t", "1", "yes", "y", "+"].includes(
      norm,
    )
  ) {
    return { label: "Up", cls: RESULT_BADGE_CLASSES.up };
  }

  if (
    [
      "down",
      "thumb_down",
      "thumbs_down",
      "downvote",
      "negative",
      "false",
      "f",
      "0",
      "no",
      "n",
      "-",
    ].includes(norm)
  ) {
    return { label: "Down", cls: RESULT_BADGE_CLASSES.down };
  }

  return { label: vote, cls: RESULT_BADGE_CLASSES.default };
}

export default function DriverLearningLiveFeed() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadFeedback() {
      setLoading(true);
      setErrorMsg("");

      const { data, error } = await supabase
        .from("v_driver_feedback_events")
        .select(
          `
          id,
          created_at,
          vote,
          note,
          driver_id,
          first_name,
          last_name,
          load_id,
          load_reference,
          o_norm,
          d_norm,
          lane_key,
          equipment_type,
          miles
        `,
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (!isMounted) return;

      if (error) {
        console.error("Failed to load driver feedback events:", error);
        setErrorMsg(error.message || "Failed to load feedback events.");
        setRows([]);
      } else {
        setRows(data || []);
      }

      setLoading(false);
    }

    loadFeedback();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="mt-6 rounded-2xl border border-lime-400/40 bg-zinc-900/60 shadow-xl shadow-black/40">
      <div className="border-b border-zinc-800 px-4 py-3 sm:px-6">
        <h3 className="text-sm font-semibold text-zinc-100">
          Recent Feedback (All Drivers)
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          Org-scoped event history across all drivers, powered by{" "}
          <span className="font-mono text-[11px] text-lime-300">
            v_driver_feedback_events
          </span>
          .
        </p>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-sm text-zinc-400 sm:px-6">
          Loading feedback events…
        </div>
      ) : errorMsg ? (
        <div className="px-4 py-6 text-sm text-rose-300 sm:px-6">
          {errorMsg}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-zinc-400 sm:px-6">
          No feedback events yet for this organization.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-left">
            <thead className="bg-zinc-900/70">
              <tr>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  When
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  Driver
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  Result
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  Load
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  Lane
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  Equip
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  Miles
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
                  Note
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40 text-sm">
              {rows.map((row) => {
                const { label: resultLabel, cls: resultCls } = formatResult(row.vote);
                const driverName =
                  row.first_name || row.last_name
                    ? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()
                    : "—";
                const lane =
                  row.o_norm && row.d_norm
                    ? `${row.o_norm} → ${row.d_norm}`
                    : row.lane_key || "—";

                return (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-300 sm:px-6">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-200 sm:px-6">
                      {driverName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 sm:px-6">
                      <span className={resultCls}>{resultLabel}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-300 sm:px-6">
                      {row.load_reference || row.load_id || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-300 sm:px-6">
                      {lane}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-300 sm:px-6">
                      {row.equipment_type || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-300 sm:px-6">
                      {row.miles ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-400 sm:px-6">
                      {row.note || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
