// src/components/DriverThumbsBar.jsx
import React, { useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { recordThumb } from "../lib/driverPreferences.js";
import { getStableClickKey } from "../lib/thumbKeyBus.js";

export default function DriverThumbsBar({ driverId, onChange }) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  async function handle(rate, e) {
    e?.stopPropagation?.();
    if (busy) return;
    setBusy(true);
    setOk(""); setErr("");

    try {
      const clickKey = getStableClickKey(rate);
      await recordThumb(driverId, rate, clickKey); // writes exactly one row
      setOk(rate === "up" ? "Up recorded" : "Down recorded");

      // ⬇️ IMPORTANT: do NOT do any local "+1" here.
      // If you want the badge to refresh immediately:
      onChange && onChange(); // parent can call badge.reload() once
    } catch (e2) {
      setErr(e2?.message || "Failed to record feedback");
      console.error(e2);
    } finally {
      setBusy(false);
      setTimeout(() => { setOk(""); setErr(""); }, 1200);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={(e)=>handle("up",e)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700/60 px-3 py-2 hover:bg-zinc-800/60 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
        <span className="text-xs sm:text-sm">Up</span>
      </button>
      <button type="button" onClick={(e)=>handle("down",e)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700/60 px-3 py-2 hover:bg-zinc-800/60 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
        <span className="text-xs sm:text-sm">Down</span>
      </button>

      {ok && <span className="ml-2 inline-flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="w-4 h-4" />{ok}</span>}
      {err && <span className="ml-2 inline-flex items-center gap-1 text-rose-400 text-xs"><AlertCircle className="w-4 h-4" />{err}</span>}
    </div>
  );
}
