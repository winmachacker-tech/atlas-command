// FILE: src/components/AiLearningCard.jsx
// Purpose: AI Learning Proof card (dashboard)
// - NOW: uses ONLY RLS-safe views (no RPCs) for multi-tenant safety.
//   Source priority: v_ai_learning_summary_7d -> v_ai_learning_summary
// - Normalizes fields into: total_votes, up_events, down_events, tracked_drivers, last_signal_ts
// - % = ups / (ups + downs)
// - Shows mismatch hint when total_votes !== (ups + downs)
// - Safe date/number formatting, zero-division protection

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  LayoutDashboard,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  Users,
  AlertCircle,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString() : "—";
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? "—" : t.toLocaleString();
  } catch {
    return "—";
  }
}
function pct(n) {
  if (!Number.isFinite(n)) return "0.0%";
  return `${(n * 100).toFixed(1)}%`;
}
function firstRow(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  if (typeof data === "object") return data;
  return null;
}

/** Map any supported shape (7d or base) -> normalized fields */
function normalizeSummary(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      total_votes: 0,
      up_events: 0,
      down_events: 0,
      tracked_drivers: 0,
      last_signal_ts: null,
      source: "none",
    };
  }

  // 7d shape
  if ("total_events_7d" in raw || "ups_7d" in raw || "downs_7d" in raw) {
    return {
      total_votes: Number(raw.total_events_7d ?? 0),
      up_events: Number(raw.ups_7d ?? 0),
      down_events: Number(raw.downs_7d ?? 0),
      tracked_drivers: Number(raw.unique_drivers_7d ?? 0),
      last_signal_ts: raw.last_event_7d ?? raw.first_event_7d ?? null,
      source: "7d",
    };
  }

  // Base shape
  return {
    total_votes: Number(raw.total_votes ?? 0),
    up_events: Number(raw.up_events ?? 0),
    down_events: Number(raw.down_events ?? 0),
    tracked_drivers: Number(raw.tracked_drivers ?? 0),
    last_signal_ts: raw.last_signal_ts ?? null,
    source: "base",
  };
}

/* ---------------------------- component -------------------------- */
export default function AiLearningCard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [norm, setNorm] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSummary() {
      setLoading(true);
      setErr("");

      try {
        let data = null;

        // 1) 7-day View (preferred, RLS-safe)
        {
          const { data: d, error } = await supabase
            .from("v_ai_learning_summary_7d")
            .select("*")
            .limit(1)
            .maybeSingle();

          if (!error && d) {
            data = d;
          }
        }

        // 2) Base View (fallback, RLS-safe)
        if (!data) {
          const { data: d, error } = await supabase
            .from("v_ai_learning_summary")
            .select("*")
            .limit(1)
            .maybeSingle();

          if (!error && d) {
            data = d;
          }
        }

        if (!data) {
          // No data at all – treat as zeroed summary
          if (!cancelled) {
            setNorm(
              normalizeSummary({
                total_events_7d: 0,
                ups_7d: 0,
                downs_7d: 0,
                unique_drivers_7d: 0,
                last_event_7d: null,
              }),
            );
          }
        } else {
          const row = firstRow(data);
          const normalized = normalizeSummary(row);
          if (!cancelled) setNorm(normalized);
        }
      } catch (e) {
        console.error("[AiLearningCard] fetchSummary error:", e);
        if (!cancelled) setErr(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const total_votes = norm?.total_votes ?? 0;
  const up_events = norm?.up_events ?? 0;
  const down_events = norm?.down_events ?? 0;
  const tracked_drivers = norm?.tracked_drivers ?? 0;
  const last_signal_ts = norm?.last_signal_ts ?? null;

  // % from only up/down
  const voteEvents = (Number(up_events) || 0) + (Number(down_events) || 0);
  const upRate =
    voteEvents > 0 ? (Number(up_events) || 0) / voteEvents : 0;

  const mismatch = useMemo(() => {
    const tv = Number(total_votes) || 0;
    return tv !== voteEvents && (tv > 0 || voteEvents > 0);
  }, [total_votes, voteEvents]);

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
          <LayoutDashboard className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <div className="text-sm text-zinc-400 tracking-wide">
            AI LEARNING PROOF
          </div>
          <div className="text-lg md:text-xl font-semibold text-zinc-100">
            Real-time driver fit learning
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatTile
          icon={CheckCircle2}
          label="Total Votes"
          value={loading ? "…" : num(total_votes)}
        />
        <StatTile
          icon={ArrowUp}
          label="Up Events"
          value={loading ? "…" : num(up_events)}
        />
        <StatTile
          icon={ArrowDown}
          label="Down Events"
          value={loading ? "…" : num(down_events)}
        />
        <StatTile
          icon={Users}
          label="Tracked Drivers"
          value={loading ? "…" : num(tracked_drivers)}
        />
      </div>

      {/* Global Up-Rate */}
      <div className="mt-5 rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
        <div className="text-sm text-zinc-400 mb-1">Global Up-Rate</div>
        <div className="flex items-end justify-between">
          <div className="text-3xl font-bold text-zinc-100">
            {loading ? "…" : pct(upRate)}
          </div>
          <div className="text-xs text-zinc-400">
            = ups / (ups + downs)
          </div>
        </div>

        <div className="mt-3 text-xs text-zinc-500">
          Last signal: {loading ? "…" : fmtDate(last_signal_ts)}
        </div>

        {/* Mismatch helper note */}
        {mismatch && !loading && (
          <div className="mt-3 inline-flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
            <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5" />
            <div className="text-xs text-amber-200/90">
              Heads up: <strong>Global %</strong> uses only up/down events (
              {num(voteEvents)}), but <strong>Total Votes</strong> shows{" "}
              {num(total_votes)} (e.g., includes other feedback rows). This is
              expected if your feedback table stores more than just up/down
              votes.
            </div>
          </div>
        )}

        {/* Error surface */}
        {err && (
          <div className="mt-3 text-xs text-rose-300 bg-rose-900/30 border border-rose-700/40 rounded p-2">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- subcomponents ---------------------- */
function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-3">
      <div className="flex items-center gap-2 text-zinc-400 text-sm">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10">
          <Icon className="h-3.5 w-3.5 text-emerald-400" />
        </span>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">
        {value}
      </div>
    </div>
  );
}
