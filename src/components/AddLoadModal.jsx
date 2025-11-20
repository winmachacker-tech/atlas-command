// FILE: src/components/AddLoadModal.jsx
// Purpose:
// - Fast, clean "Add Load" modal
// - Optional OCR upload to auto-fill key fields from a rate confirmation
// - Inserts a new row into `loads` via Supabase
//
// Notes:
// - Relies on RLS / current_org_id() on the backend (no org_id set here)
// - Parent can pass: { open?, isOpen?, onClose, onCreated?, onSaved? }
// - Does NOT touch any RLS / security, only a normal insert.

import { useEffect, useState } from "react";
import { X, Loader2, Plus, ChevronDown, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { extractRateConfirmationData } from "../utils/bolOcrParser";

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
// Adjust values to match your `loads.status` enum/text.
const STATUS_OPTIONS = ["AVAILABLE", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

const EQUIPMENT_OPTIONS = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Hotshot",
  "Power Only",
];

// Map OCR equipment codes (DRY_VAN, REEFER, STEP_DECK, etc.) to UI labels
function mapEquipmentFromOcr(codeOrLabel) {
  if (!codeOrLabel) return "";
  const raw = String(codeOrLabel).toUpperCase();

  if (raw.includes("DRY") && raw.includes("VAN")) return "Dry Van";
  if (raw.includes("REEFER") || raw.includes("REFRIG")) return "Reefer";
  if (raw.includes("FLATBED")) return "Flatbed";
  if (raw.includes("STEP") && raw.includes("DECK")) return "Step Deck";
  if (raw.includes("HOTSHOT")) return "Hotshot";
  if (raw.includes("POWER")) return "Power Only";

  // Fall back to original if it already matches one of our options
  if (EQUIPMENT_OPTIONS.includes(codeOrLabel)) return codeOrLabel;

  return "";
}

// Parse "City, ST" into { city, state }
function parseCityState(value) {
  if (!value) return { city: "", state: "" };
  const parts = String(value)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const city = parts[0] || "";
  const state = (parts[1] || "").slice(0, 2).toUpperCase();
  return { city, state };
}

// Basic initial form state for a brand new load
const EMPTY_FORM = {
  // BASIC
  reference_number: "",
  status: "AVAILABLE",

  // HIGH-LEVEL LANE TEXT (maps to loads.origin / loads.destination)
  origin: "",
  destination: "",

  // LOCATIONS & SCHEDULE (more structured)
  origin_city: "",
  origin_state: "",
  destination_city: "",
  destination_state: "",
  pickup_date: "",
  pickup_time: "",
  delivery_date: "",
  delivery_time: "",

  // CONTACTS
  shipper_company: "",
  broker_customer: "",
  shipper_contact: "",
  shipper_phone: "",
  shipper_email: "",
  receiver_contact: "",
  receiver_phone: "",
  receiver_email: "",

  // DETAILS
  commodity: "",
  equipment_type: "",
  weight_lbs: "",
  pieces: "",
  temperature: "",
  special_instructions: "",
  miles: "",
  rate: "",
};

export default function AddLoadModal(props) {
  const { open, isOpen, onClose, onCreated, onSaved, initialData } = props;

  // Support both `open` and `isOpen` to be flexible with parent usage
  const isVisible = (open ?? isOpen ?? false) === true;

  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ...(initialData || {}),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrInfo, setOcrInfo] = useState("");

  // When the modal opens with different initialData, reset the form
  useEffect(() => {
    if (!isVisible) return;
    setForm((prev) => ({
      ...EMPTY_FORM,
      ...(initialData || {}),
    }));
    setError("");
    setOcrInfo("");
  }, [isVisible, initialData]);

  if (!isVisible) return null;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleOcrFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setOcrInfo("");
    setError("");

    try {
      const extracted = await extractRateConfirmationData(file);

      console.log("[AddLoadModal] OCR extracted data:", extracted);

      // Safely pull nested address info if present
      const pickupAddr = extracted?.pickup_address || {};
      const deliveryAddr = extracted?.delivery_address || {};

      // Derive origin city/state:
      // 1) explicit origin_city / origin_state
      // 2) pickup_address.city/state
      // 3) parse "origin" string ("City, ST")
      const fromOriginString = parseCityState(extracted.origin);
      let originCity =
        extracted.origin_city || pickupAddr.city || fromOriginString.city;
      let originState =
        extracted.origin_state || pickupAddr.state || fromOriginString.state;

      // Derive destination city/state
      const fromDestString = parseCityState(extracted.destination);
      let destinationCity =
        extracted.destination_city ||
        deliveryAddr.city ||
        fromDestString.city;
      let destinationState =
        extracted.destination_state ||
        deliveryAddr.state ||
        fromDestString.state;

      // Build full address strings for loads.origin / loads.destination
      const pickupFull =
        extracted.pickup_address_full ||
        [
          pickupAddr.company_name,
          pickupAddr.address_line1,
          pickupAddr.address_line2,
          [originCity, originState].filter(Boolean).join(", "),
          pickupAddr.postal_code,
        ]
          .filter(Boolean)
          .join(", ") ||
        [originCity, originState].filter(Boolean).join(", ");

      const deliveryFull =
        extracted.delivery_address_full ||
        [
          deliveryAddr.company_name,
          deliveryAddr.address_line1,
          deliveryAddr.address_line2,
          [destinationCity, destinationState].filter(Boolean).join(", "),
          deliveryAddr.postal_code,
        ]
          .filter(Boolean)
          .join(", ") ||
        [destinationCity, destinationState].filter(Boolean).join(", ");

      const merged = { ...form };

      // Reference / load number
      if (
        extracted.reference_number ||
        extracted.load_number ||
        extracted.reference
      ) {
        merged.reference_number =
          extracted.reference_number ||
          extracted.load_number ||
          extracted.reference;
      }

      // HIGH-LEVEL ORIGIN / DESTINATION TEXT (used by loads.origin / loads.destination)
      if (pickupFull) merged.origin = pickupFull;
      if (deliveryFull) merged.destination = deliveryFull;

      // LOCATIONS (structured city/state)
      if (originCity) merged.origin_city = originCity;
      if (originState) merged.origin_state = originState;
      if (destinationCity) merged.destination_city = destinationCity;
      if (destinationState) merged.destination_state = destinationState;

      // DATES & TIMES
      if (extracted.pickup_date) merged.pickup_date = extracted.pickup_date;
      if (extracted.pickup_time) merged.pickup_time = extracted.pickup_time;
      if (extracted.delivery_date) merged.delivery_date = extracted.delivery_date;
      if (extracted.delivery_time) merged.delivery_time = extracted.delivery_time;

      // CONTACTS & COMPANIES
      if (extracted.shipper_company || extracted.shipper || pickupAddr.company_name) {
        merged.shipper_company =
          extracted.shipper_company || extracted.shipper || pickupAddr.company_name;
      }
      if (extracted.broker_customer || extracted.broker_name || extracted.broker) {
        merged.broker_customer =
          extracted.broker_customer || extracted.broker_name || extracted.broker;
      }

      if (extracted.shipper_contact_name) {
        merged.shipper_contact = extracted.shipper_contact_name;
      }
      if (extracted.shipper_contact_phone) {
        merged.shipper_phone = extracted.shipper_contact_phone;
      }
      if (extracted.shipper_contact_email) {
        merged.shipper_email = extracted.shipper_contact_email;
      }

      if (extracted.receiver_contact_name) {
        merged.receiver_contact = extracted.receiver_contact_name;
      }
      if (extracted.receiver_contact_phone) {
        merged.receiver_phone = extracted.receiver_contact_phone;
      }
      if (extracted.receiver_contact_email) {
        merged.receiver_email = extracted.receiver_email;
      }

      // DETAILS
      if (extracted.commodity) merged.commodity = extracted.commodity;
      if (extracted.equipment_type) {
        merged.equipment_type = mapEquipmentFromOcr(extracted.equipment_type);
      }

      if (extracted.weight_lbs || extracted.weight) {
        merged.weight_lbs = String(
          extracted.weight_lbs ?? extracted.weight ?? ""
        );
      }
      if (extracted.pieces || extracted.pallets) {
        merged.pieces = String(extracted.pieces ?? extracted.pallets ?? "");
      }
      if (extracted.temperature) {
        merged.temperature = String(extracted.temperature);
      }
      if (extracted.special_instructions) {
        merged.special_instructions = extracted.special_instructions;
      }
      if (extracted.miles) merged.miles = String(extracted.miles);
      if (extracted.rate || extracted.total_rate || extracted.line_haul) {
        merged.rate = String(
          extracted.rate ?? extracted.total_rate ?? extracted.line_haul ?? ""
        );
      }

      console.log("[AddLoadModal] Merged form data:", merged);

      setForm(merged);
      setOcrInfo("Rate confirmation parsed. Fields auto-filled where possible.");
    } catch (err) {
      console.error("[AddLoadModal] OCR error:", err);
      setError(
        "Could not parse rate confirmation. You can still enter fields manually."
      );
    } finally {
      setOcrLoading(false);
      // Reset the input so uploading the same file again re-triggers change
      event.target.value = "";
    }
  }

  async function handleSave(e) {
    if (e) e.preventDefault();
    setSaving(true);
    setError("");

    // Derive origin/destination text if user didn't override:
    const originText =
      form.origin ||
      (form.origin_city && form.origin_state
        ? `${form.origin_city}, ${form.origin_state}`
        : null);

    const destinationText =
      form.destination ||
      (form.destination_city && form.destination_state
        ? `${form.destination_city}, ${form.destination_state}`
        : null);

    // Build payload with CORRECT database column names
    const payload = {
      status: form.status || "AVAILABLE",
      reference: form.reference_number || null,

      // High-level lane fields used across Atlas
      origin: originText,
      destination: destinationText,

      // Structured city/state - FIXED TO MATCH DATABASE COLUMNS
      origin_city: form.origin_city || null,
      origin_state: form.origin_state || null,
      dest_city: form.destination_city || null,        // Database column is dest_city
      dest_state: form.destination_state || null,      // Database column is dest_state
      
      pickup_date: form.pickup_date || null,
      pickup_time: form.pickup_time || null,
      delivery_date: form.delivery_date || null,
      delivery_time: form.delivery_time || null,

      // Company fields - FIXED TO MATCH DATABASE COLUMNS
      shipper: form.shipper_company || null,           // Database column is shipper
      shipper_name: form.shipper_company || null,      // Also set shipper_name
      broker: form.broker_customer || null,            // Database column is broker
      broker_name: form.broker_customer || null,       // Also set broker_name
      
      // Contact fields
      shipper_contact_name: form.shipper_contact || null,
      shipper_contact_phone: form.shipper_phone || null,
      shipper_contact_email: form.shipper_email || null,
      receiver_contact_name: form.receiver_contact || null,
      receiver_contact_phone: form.receiver_phone || null,
      receiver_contact_email: form.receiver_email || null,

      // Load details
      commodity: form.commodity || null,
      equipment_type: form.equipment_type || null,
      weight: form.weight_lbs === "" ? null : Number(form.weight_lbs),  // Database column is weight
      pieces: form.pieces === "" ? null : Number(form.pieces),
      temperature: form.temperature || null,
      special_instructions: form.special_instructions || null,
      miles: form.miles === "" ? null : Number(form.miles),
      rate: form.rate === "" ? null : Number(form.rate),
    };

    // Remove undefined so we don't send junk
    Object.keys(payload).forEach((k) => {
      if (payload[k] === undefined) delete payload[k];
    });

    console.log("[AddLoadModal] Saving payload:", payload);

    const { data, error: dbError } = await supabase
      .from("loads")
      .insert(payload)
      .select()
      .single();

    setSaving(false);

    if (dbError) {
      console.error("[AddLoadModal] insert error:", dbError);
      setError(dbError.message || "Failed to create load.");
      return;
    }

    console.log("[AddLoadModal] Successfully created load:", data);

    // Notify parent
    if (onCreated) onCreated(data);
    if (onSaved) onSaved(data);

    if (onClose) onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-emerald-400/20 bg-slate-950/95 shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-400/80">
              New Load
            </p>
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold text-slate-50">
                {form.reference_number || "Create Load"}
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
          {/* OCR SECTION */}
          <section className="rounded-xl border border-emerald-400/20 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                  Rate Confirmation OCR
                </h3>
                <p className="mt-1 text-xs text-slate-300/80">
                  Upload a PDF or image of a rate confirmation and Atlas will
                  pre-fill as many fields as it can. You can still adjust
                  everything manually.
                </p>
                {ocrInfo && (
                  <p className="mt-2 text-[11px] text-emerald-300">{ocrInfo}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/20">
                  {ocrLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Processing…</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload Rate Confirmation</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={handleOcrFileChange}
                    disabled={ocrLoading}
                  />
                </label>
              </div>
            </div>
          </section>

          {/* BASIC INFORMATION */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Basic Information
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Load # / Ref</label>
                <input
                  type="text"
                  value={form.reference_number}
                  onChange={(e) =>
                    updateField("reference_number", e.target.value)
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
                  value={form.shipper_company}
                  onChange={(e) =>
                    updateField("shipper_company", e.target.value)
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
                  value={form.broker_customer}
                  onChange={(e) =>
                    updateField("broker_customer", e.target.value)
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

            {/* High-level origin/destination single-line (optional for you in future UI) */}
            {/* For now we just show the structured City/State fields that were already here */}

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
                    value={form.origin_state}
                    onChange={(e) =>
                      updateField("origin_state", e.target.value)
                    }
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
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
                    value={form.destination_city}
                    onChange={(e) =>
                      updateField("destination_city", e.target.value)
                    }
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                  <input
                    type="text"
                    placeholder="State"
                    value={form.destination_state}
                    onChange={(e) =>
                      updateField("destination_state", e.target.value)
                    }
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
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
                  value={form.shipper_contact}
                  onChange={(e) =>
                    updateField("shipper_contact", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Shipper Phone</label>
                <input
                  type="text"
                  value={form.shipper_phone}
                  onChange={(e) =>
                    updateField("shipper_phone", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Shipper Email</label>
                <input
                  type="email"
                  value={form.shipper_email}
                  onChange={(e) =>
                    updateField("shipper_email", e.target.value)
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
                  value={form.receiver_contact}
                  onChange={(e) =>
                    updateField("receiver_contact", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Receiver Phone</label>
                <input
                  type="text"
                  value={form.receiver_phone}
                  onChange={(e) =>
                    updateField("receiver_phone", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Receiver Email</label>
                <input
                  type="email"
                  value={form.receiver_email}
                  onChange={(e) =>
                    updateField("receiver_email", e.target.value)
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
                  value={form.weight_lbs}
                  onChange={(e) =>
                    updateField("weight_lbs", e.target.value)
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">
                  Pieces / Pallets
                </label>
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
            type="submit"
            form=""
            onClick={handleSave}
            disabled={saving}
            className={cx(
              "inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Plus className="h-3.5 w-3.5" />
            <span>{saving ? "Creating…" : "Create Load"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}