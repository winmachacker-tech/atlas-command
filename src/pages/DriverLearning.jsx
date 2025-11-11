// src/pages/DriverLearning.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import DriverLearningPanel from "../components/DriverLearningPanel.jsx";
import { Loader2, UserRound } from "lucide-react";
import DriverLearningLiveFeed from "../components/DriverLearningLiveFeed.jsx";

function cx(...a){return a.filter(Boolean).join(" ");}

export default function DriverLearning() {
  const [drivers, setDrivers] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activeFlag = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("drivers")
          .select("id, first_name, last_name, status")
          .order("last_name", { ascending: true });
        if (error) throw error;
        if (!activeFlag) return;
        setDrivers(Array.isArray(data) ? data : []);
        setActive(data?.[0]?.id || null);
      } finally {
        if (activeFlag) setLoading(false);
      }
    })();
    return () => { activeFlag = false; };
  }, []);

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4">
        <h1 className="text-lg sm:text-xl font-semibold">Driver Learning</h1>
        <p className="text-xs sm:text-sm text-white/60">Thumbs history, evolving prefs, and acceptance trends.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <div className="rounded-2xl border border-white/10">
          <div className="bg-white/5 px-3 py-2 text-xs font-semibold">Drivers</div>
          <div className="max-h-[70vh] overflow-y-auto p-2">
            {loading ? (
              <div className="p-3 text-white/60 text-sm inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loadingâ€¦
              </div>
            ) : drivers.length === 0 ? (
              <div className="p-3 text-white/60 text-sm">No drivers.</div>
            ) : (
              drivers.map((d) => {
                const name = `${d.last_name || ""}${d.last_name && d.first_name ? ", " : ""}${d.first_name || ""}`;
                const activeRow = d.id === active;
                return (
                  <button
                    key={d.id}
                    onClick={() => setActive(d.id)}
                    className={cx(
                      "w-full text-left px-3 py-2 rounded-lg mb-1 flex items-center gap-2",
                      activeRow ? "bg-emerald-500/15 border border-emerald-500/30" : "hover:bg-white/5"
                    )}
                  >
                    <UserRound className="h-4 w-4 opacity-80" />
                    <span className="truncate">{name || "Driver"}</span>
                    <span className="ml-auto text-[10px] opacity-60">{d.status || ""}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Main panel + driver-specific live feed */}
        <div className="space-y-4">
          <DriverLearningPanel driverId={active} />
          {active && <DriverLearningLiveFeed driverId={active} />}
        </div>
      </div>

      {/* Global: most recent feedback across all drivers */}
      <GlobalRecent />
    </div>
  );
}

function GlobalRecent() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await supabase
        .from("v_dispatch_feedback_enriched")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (on) setRows(Array.isArray(data) ? data : []);
    })();
    return () => { on = false; };
  }, []);
  if (rows.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-white/10 overflow-hidden">
      <div className="bg-white/5 px-4 py-2 text-xs font-semibold">Recent Feedback (All Drivers)</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-white/5">
            <tr className="text-left">
              <Th>When</Th>
              <Th>Driver</Th>
              <Th>Result</Th>
              <Th>Load</Th>
              <Th>Lane</Th>
              <Th>Equip</Th>
              <Th>Miles</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-top border-white/10">
                <Td>{r.created_at ? new Date(r.created_at).toLocaleString() : "â€”"}</Td>
                <Td>{[r.driver_last_name, r.driver_first_name].filter(Boolean).join(", ") || "â€”"}</Td>
                <Td>{r.accepted ? "Up" : "Down"}</Td>
                <Td>{r.load_reference || "â€”"}</Td>
                <Td>{r.origin || "â€”"} â†’ {r.destination || "â€”"}</Td>
                <Td>{r.equipment_type || "â€”"}</Td>
                <Td>{r.miles ?? "â€”"}</Td>
                <Td className="max-w-[320px] truncate" title={r.note || ""}>{r.note || "â€”"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }) { return <th className="px-4 py-2 text-white/70">{children}</th>; }
function Td({ children }) { return <td className="px-4 py-2">{children}</td>; }
