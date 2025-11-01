// src/pages/Dashboard.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import RechartSafeContainer from "../components/RechartSafeContainer";

const PIE_COLORS = ["#60a5fa", "#fbbf24", "#34d399"]; // no theming dependency

export default function Dashboard() {
  const [trend, setTrend] = useState([]);
  const [mix, setMix] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        setErrorMsg("");

        // Replace with your real views when ready. Fallback demo data to avoid empty layout.
        const trendData = await fakeTrend();
        const mixData = await fakeMix();

        if (isMounted) {
          setTrend(trendData);
          setMix(mixData);
        }
      } catch (e) {
        if (isMounted) setErrorMsg(e.message || "Failed to load dashboard");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {errorMsg && (
        <div className="rounded-xl border border-red-300/50 bg-red-50 text-red-700 p-3 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Trend Line Chart */}
        <div className="rounded-2xl border border-zinc-200/60 dark:border-neutral-800 p-4">
          <div className="mb-3 font-medium">Weekly Loads Trend</div>
          <RechartSafeContainer className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <XAxis dataKey="week" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#2563eb" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </RechartSafeContainer>
        </div>

        {/* Pie Mix */}
        <div className="rounded-2xl border border-zinc-200/60 dark:border-neutral-800 p-4">
          <div className="mb-3 font-medium">Status Mix</div>
          <RechartSafeContainer className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mix}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                >
                  {mix.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </RechartSafeContainer>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-zinc-500">Loading dashboard…</div>
      )}
    </div>
  );
}

// Demo data while wiring up Supabase
async function fakeTrend() {
  const weeks = 8;
  const out = [];
  const now = new Date();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const week = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, "0")}`;
    out.push({ week, count: 12 + ((i * 5) % 9) });
  }
  return out;
}

async function fakeMix() {
  return [
    { name: "In Transit", value: 24 },
    { name: "Delivered", value: 52 },
    { name: "Problem", value: 6 },
  ];
}

// ISO week helper
function getISOWeek(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
}
// Ready for the next step?
