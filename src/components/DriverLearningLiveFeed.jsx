// src/components/DriverLearningLiveFeed.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * DriverLearningLiveFeed
 * Live, realtime activity stream for driver learning events.
 *
 * Modes:
 *  - Per-driver (default): pass driverId
 *  - All-drivers: set allDrivers={true} (driverId not required)
 *
 * Subscribes to:
 *  - ai_feedback (INSERT)               â† Loads page writes here
 *  - ai_driver_recent_feedback (INSERT) â† optional/dev helper
 *  - ai_driver_pref_snapshot (UPDATE)   â† per-driver only
 *  - ai_driver_learning_stats (UPDATE)  â† per-driver only
 *
 * Hydration sources (history, not realtime):
 *  - v_dispatch_feedback_enriched (if present)
 *  - ai_feedback
 *  - ai_driver_recent_feedback
 *
 * Ensure these TABLES are in publication `supabase_realtime`:
 *   alter publication supabase_realtime add table public.ai_feedback;
 *   -- snapshots/stats are tables in your schema; if they are views, skip them
 */
const BASE_FEEDBACK_TABLE = "ai_feedback";

export default function DriverLearningLiveFeed({
  driverId,
  limit = 25,
  allDrivers = false,        // ðŸ‘ˆ NEW: set true to stream across ALL drivers
  showDriverName = true,     // shows driver name/short id on each event (useful in allDrivers mode)
}) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [driverMap, setDriverMap] = useState({});
  const mounted = useRef(false);

  const perDriver = !allDrivers && !!driverId;
  const channelName = useMemo(
    () => (allDrivers ? "driver_learn_all" : perDriver ? `driver_learn_${driverId}` : null),
    [allDrivers, perDriver, driverId]
  );

  // Build a local driver map (for names in allDrivers mode, harmless otherwise)
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("drivers")
          .select("id, first_name, last_name");
        if (error || !on) return;
        const map = Object.fromEntries((data || []).map((d) => [d.id, d]));
        setDriverMap(map);
      } catch {}
    })();
    return () => { on = false; };
  }, []);

  // Helpers
  const pushEvent = (e) =>
    setEvents((prev) => {
      const next = [e, ...prev];
      if (next.length > 300) next.pop();
      return next;
    });

  const nameFor = (id) => {
    if (!showDriverName) return null;
    const d = driverMap?.[id];
    if (!d) return compactUuid(id);
    const n = [d.last_name, d.first_name].filter(Boolean).join(", ");
    return n || compactUuid(id);
  };

  const normalizeFeedbackRow = (row) => {
    // Supports ai_feedback and ai_driver_recent_feedback shapes
    const dir =
      row.direction ??
      (row.accepted === true ? "up" : row.accepted === false ? "down" : undefined);

    return {
      kind: "feedback",
      at: row.created_at || row.inserted_at || row.updated_at || new Date().toISOString(),
      title: dir === "up" ? "ðŸ‘ Thumbs Up" : dir === "down" ? "ðŸ‘Ž Thumbs Down" : "ðŸ“ Feedback",
      payload: { ...row, direction: dir },
    };
  };

  const normalizeSnapshotRow = (row) => ({
    kind: "snapshot",
    at: row.updated_at || row.created_at || new Date().toISOString(),
    title: "ðŸ§­ Snapshot updated",
    payload: row,
  });

  const normalizeStatsRow = (row) => ({
    kind: "stats",
    at: row.updated_at || row.created_at || new Date().toISOString(),
    title: "ðŸ“ˆ Stats updated",
    payload: row,
  });

  // Initial history load
  useEffect(() => {
    if (mounted.current) return;
    if (!allDrivers && !driverId) return; // need a target unless global mode
    mounted.current = true;

    (async () => {
      try {
        const history = [];

        // View first (if present)
        try {
          const q = supabase
            .from("v_dispatch_feedback_enriched")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
          const { data: vw } = perDriver ? await q.eq("driver_id", driverId) : await q;
          (vw || []).forEach((row) =>
            history.push(
              normalizeFeedbackRow({
                ...row,
                note: row.note,
                load_id: row.load_id,
                driver_id: row.driver_id,
                created_at: row.created_at,
                accepted: row.accepted,
              })
            )
          );
        } catch {
          /* view may not exist â€” ignore */
        }

        // Base table: ai_feedback
        try {
          const q = supabase
            .from(BASE_FEEDBACK_TABLE)
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
          const { data: fb1 } = perDriver ? await q.eq("driver_id", driverId) : await q;
          (fb1 || []).forEach((row) => history.push(normalizeFeedbackRow(row)));
        } catch {}

        // Helper table: ai_driver_recent_feedback
        try {
          const q = supabase
            .from("ai_driver_recent_feedback")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
          const { data: fb2 } = perDriver ? await q.eq("driver_id", driverId) : await q;
          (fb2 || []).forEach((row) => history.push(normalizeFeedbackRow(row)));
        } catch {}

        // Snapshots + stats (only make sense per-driver)
        if (perDriver) {
          try {
            const { data: snap } = await supabase
              .from("ai_driver_pref_snapshot")
              .select("*")
              .eq("driver_id", driverId)
              .order("updated_at", { ascending: false })
              .limit(5);
            (snap || []).forEach((row) => history.push(normalizeSnapshotRow(row)));
          } catch {}
          try {
            const { data: stats } = await supabase
              .from("ai_driver_learning_stats")
              .select("*")
              .eq("driver_id", driverId)
              .order("updated_at", { ascending: false })
              .limit(5);
            (stats || []).forEach((row) => history.push(normalizeStatsRow(row)));
          } catch {}
        }

        history.sort((a, b) => new Date(b.at) - new Date(a.at));
        setEvents(history.slice(0, limit));
      } catch (e) {
        console.error("LiveFeed initial load failed:", e);
      }
    })();
  }, [allDrivers, perDriver, driverId, limit]);

  // Realtime subscriptions
  useEffect(() => {
    if (!channelName) return;

    const channel = supabase
      .channel(channelName, {
        config: { broadcast: { ack: false }, presence: { key: perDriver ? driverId : "all" } },
      })

      // INSERTs from ai_feedback (Loads page)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: BASE_FEEDBACK_TABLE,
        },
        (payload) => {
          // CRITICAL: Client-side filter to prevent cross-driver bleed
          if (!payload?.new) return;
          if (perDriver && payload.new.driver_id !== driverId) {
            console.log(`[LiveFeed] Ignoring INSERT for different driver: ${payload.new.driver_id} (expected: ${driverId})`);
            return;
          }
          pushEvent(normalizeFeedbackRow(payload.new));
        }
      )

      // INSERTs from ai_driver_recent_feedback (Dev/Test helpers)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ai_driver_recent_feedback",
        },
        (payload) => {
          // CRITICAL: Client-side filter
          if (!payload?.new) return;
          if (perDriver && payload.new.driver_id !== driverId) return;
          pushEvent(normalizeFeedbackRow(payload.new));
        }
      )

      // Snapshot + Stats updates are only meaningful per-driver
      .on(
        "postgres_changes",
        perDriver
          ? {
              event: "UPDATE",
              schema: "public",
              table: "ai_driver_pref_snapshot",
              filter: `driver_id=eq.${driverId}`,
            }
          : null,
        (payload) => {
          if (!payload?.new) return;
          if (payload.new.driver_id !== driverId) return;
          pushEvent(normalizeSnapshotRow(payload.new));
        }
      )
      .on(
        "postgres_changes",
        perDriver
          ? {
              event: "UPDATE",
              schema: "public",
              table: "ai_driver_learning_stats",
              filter: `driver_id=eq.${driverId}`,
            }
          : null,
        (payload) => {
          if (!payload?.new) return;
          if (payload.new.driver_id !== driverId) return;
          pushEvent(normalizeStatsRow(payload.new));
        }
      )

      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, perDriver, driverId]);

  // Header title + guard
  const title = allDrivers ? "Live Activity â€” All Drivers" : "Live Activity";

  if (!allDrivers && !driverId) {
    return (
      <div className="rounded-xl border border-zinc-700/60 p-4">
        <div className="text-sm text-zinc-400">Select a driver to view live activity.</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-zinc-900/40">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700/60">
        <div className="font-medium">{title}</div>
        <div
          className={connected ? "text-emerald-400 text-xs" : "text-zinc-400 text-xs"}
          title={connected ? "Realtime connected" : "Connecting..."}
        >
          {connected ? "â— live" : "â—‹ connecting"}
        </div>
      </div>

      <ul className="max-h-[420px] overflow-auto divide-y divide-zinc-800">
        {events.length === 0 ? (
          <li className="px-4 py-4 text-sm text-zinc-400">
            No activity yet. Try recording ðŸ‘/ðŸ‘Ž or updating a preference.
          </li>
        ) : (
          events.map((e, idx) => (
            <li key={idx} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="mr-2">{e.title}</span>
                  <span className="text-xs text-zinc-400">{new Date(e.at).toLocaleString()}</span>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">{e.kind}</span>
              </div>

              {e.kind === "feedback" && (
                <p className="mt-1 text-sm text-zinc-300">
                  {allDrivers && e?.payload?.driver_id ? (
                    <span className="font-medium">
                      {nameFor(e.payload.driver_id)}
                      <span className="text-zinc-400"> â€¢ </span>
                    </span>
                  ) : null}
                  {e.payload?.note || e.payload?.notes || "Feedback recorded"}
                  {e.payload?.load_id ? (
                    <span className="text-zinc-400"> â€¢ load {compactUuid(e.payload.load_id)}</span>
                  ) : null}
                </p>
              )}
              {e.kind === "snapshot" && (
                <p className="mt-1 text-sm text-zinc-300">Prefs: {summarizeSnapshot(e.payload)}</p>
              )}
              {e.kind === "stats" && (
                <p className="mt-1 text-sm text-zinc-300">Stats: {summarizeStats(e.payload)}</p>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ----- helpers -----
function summarizeSnapshot(row) {
  if (!row) return "â€”";
  const bits = [];
  if (row.home_base) bits.push(`Home ${row.home_base}`);
  if (row.regions?.length) bits.push(`Regions ${row.regions.join(", ")}`);
  if (row.equipment?.length) bits.push(`Equip ${row.equipment.join(", ")}`);
  if (row.avoid_states?.length) bits.push(`Avoid ${row.avoid_states.join(", ")}`);
  if (row.max_distance) bits.push(`${row.max_distance} mi max`);
  return bits.join(" â€¢ ") || "updated";
}

function summarizeStats(row) {
  if (!row) return "â€”";
  const up = row.thumbs_up ?? row.up_count ?? 0;
  const down = row.thumbs_down ?? row.down_count ?? 0;
  const acc = row.acceptance_rate ?? row.accept_rate ?? 0;
  return `ðŸ‘ ${up} â€¢ ðŸ‘Ž ${down} â€¢ ${acc}% acceptance`;
}

function compactUuid(id) {
  if (!id || typeof id !== "string") return id ?? "â€”";
  return id.length > 8 ? `${id.slice(0, 8)}â€¦` : id;
}
