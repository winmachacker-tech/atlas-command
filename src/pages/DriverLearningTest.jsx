// src/pages/DriverLearningTest.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

// âœ… UI component stays from components (if you use it in this page)
import DriverPreferences from "../components/DriverPreferences.jsx";

// âœ… All helper functions come from the Linux-safe shim in /lib
//    DO NOT import from ../lib/driverPreferences.jsx (breaks on Vercel/Linux).
import {
  getDriverPreferences,
  getDriverRecentFeedback,
  recordThumb,
} from "../lib/driverPreferences.js";

/**
 * DriverLearningTest
 * Minimal harness to verify driver preference helpers work end-to-end.
 * - Uses /lib/driverPreferences.js (shim) so Linux builds succeed.
 * - Keeps your page self-contained and easy to validate.
 */

export default function DriverLearningTest() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDriverId = searchParams.get("driverId") || "";
  const [driverId, setDriverId] = useState(initialDriverId);

  const [prefs, setPrefs] = useState(null);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  function cx(...a) {
    return a.filter(Boolean).join(" ");
  }

  async function handleLoadPrefs() {
    if (!driverId) return setToast("Enter a driverId first.");
    if (typeof getDriverPreferences !== "function") {
      return setToast("getDriverPreferences is not available.");
    }
    setBusy(true);
    setToast("");
    try {
      const res = await getDriverPreferences(driverId);
      setPrefs(res ?? {});
      setToast("Loaded preferences.");
    } catch (e) {
      setToast(`Error loading preferences: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadRecent() {
    if (!driverId) return setToast("Enter a driverId first.");
    if (typeof getDriverRecentFeedback !== "function") {
      return setToast("getDriverRecentFeedback is not available.");
    }
    setBusy(true);
    setToast("");
    try {
      const res = await getDriverRecentFeedback(driverId, { limit: 10 });
      setRecent(Array.isArray(res) ? res : []);
      setToast("Loaded recent feedback.");
    } catch (e) {
      setToast(`Error loading feedback: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleThumb(dir) {
    if (!driverId) return setToast("Enter a driverId first.");
    if (typeof recordThumb !== "function") {
      return setToast("recordThumb is not available.");
    }
    setBusy(true);
    setToast("");
    try {
      await recordThumb({
        driver_id: driverId,
        thumb: dir === "up" ? "up" : "down",
        context: { source: "DriverLearningTest" },
      });
      setToast(`Recorded thumb ${dir}.`);
      await handleLoadRecent();
    } catch (e) {
      setToast(`Error recording thumb: ${e?.message || e}`);
      setBusy(false);
    }
  }

  const disabled = busy === true;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Driver Learning Test</h1>
        <Link to="/drivers" className="text-sm underline opacity-80 hover:opacity-100">
          â† Back to Drivers
        </Link>
      </div>

      {/* Driver input */}
      <div className="grid gap-2 max-w-xl">
        <label className="text-sm opacity-80">Driver ID</label>
        <input
          value={driverId}
          onChange={(e) => {
            const v = e.target.value;
            setDriverId(v);
            const t = v.trim();
            if (t) setSearchParams({ driverId: t });
            else setSearchParams({});
          }}
          placeholder="uuid or your driver primary key"
          className="w-full rounded-lg border bg-transparent p-2 outline-none focus:ring focus:ring-emerald-600/30"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleLoadPrefs}
            disabled={disabled}
            className={cx(
              "rounded-lg px-3 py-2 text-sm",
              disabled ? "opacity-50 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500"
            )}
          >
            Load Preferences
          </button>
          <button
            onClick={handleLoadRecent}
            disabled={disabled}
            className={cx(
              "rounded-lg px-3 py-2 text-sm",
              disabled ? "opacity-50 cursor-not-allowed" : "bg-sky-600 hover:bg-sky-500"
            )}
          >
            Load Recent Feedback
          </button>
          <button
            onClick={() => handleThumb("up")}
            disabled={disabled}
            className={cx(
              "rounded-lg px-3 py-2 text-sm",
              disabled ? "opacity-50 cursor-not-allowed" : "bg-emerald-700 hover:bg-emerald-600"
            )}
          >
            ðŸ‘ Thumb Up
          </button>
          <button
            onClick={() => handleThumb("down")}
            disabled={disabled}
            className={cx(
              "rounded-lg px-3 py-2 text-sm",
              disabled ? "opacity-50 cursor-not-allowed" : "bg-rose-700 hover:bg-rose-600"
            )}
          >
            ðŸ‘Ž Thumb Down
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast ? (
        <div className="text-sm opacity-90">
          <span className="px-2 py-1 rounded bg-black/30">{toast}</span>
        </div>
      ) : null}

      {/* Optional UI component preview (kept intact; safe if unused) */}
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Driver Preferences Component</h2>
        <div className="rounded-lg border p-3">
          {/* This component can be empty/no-op if you haven't wired it yet */}
          <DriverPreferences driverId={driverId} />
        </div>
      </section>

      {/* Preferences preview */}
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Preferences (raw)</h2>
        <pre className="whitespace-pre-wrap rounded-lg border p-3 text-xs opacity-90">
          {prefs ? JSON.stringify(prefs, null, 2) : "â€”"}
        </pre>
      </section>

      {/* Recent feedback preview */}
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Recent Feedback (raw)</h2>
        <pre className="whitespace-pre-wrap rounded-lg border p-3 text-xs opacity-90">
          {recent && recent.length ? JSON.stringify(recent, null, 2) : "â€”"}
        </pre>
      </section>
    </div>
  );
}

