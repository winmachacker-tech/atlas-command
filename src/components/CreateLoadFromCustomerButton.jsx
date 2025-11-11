// src/components/CreateLoadFromCustomerButton.jsx
// Purpose: Create a REAL load in `public.loads` from a Customers lane row.
// - Parses laneKey: "OriginCity, ST → DestCity, ST"
// - Calls RPC: public.rpc_create_load_from_customer(...)
// - Optional driver assignment (pass driverId or leave null)
// - Shows simple inline status while running

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { PlayCircle, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

function parseLaneKey(laneKey) {
  // Expected: "Tulsa, OK → Columbus, OH"
  if (!laneKey || typeof laneKey !== "string") return {};
  const parts = laneKey.split("→").map(s => s.trim());
  if (parts.length !== 2) return {};

  const [oCity, oState] = parts[0].split(",").map(s => s.trim());
  const [dCity, dState] = parts[1].split(",").map(s => s.trim());
  return {
    origin_city: oCity || null,
    origin_state: oState || null,
    dest_city: dCity || null,
    dest_state: dState || null,
  };
}

/**
 * Props:
 * - customerId: UUID (required)
 * - laneKey: "City, ST → City, ST" (required)
 * - driverId?: UUID (optional) — if you want to pre-assign
 * - rate?: number (optional, defaults 1500)
 * - pickupAt?: ISO string (optional, defaults now)
 * - deliveryAt?: ISO string (optional)
 * - label?: string (button text)
 * - onCreated?: (loadRow) => void
 */
export default function CreateLoadFromCustomerButton({
  customerId,
  laneKey,
  driverId = null,
  rate = 1500,
  pickupAt = new Date().toISOString(),
  deliveryAt = null,
  label = "Create real load",
  onCreated,
}) {
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  async function handleCreate() {
    setBusy(true);
    setOkMsg("");
    setErrMsg("");

    try {
      if (!customerId) throw new Error("customerId is required");
      if (!laneKey) throw new Error("laneKey is required");

      const lane = parseLaneKey(laneKey);
      if (!lane.origin_city || !lane.dest_city) {
        throw new Error(`laneKey is malformed. Got: "${laneKey}"`);
      }

      const { data, error } = await supabase.rpc("rpc_create_load_from_customer", {
        p_customer_id: customerId,          // REQUIRED
        p_ref_no: null,                     // or "AC-12345"
        p_driver_id: driverId,              // optional
        p_origin_city: lane.origin_city,
        p_origin_state: lane.origin_state,
        p_dest_city: lane.dest_city,
        p_dest_state: lane.dest_state,
        p_pickup_at: pickupAt,
        p_delivery_at: deliveryAt,
        p_rate: rate,
      });

      if (error) {
        // Surface Postgres check-constraint messages clearly
        throw new Error(error.message || JSON.stringify(error));
      }

      setOkMsg(`Load created: ${data?.ref_no || data?.id || "OK"}`);
      if (typeof onCreated === "function") onCreated(data);
    } catch (e) {
      setErrMsg(String(e.message || e));
    } finally {
      setBusy(false);
      // auto-clear message after a moment
      setTimeout(() => {
        setOkMsg("");
        setErrMsg("");
      }, 3500);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleCreate}
        disabled={busy}
        className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm
          ${busy ? "opacity-70 cursor-not-allowed" : "hover:opacity-90"}
          bg-emerald-600 text-white`}
        title="Create a real load in Supabase"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
        {label}
      </button>

      {okMsg && (
        <span className="flex items-center gap-1 text-emerald-400 text-sm">
          <CheckCircle2 className="w-4 h-4" /> {okMsg}
        </span>
      )}
      {errMsg && (
        <span className="flex items-center gap-1 text-rose-400 text-sm">
          <AlertCircle className="w-4 h-4" /> {errMsg}
        </span>
      )}
    </div>
  );
}
