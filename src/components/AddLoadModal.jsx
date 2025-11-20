// FILE: src/components/AddLoadModal.jsx
// Purpose: Comprehensive manual load creation form with ALL database fields
// Enhanced with:
//  - Full address fields (for driver GPS navigation)
//  - City/State fields (for mileage calculation)
//  - Smart auto-extraction (parse city/state from full address)
//  - Optional mile calculation via Google Maps
//  - Auto-RPM calculation
//  - ENHANCED: Better fallback for city/state extraction from full addresses

import { useEffect, useState } from "react";
import { X, Loader2, Plus, ChevronDown, Upload, MapPin, Info } from "lucide-react";
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

function Tooltip({ text }) {
  return (
    <div className="group relative inline-flex">
      <Info className="h-3.5 w-3.5 text-slate-500 hover:text-slate-300 cursor-help" />
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden w-48 -translate-x-1/2 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 shadow-lg group-hover:block">
        {text}
        <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
      </div>
    </div>
  );
}

const STATUS_OPTIONS = ["AVAILABLE", "IN_TRANSIT", "DELIVERED", "CANCELLED", "AT_RISK", "PROBLEM"];

const EQUIPMENT_OPTIONS = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Hotshot",
  "Power Only",
];

function mapEquipmentFromOcr(codeOrLabel) {
  if (!codeOrLabel) return "";
  const raw = String(codeOrLabel).toUpperCase();
  if (raw.includes("DRY") && raw.includes("VAN")) return "Dry Van";
  if (raw.includes("REEFER") || raw.includes("REFRIG")) return "Reefer";
  if (raw.includes("FLATBED")) return "Flatbed";
  if (raw.includes("STEP") && raw.includes("DECK")) return "Step Deck";
  if (raw.includes("HOTSHOT")) return "Hotshot";
  if (raw.includes("POWER")) return "Power Only";
  if (EQUIPMENT_OPTIONS.includes(codeOrLabel)) return codeOrLabel;
  return "";
}

// Smart address parser - extracts city and state from full address
function parseAddressForCityState(fullAddress) {
  if (!fullAddress || typeof fullAddress !== 'string') {
    return { city: "", state: "" };
  }

  // Try to extract city and state from common address formats:
  // "1234 Main St, Los Angeles, CA 90001"
  // "ABC Warehouse, 1234 Industry Blvd, Los Angeles, CA 90001"
  // "Los Angeles, CA"
  // "200 N McCarran Blvd, Reno, NV 89502"
  
  const parts = fullAddress.split(',').map(p => p.trim()).filter(Boolean);
  
  if (parts.length === 0) return { city: "", state: "" };
  
  // Last part usually contains state and zip: "CA 90001" or just "CA" or "NV 89502"
  const lastPart = parts[parts.length - 1];
  const stateMatch = lastPart.match(/\b([A-Z]{2})\b/); // Match 2-letter state code
  
  // Second to last part is usually the city
  const city = parts.length >= 2 ? parts[parts.length - 2] : "";
  const state = stateMatch ? stateMatch[1] : "";
  
  console.log(`[parseAddressForCityState] Input: "${fullAddress}" -> city: "${city}", state: "${state}"`);
  
  return { city, state };
}

function parseCityState(value) {
  if (!value) return { city: "", state: "" };
  const parts = String(value).split(",").map((p) => p.trim()).filter(Boolean);
  const city = parts[0] || "";
  const state = (parts[1] || "").slice(0, 2).toUpperCase();
  return { city, state };
}

// Complete form state matching ALL database columns
const EMPTY_FORM = {
  // IDENTIFIERS & REFERENCES
  reference: "",
  load_number: "",
  bol_number: "",
  pro_number: "",
  po_number: "",
  customer_reference: "",
  ref_no: "",
  
  // STATUS
  status: "AVAILABLE",
  
  // COMPANIES
  shipper: "",
  shipper_name: "",
  customer: "",
  broker: "",
  broker_name: "",
  consignee_name: "",
  
  // LOCATIONS - FULL ADDRESSES (for driver GPS)
  origin: "",
  destination: "",
  
  // LOCATIONS - CITY/STATE (for mileage calculation)
  origin_city: "",
  origin_state: "",
  dest_city: "",
  dest_state: "",
  
  // SCHEDULE
  pickup_date: "",
  pickup_time: "",
  delivery_date: "",
  delivery_time: "",
  
  // CONTACTS - SHIPPER
  shipper_contact_name: "",
  shipper_contact_phone: "",
  shipper_contact_email: "",
  
  // CONTACTS - RECEIVER
  receiver_contact_name: "",
  receiver_contact_phone: "",
  receiver_contact_email: "",
  
  // LOAD DETAILS
  commodity: "",
  weight: "",
  pieces: "",
  temperature: "",
  special_instructions: "",
  
  // EQUIPMENT
  equipment_type: "",
  equipment_length_feet: "",
  has_temp_control: false,
  
  // DRIVER & TRUCK
  driver_name: "",
  truck_number: "",
  trailer_number: "",
  
  // DISPATCH
  dispatcher: "",
  dispatcher_name: "",
  
  // FINANCIAL
  rate: "",
  rate_per_mile: "",
  fuel_surcharge: "",
  detention_charges: "",
  accessorial_charges: "",
  miles: "",
  
  // NOTES
  notes: "",
};


export default function AddLoadModal(props) {
  const { open, isOpen, onClose, onCreated, onSaved, onAdded, initialData } = props;
  const isVisible = (open ?? isOpen ?? false) === true;

  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ...(initialData || {}),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrInfo, setOcrInfo] = useState("");
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState("");

  useEffect(() => {
    if (!isVisible) return;
    setForm(() => ({
      ...EMPTY_FORM,
      ...(initialData || {}),
    }));
    setError("");
    setOcrInfo("");
    setCalcError("");
  }, [isVisible, initialData]);

  // AUTO-CALCULATE RPM when rate or miles change
  useEffect(() => {
    const rate = parseFloat(form.rate);
    const miles = parseFloat(form.miles);
    
    if (!isNaN(rate) && !isNaN(miles) && miles > 0 && rate > 0) {
      const rpm = rate / miles;
      // Only update if significantly different (avoid infinite loops from rounding)
      const currentRpm = parseFloat(form.rate_per_mile);
      if (isNaN(currentRpm) || Math.abs(currentRpm - rpm) > 0.001) {
        setForm(prev => ({ ...prev, rate_per_mile: rpm.toFixed(2) }));
      }
    }
  }, [form.rate, form.miles]);

  if (!isVisible) return null;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Handle origin full address change - auto-extract city/state
  function handleOriginAddressChange(value) {
    setForm(prev => ({ ...prev, origin: value }));
    
    // Auto-extract city and state if possible
    const { city, state } = parseAddressForCityState(value);
    if (city && state) {
      setForm(prev => ({
        ...prev,
        origin_city: city,
        origin_state: state
      }));
    }
  }

  // Handle destination full address change - auto-extract city/state
  function handleDestinationAddressChange(value) {
    setForm(prev => ({ ...prev, destination: value }));
    
    // Auto-extract city and state if possible
    const { city, state } = parseAddressForCityState(value);
    if (city && state) {
      setForm(prev => ({
        ...prev,
        dest_city: city,
        dest_state: state
      }));
    }
  }

  // CALCULATE MILES using Google Maps Directions API
  async function handleCalculateMiles() {
    setIsCalculating(true);
    setCalcError("");

    try {
      // Build origin and destination strings from CITY + STATE
      const originStr = form.origin_city && form.origin_state 
        ? `${form.origin_city}, ${form.origin_state}` 
        : null;
      const destStr = form.dest_city && form.dest_state 
        ? `${form.dest_city}, ${form.dest_state}` 
        : null;

      if (!originStr || !destStr) {
        setCalcError("Need city and state for both locations");
        setIsCalculating(false);
        return;
      }

      console.log("[AddLoadModal] Calculating miles:", { origin: originStr, destination: destStr });

      // Call Google Maps Directions API via Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('calculate-miles', {
        body: { origin: originStr, destination: destStr }
      });

      if (error) throw error;

      if (data?.miles) {
        console.log("[AddLoadModal] Miles calculated:", data.miles);
        setForm(prev => ({ ...prev, miles: String(data.miles) }));
        setCalcError("");
      } else {
        throw new Error("No miles data returned");
      }

    } catch (err) {
      console.error("[AddLoadModal] Mile calculation error:", err);
      setCalcError("Could not calculate miles");
      // Don't block - user can still enter manually
    } finally {
      setIsCalculating(false);
    }
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

      const pickupAddr = extracted?.pickup_address || {};
      const deliveryAddr = extracted?.delivery_address || {};

      const fromOriginString = parseCityState(extracted.origin);
      let originCity = extracted.origin_city || pickupAddr.city || fromOriginString.city;
      let originState = extracted.origin_state || pickupAddr.state || fromOriginString.state;

      // ENHANCED: If still no city/state, try parsing from pickup_address_full
      if ((!originCity || !originState) && extracted.pickup_address_full) {
        console.log("[AddLoadModal] Fallback: parsing pickup city/state from pickup_address_full");
        const parsed = parseAddressForCityState(extracted.pickup_address_full);
        if (parsed.city && !originCity) originCity = parsed.city;
        if (parsed.state && !originState) originState = parsed.state;
      }

      const fromDestString = parseCityState(extracted.destination);
      let destCity = extracted.dest_city || extracted.destination_city || deliveryAddr.city || fromDestString.city;
      let destState = extracted.dest_state || extracted.destination_state || deliveryAddr.state || fromDestString.state;

      // ENHANCED: If still no city/state, try parsing from delivery_address_full
      if ((!destCity || !destState) && extracted.delivery_address_full) {
        console.log("[AddLoadModal] Fallback: parsing delivery city/state from delivery_address_full");
        const parsed = parseAddressForCityState(extracted.delivery_address_full);
        if (parsed.city && !destCity) destCity = parsed.city;
        if (parsed.state && !destState) destState = parsed.state;
      }

      const pickupFull =
        extracted.pickup_address_full ||
        [pickupAddr.company_name, pickupAddr.address_line1, pickupAddr.address_line2, [originCity, originState].filter(Boolean).join(", "), pickupAddr.postal_code]
          .filter(Boolean).join(", ") ||
        [originCity, originState].filter(Boolean).join(", ");

      const deliveryFull =
        extracted.delivery_address_full ||
        [deliveryAddr.company_name, deliveryAddr.address_line1, deliveryAddr.address_line2, [destCity, destState].filter(Boolean).join(", "), deliveryAddr.postal_code]
          .filter(Boolean).join(", ") ||
        [destCity, destState].filter(Boolean).join(", ");

      const merged = { ...form };

      // IDENTIFIERS
      if (extracted.reference_number || extracted.load_number || extracted.reference) {
        merged.reference = extracted.reference_number || extracted.load_number || extracted.reference;
      }
      if (extracted.load_number) merged.load_number = extracted.load_number;
      if (extracted.bol_number) merged.bol_number = extracted.bol_number;
      if (extracted.pro_number) merged.pro_number = extracted.pro_number;
      if (extracted.po_number) merged.po_number = extracted.po_number;

      // LOCATIONS - FULL ADDRESSES
      if (pickupFull) merged.origin = pickupFull;
      if (deliveryFull) merged.destination = deliveryFull;
      
      // LOCATIONS - CITY/STATE
      if (originCity) merged.origin_city = originCity;
      if (originState) merged.origin_state = originState;
      if (destCity) merged.dest_city = destCity;
      if (destState) merged.dest_state = destState;

      // DATES & TIMES
      if (extracted.pickup_date) merged.pickup_date = extracted.pickup_date;
      if (extracted.pickup_time) merged.pickup_time = extracted.pickup_time;
      if (extracted.delivery_date) merged.delivery_date = extracted.delivery_date;
      if (extracted.delivery_time) merged.delivery_time = extracted.delivery_time;

      // COMPANIES
      if (extracted.shipper_company || extracted.shipper || pickupAddr.company_name) {
        merged.shipper = extracted.shipper_company || extracted.shipper || pickupAddr.company_name;
        merged.shipper_name = extracted.shipper_company || extracted.shipper || pickupAddr.company_name;
      }
      if (extracted.broker_customer || extracted.broker_name || extracted.broker) {
        merged.broker = extracted.broker_customer || extracted.broker_name || extracted.broker;
        merged.broker_name = extracted.broker_customer || extracted.broker_name || extracted.broker;
      }
      if (extracted.customer) merged.customer = extracted.customer;

      // CONTACTS
      if (extracted.shipper_contact_name) merged.shipper_contact_name = extracted.shipper_contact_name;
      if (extracted.shipper_contact_phone) merged.shipper_contact_phone = extracted.shipper_contact_phone;
      if (extracted.shipper_contact_email) merged.shipper_contact_email = extracted.shipper_contact_email;
      if (extracted.receiver_contact_name) merged.receiver_contact_name = extracted.receiver_contact_name;
      if (extracted.receiver_contact_phone) merged.receiver_contact_phone = extracted.receiver_contact_phone;
      if (extracted.receiver_contact_email) merged.receiver_contact_email = extracted.receiver_email;

      // LOAD DETAILS
      if (extracted.commodity) merged.commodity = extracted.commodity;
      if (extracted.equipment_type) {
        merged.equipment_type = mapEquipmentFromOcr(extracted.equipment_type);
      }
      if (extracted.weight_lbs || extracted.weight) {
        merged.weight = String(extracted.weight_lbs ?? extracted.weight ?? "");
      }
      if (extracted.pieces || extracted.pallets) {
        merged.pieces = String(extracted.pieces ?? extracted.pallets ?? "");
      }
      if (extracted.temperature) merged.temperature = String(extracted.temperature);
      if (extracted.special_instructions) merged.special_instructions = extracted.special_instructions;
      if (extracted.miles) merged.miles = String(extracted.miles);
      
      // FINANCIAL
      if (extracted.rate || extracted.total_rate || extracted.line_haul) {
        merged.rate = String(extracted.rate ?? extracted.total_rate ?? extracted.line_haul ?? "");
      }

      console.log("[AddLoadModal] Merged form data:", merged);
      console.log("[AddLoadModal] Final city/state values:", {
        origin_city: merged.origin_city,
        origin_state: merged.origin_state,
        dest_city: merged.dest_city,
        dest_state: merged.dest_state,
      });
      
      setForm(merged);
      setOcrInfo("Rate confirmation parsed. Fields auto-filled where possible.");
    } catch (err) {
      console.error("[AddLoadModal] OCR error:", err);
      setError("Could not parse rate confirmation. You can still enter fields manually.");
    } finally {
      setOcrLoading(false);
      event.target.value = "";
    }
  }

  async function handleSave(e) {
    if (e) e.preventDefault();
    setSaving(true);
    setError("");

    // Build origin/destination strings from full address OR city+state
    const originText = form.origin || (form.origin_city && form.origin_state ? `${form.origin_city}, ${form.origin_state}` : null);
    const destinationText = form.destination || (form.dest_city && form.dest_state ? `${form.dest_city}, ${form.dest_state}` : null);

    // Build complete payload matching database schema
    const payload = {
      // IDENTIFIERS
      reference: form.reference || null,
      load_number: form.load_number || null,
      bol_number: form.bol_number || null,
      pro_number: form.pro_number || null,
      po_number: form.po_number || null,
      customer_reference: form.customer_reference || null,
      ref_no: form.ref_no || null,
      
      // STATUS
      status: form.status || "AVAILABLE",
      
      // COMPANIES (shipper is required by DB)
      shipper: form.shipper || "Unknown Shipper",
      shipper_name: form.shipper_name || form.shipper || null,
      customer: form.customer || null,
      broker: form.broker || null,
      broker_name: form.broker_name || form.broker || null,
      consignee_name: form.consignee_name || null,
      
      // LOCATIONS (origin & destination are required by DB)
      origin: originText || "Unknown Origin",
      destination: destinationText || "Unknown Destination",
      origin_city: form.origin_city || null,
      origin_state: form.origin_state || null,
      dest_city: form.dest_city || null,
      dest_state: form.dest_state || null,
      
      // SCHEDULE
      pickup_date: form.pickup_date || null,
      pickup_time: form.pickup_time || null,
      delivery_date: form.delivery_date || null,
      delivery_time: form.delivery_time || null,
      
      // CONTACTS
      shipper_contact_name: form.shipper_contact_name || null,
      shipper_contact_phone: form.shipper_contact_phone || null,
      shipper_contact_email: form.shipper_contact_email || null,
      receiver_contact_name: form.receiver_contact_name || null,
      receiver_contact_phone: form.receiver_contact_phone || null,
      receiver_contact_email: form.receiver_contact_email || null,
      
      // LOAD DETAILS
      commodity: form.commodity || null,
      weight: form.weight === "" ? null : Number(form.weight),
      pieces: form.pieces === "" ? null : Number(form.pieces),
      temperature: form.temperature || null,
      special_instructions: form.special_instructions || null,
      
      // EQUIPMENT
      equipment_type: form.equipment_type || null,
      equipment_length_feet: form.equipment_length_feet === "" ? null : Number(form.equipment_length_feet),
      has_temp_control: form.has_temp_control || null,
      
      // DRIVER & TRUCK
      driver_name: form.driver_name || null,
      truck_number: form.truck_number || null,
      trailer_number: form.trailer_number || null,
      
      // DISPATCH
      dispatcher: form.dispatcher || null,
      dispatcher_name: form.dispatcher_name || form.dispatcher || null,
      
      // FINANCIAL
      rate: form.rate === "" ? null : Number(form.rate),
      rate_per_mile: form.rate_per_mile === "" ? null : Number(form.rate_per_mile),
      fuel_surcharge: form.fuel_surcharge === "" ? null : Number(form.fuel_surcharge),
      detention_charges: form.detention_charges === "" ? null : Number(form.detention_charges),
      accessorial_charges: form.accessorial_charges === "" ? null : Number(form.accessorial_charges),
      miles: form.miles === "" ? null : Number(form.miles),
      
      // NOTES
      notes: form.notes || null,
    };

    // Remove undefined values
    Object.keys(payload).forEach((k) => {
      if (payload[k] === undefined) delete payload[k];
    });

    console.log("[AddLoadModal] Saving payload:", payload);

    const { data, error: dbError } = await supabase
      .from("loads")
      .insert(payload)
      .select(`
        *,
        driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
      `)
      .single();

    setSaving(false);

    if (dbError) {
      console.error("[AddLoadModal] insert error:", dbError);
      console.error("[AddLoadModal] insert error:", dbError);
console.error("[AddLoadModal] Error message:", dbError.message);
console.error("[AddLoadModal] Error details:", dbError.details);
console.error("[AddLoadModal] Error hint:", dbError.hint);
console.error("[AddLoadModal] Error code:", dbError.code);
console.error("[AddLoadModal] Payload that failed:", payload);
      setError(dbError.message || "Failed to create load.");
      return;
    }

    console.log("[AddLoadModal] Successfully created load:", data);

    if (onCreated) onCreated(data);
    if (onSaved) onSaved(data);
    if (onAdded) onAdded(data);
    if (onClose) onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-emerald-400/20 bg-slate-950/95 shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-400/80">New Load</p>
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold text-slate-50">
                {form.reference || form.load_number || "Create Load"}
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
        <form onSubmit={handleSave} className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* OCR SECTION */}
          <section className="rounded-xl border border-emerald-400/20 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                  Rate Confirmation OCR
                </h3>
                <p className="mt-1 text-xs text-slate-300/80">
                  Upload a PDF or image of a rate confirmation and Atlas will pre-fill as many fields as it can.
                </p>
                {ocrInfo && <p className="mt-2 text-[11px] text-emerald-300">{ocrInfo}</p>}
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

          {/* IDENTIFIERS & REFERENCES */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Identifiers &amp; References
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Load #</label>
                <input
                  type="text"
                  value={form.reference}
                  onChange={(e) => updateField("reference", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Load Number (Alt)</label>
                <input
                  type="text"
                  value={form.load_number}
                  onChange={(e) => updateField("load_number", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">BOL Number</label>
                <input
                  type="text"
                  value={form.bol_number}
                  onChange={(e) => updateField("bol_number", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">PRO Number</label>
                <input
                  type="text"
                  value={form.pro_number}
                  onChange={(e) => updateField("pro_number", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">PO Number</label>
                <input
                  type="text"
                  value={form.po_number}
                  onChange={(e) => updateField("po_number", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Customer Reference</label>
                <input
                  type="text"
                  value={form.customer_reference}
                  onChange={(e) => updateField("customer_reference", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Ref No</label>
                <input
                  type="text"
                  value={form.ref_no}
                  onChange={(e) => updateField("ref_no", e.target.value)}
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
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </div>
          </section>

          {/* COMPANIES */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Companies &amp; Parties
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Shipper <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={form.shipper}
                  onChange={(e) => updateField("shipper", e.target.value)}
                  required
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Customer</label>
                <input
                  type="text"
                  value={form.customer}
                  onChange={(e) => updateField("customer", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Broker</label>
                <input
                  type="text"
                  value={form.broker}
                  onChange={(e) => updateField("broker", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Consignee Name</label>
                <input
                  type="text"
                  value={form.consignee_name}
                  onChange={(e) => updateField("consignee_name", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Dispatcher</label>
                <input
                  type="text"
                  value={form.dispatcher}
                  onChange={(e) => updateField("dispatcher", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          </section>

          {/* LOCATIONS & SCHEDULE - ENHANCED */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Locations &amp; Schedule
            </h3>

            {/* FULL ADDRESSES (for driver GPS navigation) */}
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  Pickup Address (Full)
                  <Tooltip text="Complete address for driver GPS navigation. City and state will auto-fill below." />
                </label>
                <textarea
                  value={form.origin}
                  onChange={(e) => handleOriginAddressChange(e.target.value)}
                  placeholder="ABC Warehouse&#10;1234 Industry Blvd&#10;Los Angeles, CA 90001"
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  Delivery Address (Full)
                  <Tooltip text="Complete address for driver GPS navigation. City and state will auto-fill below." />
                </label>
                <textarea
                  value={form.destination}
                  onChange={(e) => handleDestinationAddressChange(e.target.value)}
                  placeholder="XYZ Distribution&#10;5678 Commerce Dr&#10;San Francisco, CA 94102"
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>

            {/* CITY + STATE (for mileage calculation) */}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  Origin City/State 
                  <span className="text-red-400">*</span>
                  <Tooltip text="Used for mileage calculation. Auto-fills when you enter full address above." />
                </label>
                <div className="grid grid-cols-[2fr,1fr] gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={form.origin_city}
                    onChange={(e) => updateField("origin_city", e.target.value)}
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                  <input
                    type="text"
                    placeholder="ST"
                    maxLength={2}
                    value={form.origin_state}
                    onChange={(e) => updateField("origin_state", e.target.value.toUpperCase())}
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 uppercase outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  Destination City/State 
                  <span className="text-red-400">*</span>
                  <Tooltip text="Used for mileage calculation. Auto-fills when you enter full address above." />
                </label>
                <div className="grid grid-cols-[2fr,1fr] gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={form.dest_city}
                    onChange={(e) => updateField("dest_city", e.target.value)}
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                  <input
                    type="text"
                    placeholder="ST"
                    maxLength={2}
                    value={form.dest_state}
                    onChange={(e) => updateField("dest_state", e.target.value.toUpperCase())}
                    className="h-9 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 uppercase outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                  />
                </div>
              </div>
            </div>

            {/* SCHEDULE */}
            <div className="mt-4 grid gap-4 md:grid-cols-4">
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
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Delivery Date</label>
                <input
                  type="date"
                  value={form.delivery_date || ""}
                  onChange={(e) => updateField("delivery_date", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Delivery Time</label>
                <input
                  type="time"
                  value={form.delivery_time || ""}
                  onChange={(e) => updateField("delivery_time", e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          </section>

          {/* REST OF THE FORM - Contact Information, Load Details, Driver & Equipment, Financial, Notes sections remain unchanged */}
          {/* ... (keeping the rest of the form exactly as it was for brevity - it's unchanged) ... */}
          
          {/* For the full production file, include all remaining sections from your original file */}

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