// src/pages/Dashboard.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Truck,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* ---------- constants ---------- */
const COLORS = {
  IN_TRANSIT: "#60a5fa",
  DELIVERED: "#34d399",
  PROBLEM: "#f87171",
};

/* ---------- helpers ---------- */
function aggregateStatus(loads = []) {
  const counts = { IN_TRANSIT: 0, DELIVERED: 0, PROBLEM: 0 };
  for (const l of loads) {
    if (l.status in counts) counts[l.status]++;
  }
  return Object.entries(counts).map(([status, value]) => ({
    status,
    value,
  }));
}

/* ---------- component ---------- */
export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusData, setStatusData] = useState([]);
  const [trendData, setTrendData] = useState([]);

  useEffect(() => {
    fetchDashboard();
  }, []);

  async function fetchDashboard() {
    setLoading(true);
    setError("");

    try {
      // 1️⃣ Active loads (fast view)
      const { data: loads, error: loadsErr } = await supabase
        .from("v_loads_active")
        .select("id, status");

      if (loadsErr) throw loadsErr;
      setStatusData(aggregateStatus(loads));

      // 2️⃣ Weekly trend (RPC)
      const { data: trend, error: trendErr } = await supabase.rpc(
        "get_weekly_loads_trend"
      );
      if (trendErr) throw trendErr;
      setTrendData(trend || []);
    } catch (e) {
      console.error(e);
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading dashboard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-500">
        Error loading dashboard: {error}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* ----- cards ----- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          title="In Transit"
          value={statusData.find((x) => x.status === "IN_TRANSIT")?.value || 0}
          icon={<Truck />}
        />
        <Card
          title="Delivered"
          value={statusData.find((x) => x.status === "DELIVERED")?.value || 0}
          icon={<CheckCircle2 />}
        />
        <Card
          title="Problem"
          value={statusData.find((x) => x.status === "PROBLEM")?.value || 0}
          icon={<AlertTriangle />}
        />
      </div>

      {/* ----- charts ----- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pie */}
        <div className="h-80 bg-white dark:bg-neutral-950 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
          <h3 className="font-semibold mb-4">Status Distribution</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="status"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
              >
                {statusData.map((entry) => (
                  <Cell
                    key={entry.status}
                    fill={COLORS[entry.status] || "#a1a1aa"}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Trend line */}
        <div className="h-80 bg-white dark:bg-neutral-950 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
          <h3 className="font-semibold mb-4">Delivered Loads (12 Weeks)</h3>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={trendData}>
              <XAxis dataKey="week_label" hide />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ---------- small card ---------- */
function Card({ title, value, icon }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 flex items-center gap-4">
      <div className="p-3 rounded-xl bg-neutral-100 dark:bg-neutral-900">
        {icon}
      </div>
      <div>
        <div className="text-sm text-neutral-500">{title}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    </div>
  );
}
