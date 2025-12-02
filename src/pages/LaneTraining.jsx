// FILE: src/pages/Customers.jsx
// Purpose: Lane training overview + working "Train AI" button + inline trainer per lane,
// scoped by org via Postgres RLS on AI tables.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  RefreshCw,
  PlayCircle,
  Search as SearchIcon,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import CustomerThumbsBar from "../components/CustomerThumbsBar.jsx";
import CreateLoadFromCustomerButton from "../components/CreateLoadFromCustomerButton.jsx";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) { return a.filter(Boolean).join(" "); }
function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.0%";
  return `${(v * 100).toFixed(1)}%`;
}
function firstKey(obj, keys, fallback = undefined) {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  return fallback;
}
function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Parse lane string like "Birmingham, AL → Charlotte, NC" into parts. */
function parseLane(laneKey) {
  if (!laneKey || typeof laneKey !== "string") {
    return { origin_city: null, origin_state: null, dest_city: null, dest_state: null };
  }
  const arrow = laneKey.includes("→") ? "→" : laneKey.includes("->") ? "->" : null;
  if (!arrow) return { origin_city: null, origin_state: null, dest_city: null, dest_state: null };

  const [left, right] = laneKey.split(arrow).map((s) => s.trim());
  const [oc, os] = (left || "").split(",").map((s) => s.trim());
  const [dc, ds] = (right || "").split(",").map((s) => s.trim());
  return {
    origin_city: oc || null,
    origin_state: os || null,
    dest_city: dc || null,
    dest_state: ds || null,
  };
}

/* ------------------------- tiny toast hook ----------------------- */
function useToast() {
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState("ok");
  const t = useRef(null);
  const show = useCallback((m, _tone = "ok") => {
    setMsg(m);
    setTone(_tone);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 3600);
  }, []);
  const View = useMemo(() => {
    if (!msg) return null;
    return (
      <div
        className={cx(
          "fixed z-50 bottom-10 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-xl text-sm shadow-lg border",
          tone === "ok" && "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
          tone === "err" && "bg-rose-500/10 text-rose-200 border-rose-500/30",
          tone === "info" && "bg-sky-500/10 text-sky-200 border-sky-500/30"
        )}
        role="status"
      >
        {msg}
      </div>
    );
  }, [msg, tone]);
  return { show, ToastView: View };
}

/* ----------------- inline lane trainer --------------------------- */
function LaneInlineTrainer({ laneKey, customerId = null, shipper = "Unknown", limit = 3 }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [driverMeta, setDriverMeta] = useState({});
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState("");

  const refetch = useCallback(async () => {
    if (!laneKey) return;
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("rpc_ai_best_drivers_for_lane", {
        lane_key: laneKey,
        limit_count: limit,
      });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("LaneInlineTrainer fetch failed:", e);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [laneKey, limit]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Resolve driver names if not included
  useEffect(() => {
    const ids = rows.map((r) => r.driver_id).filter(Boolean);
    const missing = ids.filter((id) => !driverMeta[id]);
    if (!missing.length) return;

    (async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, full_name, phone")
        .in("id", missing);

      if (!error && Array.isArray(data)) {
        setDriverMeta((prev) => {
          const next = { ...prev };
          for (const r of data) {
            next[r.id] = {
              full_name: r.full_name || "",
              phone: r.phone || "",
            };
          }
          return next;
        });
      }
    })();
  }, [rows, driverMeta]);

  const SHOW_CREATE_BUTTONS = true;

  // Direct RPC create (includes required p_shipper, leaves status to DB default)
  const handleCreateDirect = async () => {
    if (!laneKey || !customerId) {
      setCreateMsg("Missing lane or customer.");
      return;
    }
    const { origin_city, origin_state, dest_city, dest_state } = parseLane(laneKey);
    if (!origin_city || !origin_state || !dest_city || !dest_state) {
      setCreateMsg("Could not parse lane (need City, ST → City, ST).");
      return;
    }
    setCreating(true);
    setCreateMsg("");
    try {
      const payload = {
        p_customer_id: customerId,
        p_shipper: shipper || "Unknown",
        p_origin_city: origin_city,
        p_origin_state: origin_state,
        p_dest_city: dest_city,
        p_dest_state: dest_state,
        p_pickup_at: new Date().toISOString(),
        p_delivery_at: null,
        p_rate: 1500,
        p_driver_id: null,
      };

      const { error } = await supabase.rpc("rpc_create_load_from_customer", payload);
      if (error) throw error;
      setCreateMsg("Load created.");
      await refetch();
    } catch (e) {
      console.error(e);
      setCreateMsg(e.message || "Create failed.");
    } finally {
      setCreating(false);
      setTimeout(() => setCreateMsg(""), 2500);
    }
  };

  return (
    <div className="px-4 py-3 bg-zinc-950/40 border-t border-zinc-800/60">
      {SHOW_CREATE_BUTTONS && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-xs text-zinc-400">
            Top drivers for{" "}
            <span className="text-zinc-200 font-medium">{laneKey}</span>
          </div>

          <div className="flex items-center gap-2">
            <CreateLoadFromCustomerButton
              customerId={customerId}
              laneKey={laneKey}
              driverId={null}
              rate={1500}
              onCreated={() => refetch()}
              shipper={shipper}
            />
            <button
              onClick={handleCreateDirect}
              disabled={creating}
              className={cx(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs",
                "border border-emerald-600/40 text-emerald-200 hover:bg-emerald-600/10",
                creating && "opacity-60 cursor-not-allowed"
              )}
              title="Create Load (direct RPC)"
            >
              <PlayCircle
                className={cx("w-3.5 h-3.5", creating && "animate-pulse")}
              />
              {creating ? "Creating…" : "Create Load (direct)"}
            </button>
          </div>
        </div>
      )}

      {createMsg && <div className="mb-2 text-xs text-zinc-400">{createMsg}</div>}
      {loading && <div className="text-xs text-zinc-400">Loading top drivers…</div>}
      {err && (
        <div className="text-xs text-rose-400">
          {String(err.message || err)}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-xs text-zinc-400">
          No AI signals yet for{" "}
          <span className="text-zinc-200 font-medium">{laneKey}</span>. Click 👍/👎
          to start training.
        </div>
      )}

      <div className="grid gap-2">
        {rows.map((r, idx) => (
          <div
            key={`${laneKey}-${r.driver_id}-${idx}`}
            className="flex items-center justify-between rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-6 text-zinc-500 text-xs tabular-nums">
                {idx + 1}
              </div>
              <div className="min-w-0">
                <div className="text-sm text-zinc-100 font-medium truncate">
                  {driverMeta[r.driver_id]?.full_name ||
                    r.driver_name ||
                    r.driver_id}
                </div>
                <div className="text-xs text-zinc-400">
                  Score {num(r.fit_score, r.score)} • 👍 {num(r.up_events)} • 👎{" "}
                  {num(r.down_events)}
                </div>
              </div>
            </div>

            <CustomerThumbsBar
              driverId={r.driver_id}
              laneKey={laneKey}
              customerId={customerId}
              onChange={refetch}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ page ----------------------------- */
export default function Customers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // training state machine: idle | backfilling | retraining | done
  const [trainStep, setTrainStep] = useState("idle");
  const [training, setTraining] = useState(false);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const { show, ToastView } = useToast();

  // Signal map (lane-level AI feedback totals)
  const [signalMap, setSignalMap] = useState({});

  const fetchSignals = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("rpc_ai_lane_signal_totals");
      if (error) throw error;
      const map = {};
      if (Array.isArray(data)) {
        for (const r of data) {
          // normalize key just like fn_norm_lane does
          const norm = (r.lane_key || "")
            .toLowerCase()
            .replace(/^lane\s+/, "")
            .replace(/->/g, "→")
            .trim();
          map[norm] = { up: r.up_total || 0, down: r.down_total || 0 };
        }
      }
      setSignalMap(map);
    } catch (e) {
      console.error("fetchSignals failed:", e);
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      // *** key piece: this RPC is now org-scoped via org_id + RLS ***
      const { data, error } = await supabase.rpc("rpc_ai_customer_training", {
        limit_rows: 5000, // you can bump this if you want more
      });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      show(`Failed to load: ${e.message || String(e)}`, "err");
    } finally {
      setLoading(false);
    }
  }, [show]);

  // Load data & signal totals on mount
  useEffect(() => {
    fetchRows();
  }, [fetchRows]);
  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  async function handleTrainAI() {
    if (training) return;
    setTraining(true);
    setTrainStep("backfilling");
    try {
      // Backfill examples for THIS org (RLS / org_id handles scoping)
      const { data: backfillData, error: backfillError } =
        await supabase.rpc("rpc_ai_backfill_examples_from_raw", {
          p_lane_key: null,
        });
      if (backfillError) throw backfillError;
      const inserted = Number(backfillData ?? 0);

      setTrainStep("retraining");

      // Call retrain with NO arguments – matches rpc_ai_retrain() in Postgres
      const { error: retrainError } = await supabase.rpc("rpc_ai_retrain");
      if (retrainError) throw retrainError;

      // Refresh both grids and signal totals after train
      await fetchRows();
      await fetchSignals();

      setTrainStep("done");

      show(
        inserted > 0
          ? `AI trained: ${inserted} examples processed.`
          : "AI train completed (no new examples found).",
        "ok"
      );
    } catch (e) {
      console.error(e);
      const msg = e?.message || e?.details || String(e);
      show(`Train failed: ${msg}`, "err");
      setTrainStep("idle");
    } finally {
      setTraining(false);
      setTimeout(() => setTrainStep("idle"), 2000);
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const label = String(
        firstKey(r, ["lane_key", "customer", "customer_name", "name", "title"], "")
      ).toLowerCase();
      return label.includes(s);
    });
  }, [rows, q]);

  return (
    <div className="p-4 md:p-6">
      {ToastView}

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs">
            🧠
          </span>
          <h1 className="text-xl font-semibold text-zinc-100">Customers</h1>

          {/* Training status pill */}
          <div
            className={cx(
              "ml-3 text-xs px-2 py-1 rounded-md border transition",
              trainStep === "idle" &&
                "border-zinc-700/60 text-zinc-400",
              trainStep === "backfilling" &&
                "border-sky-600/40 text-sky-200 bg-sky-500/10",
              trainStep === "retraining" &&
                "border-violet-600/40 text-violet-200 bg-violet-500/10",
              trainStep === "done" &&
                "border-emerald-600/40 text-emerald-200 bg-emerald-500/10"
            )}
            title="Training progress"
          >
            {trainStep === "idle" && "Idle"}
            {trainStep === "backfilling" && "Backfilling examples…"}
            {trainStep === "retraining" && "Retraining model…"}
            {trainStep === "done" && "Done"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchRows}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
            title="Refresh"
          >
            <RefreshCw
              className={cx("w-4 h-4", loading && "animate-spin")}
            />
            Refresh
          </button>

          <button
            onClick={handleTrainAI}
            disabled={training}
            className={cx(
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border",
              "border-emerald-600/40 text-emerald-200 hover:bg-emerald-600/10",
              training && "opacity-60 cursor-not-allowed"
            )}
            title="Train AI with historical + raw data"
          >
            <PlayCircle
              className={cx("w-4 h-4", training && "animate-pulse")}
            />
            {training ? "Training…" : "Train AI"}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-zinc-700/60 bg-zinc-900/40 text-zinc-200 w-full max-w-md">
          <SearchIcon className="w-4 h-4 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-transparent outline-none w-full placeholder:text-zinc-500"
            placeholder="Search customers/lanes…"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-2xl border border-zinc-700/60 overflow-hidden">
        <div className="grid grid-cols-[34px_minmax(320px,1fr)_100px_110px_110px_110px_160px_180px] px-4 py-2 bg-zinc-900/50 text-xs text-zinc-400 border-b border-zinc-700/60">
          <div /> {/* chevron col */}
          <div>Customer</div>
          <div className="text-center">Region</div>
          <div className="text-center">Recent 90d</div>
          <div className="text-center">Total Rows</div>
          <div className="text-center">Avg Margin</div>
          <div className="text-center">Avg Rate</div>
          <div className="text-center">Signals</div>
        </div>

        {loading && (
          <div className="p-4 text-sm text-zinc-400">Loading…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="p-4 text-sm text-zinc-400">No lanes found.</div>
        )}

        <div className="divide-y divide-zinc-800/70">
          {filtered.map((r, i) => {
            const label = firstKey(
              r,
              ["lane_key", "customer", "customer_name", "name", "title"],
              ""
            );
            const isOpen = !!open[label];
            const laneLabel = label || "—";
            const laneKey = label || null;

            const recent90 = num(r.recent_90d, r.recent90, r.recent);
            const total = num(r.total_rows, r.total, r.count);

            const normLane = laneLabel
              .toLowerCase()
              .replace(/^lane\s+/, "")
              .replace(/->/g, "→")
              .trim();
            const sig = signalMap[normLane] || {};
            const upSig =
              sig.up ?? num(r.up_signals, r.ups, r.up_count, r.upvotes);
            const downSig =
              sig.down ?? num(r.down_signals, r.downs, r.down_count, r.downvotes);

            const shipper = firstKey(
              r,
              ["customer_name", "customer", "name", "title", "shipper_name", "shipper"],
              "Unknown"
            );

            return (
              <div key={`${laneLabel}-${i}`} className="group">
                <div
                  className={cx(
                    "grid grid-cols-[34px_minmax(320px,1fr)_100px_110px_110px_110px_160px_180px] px-4 py-2 text-sm items-center",
                    "hover:bg-zinc-900/40"
                  )}
                >
                  {/* expand/collapse */}
                  <button
                    onClick={() =>
                      setOpen((o) => ({ ...o, [laneLabel]: !isOpen }))
                    }
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-zinc-800/60 hover:bg-zinc-900/60"
                    title={isOpen ? "Hide trainer" : "Show trainer"}
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-zinc-300" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-zinc-300" />
                    )}
                  </button>

                  {/* lane / customer */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-amber-400/80" />
                    <div className="truncate text-zinc-100">{laneLabel}</div>
                  </div>

                  <div className="text-center text-zinc-500">—</div>
                  <div className="text-center tabular-nums">{recent90}</div>
                  <div className="text-center tabular-nums">{total}</div>
                  <div className="text-center tabular-nums">
                    {pct(r.avg_margin)}
                  </div>
                  <div className="text-center text-zinc-500">—</div>

                  <div className="flex items-center justify-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200 text-xs">
                      ▲ {upSig}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-200 text-xs">
                      ▼ {downSig}
                    </span>
                  </div>
                </div>

                {isOpen && laneKey && (
                  <LaneInlineTrainer
                    laneKey={laneKey}
                    customerId={r.customer_id || null}
                    shipper={shipper}
                    limit={3}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 text-xs text-zinc-500">
        Data via <code>rpc_ai_customer_training</code> • Last refresh:{" "}
        {new Date().toLocaleString()}
      </div>
    </div>
  );
}
