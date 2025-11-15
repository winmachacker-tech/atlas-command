// FILE: src/components/LearnedSuggestions.jsx
// Purpose: Show lane×driver learned recommendations for a given load.
// - Calls: rpc_ai_best_drivers_from_learning(load_id, limit)
// - Fully responsive (no horizontal scroll), safe if no data.
// - Drop-in: <LearnedSuggestions loadId={load.id} />

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Brain, Loader2, TrendingUp, ShieldCheck } from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }

export default function LearnedSuggestions({ loadId, limit = 10, className = "" }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!loadId) return;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data, error } = await supabase.rpc(
          "rpc_ai_best_drivers_from_learning",
          { p_load_id: loadId, p_limit: limit }
        );
        if (!alive) return;
        if (error) throw error;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        setErr(e?.message || "Failed to load learned suggestions");
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [loadId, limit]);

  return (
    <div className={cx(
      "w-full max-w-full rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-3 md:p-4",
      "shadow-sm backdrop-blur supports-[backdrop-filter]:bg-zinc-900/30",
      className
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Brain className="h-4 w-4 shrink-0" />
        <h3 className="text-sm font-semibold">Learned Driver Suggestions</h3>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && err && (
        <div className="text-sm text-red-400 break-words">{err}</div>
      )}

      {!loading && !err && (!rows || rows.length === 0) && (
        <p className="text-sm text-zinc-400">
          No learned suggestions yet for this lane. Try giving a 👍/👎 on a load with the same origin/dest,
          then retrain:
          <code className="ml-1 rounded bg-zinc-800/60 px-1 py-0.5 text-xs">select * from public.rpc_ai_retrain_model('v1');</code>
        </p>
      )}

      {!loading && rows && rows.length > 0 && (
        <ul className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.driver_id} className="rounded-xl border border-zinc-800/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.driver_id}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      Score: {(Number(r.learned_score ?? 0) * 100).toFixed(0)}%
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      Net: {r.net_score ?? 0} (↑{r.up_count ?? 0} / ↓{r.down_count ?? 0})
                    </span>
                  </div>
                </div>
              </div>
              {r.lane_key && (
                <div className="mt-2 text-xs text-zinc-500 truncate">Lane: {r.lane_key}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
