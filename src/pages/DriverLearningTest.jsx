// src/pages/DriverLearningTest.jsx
import { useState } from "react";
import { supabase } from "../lib/supabase";
import DriverPreferences from "../components/DriverPreferences.jsx";
, import {
  getDriverPreferences,
  saveDriverPreferences
  saveDriverPreferences
} from "../lib/driverPreferences.js";


function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/* --- local readers for the views --- */
async function getDriverSnapshot(driverId) {
  if (!driverId) return null;
  const { data, error } = await supabase
    .from("ai_driver_pref_snapshot")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) {
    console.error("getDriverSnapshot error:", error);
    return null;
  }
  return data || null;
}

async function getDriverStats(driverId) {
  if (!driverId) return null;
  const { data, error } = await supabase
    .from("ai_driver_learning_stats")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) {
    console.error("getDriverStats error:", error);
    return null;
  }
  return data || null;
}

export default function DriverLearningTest() {
  const [driverId, setDriverId] = useState("");
  const [loadId, setLoadId] = useState("");
  const [log, setLog] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);

  function pushLog(msg, obj) {
    setLog((l) => [{ ts: new Date().toLocaleTimeString(), msg, obj }, ...l].slice(0, 100));
  }

  async function runRead() {
    try {
      const s = await getDriverSnapshot(driverId);
      const st = await getDriverStats(driverId);
      const r = await getDriverRecentFeedback(driverId, 10);
      setSnapshot(s);
      setStats(st);
      setRecent(r);
      pushLog("Read OK", { snapshot: s, stats: st, recent: r });
    } catch (e) {
      pushLog("Read FAILED", { error: String(e) });
    }
  }

  async function seedPrefs() {
    try {
      const current = await getDriverPreferences(driverId);
      const res = await saveDriverPreferences(driverId, {
        home_base: current?.home_base ?? "Houston, TX",
        preferred_regions: current?.preferred_regions ?? ["West Coast", "South East"],
        preferred_equipment: current?.preferred_equipment ?? ["Reefer"],
        max_distance: current?.max_distance ?? 600,
        avoid_states: current?.avoid_states ?? ["NY", "NJ"],
        notes: current?.notes ?? null,
      });
      pushLog("Save/Upsert prefs OK", res);
      await runRead();
    } catch (e) {
      pushLog("Save/Upsert prefs FAILED", { error: String(e) });
    }
  }

  async function thumb(kind) {
    try {
      const rating = kind === "up" ? 1 : -1; // map to numeric expected by recordThumb
      const res = await recordThumb({
        driver_id: driverId || null,
        load_id: loadId || null,
        rating,
        note: `test thumb: ${kind}`,
        source: "driver-learning-test",
      });
      pushLog(`Thumb ${kind} OK`, res);
      setTimeout(runRead, 300);
    } catch (e) {
      pushLog(`Thumb ${kind} FAILED`, { error: String(e) });
    }
  }

  async function clearDriverFeedback() {
    try {
      const { error } = await supabase
        .from("ai_feedback")
        .delete()
        .eq("driver_id", driverId);
      if (error) throw error;
      pushLog("Cleared feedback for driver", { driverId });
      await runRead();
    } catch (e) {
      pushLog("Clear FAILED", { error: String(e) });
    }
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Driver Learning – Dev Test</h1>
      </header>

      {/* Controls */}
      <section className="rounded-xl border p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1">Driver ID (uuid)</label>
            <input
              className="w-full px-3 py-2 rounded-md border bg-background"
              placeholder="e.g. 5d88a72f-e6d7-4f57-a17f-65c69c9a5c76"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Load ID (uuid, optional)</label>
            <input
              className="w-full px-3 py-2 rounded-md border bg-background"
              placeholder="optional"
              value={loadId}
              onChange={(e) => setLoadId(e.target.value)}
            />
          </div>
          <div className="self-end">
            <button onClick={seedPrefs} className="px-3 py-2 rounded-md border hover:bg-muted w-full">
              Seed/Update Prefs
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button onClick={() => thumb("up")} className="px-3 py-2 rounded-md border hover:bg-muted">
            👍 Thumb Up
          </button>
          <button onClick={() => thumb("down")} className="px-3 py-2 rounded-md border hover:bg-muted">
            👎 Thumb Down
          </button>
          <button onClick={runRead} className="px-3 py-2 rounded-md border hover:bg-muted">
            Refresh Reads
          </button>
          <button
            onClick={clearDriverFeedback}
            className="px-3 py-2 rounded-md border hover:bg-rose-50 text-rose-700 border-rose-300"
          >
            Clear Feedback (this driver)
          </button>
        </div>
      </section>

      {/* Snapshot / Stats */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Snapshot (ai_driver_pref_snapshot)">
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(snapshot, null, 2)}</pre>
        </Card>
        <Card title="Stats (ai_driver_learning_stats)">
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(stats, null, 2)}</pre>
        </Card>
      </section>

      {/* Recent Feedback */}
      <section className="rounded-xl border p-4">
        <h3 className="text-sm font-medium mb-2">Recent Feedback (ai_driver_recent_feedback)</h3>
        {recent?.length ? (
          <ul className="space-y-2 text-sm">
            {recent.map((r) => (
              <li key={r.feedback_id || r.id} className="rounded-md border p-2">
                <div className="flex justify-between">
                  <span
                    className={cx(
                      "px-2 py-0.5 rounded border",
                      r.rating === "up" || r.rating === 1
                        ? "border-emerald-400"
                        : r.rating === "down" || r.rating === -1
                        ? "border-rose-400"
                        : "border-slate-300"
                    )}
                  >
                    {r.rating}
                  </span>
                  <span className="opacity-70">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                  </span>
                </div>
                <div className="mt-1 text-xs opacity-80">
                  Load: {r.load_number || r.load_id || "—"} {r.intent ? `| Intent: ${r.intent}` : ""}
                </div>
                {(r.comment || r.note) && (
                  <div className="mt-1 text-xs">
                    {r.comment ? (
                      <div>
                        <b>Comment:</b> {r.comment}
                      </div>
                    ) : null}
                    {r.note ? (
                      <div>
                        <b>Note:</b> {r.note}
                      </div>
                    ) : null}
                  </div>
                )}
                {(r.prompt_snippet || r.response_snippet) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs underline">LLM details</summary>
                    <div className="text-xs opacity-80 mt-1">
                      <div>
                        <b>Prompt:</b> {r.prompt_snippet || "—"}
                      </div>
                      <div>
                        <b>Response:</b> {r.response_snippet || "—"}
                      </div>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm opacity-70">No feedback yet.</div>
        )}
      </section>

      {/* Log */}
      <section className="rounded-xl border p-4">
        <h3 className="text-sm font-medium mb-2">Action Log</h3>
        <ul className="text-xs space-y-1">
          {log.map((l, i) => (
            <li key={i} className="border rounded p-2">
              <div className="flex justify-between">
                <span className="font-mono opacity-70">{l.ts}</span>
                <span className="font-medium">{l.msg}</span>
              </div>
              {l.obj ? <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(l.obj, null, 2)}</pre> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl border p-4">
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      <div className="text-sm">{children}</div>
    </div>
  );
}
