// src/components/AILearningBadge.jsx
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2 } from "lucide-react";

/**
 * Live AI Learning badge
 * - labeled = COUNT(DISTINCT driver_id) in driver_feedback WHERE created_at >= epoch.started_at
 * - total   = COUNT(*) from drivers
 * - Subscribes to driver_feedback, drivers, and ai_learning_epoch for live updates
 */
export default function AILearningBadge({ className = "" }) {
  const [state, setState] = useState({ labeled: 0, total: 0, loading: true, err: "" });
  const refreshLock = useRef(false);
  const lastRefreshAt = useRef(0);
  const unsubscribed = useRef(false);

  async function fetchProgress() {
    try {
      // 1) Get epoch start
      const { data: epochRows, error: epochErr } = await supabase
        .from("ai_learning_epoch")
        .select("started_at")
        .eq("id", "global")
        .limit(1);
      if (epochErr) throw epochErr;
      const started_at = epochRows?.[0]?.started_at || new Date().toISOString(); // fallback = now

      // 2) Count total drivers
      const { data: totalRows, error: totErr, count: totCount } = await supabase
        .from("drivers")
        .select("id", { count: "exact", head: true });
      if (totErr) throw totErr;
      const total = typeof totCount === "number" ? totCount : (totalRows?.length || 0);

      // 3) Count distinct labeled drivers since epoch
      const { data: labeledRows, error: labErr } = await supabase
        .from("driver_feedback")
        .select("driver_id")
        .gte("created_at", started_at);
      if (labErr) throw labErr;
      const distinct = new Set((labeledRows || []).map((r) => r.driver_id));
      const labeled = distinct.size;

      setState({ labeled, total, loading: false, err: "" });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, err: e?.message || "Failed to load" }));
    }
  }

  function throttledRefresh(ms = 700) {
    const now = Date.now();
    if (refreshLock.current && now - lastRefreshAt.current < ms) return;
    refreshLock.current = true;
    lastRefreshAt.current = now;
    fetchProgress().finally(() => {
      setTimeout(() => (refreshLock.current = false), ms);
    });
  }

  useEffect(() => {
    setState((s) => ({ ...s, loading: true, err: "" }));
    fetchProgress();

    const ch = supabase
      .channel("ai-learning-progress-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_feedback" },
        () => throttledRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drivers" },
        () => throttledRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_learning_epoch" },
        () => throttledRefresh()
      )
      .subscribe();

    return () => {
      if (!unsubscribed.current) {
        try {
          supabase.removeChannel(ch);
        } catch (_) {}
        unsubscribed.current = true;
      }
    };
  }, []);

  const { labeled, total, loading, err } = state;

  return (
    <div
      className={
        className ||
        "rounded-2xl border border-yellow-500/40 bg-yellow-500/5 px-3 py-1.5 text-sm"
      }
      title="AI Learning progress (live since epoch)"
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          AI Learning: loading…
        </span>
      ) : err ? (
        <span className="text-rose-300">AI Learning: {err}</span>
      ) : (
        <span className="text-yellow-200">
          AI Learning: <span className="tabular-nums">{labeled}/{total}</span> labeled
        </span>
      )}
    </div>
  );
}
