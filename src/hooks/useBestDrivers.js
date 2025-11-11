// FILE: src/hooks/useBestDrivers.js
// Purpose: Get ranked drivers for a lane via RPC and auto-refresh on thumbs.
// Usage:
//   const { data, loading, error, refetch } = useBestDrivers(laneKey, { limit: 5 });
//
// Notes:
// - Listens to Realtime changes on public.ai_training_examples for that lane.
// - Any thumbs up/down for the lane triggers a safe, throttled refetch.
// - Returns: [{ driver_id, score, up_events, down_events, last_positive_at }, ...].

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useBestDrivers(laneKey, opts = {}) {
  const limit = Math.max(1, Number(opts.limit || 5));

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(laneKey));
  const [error, setError] = useState(null);

  // Throttle guard to avoid spamming refetches on bursty realtime events.
  const lastFetchRef = useRef(0);
  const fetchInFlightRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!laneKey) return;
    const now = Date.now();
    if (now - lastFetchRef.current < 250) return; // 250ms debounce
    if (fetchInFlightRef.current) return;

    fetchInFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { data: rows, error: err } = await supabase.rpc(
        "rpc_ai_best_drivers_for_lane",
        { lane_key: laneKey, limit }
      );
      if (err) throw err;
      setData(Array.isArray(rows) ? rows : []);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("useBestDrivers refetch error:", e);
      setError(e);
    } finally {
      lastFetchRef.current = Date.now();
      fetchInFlightRef.current = false;
      setLoading(false);
    }
  }, [laneKey, limit]);

  // Initial fetch when laneKey or limit changes.
  useEffect(() => {
    if (!laneKey) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }
    refetch();
  }, [laneKey, limit, refetch]);

  // Realtime subscription for thumbs on this lane.
  useEffect(() => {
    if (!laneKey) return;

    // Unique-ish channel name per lane; keep it short/safe.
    const safeKey = String(laneKey).slice(0, 120);
    const channel = supabase.channel(`ai-best:${safeKey}`);

    const handler = () => {
      // Any INSERT/UPDATE/DELETE on examples for this lane → refetch (throttled)
      refetch();
    };

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ai_training_examples",
          filter: `lane_key=eq.${safeKey}`,
        },
        handler
      )
      .subscribe((status) => {
        // Optional: you could log status === "SUBSCRIBED"
        // console.log("useBestDrivers realtime:", status);
      });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* no-op */
      }
    };
  }, [laneKey, refetch]);

  return { data, loading, error, refetch };
}
