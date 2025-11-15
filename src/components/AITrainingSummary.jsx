// FILE: src/components/AITrainingSummary.jsx
// Purpose: Nightly retrain summary panel for AI Learning Proof
// Adds: "Run Type" label (manual/nightly) pulled from ai_training_runs.notes

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { RefreshCw, PlayCircle, CheckCircle2, XCircle, Clock, Database } from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) { return a.filter(Boolean).join(" "); }
function fmt(d) { if (!d) return "—"; try { return new Date(d).toLocaleString(); } catch { return String(d); } }
function num(n, d = 0) {
  const x = Number(n);
  return Number.isFinite(x)
    ? x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
}

/* ------------------------- tiny toast hook ----------------------- */
function useToast() {
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState("ok");
  const t = useRef(null);
  const show = useCallback((m, _tone = "ok") => {
    setMsg(m); setTone(_tone);
    clearTimeout(t.current); t.current = setTimeout(() => setMsg(""), 3000);
  }, []);
  const View = useMemo(() => {
    if (!msg) return null;
    return (
      <div
        className={cx(
          "fixed z-50 bottom-16 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-xl text-sm shadow-lg border",
          tone === "ok"  && "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
          tone === "err" && "bg-rose-500/10 text-rose-200 border-rose-500/30",
          tone === "info"&& "bg-sky-500/10 text-sky-200 border-sky-500/30"
        )}
        role="status"
      >
        {msg}
      </div>
    );
  }, [msg, tone]);
  return { show, ToastView: View };
}

/* ------------------------------ page ---------------------------- */
export default function AITrainingSummary({ className = "" }) {
  const { show, ToastView } = useToast();

  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);

  const [summary, setSummary] = useState({
    drivers_with_signals: 0,
    total_feedback: 0,
    avg_fit_score: 0,
    last_feedback_at: null,
    last_training_at: null,
    last_training_ok: null,
    last_training_method: null,
    last_training_type: null, // new
  });

  const [recent, setRecent] = useState([]); // last 5 rows

  const fetchSummary = useCallback(async () => {
    // Try RPC first
    const { data, error } = await supabase.rpc("rpc_ai_learning_summary");
    if (!error && Array.isArray(data) && data[0]) {
      setSummary(data[0]);
      return;
    }

    // Fallback
    try {
      const [{ data: fits }, fbCount, lastFb, lastRun] = await Promise.all([
        supabase.from("driver_fit_scores").select("fit_score").limit(10000),
        supabase.from("driver_feedback").select("*", { count: "exact", head: true }),
        supabase
          .from("v_driver_feedback_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100)
          .maybeSingle(),
        supabase
          .from("ai_training_runs")
          .select("ran_at, ok, retrain_name, notes")
          .order("ran_at", { ascending: false })
          .limit(1),
      ]);

      const drivers_with_signals = (fits || []).length;
      const avg_fit_score =
        (fits || []).reduce((s, r) => s + (Number(r.fit_score) || 0), 0) /
        (drivers_with_signals || 1);

      setSummary({
        drivers_with_signals,
        total_feedback: fbCount?.count ?? 0,
        avg_fit_score: Number.isFinite(avg_fit_score) ? Number(avg_fit_score.toFixed(4)) : 0,
        last_feedback_at: lastFb?.data?.feedback_at ?? null,
        last_training_at: lastRun?.data?.[0]?.ran_at ?? null,
        last_training_ok: lastRun?.data?.[0]?.ok ?? null,
        last_training_method: lastRun?.data?.[0]?.retrain_name ?? null,
        last_training_type: lastRun?.data?.[0]?.notes ?? null,
      });
    } catch (e) {
      console.error(e);
      show(`Summary error: ${e.message || e}`, "err");
    }
  }, [show]);

  const fetchRecent = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("ai_training_runs")
        .select("id, ran_at, ok, retrain_name, backfill_ok, backfill_name, lane_key, notes")
        .order("ran_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      setRecent(data || []);
    } catch (e) {
      console.error(e);
      show(`Runs error: ${e.message || e}`, "err");
    }
  }, [show]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try { await Promise.all([fetchSummary(), fetchRecent()]); }
    finally { setLoading(false); }
  }, [fetchSummary, fetchRecent]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Train Now → call retrain RPC (manual label)
  const trainNow = useCallback(async () => {
    setTraining(true);
    try {
      const { data, error } = await supabase.rpc("rpc_ai_run_now", { p_lane_key: null, p_notes: "manual" });
      if (error) throw error;
      if (!data?.ok) throw new Error("Retrain RPC returned not-ok");
      show("AI retrain triggered via RPC.", "ok");
      await refreshAll();
    } catch (err) {
      console.error(err);
      show(`Train failed: ${err.message || err}`, "err");
    } finally {
      setTraining(false);
    }
  }, [refreshAll, show]);

  const Pill = ({ ok }) => {
    const tone =
      ok === true  ? "text-emerald-200 border-emerald-500/40 bg-emerald-500/10" :
      ok === false ? "text-rose-200 border-rose-500/40 bg-rose-500/10" :
                     "text-zinc-300 border-zinc-600 bg-zinc-800/50";
    const Icon = ok === true ? CheckCircle2 : ok === false ? XCircle : Clock;
    const label = ok === true ? "Success" : ok === false ? "Failed" : "—";
    return (
      <span className={cx("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs", tone)}>
        <Icon className="w-3.5 h-3.5" />
        {label}
      </span>
    );
  };

  return (
    <section className={cx("rounded-2xl border border-amber-400/40 bg-zinc-900/40", className)}>
      {ToastView}
      <header className="px-4 py-3 border-b border-amber-400/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-300" />
          <h2 className="text-zinc-100 font-semibold">Nightly Retrain Summary</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={trainNow}
            disabled={training}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-pink-400/40 text-pink-200 hover:bg-pink-500/10"
          >
            <PlayCircle className={cx("w-4 h-4", training && "animate-pulse")} />
            {training ? "Training…" : "Train Now"}
          </button>
          <button
            onClick={refreshAll}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
          >
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left: Last run */}
        <div className="rounded-xl border border-zinc-800/70 p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-400">Last Run</div>
          <div className="mt-1 text-zinc-100 font-medium">{fmt(summary.last_training_at)}</div>
          <div className="mt-2"><Pill ok={summary.last_training_ok} /></div>
          <div className="mt-1 text-xs text-zinc-400">Method: {summary.last_training_method || "—"}</div>
          <div className="text-xs text-zinc-500">Type: {summary.last_training_type || "—"}</div>
        </div>

        {/* Middle: Totals */}
        <div className="rounded-xl border border-zinc-800/70 p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-400">Totals</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">Drivers</div>
              <div className="text-zinc-100 font-semibold">{num(summary.drivers_with_signals)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">Feedback</div>
              <div className="text-zinc-100 font-semibold">{num(summary.total_feedback)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">Avg Score</div>
              <div className="text-zinc-100 font-semibold">{num(summary.avg_fit_score, 3)}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-400">Last feedback: {fmt(summary.last_feedback_at)}</div>
        </div>

        {/* Right: Recent runs */}
        <div className="rounded-xl border border-zinc-800/70 p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-400">Recent Runs</div>
          <div className="mt-2 space-y-2">
            {recent.length === 0 && <div className="text-sm text-zinc-500">No runs logged yet.</div>}
            {recent.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="text-zinc-200 truncate">{fmt(r.ran_at)}</div>
                  <div className="text-xs text-zinc-500 truncate">
                    {r.retrain_name || "—"}{r.lane_key ? ` · ${r.lane_key}` : ""}
                  </div>
                  <div className="text-[11px] text-zinc-600 italic">{r.notes || "—"}</div>
                </div>
                <div className="shrink-0"><Pill ok={r.ok} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
