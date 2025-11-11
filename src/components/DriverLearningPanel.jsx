// src/components/DriverLearningPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, TrendingUp, TrendingDown, Clock, CheckCircle2, XCircle, MapPin, Truck, Layers, SlidersHorizontal } from "lucide-react";

function cx(...a){return a.filter(Boolean).join(" ");}

export default function DriverLearningPanel({ driverId }) {
  const [prefs, setPrefs] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  // pull snapshot + recent feedback
  useEffect(() => {
    let active = true;
    (async () => {
      if (!driverId) return;
      setLoading(true);
      try {
        const [{ data: p }, { data: e }] = await Promise.all([
          supabase.from("driver_preferences").select("*").eq("driver_id", driverId).maybeSingle(),
          supabase.from("v_dispatch_feedback_enriched")
            .select("*")
            .eq("driver_id", driverId)
            .order("created_at", { ascending: false })
            .limit(50)
        ]);
        if (!active) return;
        setPrefs(p || null);
        setEvents(Array.isArray(e) ? e : []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [driverId]);

  const agg = useMemo(() => {
    const up = events.filter((r) => r.accepted === true).length;
    const down = events.filter((r) => r.accepted === false).length;
    const total = up + down;
    const rate = total ? Math.round((up / total) * 100) : 0;
    return { up, down, total, rate };
  }, [events]);

  if (!driverId) {
    return (
      <div className="rounded-xl border border-white/10 p-6 text-sm text-white/70">
        Select a driver to view learning history.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid place-items-center p-10">
        <div className="inline-flex items-center gap-2 text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading learning historyâ€¦
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Snapshot */}
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="mb-3 text-sm font-semibold">Current Preference Snapshot</div>
        {prefs ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <InfoCard icon={MapPin} label="Home Base" value={prefs.home_base || "â€”"} />
            <InfoCard icon={Layers} label="Regions" value={
              (prefs.preferred_regions?.length ? prefs.preferred_regions.join(", ") : "â€”")
            } />
            <InfoCard icon={Truck} label="Equipment" value={
              (prefs.preferred_equipment?.length ? prefs.preferred_equipment.join(", ") : "â€”")
            } />
            <InfoCard icon={SlidersHorizontal} label="Max Distance" value={
              prefs.max_distance ? `${prefs.max_distance} mi` : "â€”"
            } />
            <InfoCard icon={XCircle} label="Avoid States" value={
              (prefs.avoid_states?.length ? prefs.avoid_states.join(", ") : "â€”")
            } />
            <InfoCard icon={Clock} label="Updated" value={
              prefs.updated_at ? new Date(prefs.updated_at).toLocaleString() : "â€”"
            } />
          </div>
        ) : (
          <div className="text-white/60 text-sm">No preferences saved yet for this driver.</div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={TrendingUp} label="Thumbs Up" value={agg.up} tone="good" />
        <KpiCard icon={TrendingDown} label="Thumbs Down" value={agg.down} tone="bad" />
        <KpiCard icon={CheckCircle2} label="Acceptance Rate" value={`${agg.rate}%`} tone="neutral" />
      </div>

      {/* Timeline */}
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="bg-white/5 px-4 py-2 text-xs font-semibold">Recent Feedback</div>
        {events.length === 0 ? (
          <div className="p-4 text-sm text-white/60">No feedback yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-white/5">
                <tr className="text-left">
                  <Th>When</Th>
                  <Th>Result</Th>
                  <Th>Load</Th>
                  <Th>Lane</Th>
                  <Th>Equip</Th>
                  <Th>Miles</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((r) => (
                  <tr key={r.id} className="border-t border-white/10">
                    <Td>{r.created_at ? new Date(r.created_at).toLocaleString() : "â€”"}</Td>
                    <Td>
                      {r.accepted
                        ? <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">Up</span>
                        : <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-300">Down</span>}
                    </Td>
                    <Td>{r.load_reference || "â€”"}</Td>
                    <Td>{r.origin || "â€”"} â†’ {r.destination || "â€”"}</Td>
                    <Td>{r.equipment_type || "â€”"}</Td>
                    <Td>{r.miles ?? "â€”"}</Td>
                    <Td className="max-w-[280px] truncate" title={r.note || ""}>{r.note || "â€”"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ icon:Icon, label, value }) {
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <div className="text-white/60 flex items-center gap-1">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function KpiCard({ icon:Icon, label, value, tone="neutral" }) {
  const map = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    bad: "border-red-500/30 bg-red-500/10 text-red-300",
    neutral: "border-white/10 bg-white/5 text-white/90",
  };
  return (
    <div className={cx("rounded-xl border p-3", map[tone])}>
      <div className="text-xs flex items-center gap-1 opacity-90"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Th({ children }) { return <th className="px-4 py-2 text-white/70">{children}</th>; }
function Td({ children }) { return <td className="px-4 py-2">{children}</td>; }

