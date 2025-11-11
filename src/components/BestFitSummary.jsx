import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { RefreshCw, Eye, AlertCircle, Loader2, Star } from "lucide-react";

/**
 * Compact, non-redundant summary:
 * - Top Driver (name + fit)
 * - Avg Fit Score (of the list you consider "shown")
 * - Last Feedback date (across those drivers)
 * - View → scrolls to full AI panel (expects element with id="ai-recs")
 *
 * Props:
 *  - loadId: UUID of the load
 *  - shown?: number   (how many the main page is "showing" — just for the label)
 *  - limit?: number   (how many to consider when computing summary, default 10)
 */
export default function BestFitSummary({ loadId, shown = 5, limit = 10 }) {
  const [data, setData] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!loadId) return;
    setLoading(true);
    setErr("");
    try {
      const { data, error } = await supabase.rpc("rec_drivers_for_load", {
        p_load_id: loadId,
        p_limit: limit,
      });
      if (error) throw error;
      setData(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("BestFitSummary RPC failed:", e);
      setErr(e?.message || "Failed to load summary.");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [loadId, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const top = data?.[0] || null;

  const avgFit = useMemo(() => {
    if (!data?.length) return 0;
    const total = data.reduce((sum, r) => sum + (Number(r.fit_score) || 0), 0);
    return Math.round(total / data.length);
  }, [data]);

  const lastFeedback = useMemo(() => {
    if (!data?.length) return null;
    const times = data
      .map((r) => (r.last_feedback_at ? new Date(r.last_feedback_at) : null))
      .filter(Boolean);
    if (!times.length) return null;
    const max = new Date(Math.max(...times.map((d) => d.getTime())));
    return max;
  }, [data]);

  function handleView() {
    // Jump to full AI panel if present
    try {
      window.location.hash = "#ai-recs";
      const el = document.getElementById("ai-recs");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_) {}
  }

  return (
    <section className="rounded-2xl border border-pink-500/40 bg-zinc-900 p-3 sm:p-4">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-pink-400/80" />
          <div className="leading-5">
            <div className="text-pink-200 font-semibold">Best-Fit Drivers</div>
            <div className="text-xs text-zinc-400">
              ({shown} shown)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="flex items-center gap-1 rounded-full border border-zinc-700/60 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            title="Refresh"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>Refresh</span>
          </button>
          <button
            onClick={handleView}
            className="flex items-center gap-1 rounded-full border border-zinc-700/60 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            title="View full AI recommendations"
          >
            <Eye className="h-4 w-4" />
            <span>View</span>
          </button>
        </div>
      </div>

      {/* Body */}
      {err && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
          <AlertCircle className="h-4 w-4" />
          <span>{err}</span>
        </div>
      )}

      {loading && !data.length && (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-pink-300" />
        </div>
      )}

      {!loading && (
        <div className="grid gap-3">
          {/* Top driver */}
          <div className="rounded-xl border border-pink-500/30 bg-zinc-950/40 p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Star className="h-4 w-4 text-pink-300" />
                <div className="truncate text-sm font-medium text-zinc-100">
                  {top?.driver_name || "—"}
                </div>
              </div>
              <div
                className="rounded-md border border-pink-500/40 px-2 py-1 text-right text-xs"
                title="Top driver fit score"
              >
                <div className="font-semibold text-pink-200">
                  {top ? Math.round(top.fit_score) : "—"}
                </div>
                <div className="text-zinc-400">top fit</div>
              </div>
            </div>

            <div className="ml-6 text-xs text-zinc-400">
              {top?.driver_code ? `#${top.driver_code}` : ""}
              {top?.phone ? (top?.driver_code ? " · " : "") + top.phone : ""}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-2 text-center">
              <div className="text-sm font-semibold text-zinc-100">{avgFit}</div>
              <div className="text-xs text-zinc-400">avg fit score</div>
            </div>
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-2 text-center">
              <div className="text-sm font-semibold text-zinc-100">
                {lastFeedback ? lastFeedback.toLocaleDateString() : "—"}
              </div>
              <div className="text-xs text-zinc-400">last feedback</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
