// src/components/BestFitDriversPanel.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Trophy,
  RefreshCw,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Clock,
  CheckCircle2,
  UserRound,
  ChevronDown,
} from "lucide-react";

/**
 * Responsive Best-Fit Drivers dropdown
 * - Auto sizes to viewport
 * - Flips up/down based on available space
 * - Clamps width so it never overflows horizontally
 *
 * Props:
 * - loadId?: string | null
 * - limit?: number (default 5)
 * - onAssign?: (driver) => void   // if omitted, Assign button is hidden
 */
export default function BestFitDriversPanel({ loadId = null, limit = 5, onAssign }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const liveRef = useRef(null);

  // For responsive dropdown positioning/sizing
  const headerRef = useRef(null);
  const panelRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState({
    top: 0,
    left: 0,
    width: 360,
    maxHeight: 360,
    openUp: false,
  });

  const canAssign = typeof onAssign === "function";

  const fetchRanked = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await supabase.rpc("best_fit_drivers", {
        limit_n: limit,
        load_id: loadId,
      });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.message || "Failed to load best-fit drivers");
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [limit, loadId]);

  useEffect(() => {
    fetchRanked();

    // Live refresh on feedback, drivers, and epoch updates
    if (liveRef.current) {
      try {
        supabase.removeChannel(liveRef.current);
      } catch (_) {}
      liveRef.current = null;
    }
    const ch = supabase
      .channel("best-fit-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_feedback" }, fetchRanked)
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, fetchRanked)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_learning_epoch" }, fetchRanked)
      .subscribe();

    liveRef.current = ch;
    return () => {
      try {
        if (liveRef.current) supabase.removeChannel(liveRef.current);
      } catch (_) {}
      liveRef.current = null;
    };
  }, [fetchRanked]);

  // Format date helper
  function fmtDate(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString();
    } catch {
      return "—";
    }
  }

  // Compute panel layout based on viewport + header position
  const computePanelLayout = useCallback(() => {
    const headerEl = headerRef.current;
    if (!headerEl) return;

    const rect = headerEl.getBoundingClientRect();

    // Desired width (clamped)
    const viewportW = window.innerWidth;
    const sidePadding = 16; // 16px margin from viewport edges
    const desired = Math.min(560, Math.max(320, viewportW - sidePadding * 2));
    const left = Math.min(
      Math.max(rect.left, sidePadding),
      viewportW - desired - sidePadding
    );

    // Available space above/below
    const gap = 8; // space between header and panel
    const below = window.innerHeight - rect.bottom - gap - sidePadding;
    const above = rect.top - gap - sidePadding;

    // Choose direction
    const openUp = below < Math.min(360, window.innerHeight * 0.4) && above > below;

    // Max height for panel (leave sidePadding margin from viewport bounds)
    const maxHeight = Math.max(
      200,
      Math.min(openUp ? above : below, Math.floor(window.innerHeight * 0.75))
    );

    const top = openUp ? rect.top - gap : rect.bottom + gap;

    setPanelStyle({
      top,
      left,
      width: desired,
      maxHeight,
      openUp,
    });
  }, []);

  // Recompute layout when opening, resizing, or scrolling
  useEffect(() => {
    if (!open) return;

    computePanelLayout();

    const onResize = () => computePanelLayout();
    const onScroll = () => computePanelLayout();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true); // capture scroll from parents

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, computePanelLayout]);

  // Close dropdown on outside click / ESC
  useEffect(() => {
    function onDocClick(e) {
      if (!open) return;
      const panel = panelRef.current;
      const header = headerRef.current;
      if (panel && panel.contains(e.target)) return;
      if (header && header.contains(e.target)) return;
      setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const items = useMemo(() => rows || [], [rows]);

  return (
    <div className="relative">
      {/* Header bar with dropdown trigger */}
      <div
        ref={headerRef}
        className="flex items-center justify-between rounded-2xl border border-yellow-500/40 bg-yellow-500/5 p-3"
      >
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-300" />
          <h3 className="font-semibold">Best-Fit Drivers</h3>
          <span className="text-xs opacity-70">({items.length} shown)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRanked}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/60 px-3 py-1.5 hover:bg-zinc-800/60"
            title="Refresh"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/60 px-3 py-1.5 hover:bg-zinc-800/60"
            aria-expanded={open}
            aria-haspopup="menu"
            title="Open best-fit list"
          >
            View
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Dropdown panel — use fixed positioning so it respects the viewport */}
      {open && (
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: "fixed",
            top: panelStyle.openUp ? undefined : panelStyle.top,
            bottom: panelStyle.openUp ? window.innerHeight - panelStyle.top : undefined,
            left: panelStyle.left,
            width: panelStyle.width,
            maxHeight: panelStyle.maxHeight,
          }}
          className="z-50 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/95 shadow-xl backdrop-blur"
        >
          {/* Scrollable interior */}
          <div className="p-3 overflow-auto" style={{ maxHeight: panelStyle.maxHeight }}>
            {/* States */}
            {err ? (
              <div className="flex items-center gap-2 text-rose-300 text-sm mb-2">{err}</div>
            ) : null}

            {busy && items.length === 0 ? (
              <div className="flex items-center gap-2 text-zinc-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading ranked drivers…
              </div>
            ) : null}

            {!busy && !err && items.length === 0 ? (
              <div className="text-sm text-zinc-400">No candidates yet. Add feedback or drivers to see rankings.</div>
            ) : null}

            {/* List */}
            <ul className="space-y-3">
              {items.map((d, idx) => {
                const finalPercent = Math.round(Number(d.final_score ?? 0) * 100);
                const fitPercent = Math.round(Number(d.fit_score ?? 0));
                const ups = Number(d.up_events ?? 0);
                const downs = Number(d.down_events ?? 0);
                const last = d.last_feedback_at;
                const bar = Math.max(0, Math.min(100, finalPercent));

                return (
                  <li key={d.driver_id ?? idx} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                    {/* Row 1: Name + score chip */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <UserRound className="w-4 h-4 text-zinc-300" />
                        <div className="font-medium">{d.full_name || "—"}</div>
                        {d.status ? (
                          <span className="text-2xs ml-2 rounded-md border border-zinc-700/60 px-1.5 py-0.5">
                            {d.status}
                          </span>
                        ) : null}
                      </div>

                      <div
                        className={`rounded-lg px-2 py-0.5 text-2xs font-semibold ${
                          bar >= 80
                            ? "bg-emerald-600/20 text-emerald-300 border border-emerald-600/40"
                            : bar >= 60
                            ? "bg-amber-600/20 text-amber-300 border border-amber-600/40"
                            : "bg-zinc-700/30 text-zinc-200 border border-zinc-600/40"
                        }`}
                        title="Overall ranking (final score)"
                      >
                        {finalPercent}% match
                      </div>
                    </div>

                    {/* Row 2: Bar + facts */}
                    <div className="mt-2">
                      <div className="h-2 w-full rounded-md bg-zinc-800 overflow-hidden">
                        <div className="h-2 bg-emerald-500" style={{ width: `${bar}%` }} aria-hidden="true" />
                      </div>

                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-zinc-300">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Fit: {fitPercent}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>{ups}</span>
                          <span className="opacity-60">up</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>{downs}</span>
                          <span className="opacity-60">down</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Last: {fmtDate(last)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Row 3: Assign */}
                    {canAssign ? (
                      <div className="mt-3">
                        <button
                          onClick={() => onAssign(d)}
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-1.5 hover:bg-emerald-500"
                        >
                          Assign
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
