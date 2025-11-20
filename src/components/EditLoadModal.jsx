// FILE: src/components/EditLoadModal.jsx
// Purpose:
// - Fast, clean "Edit Load" modal
// - Edits core load fields only (no schema changes)
// - Calls Supabase to update the existing load row
//
// FIXED: Field names now match actual database schema

import { useEffect, useState } from "react";
import { X, Loader2, ChevronDown } from "lucide-react";
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
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 transition-colors hover:bg-white/10 hover:border-white/20"
    >
      {children}
    </button>
  );
}

// Simple options for a status dropdown.
const STATUS_OPTIONS = [
  "AVAILABLE",
  "DISPATCHED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
];

const EQUIPMENT_OPTIONS = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Hotshot",
  "Power Only",
];

export default function EditLoadModal({ load, onClose, onUpdated }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Initialize form from incoming load once
  useEffect(() => {
    if (!load) return;

    setForm({
      // BASIC - Using correct field names from database
      reference: load.reference ?? load.load_number ?? "",
      status: load.status ?? "AVAILABLE",

      // LOCATIONS & SCHEDULE - Using correct field names
      origin_city: load.origin_city ?? "",
      origin_state: load.origin_state ?? "",
      dest_city: load.dest_city ?? load.destination_city ?? "",
      dest_state: load.dest_state ?? load.destination_state ?? "",
      pickup_date: load.pickup_date ?? "",
      pickup_time: load.pickup_time ?? "",
      delivery_date: load.delivery_date ?? "",
      delivery_time: load.delivery_time ?? "",

      // CONTACTS - Using correct field names
      shipper: load.shipper ?? load.shipper_company ?? "",
      broker: load.broker ?? load.broker_customer ?? "",
      shipper_contact_name: load.shipper_contact_name ?? load.shipper_contact ?? "",
      shipper_contact_phone: load.shipper_contact_phone ?? load.shipper_phone ?? "",
      shipper_contact_email: load.shipper_contact_email ?? load.shipper_email ?? "",
      receiver_contact_name: load.receiver_contact_name ?? load.receiver_contact ?? "",
      receiver_contact_phone: load.receiver_contact_phone ?? load.receiver_phone ?? "",
      receiver_contact_email: load.receiver_contact_email ?? load.receiver_email ?? "",

      // DETAILS - Using correct field names
      commodity: load.commodity ?? "",
      equipment_type: load.equipment_type ?? "",
      weight: load.weight ?? load.weight_lbs ?? "",
      pieces: load.pieces ?? "",
      temperature: load.temperature ?? "",
      special_instructions: load.special_instructions ?? "",
      miles: load.miles ?? "",
      rate: load.rate ?? "",
    });
  }, [load]);

  if (!load) return null;
  if (!form) return null;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!load.id) return;

    setSaving(true);
    setError("");

    // Build payload with CORRECT field names matching database schema
    const updatePayload = {
      status: form.status || null,
      reference: form.reference || null,

      // Locations - using correct field names
      origin_city: form.origin_city || null,
      origin_state: form.origin_state || null,
      dest_city: form.dest_city || null,
      dest_state: form.dest_state || null,
      
      pickup_date: form.pickup_date || null,
      pickup_time: form.pickup_time || null,
      delivery_date: form.delivery_date || null,
      delivery_time: form.delivery_time || null,

      // Companies - using correct field names
      shipper: form.shipper || null,
      broker: form.broker || null,
      
      // Contacts - using correct field names
      shipper_contact_name: form.shipper_contact_name || null,
      shipper_contact_phone: form.shipper_contact_phone || null,
      shipper_contact_email: form.shipper_contact_email || null,
      receiver_contact_name: form.receiver_contact_name || null,
      receiver_contact_phone: form.receiver_contact_phone || null,
      receiver_contact_email: form.receiver_contact_email || null,

      // Load details - using correct field names
      commodity: form.commodity || null,
      equipment_type: form.equipment_type || null,
      weight: form.weight && !isNaN(parseFloat(form.weight)) ? parseFloat(form.weight) : null,
      pieces: form.pieces && !isNaN(parseInt(form.pieces)) ? parseInt(form.pieces) : null,
      temperature: form.temperature || null,
      special_instructions: form.special_instructions || null,
      miles: form.miles && !isNaN(parseInt(form.miles)) ? parseInt(form.miles) : null,
      rate: form.rate && !isNaN(parseFloat(form.rate)) ? parseFloat(form.rate) : null,
    };

    // CRITICAL: Convert empty strings to null
    Object.keys(updatePayload).forEach((k) => {
      if (updatePayload[k] === undefined || updatePayload[k] === "") {
        updatePayload[k] = null;
      }
    });

    console.log("[EditLoadModal] Updating load with payload:", updatePayload);

    const { data, error: dbError } = await supabase
      .from("loads")
      .update(updatePayload)
      .eq("id", load.id)
      .select()
      .single();

    setSaving(false);

    if (dbError) {
      console.error("[EditLoadModal] update error:", dbError);
      console.error("[EditLoadModal] Error message:", dbError.message);
      console.error("[EditLoadModal] Error details:", dbError.details);
      console.error("[EditLoadModal] Error hint:", dbError.hint);
      console.error("[EditLoadModal] Payload that failed:", updatePayload);
      setError(dbError.message || "Failed to update load.");
      return;
    }

    console.log("[EditLoadModal] Successfully updated load:", data);

    if (onUpdated) {
      onUpdated(data);
    }

    if (onClose) {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-emerald-400/20 bg-slate-950/95 shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-400/80">
              Edit Load (NEW UI TEST)
            </p>
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold text-slate-50">
                {form.reference || load.id?.slice(0, 6) || "—"}
              </h2>
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-emerald-200">
                {form.status || "AVAILABLE"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {saving && (
              <div className="flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </div>
            )}
            <IconButton title="Close" onClick={onClose}>
              <Ico as={X} />
            </IconButton>
          </div>
        </div>

        {/* Scrollable body */}
        <form
          onSubmit={handleSave}
          className="flex-1 space-y-6 overflow-y-auto px-6 py-5"
        >
          {/* BASIC INFORMATION */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Basic Information
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Load #</label>
                <input
                  type="text"
                  value={form.reference}
                  onChange={(e) =>
                    updateField("reference", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Status</label>
                <div className="relative">
                  <select
                    value={form.status}
                    onChange={(e) => updateField("status", e.target.value)}
                    className="h-9 w-full appearance-none rounded-lg border border-white/10 bg-slate-900/70 px-3 pr-8 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-1">
                <label className="text-xs text-slate-400">
                  Shipper Company
                </label>
                <input
                  type="text"
                  value={form.shipper}
                  onChange={(e) =>
                    updateField("shipper", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>

              <div className="space-y-1.5 md:col-span-1">
                <label className="text-xs text-slate-400">
                  Broker / Customer
                </label>
                <input
                  type="text"
                  value={form.broker}
                  onChange={(e) =>
                    updateField("broker", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          </section>

          {/* LOCATIONS & SCHEDULE */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Locations &amp; Schedule
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              {/* ORIGIN */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs text-slate-400">Origin</label>
                <div className="grid grid-cols-[2fr,1fr] gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={form.origin_city}
                    onChange={(e) =>
                      updateField("origin_city", e.target.value)
                    }
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                  <input
                    type="text"
                    placeholder="State"
                    maxLength={2}
                    value={form.origin_state}
                    onChange={(e) =>
                      updateField("origin_state", e.target.value.toUpperCase())
                    }
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 uppercase outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                </div>
              </div>

              {/* DESTINATION */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs text-slate-400">Destination</label>
                <div className="grid grid-cols-[2fr,1fr] gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={form.dest_city}
                    onChange={(e) =>
                      updateField("dest_city", e.target.value)
                    }
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                  <input
                    type="text"
                    placeholder="State"
                    maxLength={2}
                    value={form.dest_state}
                    onChange={(e) =>
                      updateField("dest_state", e.target.value.toUpperCase())
                    }
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 uppercase outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-4">
              {/* PICKUP DATE/TIME */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Pickup Date</label>
                <input
                  type="date"
                  value={form.pickup_date || ""}
                  onChange={(e) => updateField("pickup_date", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Pickup Time</label>
                <input
                  type="time"
                  value={form.pickup_time || ""}
                  onChange={(e) => updateField("pickup_time", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>

              {/* DELIVERY DATE/TIME */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Delivery Date</label>
                <input
                  type="date"
                  value={form.delivery_date || ""}
                  onChange={(e) =>
                    updateField("delivery_date", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Delivery Time</label>
                <input
                  type="time"
                  value={form.delivery_time || ""}
                  onChange={(e) =>
                    updateField("delivery_time", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          </section>

          {/* CONTACT INFORMATION */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Contact Information
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              {/* Shipper contact */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Shipper Contact</label>
                <input
                  type="text"
                  value={form.shipper_contact_name}
                  onChange={(e) =>
                    updateField("shipper_contact_name", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Shipper Phone</label>
                <input
                  type="text"
                  value={form.shipper_contact_phone}
                  onChange={(e) =>
                    updateField("shipper_contact_phone", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Shipper Email</label>
                <input
                  type="email"
                  value={form.shipper_contact_email}
                  onChange={(e) =>
                    updateField("shipper_contact_email", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-3">
              {/* Receiver contact */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">
                  Receiver Contact
                </label>
                <input
                  type="text"
                  value={form.receiver_contact_name}
                  onChange={(e) =>
                    updateField("receiver_contact_name", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Receiver Phone</label>
                <input
                  type="text"
                  value={form.receiver_contact_phone}
                  onChange={(e) =>
                    updateField("receiver_contact_phone", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Receiver Email</label>
                <input
                  type="email"
                  value={form.receiver_contact_email}
                  onChange={(e) =>
                    updateField("receiver_contact_email", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          </section>

          {/* LOAD DETAILS */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Load Details
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs text-slate-400">Commodity</label>
                <input
                  type="text"
                  value={form.commodity}
                  onChange={(e) => updateField("commodity", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Equipment Type</label>
                <div className="relative">
                  <select
                    value={form.equipment_type}
                    onChange={(e) =>
                      updateField("equipment_type", e.target.value)
                    }
                    className="h-9 w-full appearance-none rounded-lg border border-white/10 bg-slate-900/70 px-3 pr-8 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  >
                    <option value="">Select equipment</option>
                    {EQUIPMENT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Weight (lbs)</label>
                <input
                  type="number"
                  value={form.weight}
                  onChange={(e) =>
                    updateField("weight", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Pieces / Pallets</label>
                <input
                  type="number"
                  value={form.pieces}
                  onChange={(e) => updateField("pieces", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Temperature</label>
                <input
                  type="text"
                  placeholder="e.g. 35°F"
                  value={form.temperature}
                  onChange={(e) =>
                    updateField("temperature", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Miles</label>
                <input
                  type="number"
                  value={form.miles}
                  onChange={(e) => updateField("miles", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Rate ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => updateField("rate", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1.5 block text-xs text-slate-400">
                Special Instructions
              </label>
              <textarea
                rows={4}
                value={form.special_instructions}
                onChange={(e) =>
                  updateField("special_instructions", e.target.value)
                }
                className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
              />
            </div>
          </section>

          {/* Error message */}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              {error}
            </div>
          )}
        </form>

        {/* Footer buttons */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cx(
              "inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{saving ? "Updating…" : "Update Load"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}