// FILE: src/components/CustomerThumbsBar.jsx
// Purpose: Record thumbs (👍/👎) as training signals with conflict-safe UPSERT.
// - Writes BOTH `label` (boolean) for AI and legacy `vote` (boolean).
// - Uses a stable `click_key` to avoid duplicate key errors.
// - Auto-retries with column-based conflict target if needed.

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) { return a.filter(Boolean).join(" "); }

// Coerce driverId prop: can be uuid OR { id } OR { driver_id }
function normalizeDriverId(input) {
  if (!input) return null;
  if (typeof input === "string") return input;
  if (typeof input === "object") return input.id || input.driver_id || null;
  return null;
}

// Build a stable scope key so repeated clicks UPDATE rather than INSERT
function buildScopeKey({ laneKey, driverId, customerId, created_by }) {
  const safe = (v) => (v === null || v === undefined || v === "" ? "null" : String(v));
  return `${safe(laneKey)}::${safe(driverId)}::${safe(customerId)}::${safe(created_by)}`;
}

/**
 * Props:
 * - driverId: UUID string or object with { id } / { driver_id }
 * - customerId?: UUID
 * - laneKey: "City, ST → City, ST"
 * - onChange?: () => void
 */
export default function CustomerThumbsBar({ driverId, customerId = null, laneKey, onChange }) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  async function writeFeedback({ dId, isUp, created_by }) {
    const nowIso = new Date().toISOString();
    const click_key = buildScopeKey({ laneKey, driverId: dId, customerId, created_by });

    // Payload: both label (AI) and vote (legacy); update feedback_at on change
    const payload = {
      driver_id: dId,
      customer_id: customerId || null,
      lane_key: laneKey,
      label: isUp,                 // <- AI pipeline uses this
      vote: isUp,                  // <- legacy compatibility
      feedback_at: nowIso,
      created_by: created_by || null,
      click_key,                   // <- unique scope guard
      // Optional: keep an audit trail timestamp too
      created_at: nowIso,
    };

    // Attempt 1: conflict on click_key (recommended)
    let res = await supabase
      .from("driver_feedback")
      .upsert(payload, { onConflict: "click_key" });

    // If the table’s unique constraint is on columns (e.g. driver_id,lane_key,created_by), retry
    if (res.error) {
      const msg = String(res.error.message || "");
      const isDupKey = msg.includes("duplicate key value") || res.error.code === "23505";
      if (isDupKey || msg.includes("ux_driver_feedback_unique_vote_scope")) {
        // Attempt 2: conflict on likely column set
        res = await supabase
          .from("driver_feedback")
          .upsert(payload, { onConflict: "driver_id,lane_key,created_by" });
      }
    }

    if (res.error) throw res.error;
    return true;
  }

  async function handle(rate) {
    const dId = normalizeDriverId(driverId);
    setBusy(true);
    setOk("");
    setErr("");

    try {
      if (!dId) throw new Error("Missing driverId");
      if (!laneKey) throw new Error("Missing lane key");

      // Grab current user (for created_by scoping)
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const created_by = userData?.user?.id ?? null;

      const isUp = rate === "up";

      await writeFeedback({ dId, isUp, created_by });

      setOk(isUp ? "Thumbs up recorded" : "Thumbs down recorded");
      if (typeof onChange === "function") onChange();
    } catch (e) {
      console.error("CustomerThumbsBar error:", e);
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
      setTimeout(() => { setOk(""); setErr(""); }, 2500);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        disabled={busy}
        onClick={() => handle("up")}
        className={cx(
          "inline-flex items-center justify-center w-8 h-8 rounded-md border text-emerald-200",
          "border-emerald-600/40 hover:bg-emerald-600/10",
          busy && "opacity-60 cursor-not-allowed"
        )}
        title="Thumbs up"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
      </button>

      <button
        disabled={busy}
        onClick={() => handle("down")}
        className={cx(
          "inline-flex items-center justify-center w-8 h-8 rounded-md border text-rose-200",
          "border-rose-600/40 hover:bg-rose-600/10",
          busy && "opacity-60 cursor-not-allowed"
        )}
        title="Thumbs down"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
      </button>

      {ok && (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5" /> {ok}
        </span>
      )}
      {err && (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-rose-300">
          <AlertCircle className="w-3.5 h-3.5" /> {err}
        </span>
      )}
    </div>
  );
}
