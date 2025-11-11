// src/components/DriverFitBadge.jsx
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";

// Fetch total labeled events using COUNT header
async function fetchLabeledCount() {
  const { count, error } = await supabase
    .from("driver_feedback")
    .select("*", { head: true, count: "exact" });
  if (error) throw error;
  return count ?? 0;
}

export default function DriverFitBadge({ total = 450 }) {
  const [labeled, setLabeled] = useState(0);
  const fetching = useRef(false);

  const reload = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const n = await fetchLabeledCount();
      setLabeled(n);
    } finally {
      fetching.current = false;
    }
  }, []);

  // Initial load
  useEffect(() => {
    reload();
  }, [reload]);

  // Refresh once per feedback via a global event (no realtime listener)
  useEffect(() => {
    const onBump = () => reload();
    window.addEventListener("ac-driver-feedback", onBump);
    return () => window.removeEventListener("ac-driver-feedback", onBump);
  }, [reload]);

  return (
    <span className="text-xs sm:text-sm">
      AI learning: {labeled}/{total} labeled
    </span>
  );
}
