// src/pages/InTransit.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, Search } from "lucide-react";

/* ------------------------------ safe helpers ------------------------------ */
const S = (v) => (v == null ? "" : String(v));
const T = (v) => S(v).trim();

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function InTransit() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [q, setQ] = useState(""); // search box (can be null -> normalized)

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const { data, error } = await supabase
          .from("loads")
          .select(
            "id, reference, shipper_name, consignee_name, status, pickup_at, delivery_at, driver_name"
          )
          .eq("deleted", false)
          .eq("status", "In Transit")
          .order("pickup_at", { ascending: true })
          .limit(500);
        if (error) throw error;
        if (!alive) return;
        setRows(data || []);
      } catch (e) {
        if (!alive) return;
        console.error(e);
        setErr(e.message || "Failed to load In Transit loads.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = T(q).toLowerCase(); // ✅ safe trim
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay =
        [
          r?.reference,
          r?.shipper_name,
          r?.consignee_name,
          r?.driver_name,
          r?.status,
        ]
          .map((x) => S(x).toLowerCase())
          .join(" ");
      return hay.includes(needle);
    });
  }, [rows, q]);

  return (
    <div className="p-6 md:p-8 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">In Transit</h1>
        <p className="text-sm text-zinc-500">
          Active loads currently moving to destination.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-2.5 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(S(e.target?.value))}
              placeholder="Search by reference, shipper, consignee, driver…"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-2 pr-3">Reference</th>
                <th className="py-2 pr-3">Shipper</th>
                <th className="py-2 pr-3">Consignee</th>
                <th className="py-2 pr-3">Driver</th>
                <th className="py-2 pr-3">Pickup</th>
                <th className="py-2 pr-3">Delivery</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center">
                    <Loader2 className="size-5 animate-spin inline-block mr-2" />
                    Loading…
                  </td>
                </tr>
              ) : err ? (
                <tr>
                  <td colSpan={7} className="py-4 text-red-600">
                    {err}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-zinc-500">
                    No loads found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-2 pr-3">{S(r.reference) || "—"}</td>
                    <td className="py-2 pr-3">{S(r.shipper_name) || "—"}</td>
                    <td className="py-2 pr-3">{S(r.consignee_name) || "—"}</td>
                    <td className="py-2 pr-3">{S(r.driver_name) || "—"}</td>
                    <td className="py-2 pr-3">
                      {r.pickup_at ? new Date(r.pickup_at).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {r.delivery_at
                        ? new Date(r.delivery_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">{S(r.status) || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
