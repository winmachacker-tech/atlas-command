import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { AlertTriangle, Loader2, Search } from "lucide-react";

export default function InTransitPage() {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetchInTransit();
  }, []);

  async function fetchInTransit() {
    setLoading(true);
    setErrorMsg("");
    const { data, error } = await supabase
      .from("v_in_transit")
      .select("*")
      .order("eta", { ascending: true })
      .limit(1000);

    if (error) setErrorMsg(error.message);
    else setLoads(data || []);
    setLoading(false);
  }

  const filtered = q
    ? loads.filter((r) => {
        const hay =
          `${r.reference} ${r.customer} ${r.broker} ${r.origin_city} ${r.origin_state} ${r.dest_city} ${r.dest_state}`
            .toLowerCase()
            .trim();
        return hay.includes(q.toLowerCase().trim());
      })
    : loads;

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <Loader2 className="animate-spin" />
        <span>Loading in-transit loads…</span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="p-6 text-red-600 dark:text-red-400 flex items-center gap-2">
        <AlertTriangle />
        <span>{errorMsg}</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference, customer, broker, city/state…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
          />
        </div>
        <button
          onClick={fetchInTransit}
          className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-2 pr-4">Reference</th>
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Broker</th>
              <th className="py-2 pr-4">Driver</th>
              <th className="py-2 pr-4">Truck</th>
              <th className="py-2 pr-4">Origin</th>
              <th className="py-2 pr-4">Destination</th>
              <th className="py-2 pr-4">ETA</th>
              <th className="py-2 pr-4">Problem</th>
              <th className="py-2 pr-4">At Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                className="border-b border-neutral-100 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
              >
                <td className="py-2 pr-4 font-medium">{r.reference}</td>
                <td className="py-2 pr-4">{r.customer}</td>
                <td className="py-2 pr-4">{r.broker}</td>
                <td className="py-2 pr-4">{r.driver_name || "-"}</td>
                <td className="py-2 pr-4">{r.truck_number || "-"}</td>
                <td className="py-2 pr-4">
                  {r.origin_city}, {r.origin_state}
                </td>
                <td className="py-2 pr-4">
                  {r.dest_city}, {r.dest_state}
                </td>
                <td className="py-2 pr-4">
                  {r.eta ? new Date(r.eta).toLocaleString() : "-"}
                </td>
                <td className="py-2 pr-4">
                  {r.problem_flag ? "Yes" : "No"}
                </td>
                <td className="py-2 pr-4">{r.at_risk ? "Yes" : "No"}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td className="py-6 text-center text-neutral-500" colSpan={10}>
                  No in-transit loads found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
