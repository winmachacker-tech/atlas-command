// src/components/AssignDriverModal.jsx
import { useState, useEffect } from "react";
import { X, Loader2, UserCheck, ChevronDown } from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function Ico({ as: Icon, className = "" }) {
  return (
    <Icon
      className={cx("h-4 w-4", className)}
      strokeWidth={2}
      style={{ color: "currentColor", stroke: "currentColor" }}
    />
  );
}

function IconButton({ title, onClick, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/30 bg-white/5 text-white transition-colors hover:border-white/40 hover:bg-white/10"
    >
      {children}
    </button>
  );
}

export default function AssignDriverModal({ load, onClose, onAssigned }) {
  const [driverId, setDriverId] = useState(load?.driver_id || "");
  const [drivers, setDrivers] = useState([]);
  const [currentDriver, setCurrentDriver] = useState(null);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Fetch available drivers and current driver info
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch all active drivers
        const { data: driversList, error: driversError } = await supabase
          .from("v_drivers_active")
          .select("id, first_name, last_name")
          .eq("status", "ACTIVE")
          .order("last_name", { ascending: true });
        
        if (driversError) throw driversError;
        setDrivers(driversList || []);

        // If load has a driver, fetch their info
        if (load?.driver_id) {
          const { data: driverData, error: driverError } = await supabase
            .from("v_drivers_active")
            .select("id, first_name, last_name")
            .eq("id", load.driver_id)
            .single();
          
          if (!driverError && driverData) {
            setCurrentDriver(driverData);
          }
        }
      } catch (e) {
        console.warn("[AssignDriverModal] Failed to load drivers:", e);
        setError("Failed to load drivers");
      } finally {
        setLoadingDrivers(false);
      }
    }
    fetchData();
  }, [load?.driver_id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({
          driver_id: driverId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", load.id)
        .select()
        .single();

      if (error) {
        // Handle case where driver_id column doesn't exist yet
        if (String(error?.message || "").includes("column") || error?.code === "42703") {
          setError("The 'driver_id' column doesn't exist yet. Please add it to your database.");
          return;
        }
        throw error;
      }

      // Call parent callback with updated load
      onAssigned(data);
      onClose();
    } catch (e) {
      console.error("[AssignDriverModal] error:", e);
      setError(e?.message || "Failed to assign driver");
    } finally {
      setSaving(false);
    }
  }

  function handleRemove() {
    setDriverId("");
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0B0B0F] p-4">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10">
              <Ico as={UserCheck} className="text-sky-400" />
            </div>
            <h3 className="text-base font-semibold">Assign Driver</h3>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <Ico as={X} />
          </IconButton>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/70">Load #</label>
            <input
              type="text"
              value={load?.reference || "—"}
              disabled
              className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/70">
              Driver
            </label>
            <div className="relative">
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                disabled={loadingDrivers}
                className="w-full appearance-none rounded-xl border border-white/10 bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:border-sky-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                autoFocus
              >
                <option value="" className="bg-[#0B0B0F]">
                  {loadingDrivers ? "Loading drivers..." : "No driver assigned"}
                </option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id} className="bg-[#0B0B0F]">
                    {d.last_name}, {d.first_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
            </div>
            {currentDriver && (
              <p className="mt-1 text-xs text-white/50">
                Current: {currentDriver.last_name}, {currentDriver.first_name}
              </p>
            )}
            {drivers.length === 0 && !loadingDrivers && (
              <p className="mt-1 text-xs text-amber-300">
                No active drivers available. Add drivers first.
              </p>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-2">
            {load?.driver_id && (
              <button
                type="button"
                onClick={handleRemove}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
              >
                Remove Driver
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-sky-400 disabled:opacity-60"
              >
                {saving ? (
                  <>
                    <Ico as={Loader2} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Ico as={UserCheck} />
                    Assign
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}