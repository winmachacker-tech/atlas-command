// FILE: src/components/DriverThumbsBar.jsx
// Purpose:
// Thin wrapper around AIThumbs so ALL thumbs:
//   - Train the AI via ai_training_examples
//   - Log human feedback via driver_feedback
//   - Optionally tie feedback to a lane_key and/or load_id
//
// Usage examples:
//
// 1) Generic driver-level feedback (current behavior):
//    <DriverThumbsBar driverId={driver.id} onChange={refetch} />
//
// 2) Lane-level + load-level feedback (for AI audit alignment):
//    <DriverThumbsBar
//       driverId={driver.id}
//       laneKey={laneKey}           // e.g. "LANE Mesa, AZ → Tulsa, OK"
//       loadId={load.id}            // UUID of the load
//       onChange={refetch}
//    />
//
// SECURITY:
// - This component does not touch RLS, auth, or service keys.
// - All inserts (ai_training_examples, driver_feedback) go through AIThumbs,
//   which uses the normal Supabase client and respects existing policies.

import React from "react";
import AIThumbs from "./AIThumbs";

export default function DriverThumbsBar({
  driverId,
  laneKey = null,
  loadId = null,
  size = "md",       // "sm" | "md" | "lg" — forwarded to AIThumbs
  className = "",
  onChange,          // called after a successful thumb
}) {
  // If we somehow don't have a driver, don't render anything.
  if (!driverId) return null;

  return (
    <AIThumbs
      driverId={driverId}
      laneKey={laneKey}
      loadId={loadId}
      size={size}
      className={className}
      onAfterChange={onChange}
    />
  );
}
