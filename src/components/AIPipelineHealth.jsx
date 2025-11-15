// FILE: src/components/AIPipelineHealth.jsx
// Purpose: One-glance health panel for the AI feedback → retrain pipeline.
// - Calls rpc_ai_pipeline_health() (falls back to view if RPC missing)
// - Shows status badges + key timestamps + totals
// - No schema changes required (uses what you already created)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ActivitySquare,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ServerCog,
  Clock,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) { return a.filter(Boolean).join(" "); }
function fmt(d) { if (!d) return "—"; try { return new Date(d).toLocaleString(); } catch { return String(d); } }
function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString() : "—";
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

/* ----------------------------- view ----------------------------- */
export default function AIPipelineHealth({ className = "" }) {
  const { show, ToastView } = useToast();
  const [loading, setLoading] = useState(true);

  const [data, setData] = useState({
    totals: {
      feedback_all: 0,
      feedback_7d: 0,
      feedback_1d: 0,
      drivers_all: 0,
      drivers_30d: 0,
      drivers_with_fit: 0,
      avg_fit_score_nonzero: 0
    },
    timestamps: {
      last_feedback_at: null,
      last_fit_update_at: null,
      last_training_at: null,
      last_nightly_run_at: null
    },
    training: {
      last_training_ok: null,
      last_nightly_ok: null
    },
    scheduler: {
      nightly_job_active: false,
      nightly_job_schedule: null
    }
  });

  const fetchHealth = useCallback(async () => {
    // Try RPC → fallback to view (tabular)
    const rpc = await supabase.rpc("rpc_ai_pipeline_health");
    if (!rpc.error && rpc.data) {
      setData(rpc.data);
      return;
    }
    const { data: rows, error } = await supabase.from("v_ai_pipeline_health").select("*").limit(1);
    if (error) throw error;
    const r = rows?.[0] || {};
    setData({
      totals: {
        feedback_all: r.total_feedback_all ?? 0,
        feedback_7d: r.total_feedback_7d ?? 0,
        feedback_1d: r.total_feedback_1d ?? 0,
        drivers_all: r.distinct_drivers_all ?? 0,
        drivers_30d: r.distinct_drivers_30d ?? 0,
        drivers_with_fit: r.drivers_with_fit ?? 0,
        avg_fit_score_nonzero: Number(r.avg_fit_score_nonzero ?? 0)
      },
      timestamps: {
        last_feedback_at: r.last_feedback_at ?? null,
        last_fit_update_at: r.last_fit_update_at ?? null,
        last_training_at: r.last_training_at ?? null,
        last_nightly_run_at: r.last_nightly_run_at ?? null
      },
      training: {
        last_training_ok: r.last_training_ok ?? null,
        last_nightly_ok: r.last_nightly_ok ?? null
      },
      scheduler: {
        nightly_job_active: r.nightly_job_active ?? false,
        nightly_job_schedule: r.nightly_job_schedule ?? null
      }
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await fetchHealth();
    } catch (e) {
      console.error(e);
      show(`Health error: ${e.message || e}`, "err");
    } finally {
      setLoading(false);
    }
  }, [fetchHealth, show]);

  useEffect(() => { refresh(); }, [refresh]);

  // Derive overall status
  const overall = useMemo(() => {
    const f1d = Number(data?.totals?.feedback_1d ?? 0);
    const nightlyOK = data?.training?.last_nightly_ok === true;
    const jobActive = !!data?.scheduler?.nightly_job_active;
    if (jobActive && nightlyOK && f1d > 0) return { label: "Good", tone: "good" };
    if (!jobActive || data?.training?.last_nightly_ok === false) return { label: "Broken", tone: "bad" };
    return { label: "Needs Attention", tone: "warn" };
  }, [data]);

  const Badge = ({ tone, children }) => {
    const map = {
      good: "text-emerald-200 border-emerald-500/40 bg-emerald-500/10",
      warn: "text-amber-200 border-amber-500/40 bg-amber-500/10",
      bad:  "text-rose-200 border-rose-500/40 bg-rose-500/10",
      mute: "text-zinc-300 border-zinc-600 bg-zinc-800/50",
    };
    const Icon = tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : AlertTriangle;
    return (
      <span className={cx("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs", map[tone] || map.mute)}>
        <Icon className="w-3.5 h-3.5" />
        {children}
      </span>
    );
  };

  return (
    <section className={cx("rounded-2xl border border-amber-400/40 bg-zinc-900/40", className)}>
      {ToastView}
      <header className="px-4 py-3 border-b border-amber-400/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ActivitySquare className="w-4 h-4 text-amber-300" />
          <h2 className="text-zinc-100 font-semibold">AI Pipeline Health</h2>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
        >
          <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </button>
      </header>

      {/* Overall status */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2">
          {overall.tone === "good" && <CheckCircle2 className="w-4 h-4 text-emerald-300" />}
          {overall.tone === "warn" && <AlertTriangle className="w-4 h-4 text-amber-300" />}
          {overall.tone === "bad"  && <XCircle className="w-4 h-4 text-rose-300" />}
          <div className="text-zinc-100 font-medium">Overall: {overall.label}</div>
          <Badge tone={overall.tone}>{overall.label}</Badge>
        </div>
      </div>

      {/* Stats grid */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Signals */}
        <div className="rounded-xl border border-zinc-800/70 p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-400">Signals</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">Last 1d</div>
              <div className="text-zinc-100 font-semibold">{num(data.totals.feedback_1d)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">Last 7d</div>
              <div className="text-zinc-100 font-semibold">{num(data.totals.feedback_7d)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">All</div>
              <div className="text-zinc-100 font-semibold">{num(data.totals.feedback_all)}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            Last feedback: {fmt(data.timestamps.last_feedback_at)}
          </div>
        </div>

        {/* Fit coverage */}
        <div className="rounded-xl border border-zinc-800/70 p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-400">Fit Coverage</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">Drivers (30d)</div>
              <div className="text-zinc-100 font-semibold">{num(data.totals.drivers_30d)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">With Fit</div>
              <div className="text-zinc-100 font-semibold">{num(data.totals.drivers_with_fit)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 p-2">
              <div className="text-xs text-zinc-400">Avg Score</div>
              <div className="text-zinc-100 font-semibold">
                {Number(data.totals.avg_fit_score_nonzero ?? 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            Last fit update: {fmt(data.timestamps.last_fit_update_at)}
          </div>
        </div>

        {/* Training & scheduler */}
        <div className="rounded-xl border border-zinc-800/70 p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-400">Training & Scheduler</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-zinc-300">Last retrain</div>
              <div className="text-zinc-100">{fmt(data.timestamps.last_training_at)}</div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-zinc-300">Nightly last run</div>
              <div className="text-zinc-100">{fmt(data.timestamps.last_nightly_run_at)}</div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-zinc-300">Nightly status</div>
              <div className="flex items-center gap-2">
                {data.training.last_nightly_ok === true ? (
                  <Badge tone="good">Success</Badge>
                ) : data.training.last_nightly_ok === false ? (
                  <Badge tone="bad">Failed</Badge>
                ) : (
                  <Badge tone="warn">Unknown</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-zinc-300">Job</div>
              <div className="flex items-center gap-2">
                <ServerCog className={cx("w-4 h-4", data.scheduler.nightly_job_active ? "text-emerald-300" : "text-rose-300")} />
                <span className="text-zinc-100">{data.scheduler.nightly_job_active ? "Active" : "Inactive"}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-zinc-300">Schedule</div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-zinc-400" />
                <span className="text-zinc-100">{data.scheduler.nightly_job_schedule || "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
