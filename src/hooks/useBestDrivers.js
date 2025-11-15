// FILE: src/hooks/useBestDrivers.js
// Purpose: Fetch best drivers for a given lane from rpc_ai_best_drivers_for_lane
// - Uses the correct signature: (lane_key, limit_count)
// - Returns { data, loading, error, refetch } for the UI to consume.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useBestDrivers(laneKey, options = {}) {
  const limit = options.limit ?? 10;

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(
    async (overrideLaneKey) => {
      const lk = overrideLaneKey ?? laneKey;

      // No lane = nothing to fetch
      if (!lk) {
        setData([]);
        setError(null);
        return;
      }

      setLoading(true);
      try {
        const { data: rows, error: err } = await supabase.rpc(
          "rpc_ai_best_drivers_for_lane",
          {
            lane_key: lk,
            // IMPORTANT: must match the SQL function argument name
            limit_count: limit,
          }
        );

        if (err) {
          console.error("useBestDrivers refetch error:", err);
          setError(err);
          setData([]);
        } else {
          setError(null);
          setData(Array.isArray(rows) ? rows : []);
        }
      } catch (e) {
        console.error("useBestDrivers unexpected error:", e);
        setError(e);
        setData([]);
      } finally {
        setLoading(false);
      }
    },
    [laneKey, limit]
  );

  // Auto-fetch when laneKey changes
  useEffect(() => {
    if (!laneKey) {
      setData([]);
      setError(null);
      return;
    }
    refetch(laneKey);
  }, [laneKey, refetch]);

  return {
    data,
    loading,
    error,
    refetch,
  };
}
