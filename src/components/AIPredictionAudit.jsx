// FILE: src/components/AIPredictionAudit.jsx
// Purpose: AI Prediction Audit panel that works even if no load is open.
// - Optional load selector (auto-fetches last 10 loads)
// - "Run audit" with RPC auto-discovery + flexible params
// - Graceful banners; no thrown errors
// - Pure client component; no schema changes required

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  PlayCircle,
} from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }
function fmt(d) { try { return new Date(d).toLocaleString(); } catch { return String(d ?? ""); } }
function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString() : String(n ?? "—");
}

export default function AIPredictionAudit({ initialLoadId = null }) {
  /* ---------------------------- state ---------------------------- */
  const [loads, setLoads] = useState([]);
  const [loadId, setLoadId] = useState(initialLoadId);
  const [trials, setTrials] = useState(10);

  const [discovering, setDiscovering] = useState(false);
  const [rpcName, setRpcName] = useState(null);
  const [rpcTried, setRpcTried] = useState([]);

  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [error, setError] = useState("");

  // Audit results (keep generic; we'll display what we can)
  const [result, setResult] = useState(null);

  /* ---------------------- fetch recent loads --------------------- */
  useEffect(() => {
    let ignore = false;

    async function fetchRecentLoads() {
      // If the parent passed a load, we still load a list for the dropdown UX.
      const { data, error } = await supabase
        .from("loads")
        .select("id, ref_no, origin_city, origin_state, dest_city, dest_state, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (ignore) return;
      if (error) {
        // non-fatal; just show banner; page still works
        setError(error.message ?? String(error));
        setLoads([]);
        return;
      }
      setLoads(data ?? []);
      if (!initialLoadId && !loadId && data?.length) {
        setLoadId(data[0].id);
      }
    }

    fetchRecentLoads();
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------ RPC discovery ------------------------ */
  const rpcCandidates = useMemo(
    () => [
      "rpc_ai_audit_summary",
    ],
    []
  );

  const tryRpc = useCallback(async (name, payload) => {
    try {
      const { data, error } = await supabase.rpc(name, payload ?? {});
      if (error) return { ok: false, name, error };
      return { ok: true, name, data };
    } catch (e) {
      return { ok: false, name, error: e };
    }
  }, []);

  const discoverRpc = useCallback(async () => {
    setDiscovering(true);
    setError("");
    setRpcTried([]);
    setRpcName(null);

    // We'll probe with the simplest call (no params) just to see what exists.
    for (const candidate of rpcCandidates) {
      setRpcTried((prev) => [...prev, candidate]);
      const r = await tryRpc(candidate);
      if (r.ok) {
        setRpcName(candidate);
        setDiscovering(false);
        return { ok: true, name: candidate };
      }
    }
    setDiscovering(false);
    setError("Couldn't find rpc_ai_audit_summary. Make sure the function exists in your database.");
    return { ok: false };
  }, [rpcCandidates, tryRpc]);

  /* -------------------------- run audit -------------------------- */
  const runAudit = useCallback(async () => {
    setError("");
    setRunning(true);
    setResult(null);

    let name = rpcName;
    if (!name) {
      const d = await discoverRpc();
      if (!d.ok) { setRunning(false); return; }
      name = d.name;
    }

    // rpc_ai_audit_summary takes no parameters, always returns summary of all runs
    const r = await tryRpc(name, {});
    
    if (r.ok) {
      setResult(r.data ?? []);
      setLastRunAt(Date.now());
      setRunning(false);
      return;
    }

    setError(`Failed to run "${name}": ${r.error?.message ?? String(r.error)}`);
    setRunning(false);
  }, [rpcName, discoverRpc, tryRpc]);

  /* --------------------- derived display fields ------------------ */
  const runs = Array.isArray(result) ? result : [];

  const statusChip = useMemo(() => {
    if (running || discovering) return { tone: "amber", text: running ? "Running audit…" : "Discovering RPC…" };
    if (rpcName) return { tone: "emerald", text: `Ready (RPC: ${rpcName})` };
    return { tone: "zinc", text: "Idle" };
  }, [running, discovering, rpcName]);

  /* ------------------------------ UI ----------------------------- */
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-pink-600/30 bg-pink-600/10 p-2">
            <ClipboardList className="w-4 h-4 text-pink-400" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-100">AI Prediction Audit</h3>
        </div>

        <div
          className={cx(
            "text-xs px-2.5 py-1 rounded-lg border",
            statusChip.tone === "emerald" && "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
            statusChip.tone === "amber" && "border-amber-600/40 bg-amber-500/10 text-amber-300",
            statusChip.tone === "zinc" && "border-zinc-700 bg-zinc-900/40 text-zinc-400"
          )}
        >
          {statusChip.text}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          onClick={runAudit}
          disabled={running || discovering}
          className={cx(
            "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
            "border",
            running || discovering
              ? "border-zinc-800 bg-zinc-900/60 text-zinc-400 cursor-not-allowed"
              : "border-emerald-600/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-500/50"
          )}
        >
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          {running ? "Running…" : "Load Audit Summary"}
        </button>

        <div className="text-xs text-zinc-400">
          Shows summary of all AI prediction runs with feedback stats
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-3 rounded-xl border border-rose-700/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>
              {error}
              <div className="mt-1 text-xs text-rose-300/80">
                Tip: Make sure you've created the rpc_ai_audit_summary function in your database.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* When it last ran */}
      <div className="mb-4 text-xs text-zinc-500">
        {lastRunAt ? <>Last run: {fmt(lastRunAt)}</> : <>Audit has not been run yet.</>}
        {rpcName ? <> · Using RPC: <span className="text-emerald-300">{rpcName}</span></> : null}
      </div>

      {/* Results - show prediction runs summary */}
      {runs.length > 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-zinc-400 border-b border-zinc-800 bg-zinc-900/80">
              <tr>
                <th className="text-left px-3 py-2">Run Date</th>
                <th className="text-left px-3 py-2">Model</th>
                <th className="text-center px-3 py-2">Predictions</th>
                <th className="text-center px-3 py-2">Feedback</th>
                <th className="text-center px-3 py-2">👍</th>
                <th className="text-center px-3 py-2">👎</th>
                <th className="text-center px-3 py-2">Accuracy</th>
                <th className="text-left px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <tr key={run.run_id || i} className="border-b border-zinc-800/60 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-300">{fmt(run.created_at)}</td>
                  <td className="px-3 py-2 text-zinc-200">{run.model_name || "unknown"}</td>
                  <td className="px-3 py-2 text-center text-zinc-300">{num(run.total_predictions)}</td>
                  <td className="px-3 py-2 text-center text-zinc-300">{num(run.total_feedback)}</td>
                  <td className="px-3 py-2 text-center text-emerald-300">{num(run.thumbs_up)}</td>
                  <td className="px-3 py-2 text-center text-rose-300">{num(run.thumbs_down)}</td>
                  <td className="px-3 py-2 text-center">
                    {run.accuracy != null ? (
                      <span className={cx(
                        "inline-block px-2 py-0.5 rounded-lg border text-xs font-medium",
                        Number(run.accuracy) >= 70
                          ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300"
                          : Number(run.accuracy) >= 50
                          ? "border-amber-600/40 bg-amber-500/10 text-amber-300"
                          : "border-rose-600/40 bg-rose-500/10 text-rose-300"
                      )}>
                        {run.accuracy}%
                      </span>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-400 max-w-xs truncate">
                    {run.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <CircleHelp className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400">No prediction runs found. Click "Load Audit Summary" to fetch data.</p>
        </div>
      )}

      {/* Small debug toggle */}
      {result && (
        <details className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <summary className="text-sm text-zinc-300 cursor-pointer">Show raw result (debug)</summary>
          <pre className="mt-3 text-xs text-zinc-400 whitespace-pre-wrap break-all">
{JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}