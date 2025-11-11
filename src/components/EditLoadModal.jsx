// src/components/AddLoadModal.jsx
import { useState, useEffect } from "react";
import { X, Loader2, Plus, ChevronDown, Pencil, Save } from "lucide-react";
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

export default function EditLoadModal({ load, onClose, onUpdated }) {
  const [formData, setFormData] = useState({
    reference: load?.reference || "",
    shipper: load?.shipper || "",
    origin: load?.origin || "",
    destination: load?.destination || "",
    status: load?.status || "AVAILABLE",
    driver_id: load?.driver_id || "",
    rate: load?.rate || "",
    pickup_date: load?.pickup_date || "",
    pickup_time: load?.pickup_time || "",
    delivery_date: load?.delivery_date || "",
    delivery_time: load?.delivery_time || "",
    // Contact info
    shipper_contact_name: load?.shipper_contact_name || "",
    shipper_contact_phone: load?.shipper_contact_phone || "",
    shipper_contact_email: load?.shipper_contact_email || "",
    receiver_contact_name: load?.receiver_contact_name || "",
    receiver_contact_phone: load?.receiver_contact_phone || "",
    receiver_contact_email: load?.receiver_contact_email || "",
    // Reference numbers
    bol_number: load?.bol_number || "",
    po_number: load?.po_number || "",
    customer_reference: load?.customer_reference || "",
    // Load details
    commodity: load?.commodity || "",
    weight: load?.weight || "",
    pieces: load?.pieces || "",
    equipment_type: load?.equipment_type || "DRY_VAN",
    temperature: load?.temperature || "",
    special_instructions: load?.special_instructions || "",
    // Financial & distance
    miles: load?.miles || "",
    rate_per_mile: load?.rate_per_mile || "",
    detention_charges: load?.detention_charges || "",
    accessorial_charges: load?.accessorial_charges || "",
    broker_name: load?.broker_name || "",
  });
  const [calculatingMiles, setCalculatingMiles] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Fetch available drivers on mount
  useEffect(() => {
    async function fetchDrivers() {
      try {
        const { data, error } = await supabase
          .from("v_drivers_active")
          .select("id, first_name, last_name")
          .eq("status", "ACTIVE")
          .order("last_name", { ascending: true });
        
        if (error) throw error;
        setDrivers(data || []);
      } catch (e) {
        console.warn("[AddLoadModal] Failed to load drivers:", e);
        // Don't block the modal if drivers fail to load
      } finally {
        setLoadingDrivers(false);
      }
    }
    fetchDrivers();
  }, []);

  // Auto-calculate miles using Google Maps Distance Matrix API
  async function calculateMiles() {
    if (!formData.origin || !formData.destination) {
      alert("Please enter both origin and destination to calculate miles.");
      return;
    }

    setCalculatingMiles(true);
    setError("");

    try {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
      
      if (!apiKey) {
        // Fallback: If no API key, let user enter manually
        setError("Google Maps API key not configured. Please enter miles manually.");
        setCalculatingMiles(false);
        return;
      }

      const origin = encodeURIComponent(formData.origin.trim());
      const destination = encodeURIComponent(formData.destination.trim());
      
      // Use CORS proxy for development
      const proxyUrl = 'https://api.allorigins.win/raw?url=';
      const apiUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&units=imperial&key=${apiKey}`;
      
      const response = await fetch(proxyUrl + encodeURIComponent(apiUrl));

      if (!response.ok) throw new Error("Failed to fetch distance data");

      const data = await response.json();

      if (data.status !== "OK") {
        throw new Error(data.error_message || "Failed to calculate distance");
      }

      const element = data.rows[0]?.elements[0];
      
      if (!element || element.status !== "OK") {
        throw new Error("Could not calculate distance. Check your origin and destination.");
      }

      // Convert meters to miles
      const miles = Math.round(element.distance.value * 0.000621371);
      
      handleChange("miles", miles.toString());
      setError(""); // Clear any previous errors
      
      // Auto-calculate rate if rate_per_mile is set
      if (formData.rate_per_mile) {
        const calculatedRate = (miles * parseFloat(formData.rate_per_mile)).toFixed(2);
        handleChange("rate", calculatedRate);
      }
    } catch (e) {
      console.error("[AddLoadModal] Miles calculation error:", e);
      setError(e.message || "Failed to calculate miles. You can enter manually.");
    } finally {
      setCalculatingMiles(false);
    }
  }

  // Calculate rate from rate per mile
  function calculateRateFromPerMile() {
    if (!formData.miles || !formData.rate_per_mile) {
      alert("Please enter both miles and rate per mile to calculate total rate.");
      return;
    }
    const miles = parseFloat(formData.miles);
    const ratePerMile = parseFloat(formData.rate_per_mile);
    const calculatedRate = (miles * ratePerMile).toFixed(2);
    handleChange("rate", calculatedRate);
  }

  function handleChange(field, value) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    // Basic validation
    if (!formData.reference.trim()) {
      setError("Load # is required");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({
          reference: formData.reference.trim(),
          shipper: formData.shipper.trim() || null,
          origin: formData.origin.trim() || null,
          destination: formData.destination.trim() || null,
          status: formData.status,
          driver_id: formData.driver_id || null,
          rate: formData.rate ? parseFloat(formData.rate) : null,
          pickup_date: formData.pickup_date || null,
          pickup_time: formData.pickup_time || null,
          delivery_date: formData.delivery_date || null,
          delivery_time: formData.delivery_time || null,
          // Contact info
          shipper_contact_name: formData.shipper_contact_name.trim() || null,
          shipper_contact_phone: formData.shipper_contact_phone.trim() || null,
          shipper_contact_email: formData.shipper_contact_email.trim() || null,
          receiver_contact_name: formData.receiver_contact_name.trim() || null,
          receiver_contact_phone: formData.receiver_contact_phone.trim() || null,
          receiver_contact_email: formData.receiver_contact_email.trim() || null,
          // Reference numbers
          bol_number: formData.bol_number.trim() || null,
          po_number: formData.po_number.trim() || null,
          customer_reference: formData.customer_reference.trim() || null,
          // Load details
          commodity: formData.commodity.trim() || null,
          weight: formData.weight ? parseFloat(formData.weight) : null,
          pieces: formData.pieces ? parseInt(formData.pieces) : null,
          equipment_type: formData.equipment_type || null,
          temperature: formData.temperature.trim() || null,
          special_instructions: formData.special_instructions.trim() || null,
          // Financial & distance
          miles: formData.miles ? parseInt(formData.miles) : null,
          rate_per_mile: formData.rate_per_mile ? parseFloat(formData.rate_per_mile) : null,
          detention_charges: formData.detention_charges ? parseFloat(formData.detention_charges) : null,
          accessorial_charges: formData.accessorial_charges ? parseFloat(formData.accessorial_charges) : null,
          broker_name: formData.broker_name.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", load.id)
        .select(`
          *,
          driver:v_drivers_active!loads_driver_id_fkey(id, first_name, last_name)
        `)
        .single();

      if (error) throw error;

      // Call parent callback with updated load
      onUpdated(data);
      onClose();
    } catch (e) {
      console.error("[EditLoadModal] error:", e);
      setError(e?.message || "Failed to update load");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl my-8 rounded-2xl border border-white/10 bg-[#0B0B0F] p-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10">
              <Ico as={Pencil} className="text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold">Edit Load</h3>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <Ico as={X} />
          </IconButton>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* === BASIC INFO === */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Basic Information</h4>
            
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/70">
                  Load # <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.reference}
                  onChange={(e) => handleChange("reference", e.target.value)}
                  placeholder="e.g. LD-2024-001"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => handleChange("status", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500/50"
                >
                  <option value="AVAILABLE" className="bg-[#0B0B0F]">Available</option>
                  <option value="IN_TRANSIT" className="bg-[#0B0B0F]">In Transit</option>
                  <option value="DELIVERED" className="bg-[#0B0B0F]">Delivered</option>
                  <option value="CANCELLED" className="bg-[#0B0B0F]">Cancelled</option>
                  <option value="AT_RISK" className="bg-[#0B0B0F]">At Risk</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/70">Shipper Company</label>
                <input
                  type="text"
                  value={formData.shipper}
                  onChange={(e) => handleChange("shipper", e.target.value)}
                  placeholder="Company name"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Broker/Customer</label>
                <input
                  type="text"
                  value={formData.broker_name}
                  onChange={(e) => handleChange("broker_name", e.target.value)}
                  placeholder="Broker or customer name"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-white/70">
                Driver <span className="text-white/40 text-xs">(optional)</span>
              </label>
              <div className="relative">
                <select
                  value={formData.driver_id}
                  onChange={(e) => handleChange("driver_id", e.target.value)}
                  disabled={loadingDrivers}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:border-amber-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="" className="bg-[#0B0B0F]">
                    {loadingDrivers ? "Loading drivers..." : "Select a driver (optional)"}
                  </option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id} className="bg-[#0B0B0F]">
                      {d.last_name}, {d.first_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
              </div>
              {drivers.length === 0 && !loadingDrivers && (
                <p className="mt-1 text-xs text-white/50">No active drivers available.</p>
              )}
            </div>
          </div>

          {/* === LOCATIONS & SCHEDULE === */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Locations & Schedule</h4>
            
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/70">Origin</label>
                <input
                  type="text"
                  value={formData.origin}
                  onChange={(e) => handleChange("origin", e.target.value)}
                  placeholder="City, State"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Destination</label>
                <input
                  type="text"
                  value={formData.destination}
                  onChange={(e) => handleChange("destination", e.target.value)}
                  placeholder="City, State"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>
            </div>

            {/* Pickup Date & Time */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-white/70">Pickup Date</label>
                <input
                  type="date"
                  value={formData.pickup_date}
                  onChange={(e) => handleChange("pickup_date", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/70">Time</label>
                <input
                  type="time"
                  value={formData.pickup_time}
                  onChange={(e) => handleChange("pickup_time", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500/50"
                />
              </div>
            </div>

            {/* Delivery Date & Time */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-white/70">Delivery Date</label>
                <input
                  type="date"
                  value={formData.delivery_date}
                  onChange={(e) => handleChange("delivery_date", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/70">Time</label>
                <input
                  type="time"
                  value={formData.delivery_time}
                  onChange={(e) => handleChange("delivery_time", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500/50"
                />
              </div>
            </div>
          </div>

          {/* === CONTACTS === */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Contact Information</h4>
            
            <div className="rounded-xl border border-white/10 p-3 space-y-2">
              <div className="text-xs font-medium text-white/70 mb-2">Shipper Contact</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={formData.shipper_contact_name}
                  onChange={(e) => handleChange("shipper_contact_name", e.target.value)}
                  placeholder="Contact name"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
                <input
                  type="tel"
                  value={formData.shipper_contact_phone}
                  onChange={(e) => handleChange("shipper_contact_phone", e.target.value)}
                  placeholder="Phone"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
                <input
                  type="email"
                  value={formData.shipper_contact_email}
                  onChange={(e) => handleChange("shipper_contact_email", e.target.value)}
                  placeholder="Email"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 p-3 space-y-2">
              <div className="text-xs font-medium text-white/70 mb-2">Receiver Contact</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={formData.receiver_contact_name}
                  onChange={(e) => handleChange("receiver_contact_name", e.target.value)}
                  placeholder="Contact name"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
                <input
                  type="tel"
                  value={formData.receiver_contact_phone}
                  onChange={(e) => handleChange("receiver_contact_phone", e.target.value)}
                  placeholder="Phone"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
                <input
                  type="email"
                  value={formData.receiver_contact_email}
                  onChange={(e) => handleChange("receiver_contact_email", e.target.value)}
                  placeholder="Email"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>
            </div>
          </div>

          {/* === LOAD DETAILS === */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Load Details</h4>
            
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/70">Commodity</label>
                <input
                  type="text"
                  value={formData.commodity}
                  onChange={(e) => handleChange("commodity", e.target.value)}
                  placeholder="What's being shipped"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Equipment Type</label>
                <select
                  value={formData.equipment_type}
                  onChange={(e) => handleChange("equipment_type", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500/50"
                >
                  <option value="DRY_VAN" className="bg-[#0B0B0F]">Dry Van</option>
                  <option value="REEFER" className="bg-[#0B0B0F]">Reefer</option>
                  <option value="FLATBED" className="bg-[#0B0B0F]">Flatbed</option>
                  <option value="STEP_DECK" className="bg-[#0B0B0F]">Step Deck</option>
                  <option value="LOWBOY" className="bg-[#0B0B0F]">Lowboy</option>
                  <option value="POWER_ONLY" className="bg-[#0B0B0F]">Power Only</option>
                  <option value="BOX_TRUCK" className="bg-[#0B0B0F]">Box Truck</option>
                  <option value="OTHER" className="bg-[#0B0B0F]">Other</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-white/70">Weight (lbs)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.weight}
                  onChange={(e) => handleChange("weight", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Pieces/Pallets</label>
                <input
                  type="number"
                  min="0"
                  value={formData.pieces}
                  onChange={(e) => handleChange("pieces", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Temperature</label>
                <input
                  type="text"
                  value={formData.temperature}
                  onChange={(e) => handleChange("temperature", e.target.value)}
                  placeholder="e.g. 35Â°F"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-white/70">Special Instructions</label>
              <textarea
                value={formData.special_instructions}
                onChange={(e) => handleChange("special_instructions", e.target.value)}
                placeholder="Any special handling, requirements, or notes..."
                rows={2}
                className="w-full resize-y rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
              />
            </div>
          </div>

          {/* === REFERENCE NUMBERS === */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Reference Numbers</h4>
            
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-white/70">BOL #</label>
                <input
                  type="text"
                  value={formData.bol_number}
                  onChange={(e) => handleChange("bol_number", e.target.value)}
                  placeholder="Bill of Lading"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">PO #</label>
                <input
                  type="text"
                  value={formData.po_number}
                  onChange={(e) => handleChange("po_number", e.target.value)}
                  placeholder="Purchase Order"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Customer Ref #</label>
                <input
                  type="text"
                  value={formData.customer_reference}
                  onChange={(e) => handleChange("customer_reference", e.target.value)}
                  placeholder="Reference"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>
            </div>
          </div>

          {/* === FINANCIAL === */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Financial & Distance</h4>
            
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-white/70">Rate Per Mile</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.rate_per_mile}
                    onChange={(e) => handleChange("rate_per_mile", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 pl-7 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70 flex items-center justify-between">
                  <span>Miles</span>
                  <button
                    type="button"
                    onClick={calculateMiles}
                    disabled={calculatingMiles || !formData.origin || !formData.destination}
                    className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {calculatingMiles ? "Calculating..." : "Auto-calculate"}
                  </button>
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.miles}
                  onChange={(e) => handleChange("miles", e.target.value)}
                  placeholder="Enter or auto-calculate"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70 flex items-center justify-between">
                  <span>Total Rate</span>
                  <button
                    type="button"
                    onClick={calculateRateFromPerMile}
                    disabled={!formData.miles || !formData.rate_per_mile}
                    className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Calculate
                  </button>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.rate}
                    onChange={(e) => handleChange("rate", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 pl-7 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/70">Detention Charges</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.detention_charges}
                    onChange={(e) => handleChange("detention_charges", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 pl-7 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Accessorial Charges</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.accessorial_charges}
                    onChange={(e) => handleChange("accessorial_charges", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 pl-7 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
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
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Ico as={Loader2} className="animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Ico as={Save} className="text-amber-400" />
                  Update Load
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
