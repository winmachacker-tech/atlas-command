// FILE: src/components/AIThumbs.jsx
// Purpose: Thumbs Up/Down that TRAIN the AI by inserting rows into
//          public.ai_training_examples (driver_id, lane_key, label)
//          AND log human feedback into public.driver_feedback.
// Usage example:
//   <AIThumbs
//      driverId={driver.id}
//      laneKey={laneKey}
//      loadId={load.id}            // optional, but recommended when you know the load
//      onAfterChange={refetch}
//   />

import React, { useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ThumbsUp, ThumbsDown, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export default function AIThumbs({
  driverId,
  laneKey,
  loadId = null,        // NEW: optional, to tie feedback to a specific load
  size = "md",          // "sm" | "md" | "lg"
  className = "",
  onAfterChange,        // optional: () => void
}) {
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const lastClickRef = useRef(0);

  const sizes = {
    sm: "h-7 px-2 text-xs gap-1",
    md: "h-8 px-3 text-sm gap-1.5",
    lg: "h-10 px-4 text-base gap-2",
  };
  const iconSizes = { sm: 14, md: 16, lg: 18 };

  function throttle(ms = 600) {
    const now = Date.now();
    if (now - lastClickRef.current < ms) return true;
    lastClickRef.current = now;
    return false;
  }

  async function handle(kind) {
    if (!driverId || !laneKey) {
      setErrMsg("Missing driver or lane");
      return;
    }
    if (throttle(600)) return;

    setBusy(true);
    setOkMsg("");
    setErrMsg("");

    // For ai_training_examples (integer label) and driver_feedback (boolean)
    const labelInt = kind === "up" ? 1 : -1;
    const labelBool = kind === "up";

    try {
      // 1) TRAINING EXAMPLE (existing behavior, unchanged semantics)
      const { error: trainErr } = await supabase.from("ai_training_examples").insert([
        {
          driver_id: driverId,
          lane_key: laneKey,
          label: labelInt,
          source: "thumb",
        },
      ]);

      // Treat duplicate-within-1s as success (guarded by unique index)
      if (trainErr) {
        const code = trainErr.code || "";
        const msg = (trainErr.message || "").toLowerCase();
        const dup =
          code === "23505" ||
          msg.includes("duplicate key value") ||
          msg.includes("uniq_ai_examples_guard");
        if (!dup) throw trainErr;
      }

      // 2) DRIVER FEEDBACK (NEW) — keeps org_id / created_by via DB defaults
      const feedbackPayload = {
        driver_id: driverId,
        load_id: loadId ?? null,   // stays null if you don't pass loadId
        lane_key: laneKey ?? null,
        vote: labelBool,
        label: labelBool,
        source: "human",
      };

      const { error: fbErr } = await supabase
        .from("driver_feedback")
        .insert([feedbackPayload]);

      if (fbErr) {
        throw fbErr;
      }

      setOkMsg(kind === "up" ? "Up recorded" : "Down recorded");
      if (typeof onAfterChange === "function") onAfterChange();
      setTimeout(() => setOkMsg(""), 1200);
    } catch (e) {
      console.error("AIThumbs feedback failed:", e);
      setErrMsg(e?.message || "Failed to record feedback");
      setTimeout(() => setErrMsg(""), 1800);
    } finally {
      setBusy(false);
    }
  }

  const btnBase =
    "inline-flex items-center rounded-xl border transition focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-60 disabled:cursor-not-allowed";
  const upBtn =
    "bg-emerald-600/15 border-emerald-600/30 hover:bg-emerald-600/25 text-emerald-200";
  const downBtn =
    "bg-rose-600/15 border-rose-600/30 hover:bg-rose-600/25 text-rose-200";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        className={`${btnBase} ${upBtn} ${sizes[size]}`}
        onClick={() => handle("up")}
        disabled={busy}
        title="Thumbs up (good fit)"
      >
        {busy ? (
          <Loader2 size={iconSizes[size]} className="animate-spin" />
        ) : (
          <ThumbsUp size={iconSizes[size]} />
        )}
        <span>Up</span>
      </button>

      <button
        type="button"
        className={`${btnBase} ${downBtn} ${sizes[size]}`}
        onClick={() => handle("down")}
        disabled={busy}
        title="Thumbs down (poor fit)"
      >
        {busy ? (
          <Loader2 size={iconSizes[size]} className="animate-spin" />
        ) : (
          <ThumbsDown size={iconSizes[size]} />
        )}
        <span>Down</span>
      </button>

      {okMsg && (
        <span className="ml-1 inline-flex items-center gap-1 text-emerald-300 text-xs">
          <CheckCircle2 className="w-4 h-4" />
          {okMsg}
        </span>
      )}
      {errMsg && (
        <span className="ml-1 inline-flex items-center gap-1 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4" />
          {errMsg}
        </span>
      )}
    </div>
  );
}
