// FILE: src/components/PredictBestDriverButton.jsx
// Purpose: Single button that opens a Top-3 AI picks modal for a given load,
// lets the user choose, and assigns the selected driver_id to the load.
//
// Usage (inside your Loads table row):
//   <PredictBestDriverButton
//     loadId={row.id}
//     onAssigned={() => refetch()} // optional callback after assignment
//   />
//
// Notes:
// - Tries multiple AI RPC names in order (first one that exists): 
//     rpc_ai_best_drivers_for_lane, rpc_ai_predict_best_drivers, rpc_ai_top_drivers_for_load
// - Expects result rows to include at least: driver_id (or id), score-ish number, reason-ish text.
//   We normalize common field names automatically.
// - Assigns by updating loads.driver_id (no status changes).
// - Clean fallback messages if AI has no data.

import { useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, Wand2, CheckCircle2, X, AlertTriangle } from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function normalizeCandidates(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const driver_id = r.driver_id ?? r.id ?? r.driver ?? null;
      const score =
        r.score ?? r.fit_score ?? r.fit ?? r.confidence ?? r.rank_score ?? null;
      const reason =
        r.reason ??
        r.why ??
        r.explanation ??
        r.fit_reason ??
        r.notes ??
        null;
      const driver_name =
        r.driver_name ?? r.name ?? r.full_name ?? r.driver_full_name ?? null;
      const truck =
        r.truck ?? r.truck_id ?? r.power_unit ?? r.unit ?? null;

      return { driver_id, score, reason, driver_name, truck, raw: r };
    })
    .filter((x) => x.driver_id);
}

async function callFirstWorkingRPC(loadId) {
  const rpcNamesInOrder = [
    "rpc_ai_best_drivers_for_lane",
    "rpc_ai_predict_best_drivers",
    "rpc_ai_top_drivers_for_load",
  ];

  const errors = [];

  for (const name of rpcNamesInOrder) {
    // Try common param shapes:
    const tries = [
      { payload: { load_id: loadId } },
      { payload: { p_load_id: loadId } },
      { payload: { id: loadId } },
    ];

    for (const t of tries) {
      const { data, error } = await supabase.rpc(name, t.payload);
      if (error) {
        errors.push({ name, payload: t.payload, error });
        continue;
      }
      if (Array.isArray(data) && data.length > 0) {
        return { rpc: name, data };
      }
      // If it returns empty array, keep looking (AI might have another RPC name)
    }
  }

  return { rpc: null, data: [], errors };
}

export default function PredictBestDriverButton({ loadId, onAssigned }) {
  const [open, setOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [errMsg, setErrMsg] = useState("");

  async function handleOpen() {
    setErrMsg("");
    setCandidates([]);
    setOpen(true);
    setFetching(true);

    try {
      const res = await callFirstWorkingRPC(loadId);
      const list = normalizeCandidates(res.data)
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
        .slice(0, 3);

      if (list.length === 0) {
        setErrMsg(
          "Not enough signal to predict yet. Add feedback or run a few loads, then try again."
        );
      } else {
        setCandidates(list);
      }
    } catch (e) {
      setErrMsg("Couldn’t fetch AI picks. Please try again.");
    } finally {
      setFetching(false);
    }
  }

  async function assignDriver(driver_id) {
    setAssigningId(driver_id);
    setErrMsg("");
    try {
      // Minimal, safe assignment: just set loads.driver_id
      const { error } = await supabase
        .from("loads")
        .update({ driver_id })
        .eq("id", loadId);

      if (error) {
        setErrMsg(error.message || "Failed to assign driver.");
        setAssigningId(null);
        return;
      }

      setOpen(false);
      setAssigningId(null);
      if (typeof onAssigned === "function") onAssigned();
    } catch (e) {
      setErrMsg("Unexpected error assigning driver.");
      setAssigningId(null);
    }
  }

  const modal = useMemo(() => {
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        {/* backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setOpen(false)}
        />
        {/* card */}
        <div className="relative z-[61] w-full max-w-lg rounded-2xl bg-neutral-900 text-neutral-100 shadow-2xl border border-neutral-800">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <div className="flex items-center gap-2">
              <Wand2 className="w-5 h-5" />
              <h3 className="text-base font-semibold">
                AI: Top 3 drivers for this load
              </h3>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md hover:bg-neutral-800"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4">
            {fetching && (
              <div className="flex items-center gap-2 text-sm text-neutral-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                Fetching AI picks…
              </div>
            )}

            {!fetching && errMsg && (
              <div className="flex items-center gap-2 text-amber-300 text-sm bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errMsg}</span>
              </div>
            )}

            {!fetching && !errMsg && candidates.length > 0 && (
              <ul className="space-y-3">
                {candidates.map((c, idx) => (
                  <li
                    key={c.driver_id}
                    className="rounded-xl border border-neutral-800 bg-neutral-875 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          {idx + 1}. {c.driver_name || c.driver_id}
                        </div>
                        <div className="text-xs text-neutral-300">
                          Score:{" "}
                          {Number.isFinite(Number(c.score))
                            ? Number(c.score).toFixed(2)
                            : "—"}
                          {c.truck ? ` • Truck: ${c.truck}` : ""}
                        </div>
                        {c.reason && (
                          <div className="text-xs mt-1 text-neutral-300">
                            {String(c.reason)}
                          </div>
                        )}
                      </div>

                      <button
                        disabled={assigningId === c.driver_id}
                        onClick={() => assignDriver(c.driver_id)}
                        className={cx(
                          "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                          "bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                        )}
                      >
                        {assigningId === c.driver_id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Assigning…
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            Choose
                          </>
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-4 py-3 border-t border-neutral-800 flex items-center justify-end">
            <button
              onClick={() => setOpen(false)}
              className="text-sm px-3 py-2 rounded-lg hover:bg-neutral-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }, [open, fetching, errMsg, candidates, assigningId]);

  return (
    <>
      <button
        onClick={handleOpen}
        className={cx(
          "inline-flex items-center gap-2 rounded-xl px-3 py-2",
          "bg-emerald-800 hover:bg-emerald-700 text-white"
        )}
        title="Predict top drivers for this load"
      >
        <Wand2 className="w-4 h-4" />
        Predict best drivers
      </button>

      {modal}
    </>
  );
}
