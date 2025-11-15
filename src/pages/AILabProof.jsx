// FILE: src/pages/AiLabProof.jsx
// Purpose: AI Lab — Proof & Audit
// - Calls RPC: rpc_ai_audit_summary()
// - Shows per-run predictions, feedback, thumbs, accuracy
// - Uses NEW column last_feedback_at to display "Last feedback" info in Notes

import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  ActivitySquare,
  RefreshCw,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Clock,
} from "lucide-react";

/* ----------------------------- helpers ----------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function fmtDateTime(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function fmtPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0%";
  return `${(x * 100).toFixed(1)}%`;
}

function num(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString();
}

/* ----------------------------- main page ----------------------------- */
export default function AiLabProof() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | error | ready
  const [err, setErr] = useState("");

  async function loadAudit() {
    setStatus("loading");
    setErr("");
    try {
      const { data, error } = await supabase.rpc("rpc_ai_audit_summary");
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
      setStatus("ready");
    } catch (e) {
      console.error("[AiLabProof] rpc_ai_audit_summary error:", e);
      setErr(e?.message || "Failed to load AI audit summary.");
      setStatus("error");
    }
  }

  useEffect(() => {
    loadAudit();
  }, []);

  const lastRunText = useMemo(() => {
    if (!rows?.length) return "Audit has not been run yet.";
    const latest = rows[0];
    return `Last run: ${fmtDateTime(latest.created_at)}`;
  }, [rows]);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-fuchsia-500/10 border border-fuchsia-500/40">
            <ActivitySquare className="h-5 w-5 text-fuchsia-300" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold">
              AI Lab — Proof &amp; Audit
            </h1>
            <p className="text-xs sm:text-sm text-white/60">
              Verify ranking behavior, stability, and safety checks. This is the
              permanent audit home.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadAudit}
            className={cx(
              "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs sm:text-sm",
              "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/20"
            )}
          >
            {status === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>Run audit</span>
          </button>

          <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            <span>Ready (RPC: rpc_ai_audit_summary)</span>
          </span>
        </div>
      </header>

      {/* Status / helper text */}
      <div className="text-xs sm:text-sm text-white/60">
        {lastRunText}
        {status === "loading" && " • Loading…"}
      </div>

      {/* Error banner */}
      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Audit error</div>
            <div className="text-xs sm:text-sm opacity-90">{err}</div>
          </div>
        </div>
      )}

      {/* Audit card */}
      <section className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 sm:px-6">
          <div>
            <h2 className="text-sm sm:text-base font-semibold">
              AI Prediction Audit
            </h2>
            <p className="text-xs text-white/60">
              Shows summary of all AI prediction runs with feedback stats.
            </p>
          </div>
          <button
            onClick={loadAudit}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
          >
            <RefreshCw
              className={cx(
                "h-4 w-4",
                status === "loading" && "animate-spin"
              )}
            />
            <span>Load Audit Summary</span>
          </button>
        </div>

        {/* Table */}
        {status === "loading" && !rows.length ? (
          <div className="p-6 sm:p-10 flex items-center justify-center gap-2 text-sm text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading audit runs…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 sm:p-10 text-sm text-white/70">
            No prediction runs found yet. Trigger some predictions and then run
            the audit.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <Th>Run Date</Th>
                  <Th>Model</Th>
                  <Th align="right">Predictions</Th>
                  <Th align="right">Feedback</Th>
                  <Th align="right">
                    <span className="inline-flex items-center gap-1">
                      👍<span className="hidden sm:inline">Up</span>
                    </span>
                  </Th>
                  <Th align="right">
                    <span className="inline-flex items-center gap-1">
                      👎<span className="hidden sm:inline">Down</span>
                    </span>
                  </Th>
                  <Th align="right">Accuracy</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.run_id}
                    className="border-t border-white/10 hover:bg-white/5"
                  >
                    <Td>{fmtDateTime(r.created_at)}</Td>
                    <Td>{r.model_name || "v1"}</Td>
                    <Td align="right">{num(r.total_predictions)}</Td>
                    <Td align="right">{num(r.total_feedback)}</Td>
                    <Td align="right">{num(r.thumbs_up)}</Td>
                    <Td align="right">{num(r.thumbs_down)}</Td>
                    <Td align="right">
                      <AccuracyPill
                        accuracy={r.accuracy}
                        totalFeedback={r.total_feedback}
                      />
                    </Td>
                    <Td>
                      <NotesCell
                        totalFeedback={r.total_feedback}
                        lastFeedbackAt={r.last_feedback_at}
                        notes={r.notes}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ----------------------------- sub components ----------------------------- */

function Th({ children, align = "left" }) {
  return (
    <th
      className={cx(
        "px-3 py-2 text-[11px] sm:text-xs font-medium",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }) {
  return (
    <td
      className={cx(
        "px-3 py-2 align-middle text-[11px] sm:text-xs",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </td>
  );
}

function AccuracyPill({ accuracy, totalFeedback }) {
  const pct = Number(accuracy);
  const hasFeedback = Number(totalFeedback) > 0;

  let tone =
    pct >= 0.85
      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
      : pct >= 0.7
      ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
      : "border-red-500/40 bg-red-500/15 text-red-200";

  if (!hasFeedback) {
    tone = "border-white/20 bg-white/5 text-white/70";
  }

  return (
    <span
      className={cx(
        "inline-flex items-center justify-end rounded-full border px-2 py-0.5 font-mono text-[11px]",
        tone
      )}
    >
      {hasFeedback ? fmtPct(pct) : "0%"}
    </span>
  );
}

function NotesCell({ totalFeedback, lastFeedbackAt, notes }) {
  const hasFeedback = Number(totalFeedback) > 0;
  if (!hasFeedback) {
    return (
      <div className="text-[11px] sm:text-xs text-white/60">
        {notes || "No feedback yet for this run"}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-[11px] sm:text-xs text-white/75">
      <Clock className="h-3.5 w-3.5 opacity-70" />
      <span>
        Last feedback:{" "}
        <span className="font-medium">{fmtDateTime(lastFeedbackAt)}</span>
      </span>
    </div>
  );
}
