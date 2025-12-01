// src/components/AssignDriverModal.jsx
import { useEffect, useMemo, useState } from "react";
import {
  X,
  Loader2,
  UserCheck,
  AlertTriangle,
  Search,
} from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function AssignDriverModal({ load, onClose, onAssigned }) {
  const [drivers, setDrivers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const loadId = load?.id ?? null;

  // ------------------------ Fetch AVAILABLE drivers ------------------------
  async function fetchDrivers() {
    setLoading(true);
    setErr("");

    const { data, error } = await supabase
      .from("drivers")
      .select("id, first_name, last_name, status, avatar_url")
      .eq("status", "AVAILABLE") // only show AVAILABLE drivers
      .order("last_name", { ascending: true });

    if (error) {
      console.error("[AssignDriverModal] fetchDrivers error:", error);
      setErr(error.message || "Failed to load drivers.");
      setDrivers([]);
    } else {
      console.log(
        `[AssignDriverModal] Eligible AVAILABLE drivers: ${data?.length ?? 0}`,
        data
      );
      setDrivers(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchDrivers();
  }, []);

  // ------------------------ Search filter ------------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) => {
      const fn = (d.first_name || "").toLowerCase();
      const ln = (d.last_name || "").toLowerCase();
      return fn.includes(q) || ln.includes(q) || `${fn} ${ln}`.includes(q);
    });
  }, [drivers, query]);

  // ------------------------ Assign handler ------------------------
  async function handleAssign() {
    if (!selectedId) {
      setErr("Choose a driver to assign.");
      return;
    }
    if (!loadId) {
      setErr("Load ID is missing. Please close and reopen this load.");
      return;
    }

    setBusy(true);
    setErr("");

    try {
      // Safety re-check: still AVAILABLE?
      const { data: checkDriver, error: checkErr } = await supabase
        .from("drivers")
        .select("id, status")
        .eq("id", selectedId)
        .single();

      if (checkErr) {
        throw new Error(`Could not verify driver: ${checkErr.message}`);
      }
      if (!checkDriver || checkDriver.status !== "AVAILABLE") {
        throw new Error("Selected driver is no longer AVAILABLE.");
      }

      // Assign driver on the load only
      const { data: updatedLoad, error: updLoadErr } = await supabase
        .from("loads")
        .update({
          driver_id: selectedId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", loadId)
        .select(
          `
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `
        )
        .single();

      if (updLoadErr) {
        throw new Error(`Failed to update load: ${updLoadErr.message}`);
      }

      // NOTE: we no longer touch drivers.status here.
      // This avoids drivers_status_valid constraint issues and leaves
      // status management to your other workflows (Dipsy, HOS, etc).

      onAssigned?.(updatedLoad);
      onClose?.();
    } catch (e) {
      console.error("[AssignDriverModal] assign error:", e);
      setErr(e.message || "Failed to assign driver.");
    } finally {
      setBusy(false);
    }
  }

  // ------------------------ Render ------------------------
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onClose?.()} />

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

        <div className="mt-3 text-sm text-zinc-400">
          Eligible AVAILABLE drivers found:{" "}
          <span className="font-medium text-zinc-200">
            {loading ? "…" : filtered.length}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
          <Search size={16} className="shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search drivers by name…"
          />
        </div>

        {err ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Something went wrong</div>
              <div className="opacity-90">{err}</div>
            </div>
          </div>
        ) : null}

        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-zinc-800">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-zinc-400">
              <Loader2 className="animate-spin" size={16} />
              Loading drivers…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400">
              No AVAILABLE drivers visible. This may be due to RLS or status
              values. Ensure drivers belong to your org and have status{" "}
              <span className="text-zinc-200">AVAILABLE</span>.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((d) => {
                const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
                const selected = selectedId === d.id;

                return (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelectedId(d.id)}
                      className={cx(
                        "flex w-full items-center gap-3 px-4 py-3 text-left transition",
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
                        <div className="text-sm font-medium text-zinc-100">
                          {name || d.id}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-400">
                          Status: {d.status || "AVAILABLE"}
                        </div>
                      </div>

                      {selected ? (
                        <UserCheck className="text-emerald-400" size={18} />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

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
