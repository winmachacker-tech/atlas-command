// src/components/LoadCreateForm.jsx
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * LoadCreateForm
 *
 * Purpose:
 * - Fetches equipment types from public.v_equipment_types
 * - Lets user choose equipment type and auto-fills length/temp-control
 * - Emits a clean payload via onSubmit(payload) WITHOUT doing DB writes here
 *
 * Props:
 * - onSubmit?: (payload) => Promise<void> | void
 * - onCancel?: () => void
 * - initial?: object  // optional initial form state
 *
 * Notes:
 * - Keep this form UI minimal; parent decides how to insert into `loads`.
 * - Payload includes: equipment_type_id, equipment_length_feet, has_temp_control,
 *   origin, destination, pickup_date, delivery_date, reference, notes, rate_total.
 */

export default function LoadCreateForm({
  onSubmit,
  onCancel,
  initial = {},
}) {
  /* ------------------------------- State ---------------------------------- */
  const [loadingEq, setLoadingEq] = useState(true);
  const [eqErr, setEqErr] = useState(null);
  const [eqTypes, setEqTypes] = useState([]);

  const [submitting, setSubmitting] = useState(false);

  // Core load fields (keep minimal & compatible)
  const [reference, setReference] = useState(initial.reference ?? "");
  const [origin, setOrigin] = useState(initial.origin ?? "");
  const [destination, setDestination] = useState(initial.destination ?? "");
  const [pickupDate, setPickupDate] = useState(initial.pickup_date ?? "");
  const [deliveryDate, setDeliveryDate] = useState(initial.delivery_date ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");

  // Financial (simple total linehaul for now)
  const [rateTotal, setRateTotal] = useState(
    initial.rate_total !== undefined ? String(initial.rate_total) : ""
  );

  // Equipment fields
  const [equipmentTypeId, setEquipmentTypeId] = useState(
    initial.equipment_type_id ?? ""
  );
  const [equipmentLengthFeet, setEquipmentLengthFeet] = useState(
    initial.equipment_length_feet ?? ""
  );
  const [hasTempControl, setHasTempControl] = useState(
    initial.has_temp_control ?? false
  );

  const selectedEq = useMemo(
    () => eqTypes.find((e) => e.id === equipmentTypeId) || null,
    [eqTypes, equipmentTypeId]
  );

  /* ----------------------------- Effects ---------------------------------- */
  useEffect(() => {
    let isMounted = true;
    async function loadEq() {
      setLoadingEq(true);
      setEqErr(null);
      const { data, error } = await supabase
        .from("v_equipment_types")
        .select(
          "id, code, label, description, default_length_feet, allowed_lengths_feet, has_temp_control, is_open_deck, is_power_only, max_weight_lbs"
        )
        .order("label", { ascending: true });

      if (!isMounted) return;
      if (error) {
        setEqErr(error.message || "Failed to load equipment types.");
      } else {
        setEqTypes(data || []);
      }
      setLoadingEq(false);
    }
    loadEq();
    return () => {
      isMounted = false;
    };
  }, []);

  // When equipment type changes, auto-apply defaults (non-destructive)
  useEffect(() => {
    if (!selectedEq) return;
    // Only set length if user hasn't chosen one yet
    if (!equipmentLengthFeet && selectedEq.default_length_feet) {
      setEquipmentLengthFeet(String(selectedEq.default_length_feet));
    }
    // If selected type requires temp control, lock to true
    if (selectedEq.has_temp_control) {
      setHasTempControl(true);
    }
  }, [selectedEq]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----------------------------- Handlers --------------------------------- */
  function genPayload() {
    // Keep keys snake_case to align with Supabase/Postgres column names
    const payload = {
      reference: reference?.trim() || null,
      origin: origin?.trim() || null,
      destination: destination?.trim() || null,
      pickup_date: pickupDate || null,
      delivery_date: deliveryDate || null,
      notes: notes?.trim() || null,
      rate_total:
        rateTotal !== "" && !Number.isNaN(Number(rateTotal))
          ? Number(rateTotal)
          : null,

      equipment_type_id: equipmentTypeId || null,
      equipment_length_feet:
        equipmentLengthFeet !== "" && !Number.isNaN(Number(equipmentLengthFeet))
          ? Number(equipmentLengthFeet)
          : null,
      has_temp_control: !!hasTempControl,
    };

    // Minimal clean-up: remove undefined values (keep nulls explicit)
    Object.keys(payload).forEach((k) => {
      if (payload[k] === undefined) delete payload[k];
    });

    return payload;
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    const payload = genPayload();

    // Basic front-end checks (donâ€™t be strict; avoid breaking)
    if (!payload.origin || !payload.destination) {
      alert("Please enter Origin and Destination.");
      return;
    }
    if (!payload.equipment_type_id) {
      alert("Please choose an Equipment Type.");
      return;
    }

    setSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit(payload);
      } else {
        // Safe default: no DB writes here to avoid breaking your page.
        console.log("[LoadCreateForm] payload:", payload);
        alert(
          "LoadCreateForm is wired and ready. Hook up onSubmit(payload) in the parent to insert into `loads`."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* ----------------------------- UI Bits ---------------------------------- */
  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[var(--bg-surface,#171c26)] p-4 md:p-6 shadow-lg"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg md:text-xl font-semibold">Create Load</h2>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 hover:bg-white/5"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        ) : null}
      </div>

      {/* Row: Origin / Destination */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
            Origin (City, ST)
          </span>
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
            placeholder="Travis AFB, CA"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
            Destination (City, ST)
          </span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
            placeholder="Dover AFB, DE"
          />
        </label>
      </div>

      {/* Row: Dates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
            Pickup Date
          </span>
          <input
            type="date"
            value={pickupDate}
            onChange={(e) => setPickupDate(e.target.value)}
            className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
            Delivery Date
          </span>
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
          />
        </label>
      </div>

      {/* Row: Reference / Rate */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
            Reference (optional)
          </span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
            placeholder="INV/RC/UUID, etc."
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
            Linehaul Total ($)
          </span>
          <input
            inputMode="decimal"
            value={rateTotal}
            onChange={(e) => setRateTotal(e.target.value)}
            className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
            placeholder="6000"
          />
        </label>
      </div>

      {/* Equipment Section */}
      <div className="mt-6 rounded-2xl border border-white/10 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Equipment</h3>
          {loadingEq ? (
            <span className="inline-flex items-center gap-2 text-sm opacity-80">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loadingâ€¦
            </span>
          ) : eqErr ? (
            <span className="text-sm text-red-400">Error: {eqErr}</span>
          ) : null}
        </div>

        {/* Equipment Type / Length */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
              Equipment Type
            </span>
            <select
              value={equipmentTypeId}
              onChange={(e) => setEquipmentTypeId(e.target.value)}
              className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
            >
              <option value="">Select equipmentâ€¦</option>
              {eqTypes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label} ({e.code})
                </option>
              ))}
            </select>
            {selectedEq?.description ? (
              <span className="text-xs mt-1 opacity-80">
                {selectedEq.description}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-[var(--text-muted,#a2a9b3)]">
              Length (ft)
            </span>
            <input
              inputMode="numeric"
              value={equipmentLengthFeet}
              onChange={(e) => setEquipmentLengthFeet(e.target.value)}
              className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
              placeholder={
                selectedEq?.default_length_feet
                  ? String(selectedEq.default_length_feet)
                  : "e.g., 53"
              }
              disabled={!equipmentTypeId}
            />
            {selectedEq?.allowed_lengths_feet?.length ? (
              <span className="text-xs mt-1 opacity-80">
                Allowed: {selectedEq.allowed_lengths_feet.join(", ")}
              </span>
            ) : null}
          </label>
        </div>

        {/* Temp Control */}
        <div className="mt-4">
          <label className="inline-flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!hasTempControl}
              onChange={(e) => setHasTempControl(e.target.checked)}
              disabled={!!selectedEq?.has_temp_control}
            />
            <span className="text-sm">
              Requires Temperature Control
              {selectedEq?.has_temp_control ? " (locked by equipment type)" : ""}
            </span>
          </label>
        </div>
      </div>

      {/* Notes */}
      <label className="flex flex-col gap-1 mt-6">
        <span className="text-sm text-[var(--text-muted,#a2a9b3)]">Notes</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="rounded-xl border border-white/10 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-white/20"
          placeholder="Special instructions, accessorials, base access, etc."
        />
      </label>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 hover:bg-white/5 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Create Load
        </button>

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 hover:bg-white/5"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}


