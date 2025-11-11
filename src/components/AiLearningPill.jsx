// src/components/AiLearningPill.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AiLearningPill() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("v_ai_learning_stats")
        .select("*")
        .maybeSingle();
      if (!error && active) setStats(data);
    })();
    return () => { active = false; };
  }, []);

  if (!stats) return null;

  const cls = "inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs";
  return (
    <span className={`${cls} border-emerald-700/30 bg-emerald-600/15 text-emerald-300`}>
      AI learning: {stats.labeled}/{stats.total_preds} labeled ({stats.pct_labeled}%)
    </span>
  );
}
