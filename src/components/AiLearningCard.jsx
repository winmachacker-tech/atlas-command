// FILE: src/components/AiLearningCard.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  BrainCircuit,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Activity,
} from "lucide-react";

/** Simple time formatter */
function fmtDateTime(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function AiLearningCard() {
  const [loading, setLoading] = useState(true);
  const [top, setTop] = useState([]); // top rows from v_ai_learning_proof
  const [totals, setTotals] = useState({ upTotal: 0, downTotal: 0, lastUpdated: null, drivers: 0, totalVotes: 0 });
  const [error, setError] = useState("");
  const subRef = useRef(null);

  const loadData = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      // 1) Top leaderboard (fit_score desc)
      const { data: topRows, error: topErr } = await supabase
        .from("v_ai_learning_proof")
        .select("*")
        .order("fit_score", { ascending: false })
        .limit(5);

      if (topErr) throw topErr;

      // 2) Global totals from driver_fit_scores (sum up/down’s client side)
      const { data: scoreRows, error: scoreErr } = await supabase
        .from("driver_fit_scores")
        .select("driver_id, up_events, down_events, updated_at");

      if (scoreErr) throw scoreErr;

      // Aggregate
      let upTotal = 0;
      let downTotal = 0;
      let lastUpdated = null;
      let drivers = 0;
      for (const r of scoreRows || []) {
        upTotal += Number(r.up_events || 0);
        downTotal += Number(r.down_events || 0);
        drivers += 1;
        const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
        if (t && (!lastUpdated || t > lastUpdated)) lastUpdated = t;
      }
      // If we also want totalVotes quickly, sum from the topRows? That only has 5 rows.
      // Better: quick small fetch of all v_ai_learning_proof and reduce total_votes.
      const { data: allProof, error: proofErr } = await supabase
        .from("v_ai_learning_proof")
        .select("total_votes,last_vote,driver_id");
      if (proofErr) throw proofErr;

      const totalVotes = (allProof || []).reduce((acc, r) => acc + Number(r.total_votes || 0), 0);
      // lastUpdated: consider proof last_vote too
      for (const r of allProof || []) {
        const t = r.last_vote ? new Date(r.last_vote).getTime() : 0;
        if (t && (!lastUpdated || t > lastUpdated)) lastUpdated = t;
      }

      setTop(topRows || []);
      setTotals({
        upTotal,
        downTotal,
        lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
        drivers,
        totalVotes,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("AiLearningCard loadData error:", e);
      setError(e?.message || "Failed to load learning proof.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: refresh when a new driver_feedback is inserted
  useEffect(() => {
    try {
      subRef.current = supabase
        .channel("ai-learning-proof:driver_feedback")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "driver_feedback" },
          () => {
            // Light debounce to avoid spamming reloads on bursts
            const id = setTimeout(loadData, 300);
            return () => clearTimeout(id);
          }
        )
        .subscribe();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Realtime subscription failed (AiLearningCard):", e);
    }
    return () => {
      try {
        if (subRef.current) supabase.removeChannel(subRef.current);
      } catch {}
    };
  }, [loadData]);

  const upRate = useMemo(() => {
    const denom = totals.upTotal + totals.downTotal;
    if (!denom) return 0;
    return Math.round((totals.upTotal / denom) * 1000) / 10; // one decimal
  }, [totals]);

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 p-4 md:p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <BrainCircuit className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm uppercase tracking-wider text-zinc-400">AI Learning Proof</div>
            <div className="text-base md:text-lg font-semibold">Real-time driver fit learning</div>
          </div>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700 hover:border-zinc-600 bg-zinc-800/60 text-sm"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Status / Errors */}
      <div className="mt-3">
        {error ? (
          <div className="flex items-start gap-2 text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div className="text-sm">{error}</div>
          </div>
        ) : loading ? (
          <div className="text-sm text-zinc-400">Loading learning signals…</div>
        ) : (
          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
            {/* Left: global stats */}
            <div className="flex-1 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat
                  label="Total Votes"
                  value={totals.totalVotes}
                  icon={<Activity className="w-4 h-4" />}
                />
                <Stat
                  label="Up Events"
                  value={totals.upTotal}
                  icon={<ThumbsUp className="w-4 h-4" />}
                />
                <Stat
                  label="Down Events"
                  value={totals.downTotal}
                  icon={<ThumbsDown className="w-4 h-4" />}
                />
                <Stat
                  label="Tracked Drivers"
                  value={totals.drivers}
                  icon={<CheckCircle2 className="w-4 h-4" />}
                />
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-xs text-zinc-400">Global Up-Rate</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <div className="text-2xl font-semibold">{upRate}%</div>
                  <div className="text-xs text-zinc-500">= ups / (ups + downs)</div>
                </div>
                <div className="mt-2 text-xs text-zinc-500">
                  Last signal: {fmtDateTime(totals.lastUpdated)}
                </div>
              </div>
            </div>

            {/* Right: leaderboard */}
            <div className="w-full md:w-96 shrink-0">
              <div className="text-sm text-zinc-400 mb-2">Top Drivers by Fit Score</div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 divide-y divide-zinc-800">
                {top.length === 0 ? (
                  <div className="p-3 text-sm text-zinc-400">No data yet.</div>
                ) : (
                  top.map((r, idx) => (
                    <div key={r.driver_id} className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-6 text-xs text-zinc-500">{idx + 1}.</div>
                        <div>
                          <div className="font-medium leading-tight">
                            {r.driver_id?.slice(0, 8)}…{r.driver_id?.slice(24, 36)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            votes: {r.total_votes} • last: {fmtDateTime(r.last_vote)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-semibold">
                          {Number(r.fit_score).toFixed(2)}
                        </div>
                        <div className="text-[11px] text-zinc-500">fit_score</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Small stat pill */
function Stat({ label, value, icon }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold">{value ?? "—"}</div>
    </div>
  );
}
