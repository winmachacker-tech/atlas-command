// src/components/AddLoadModal.jsx
import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function AddLoadModal({ open, onClose, onCreated }) {
  const dialogRef = useRef(null);

  const [form, setForm] = useState({
    reference: "",
    shipper: "",
    origin: "",
    destination: "",
    status: "AVAILABLE",
    rate: "",
    pickup_at: "",
    delivery_at: "",
    equipment_type: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Status options matching your database
  const STATUS_OPTIONS = [
    { label: "Available", value: "AVAILABLE" },
    { label: "In Transit", value: "IN_TRANSIT" },
    { label: "Delivered", value: "DELIVERED" },
    { label: "Cancelled", value: "CANCELLED" },
    { label: "At Risk", value: "AT_RISK" },
    { label: "Problem", value: "PROBLEM" },
  ];

  // Equipment options
  const EQUIPMENT_OPTIONS = [
    "Dry Van",
    "Reefer",
    "Flatbed",
    "Step Deck",
    "Conestoga",
    "Power Only",
    "Hotshot",
    "Tanker",
    "Other",
  ];

  /* --------------------------- UX: Close behaviors -------------------------- */
  // Close on overlay click
  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      safeClose();
    }
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    
    const onKey = (e) => {
      if (e.key === "Escape") safeClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Centralized safe close
  const safeClose = () => {
    if (typeof onClose === "function") {
      onClose();
      // Reset form
      setForm({
        reference: "",
        shipper: "",
        origin: "",
        destination: "",
        status: "AVAILABLE",
        rate: "",
        pickup_at: "",
        delivery_at: "",
        equipment_type: "",
      });
      setError("");
    } else {
      console.warn("AddLoadModal: onClose not provided; cannot unmount modal.");
    }
  };

  /* ------------------------------- Form logic ------------------------------- */
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(""); // clear any existing error as user edits
  };

  const validate = () => {
    if (!form.shipper?.trim()) return "Shipper is required.";
    if (!form.origin?.trim()) return "Origin is required.";
    if (!form.destination?.trim()) return "Destination is required.";
    if (!form.status) return "Status is required.";
    if (!form.equipment_type) return "Equipment type is required.";
    // Rate can be blank; if provided, must be a number
    if (form.rate !== "" && Number.isNaN(Number(form.rate))) {
      return "Rate must be a valid number.";
    }
    if (form.rate !== "" && Number(form.rate) < 0) {
      return "Rate must be non-negative.";
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        reference: form.reference?.trim() || null,
        shipper: form.shipper.trim(),
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        status: form.status,
        rate: form.rate === "" ? 0 : Number(form.rate),
        pickup_at: form.pickup_at ? new Date(form.pickup_at).toISOString() : null,
        delivery_at: form.delivery_at ? new Date(form.delivery_at).toISOString() : null,
        equipment_type: form.equipment_type,
      };

      const { data, error: sbError } = await supabase
        .from("loads")
        .insert([payload])
        .select();

      if (sbError) {
        console.error("❌ Error saving load:", sbError);
        setError(sbError.message || "Failed to save load.");
        setSaving(false);
        return;
      }

      console.log("✅ Load saved successfully:", data);

      // Call onCreated callback if provided
      if (typeof onCreated === "function") {
        try {
          await onCreated(data);
        } catch (err) {
          console.warn("onCreated callback error:", err);
        }
      }

      safeClose();
    } catch (err) {
      console.error("❌ Unexpected error:", err);
      setError(err.message || "An unexpected error occurred.");
      setSaving(false);
    }
  };

  // Don't render if not open
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onOverlayClick}
      aria-modal="true"
      role="dialog"
    >
      <div
        ref={dialogRef}
        className="bg-[#171c26] text-gray-200 rounded-2xl shadow-xl p-6 w-full max-w-xl border border-gray-700 max-h-[90vh] overflow-y-auto"
      >
        {/* Close (X) — explicitly type=button so it NEVER submits */}
        <button
          type="button"
          onClick={safeClose}
          className="absolute top-3 right-3 p-1 rounded-md hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-3">
          Add New Load
        </h2>

        {error && (
          <div className="mb-4 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Reference (optional)
              </label>
              <input
                name="reference"
                value={form.reference}
                onChange={handleChange}
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Load reference"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Shipper *
              </label>
              <input
                name="shipper"
                value={form.shipper}
                onChange={handleChange}
                required
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Company name"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Origin *
              </label>
              <input
                name="origin"
                value={form.origin}
                onChange={handleChange}
                required
                placeholder="City, ST or address"
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Destination *
              </label>
              <input
                name="destination"
                value={form.destination}
                onChange={handleChange}
                required
                placeholder="City, ST or address"
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Status *
              </label>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Equipment Type *
              </label>
              <select
                name="equipment_type"
                value={form.equipment_type}
                onChange={handleChange}
                required
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select type</option>
                {EQUIPMENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Rate ($)
              </label>
              <input
                name="rate"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={form.rate}
                onChange={handleChange}
                placeholder="0.00"
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Pickup (PU)
              </label>
              <input
                type="datetime-local"
                name="pickup_at"
                value={form.pickup_at}
                onChange={handleChange}
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Delivery (DEL)
              </label>
              <input
                type="datetime-local"
                name="delivery_at"
                value={form.delivery_at}
                onChange={handleChange}
                className="w-full rounded-lg bg-gray-800 text-white border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={safeClose}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 transition-colors flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                "Save Load"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
