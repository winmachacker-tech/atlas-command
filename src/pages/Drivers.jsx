// src/pages/Drivers.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  RefreshCw,
  Search,
  Loader2,
  Eye,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import DriverFitBadge from "../components/DriverFitBadge.jsx";
import AILearningBadge from "../components/AILearningBadge.jsx";

/* ---------- small utils ---------- */
function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* Merge helper: overlay epoch-based thumbs onto directory rows */
function mergeEpochCounts(rows, epochRows) {
  const map = new Map(epochRows.map((r) => [r.driver_id, r]));
  return (rows || []).map((r) => {
    const e = map.get(r.driver_id);
    return {
      ...r,
      // override thumbs counters & last_feedback_at with reset view values
      up_events: e?.up_events ?? 0,
      down_events: e?.down_events ?? 0,
      last_feedback_at: e?.last_feedback_at ?? null,
    };
  });
}

/* ---------- PAGE ---------- */
export default function Drivers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const mounted = useRef(true);
  const liveChannelRef = useRef(null);

  const loadDrivers = useCallback(
    async ({ search = "" } = {}) => {
      setLoading(true);
      try {
        // 1) Base directory (names, status, fit_score, etc.)
        const dirPromise = supabase
          .from("v_driver_directory")
          .select("*")
          .order("created_at", { ascending: false });

        // 2) Epoch-based thumbs since reset (zero after your reset until new clicks)
        const epochPromise = supabase
          .from("v_driver_feedback_since_epoch")
          .select("driver_id, up_events, down_events, last_feedback_at");

        const [{ data: dir, error: e1 }, { data: epoch, error: e2 }] =
          await Promise.all([dirPromise, epochPromise]);

        if (e1) throw e1;
        if (e2) throw e2;

        let merged = mergeEpochCounts(dir || [], epoch || []);

        // Apply search (case-insensitive)
        const s = (search || "").trim().toLowerCase();
        if (s) {
          merged = merged.filter((r) => {
            const bag = [
              r.full_name,
              r.email,
              r.phone,
              r.status,
              (r.fit_score ?? "").toString(),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return bag.includes(s);
          });
        }

        if (mounted.current) setRows(merged);
      } catch (err) {
        console.error("loadDrivers error:", err?.message || err);
        if (mounted.current) setRows([]);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    []
  );

  // Initial load
  useEffect(() => {
    mounted.current = true;
    loadDrivers();
    return () => {
      mounted.current = false;
    };
  }, [loadDrivers]);

  // Live updates: refetch when feedback or epoch changes (and when drivers change)
  useEffect(() => {
    // Clean previous channel (hot reload safety)
    if (liveChannelRef.current) {
      try {
        supabase.removeChannel(liveChannelRef.current);
      } catch (_) {}
      liveChannelRef.current = null;
    }

    const ch = supabase
      .channel("drivers_list_live_epoched")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_feedback" },
        () => loadDrivers({ search: q })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drivers" },
        () => loadDrivers({ search: q })
      )
      .on(
        // If you reset the epoch, refresh immediately
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_learning_epoch" },
        () => loadDrivers({ search: q })
      )
      .subscribe();

    liveChannelRef.current = ch;

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch (_) {}
      liveChannelRef.current = null;
    };
  }, [loadDrivers, q]);

  // Debounced search setter
  const onSearch = useMemo(
    () =>
      debounce((val) => {
        setQ(val);
        loadDrivers({ search: val });
      }, 200),
    [loadDrivers]
  );

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Drivers</h1>
          {/* Live global badge: reads ai_learning_state (0/14 after your reset) */}
          <AILearningBadge />
        </div>
        {/* Right-side buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadDrivers({ search: q })}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/50 px-3 py-2 hover:bg-zinc-800/60"
            title="Refresh"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link
            to="/drivers/new"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 hover:bg-emerald-500"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Driver</span>
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            className="w-full rounded-xl border border-zinc-700/60 bg-zinc-900 px-9 py-2 outline-none focus:ring-2 focus:ring-emerald-600"
            placeholder="Search drivers, email, status…"
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-700/60">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="text-left">
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Fit</th>
              <th className="px-4 py-3">Thumbs</th>
              <th className="px-4 py-3">Last Feedback</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center opacity-70">
                  <Loader2 className="w-5 h-5 inline-block mr-2 animate-spin" />
                  Loading drivers…
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center opacity-70">
                  No drivers found.
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((r) => (
                <tr
                  key={r.driver_id}
                  className="border-t border-zinc-800/60 hover:bg-zinc-900/40"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/drivers/${r.driver_id}`}
                        className="text-emerald-400 hover:underline"
                      >
                        {r.full_name || "—"}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg border border-zinc-700/60 px-2 py-1 text-xs">
                      {r.status || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <DriverFitBadge driverId={r.driver_id} />
                      <span className="opacity-70">
                        {Number(r.fit_score ?? 0).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/60 px-2 py-1"
                        title="Up events (since reset)"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span>{r.up_events ?? 0}</span>
                      </div>
                      <div
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/60 px-2 py-1"
                        title="Down events (since reset)"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                        <span>{r.down_events ?? 0}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="opacity-70">
                      {r.last_feedback_at
                        ? new Date(r.last_feedback_at).toLocaleString()
                        : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/drivers/${r.driver_id}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700/60 px-2 py-1 hover:bg-zinc-800/50"
                      title="View"
                    >
                      <Eye className="w-4 h-4" />
                      <span className="hidden sm:inline">Open</span>
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Footer hint */}
      <p className="mt-3 text-xs opacity-60">
        Live updates: this page reads thumbs from{" "}
        <code>public.v_driver_feedback_since_epoch</code> so counts reset when
        you reset the epoch, and auto-refreshes on{" "}
        <code>driver_feedback</code>, <code>drivers</code>, or{" "}
        <code>ai_learning_epoch</code> changes.
      </p>
    </div>
  );
}
