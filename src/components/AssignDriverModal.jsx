// src/components/AssignDriverModal.jsx
import { useEffect, useMemo, useState } from "react";
import { X, Loader2, UserCheck, AlertTriangle, Search, CheckCircle2, MapPin, Route, Box, Ban, GaugeCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function AssignDriverModal({ loadId, onClose, onAssigned }) {
  const [drivers, setDrivers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // ðŸ†• Added: lightweight load details for fit scoring (non-blocking if cols missing)
  const [loadInfo, setLoadInfo] = useState(null);

  // ðŸ†• Added: preferences cache keyed by driver_id
  const [prefsByDriver, setPrefsByDriver] = useState({});

  // Fetch ACTIVE drivers (RLS-safe). If your schema has org scoping, add .eq("org_id", <orgId>)
  async function fetchDrivers() {
    setLoading(true);
    setErr("");
    // NOTE: adjust the column list to your schema. We do not assume full_name exists.
    const { data, error } = await supabase
      .from("drivers")
      .select("id, first_name, last_name, status, avatar_url")
      .eq("status", "ACTIVE")
      .order("last_name", { ascending: true });

    if (error) {
      console.error("[AssignDriverModal] fetchDrivers error:", error);
      setErr(error.message || "Failed to load drivers.");
      setDrivers([]);
    } else {
      console.log(`[AssignDriverModal] Eligible ACTIVE drivers: ${data?.length ?? 0}`, data);
      setDrivers(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchDrivers();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) => {
      const fn = (d.first_name || "").toLowerCase();
      const ln = (d.last_name || "").toLowerCase();
      return fn.includes(q) || ln.includes(q) || `${fn} ${ln}`.includes(q);
    });
  }, [drivers, query]);

  async function handleAssign() {
    if (!selectedId) {
      setErr("Choose a driver to assign.");
      return;
    }
    setBusy(true);
    setErr("");

    try {
      // 1) Safety: ensure the chosen driver is still ACTIVE (RLS may return stale/none)
      const { data: checkDriver, error: checkErr } = await supabase
        .from("drivers")
        .select("id, status")
        .eq("id", selectedId)
        .single();

      if (checkErr) {
        throw new Error(`Could not verify driver: ${checkErr.message}`);
      }
      if (!checkDriver || checkDriver.status !== "ACTIVE") {
        throw new Error("Selected driver is no longer ACTIVE.");
      }

      // 2) Assign on loads table
      const { error: updLoadErr } = await supabase
        .from("loads")
        .update({ driver_id: selectedId })
        .eq("id", loadId);

      if (updLoadErr) {
        throw new Error(`Failed to update load: ${updLoadErr.message}`);
      }

      // 3) Flip driver status to ASSIGNED to reflect the new state
      const { error: updDriverErr } = await supabase
        .from("drivers")
        .update({ status: "ASSIGNED" })
        .eq("id", selectedId)
        .eq("status", "ACTIVE"); // guard: only flip if still ACTIVE

      if (updDriverErr) {
        // Not fatal to the assignment, but we should surface it
        console.warn("[AssignDriverModal] Driver status update warning:", updDriverErr);
      }

      // 4) Notify parent + close
      if (onAssigned) onAssigned({ loadId, driverId: selectedId });
      onClose?.();
    } catch (e) {
      console.error("[AssignDriverModal] assign error:", e);
      setErr(e.message || "Failed to assign driver.");
    } finally {
      setBusy(false);
    }
  }

  /* =========================================================================
     ADD-ONLY: Preference-aware fit scoring (no behavior changes required)
     ========================================================================= */

  // ðŸ†• Fetch minimal load info to compute fit (silently ignore if columns missing)
  useEffect(() => {
    let active = true;
    (async () => {
      if (!loadId) return;
      try {
        const { data, error } = await supabase
          .from("loads")
          .select("id, origin, destination, equipment, miles")
          .eq("id", loadId)
          .maybeSingle();
        if (error) throw error;
        if (active) setLoadInfo(data || null);
      } catch (e) {
        console.warn("[AssignDriverModal] load info fetch skipped:", e?.message);
        if (active) setLoadInfo(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadId]);

  // ðŸ†• When drivers list is loaded, bulk-fetch their preferences
  useEffect(() => {
    let active = true;
    (async () => {
      if (!drivers?.length) {
        if (active) setPrefsByDriver({});
        return;
      }
      try {
        const ids = drivers.map((d) => d.id);
        const { data, error } = await supabase
          .from("driver_preferences")
          .select("*")
          .in("driver_id", ids);
        if (error) throw error;
        const map = {};
        for (const row of data || []) map[row.driver_id] = row;
        if (active) setPrefsByDriver(map);
      } catch (e) {
        console.warn("[AssignDriverModal] driver prefs fetch warning:", e?.message);
        if (active) setPrefsByDriver({});
      }
    })();
    return () => {
      active = false;
    };
  }, [drivers]);

  // ðŸ†• Small pure helpers (duplicated here to avoid cross-file coupling)
  function extractState(cityCommaState) {
    if (!cityCommaState || typeof cityCommaState !== "string") return null;
    const parts = cityCommaState.split(",").map((s) => s.trim());
    const maybe = parts[parts.length - 1] || "";
    const st = maybe.toUpperCase();
    return /^[A-Z]{2}$/.test(st) ? st : null;
  }
  function computeDriverLoadFit(prefs, load) {
    if (!prefs || !load) return 0;
    let score = 50; // base

    // Equipment
    if (Array.isArray(prefs.preferred_equipment) && prefs.preferred_equipment.length) {
      if (
        load.equipment &&
        prefs.preferred_equipment.map((s) => s.toLowerCase()).includes(String(load.equipment).toLowerCase())
      ) {
        score += 15;
      } else {
        score -= 10;
      }
    }

    // Avoid states vs destination
    const dstState = extractState(load.destination);
    if (dstState && Array.isArray(prefs.avoid_states)) {
      if (prefs.avoid_states.map((s) => s.toUpperCase()).includes(dstState)) score -= 20;
    }

    // Distance
    if (Number.isFinite(load.miles) && Number.isFinite(prefs.max_distance)) {
      score += load.miles <= prefs.max_distance ? 10 : -10;
    }

    // Home-base bias (origin state == home state)
    const homeState = extractState(prefs.home_base);
    const origState = extractState(load.origin);
    if (homeState && origState && homeState === origState) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  // Derive a tiny shape from loadInfo for compute
  const loadBrief = useMemo(() => {
    if (!loadInfo) return null;
    return {
      origin: loadInfo.origin ?? null,
      destination: loadInfo.destination ?? null,
      equipment: loadInfo.equipment ?? null,
      miles: Number.isFinite(loadInfo.miles) ? loadInfo.miles : null,
    };
  }, [loadInfo]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={() => onClose?.()} />
      {/* Card */}
      <div className="relative z-10 w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Assign Driver</h2>
          <button
            onClick={() => onClose?.()}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Info / counts */}
        <div className="mt-3 text-sm text-zinc-400">
          Eligible ACTIVE drivers found:{" "}
          <span className="font-medium text-zinc-200">{loading ? "â€¦" : filtered.length}</span>
        </div>

        {/* Search */}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
          <Search size={16} className="shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search drivers by nameâ€¦"
          />
        </div>

        {/* Error banner */}
        {err ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Something went wrong</div>
              <div className="opacity-90">{err}</div>
              <div className="mt-1 text-xs opacity-70">
                If this persists, check RLS policies on <code>drivers</code> and that status values
                match exactly (e.g., <code>ACTIVE</code>).
              </div>
            </div>
          </div>
        ) : null}

        {/* List */}
        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-zinc-800">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-zinc-400">
              <Loader2 className="animate-spin" size={16} />
              Loading driversâ€¦
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400">
              No ACTIVE drivers visible. This is often due to RLS scope. Ensure at least one driver
              is <span className="text-zinc-200">ACTIVE</span> and visible to your session.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((d) => {
                const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
                const selected = selectedId === d.id;

                // ðŸ†• Add-on: compute a non-blocking Fit score + snapshot badges (no behavior change)
                const prefs = prefsByDriver[d.id];
                const fit = loadBrief ? computeDriverLoadFit(prefs, loadBrief) : null;

                return (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelectedId(d.id)}
                      className={cx(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition",
                        selected ? "bg-emerald-900/20" : "hover:bg-zinc-800/40"
                      )}
                    >
                      {d.avatar_url ? (
                        <img
                          src={d.avatar_url}
                          alt={name || "Driver"}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-300">
                          {name ? name[0]?.toUpperCase() : "D"}
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-zinc-100">{name || d.id}</div>
                          {/* ðŸ†• Fit pill (shown only if we have load + prefs) */}
                          {Number.isFinite(fit) ? (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                              <GaugeCircle className="h-3.5 w-3.5" />
                              Fit {fit}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-400">Status: ACTIVE</div>

                        {/* ðŸ†• Snapshot badges (optional, quiet) */}
                        {prefs ? (
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-300">
                            {prefs.home_base ? (
                              <span className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5">
                                <MapPin className="h-3.5 w-3.5" />
                                {prefs.home_base}
                              </span>
                            ) : null}
                            {Array.isArray(prefs.preferred_equipment) && prefs.preferred_equipment.length ? (
                              <span className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5">
                                <Box className="h-3.5 w-3.5" />
                                {prefs.preferred_equipment.join(", ")}
                              </span>
                            ) : null}
                            {Array.isArray(prefs.avoid_states) && prefs.avoid_states.length ? (
                              <span className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5">
                                <Ban className="h-3.5 w-3.5" />
                                Avoid: {prefs.avoid_states.join(", ")}
                              </span>
                            ) : null}
                            {Number.isFinite(prefs.max_distance) ? (
                              <span className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5">
                                <Route className="h-3.5 w-3.5" />
                                Max: {prefs.max_distance} mi
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {selected ? <CheckCircle2 className="text-emerald-400" size={18} /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={() => onClose?.()}
            className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            className={cx(
              "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500",
              busy && "opacity-80"
            )}
            disabled={!selectedId || busy}
            title={!selectedId ? "Select a driver" : "Assign driver"}
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <UserCheck size={16} />}
            Assign Driver
          </button>
        </div>
      </div>
    </div>
  );
}

