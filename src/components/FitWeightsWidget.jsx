// src/components/FitWeightsWidget.jsx
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Brain } from "lucide-react";
import { getFitWeights, runLearner } from "../lib/weights";

function cx(...a){return a.filter(Boolean).join(" ");}

export default function FitWeightsWidget() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try { setRows(await getFitWeights()); }
    catch (e) { setError(e.message || String(e)); }
  }

  useEffect(() => { load(); }, []);

  async function learn() {
    setBusy(true);
    try { await runLearner(); await load(); }
    catch (e) { alert(e.message || "Learner failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-white/10 p-3 bg-white/5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Fit Weights</div>
            <div className="text-xs text-white/60">live, self-tuning</div>
          </div>
        </div>
        <button
          onClick={learn}
          disabled={busy}
          className={cx("inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-1.5 text-xs",
                        "bg-white/5 hover:bg-white/10")}
          title="Run learner now"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Learn
        </button>
      </div>

      {error && <div className="text-xs text-red-300 mb-2">{error}</div>}

      {!rows ? (
        <div className="text-xs text-white/60 inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loadingâ€¦
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rows.map(r => (
            <div key={r.name} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
              <div className="text-xs text-white/70">{r.name}</div>
              <div className="text-xs font-mono">{Number(r.value).toFixed(1)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

