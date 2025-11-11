import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  RefreshCw,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Truck,
  BadgeCheck,
} from "lucide-react";

/**
 * Props:
 *  - loadId: UUID of the load to recommend for
 *  - limit?: number (default 10)
 *  - onAssign?: (driver) => void  // optional handler when user clicks "Assign"
 */
export default function AIRecPanel({ loadId, limit = 10, onAssign }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true); // matches your "Open" pill in the header
  const firstLoadRef = useRef(true);

  const fetchRecs = useCallback(async () => {
    if (!loadId) return;
    setLoading(true);
    setErr("");
    try {
      // Call the RPC that ranks drivers for this load.
      const { data, error } = await supabase.rpc("rec_drivers_for_load", {
        p_load_id: loadId,
        p_limit: limit,
      });

      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("AIRecPanel RPC failed:", e);
      setErr(e?.message || "Failed to load recommendations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [loadId, limit]);

  useEffect(() => {
    // Auto fetch on mount and when loadId changes
    fetchRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadId]);

  // Small UX nicety: show subtle skeleton if first load
  const isFirstLoad = useMemo(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      return true;
    }
    return false;
  }, [loadId]);

  return (
    <section className="rounded-2xl border border-amber-500/40 bg-zinc-900 p-3 sm:p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400/80" />
          <h3 className="text-amber-200 font-semibold">AI Recommendations</h3>

          {/* Open pill toggle (cosmetic + collapse) */}
          <button
            onClick={() => setOpen((v) => !v)}
            className={`ml-2 rounded-full border px-2.5 py-0.5 text-xs transition ${
              open
                ? "border-amber-500/50 text-amber-200"
                : "border-zinc-700 text-zinc-300"
            }`}
            title="Toggle open/close"
          >
            {open ? "Open" : "Closed"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchRecs}
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

          {/* Optional “New” action — wire to whatever you want; for now it retries */}
          <button
            onClick={fetchRecs}
            className="flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
            title="New"
          >
            <Plus className="h-4 w-4" />
            <span>New</span>
          </button>
        </div>
      </div>

      {/* Body */}
      {open && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-zinc-950/40 p-2 sm:p-3">
          {/* Error */}
          {err && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
              <AlertCircle className="h-4 w-4" />
              <span>{err}</span>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="flex h-28 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-amber-300" />
            </div>
          )}

          {/* Empty state */}
          {!loading && rows.length === 0 && !err && (
            <div className="flex h-28 flex-col items-center justify-center text-sm text-zinc-400">
              <Truck className="mb-1 h-5 w-5" />
              <div>No recommendations yet.</div>
              <div className="text-zinc-500">
                Click <span className="text-amber-300">Refresh</span> after
                giving thumbs on drivers.
              </div>
            </div>
          )}

          {/* List */}
          {!loading && rows.length > 0 && (
            <ul className="divide-y divide-zinc-800/80">
              {rows.map((r, idx) => (
                <li
                  key={r.driver_id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  {/* Left: rank + name + badges */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/40 text-xs text-amber-200">
                        {idx + 1}
                      </span>
                      <div className="truncate">
                        <div className="truncate text-sm font-medium text-zinc-100">
                          {r.driver_name || r.driver_code || "Unnamed Driver"}
                        </div>
                        <div className="truncate text-xs text-zinc-400">
                          {r.driver_code ? `#${r.driver_code} · ` : ""}
                          {r.phone || r.email || "—"}
                        </div>
                      </div>
                      {r.fit_score >= 100 && (
                        <BadgeCheck
                          className="ml-1 h-4 w-4 text-emerald-400"
                          title="High fit"
                        />
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="mt-1 ml-9 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span className="rounded-md border border-zinc-700/60 px-1.5 py-0.5">
                        Fit: <span className="text-zinc-200">{r.fit_score}</span>
                      </span>
                      <span className="rounded-md border border-zinc-700/60 px-1.5 py-0.5">
                        👍 {r.up_events || 0}
                      </span>
                      <span className="rounded-md border border-zinc-700/60 px-1.5 py-0.5">
                        👎 {r.down_events || 0}
                      </span>
                      {r.last_feedback_at && (
                        <span className="rounded-md border border-zinc-700/60 px-1.5 py-0.5">
                          last fb: {new Date(r.last_feedback_at).toLocaleDateString()}
                        </span>
                      )}
                      {r.reason && (
                        <span className="truncate">
                          · <span className="text-zinc-300">{r.reason}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: score + action */}
                  <div className="flex items-center gap-2">
                    <div
                      className="mr-1 hidden rounded-md border border-amber-500/40 px-2 py-1 text-right text-xs sm:block"
                      title="Composite fit score"
                    >
                      <div className="font-semibold text-amber-200">
                        {Math.round(r.fit_score)}
                      </div>
                      <div className="text-zinc-400">score</div>
                    </div>

                    <button
                      onClick={() => (typeof onAssign === "function" ? onAssign(r) : null)}
                      className="hidden items-center gap-1 rounded-lg border border-emerald-600/60 px-2.5 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-600/10 sm:flex"
                      title="Assign driver"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Assign
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
