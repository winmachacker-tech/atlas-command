// src/pages/AiLaneIntelligence.jsx
// Lane Intelligence / Heatmap view
// - Pulls recent loads from Supabase
// - Groups by origin → destination
// - Computes success / failure rate based on final status
// - Renders a color heatmap + top / risky lanes

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { RefreshCw, AlertTriangle, Info } from "lucide-react";

/* ---------------------- helpers ---------------------- */

function normPlace(v) {
  const s = (v ?? "").toString().trim();
  return s || "UNKNOWN";
}

// Map raw status text into "ok", "bad", or "ignore"
function classifyStatus(status) {
  const s = (status ?? "").toString().toLowerCase().trim();

  // ✅ POSITIVE / SUCCESS STATES
  // Treat as "delivered / completed" for lane stability:
  // - delivered / completed / closed / done
  // - statuses that mention POD (e.g. "POD Uploaded", "POD Received")
  // - "ready for billing", "ready_for_billing", etc.
  if (
    s.startsWith("delivered") ||
    s.startsWith("completed") ||
    s.startsWith("closed") ||
    s === "delivered" ||
    s === "completed" ||
    s === "done" ||
    s === "closed" ||
    s.includes("pod") || // "pod uploaded", "pod received", etc.
    s.includes("ready for billing") ||
    s.includes("ready_for_billing") ||
    s.includes("ready-for-billing") ||
    s.includes("billed")
  ) {
    return "ok";
  }

  // ❌ NEGATIVE / FAILURE STATES
  // cancel / falloff / failed / rejected / no-show
  if (
    s.includes("cancel") ||
    s.includes("falloff") ||
    s.includes("fell off") ||
    s.includes("fail") ||
    s.includes("failed") ||
    s.includes("reject") ||
    s.includes("no show") ||
    s.includes("no-show")
  ) {
    return "bad";
  }

  // Everything else (available, in transit, etc.) is ignored
  return "ignore";
}

function buildLaneStats(rows) {
  const map = new Map();

  for (const row of rows) {
    const origin = normPlace(row.origin);
    const destination = normPlace(row.destination);
    const cls = classifyStatus(row.status);

    if (cls === "ignore") continue;

    const key = `${origin} → ${destination}`;
    let cur = map.get(key);
    if (!cur) {
      cur = {
        key,
        origin,
        destination,
        total: 0,
        ok: 0,
        bad: 0,
      };
      map.set(key, cur);
    }
    cur.total += 1;
    if (cls === "ok") cur.ok += 1;
    if (cls === "bad") cur.bad += 1;
  }

  // turn into sorted array + compute score
  const lanes = Array.from(map.values())
    .map((l) => ({
      ...l,
      score: l.total > 0 ? l.ok / l.total : null,
    }))
    // require at least a couple events so we don't overreact to 1 load
    .filter((l) => l.total >= 2)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .reverse();

  const origins = Array.from(new Set(lanes.map((l) => l.origin))).sort();
  const destinations = Array.from(
    new Set(lanes.map((l) => l.destination))
  ).sort();

  // matrix[originIndex][destIndex] = lane or null
  const matrix = origins.map(() => destinations.map(() => null));
  const indexByOrigin = Object.fromEntries(
    origins.map((o, idx) => [o, idx])
  );
  const indexByDest = Object.fromEntries(
    destinations.map((d, idx) => [d, idx])
  );

  for (const lane of lanes) {
    const oi = indexByOrigin[lane.origin];
    const di = indexByDest[lane.destination];
    if (oi == null || di == null) continue;
    matrix[oi][di] = lane;
  }

  return { lanes, origins, destinations, matrix };
}

// Convert score 0..1 to a red→yellow→green HSL color
function scoreToColor(score) {
  if (score == null) return "transparent";
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const s = clamp(score, 0, 1);
  const hue = s * 120; // 0 = red, 120 = green
  return `hsl(${hue} 70% 40%)`;
}

/* ---------------------- main page ---------------------- */

export default function AiLaneIntelligence() {
  const [days, setDays] = useState(90); // lookback window
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetchData(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function fetchData(windowDays) {
    setLoading(true);
    setErr(null);
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - windowDays);

      const { data, error, count: total } = await supabase
        .from("loads")
        .select("id, origin, destination, status, created_at", {
          count: "exact",
        })
        .gte("created_at", cutoff.toISOString())
        .not("origin", "is", null)
        .not("destination", "is", null)
        .limit(5000); // safeguard

      if (error) throw error;
      setRows(data ?? []);
      setCount(total ?? 0);
    } catch (e) {
      console.error("[AiLaneIntelligence] fetch error:", e);
      setErr(
        e?.message ||
          "Failed to load lanes. Check that the 'loads' table is accessible."
      );
    } finally {
      setLoading(false);
    }
  }

  const { lanes, origins, destinations, matrix } = useMemo(
    () => buildLaneStats(rows),
    [rows]
  );

  const bestLanes = useMemo(() => lanes.slice(0, 5), [lanes]);

  const riskyLanes = useMemo(
    () =>
      [...lanes]
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
        .slice(0, 5),
    [lanes]
  );

  const totalEvents = useMemo(
    () => lanes.reduce((acc, l) => acc + l.total, 0),
    [lanes]
  );

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Lane Intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            This view looks at recent loads, groups them by origin and
            destination, and shows how stable each lane is based on delivered
            vs. failed / cancelled outcomes. Statuses like{" "}
            <span className="font-semibold">POD Uploaded</span> or{" "}
            <span className="font-semibold">Ready for Billing</span> are
            treated as successful deliveries.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 30)}
            className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none"
          >
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </select>

          <button
            onClick={() => fetchData(days)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
            disabled={loading}
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Info / error banners */}
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <div>{String(err)}</div>
        </div>
      )}

      {!err && !loading && lanes.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <Info className="mt-0.5 h-4 w-4" />
          <div>
            Not enough lane data yet. Once you start running loads with drivers
            and final statuses (delivered, cancelled, falloff, POD uploaded,
            ready for billing, etc.), this page will automatically populate.
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Loads scanned
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {count.toLocaleString()}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Loads created in the last {days} days.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Lanes with signal
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {lanes.length.toLocaleString()}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Lanes with at least 2 completed / failed events.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Training events
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {totalEvents.toLocaleString()}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Deliveries vs. cancellations / falloffs used to score lanes.
          </p>
        </div>
      </div>

      {/* Main layout: heatmap + lists */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Heatmap */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Lane heatmap</div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="inline-flex h-3 w-6 rounded bg-[hsl(0_70%_40%)]" />
              <span>High risk</span>
              <span className="inline-flex h-3 w-6 rounded bg-[hsl(40_70%_40%)]" />
              <span>Mixed</span>
              <span className="inline-flex h-3 w-6 rounded bg-[hsl(120_70%_40%)]" />
              <span>Stable</span>
            </div>
          </div>

          {origins.length === 0 || destinations.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--text-muted)]">
              No lanes to plot yet.
            </div>
          ) : (
            <div className="overflow-auto">
              <div className="inline-block min-w-full">
                {/* Header row with destination labels */}
                <div className="ml-20 mb-2 flex gap-2 text-[11px] text-[var(--text-muted)]">
                  {destinations.map((d) => (
                    <div
                      key={d}
                      className="min-w-[7rem] flex-1 text-center"
                    >
                      {d}
                    </div>
                  ))}
                </div>

                {/* Rows */}
                <div className="flex flex-col gap-2">
                  {origins.map((o, oi) => (
                    <div key={o} className="flex items-center gap-2">
                      <div className="w-20 shrink-0 text-[11px] font-medium text-[var(--text-muted)]">
                        {o}
                      </div>
                      <div className="flex flex-1 gap-2">
                        {destinations.map((d, di) => {
                          const lane = matrix[oi][di];
                          const bg = lane?.score != null
                            ? scoreToColor(lane.score)
                            : "transparent";
                          const border =
                            lane?.score != null
                              ? "border-transparent"
                              : "border-white/10";

                          return (
                            <div
                              key={`${o}-${d}`}
                              className={`flex min-h-[4rem] flex-1 flex-col items-center justify-center rounded-lg border text-[11px] ${border}`}
                              style={{
                                background: lane
                                  ? bg
                                  : "linear-gradient(to bottom right, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
                              }}
                            >
                              {lane ? (
                                <>
                                  <div className="font-semibold text-white">
                                    {(lane.score * 100).toFixed(0)}%
                                  </div>
                                  <div className="opacity-80">
                                    {lane.ok}/{lane.total} ok
                                  </div>
                                </>
                              ) : (
                                <div className="text-[10px] text-[var(--text-muted)]">
                                  —
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Best / risky lanes */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-sm font-medium">Top stable lanes</div>
            {bestLanes.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)]">
                Not enough data yet.
              </div>
            ) : (
              <ul className="space-y-2 text-xs">
                {bestLanes.map((l) => (
                  <li
                    key={l.key}
                    className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-2"
                  >
                    <div>
                      <div className="font-medium">{l.key}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {l.ok} of {l.total} successful
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        {(l.score * 100).toFixed(0)}%
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Risky / unstable lanes
            </div>
            {riskyLanes.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)]">
                No risky lanes detected yet.
              </div>
            ) : (
              <ul className="space-y-2 text-xs">
                {riskyLanes.map((l) => (
                  <li
                    key={l.key}
                    className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-2"
                  >
                    <div>
                      <div className="font-medium">{l.key}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {l.ok} of {l.total} successful
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        {(l.score * 100).toFixed(0)}%
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
