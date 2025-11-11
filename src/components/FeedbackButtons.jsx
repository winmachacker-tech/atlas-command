// src/components/FeedbackButtons.jsx
import { useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { sendDispatchFeedback } from "../lib/feedback";
import { supabase } from "../lib/supabase";

function cx(...a) { return a.filter(Boolean).join(" "); }

/**
 * Drop-in thumbs up/down for dispatch decisions.
 * Props:
 *  - loadId (uuid)
 *  - driverId (uuid)
 *  - fit: { score, verdict }   // optional, pass what you already have
 *  - humanOverride (bool)      // optional, default false
 *  - size: "sm" | "md"         // optional
 *  - onLogged?: (row) => void  // optional
 */
export default function FeedbackButtons({
  loadId,
  driverId,
  fit,
  humanOverride = false,
  size = "sm",
  onLogged,
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // "up" | "down" | null
  const sz = size === "md" ? "h-8 w-8" : "h-7 w-7";

  async function act(accepted) {
    if (busy) return;
    setBusy(true);
    try {
      const row = await sendDispatchFeedback(supabase, {
        loadId,
        driverId,
        fitScore: fit?.score ?? null,
        verdict:  fit?.verdict ?? null,
        accepted,
        humanOverride,
      });
      setDone(accepted ? "up" : "down");
      onLogged?.(row);
    } catch (e) {
      console.error("[FeedbackButtons] insert error:", e);
      alert(e?.message || "Could not save feedback.");
    } finally {
      setBusy(false);
    }
  }

  const baseBtn =
    "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 hover:bg-white/10 transition";

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        title="This was a good match"
        className={cx(baseBtn, sz, done === "up" ? "ring-2 ring-emerald-400" : "")}
        onClick={() => act(true)}
        disabled={busy}
      >
        {busy && done !== "down" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4 text-emerald-300" />}
      </button>
      <button
        type="button"
        title="This was not a good match"
        className={cx(baseBtn, sz, done === "down" ? "ring-2 ring-red-400" : "")}
        onClick={() => act(false)}
        disabled={busy}
      >
        {busy && done !== "up" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4 text-red-300" />}
      </button>
    </div>
  );
}

