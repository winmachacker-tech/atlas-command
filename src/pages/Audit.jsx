// FILE: src/pages/Audit.jsx
// Purpose: Simple audit summary page that calls rpc_ai_audit_summary()
// and lists AI run history (timestamps, model, thumbs, accuracy).

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { RefreshCw } from "lucide-react";

export default function Audit() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadAudit() {
    setLoading(true);
    setError("");
    const { data, error } = await supabase.rpc("rpc_ai_audit_summary", {}); // important: {}
    if (error) {
      console.error("Audit RPC error:", error);
      setError(error.message || "Failed to fetch audit data");
    } else {
      setData(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAudit();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">AI Audit Summary</h1>
        <button
          onClick={loadAudit}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
          {loading ? "Refreshing..." : "Run Audit"}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 text-red-800 px-3 py-2 rounded-md">{error}</div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full border border-zinc-700 text-sm">
          <thead className="bg-zinc-800 text-zinc-200">
            <tr>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Predictions</th>
              <th className="px-3 py-2 text-left">Feedback</th>
              <th className="px-3 py-2 text-left">👍</th>
              <th className="px-3 py-2 text-left">👎</th>
              <th className="px-3 py-2 text-left">Accuracy</th>
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-zinc-400">
                  No audit runs yet.
                </td>
              </tr>
            )}
            {data.map((r) => (
              <tr key={r.run_id} className="border-t border-zinc-700">
                <td className="px-3 py-2 text-zinc-300">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">{r.model_name}</td>
                <td className="px-3 py-2">{r.total_predictions}</td>
                <td className="px-3 py-2">{r.total_feedback}</td>
                <td className="px-3 py-2 text-emerald-500">{r.thumbs_up}</td>
                <td className="px-3 py-2 text-rose-500">{r.thumbs_down}</td>
                <td className="px-3 py-2">
                  {r.accuracy !== null ? `${r.accuracy}%` : "—"}
                </td>
                <td className="px-3 py-2">{r.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
