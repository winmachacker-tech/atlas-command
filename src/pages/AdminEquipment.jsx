// src/pages/AdminEquipment.jsx
import { useState } from "react";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function AdminEquipment() {
  const [form, setForm] = useState({
    code: "",
    label: "",
    description: "",
    has_temp_control: false,
    is_open_deck: false,
    is_power_only: false,
    default_length_feet: "",
    allowed_lengths_feet: "",
    max_weight_lbs: "",
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const payload = {
        code: form.code.toUpperCase(),
        label: form.label.trim(),
        description: form.description.trim() || null,
        has_temp_control: !!form.has_temp_control,
        is_open_deck: !!form.is_open_deck,
        is_power_only: !!form.is_power_only,
        default_length_feet: form.default_length_feet
          ? Number(form.default_length_feet)
          : null,
        allowed_lengths_feet: form.allowed_lengths_feet
          ? form.allowed_lengths_feet
              .split(",")
              .map((n) => Number(n.trim()))
              .filter((n) => !isNaN(n))
          : [],
        max_weight_lbs: form.max_weight_lbs
          ? Number(form.max_weight_lbs)
          : null,
      };

      const { data, error } = await supabase.functions.invoke(
        "equipment-upsert",
        {
          body: payload,
          headers: {
            "x-admin-token": import.meta.env.VITE_ADMIN_API_TOKEN,
          },
        }
      );

      if (error) throw error;
      setMsg({ type: "success", text: `Saved: ${data?.data?.label || "OK"}` });
    } catch (err) {
      console.error(err);
      setMsg({ type: "error", text: err.message || "Failed to save" });
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  return (
    <div className="p-6 text-gray-200 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Equipment Type Manager</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col">
            <span className="text-sm text-gray-400 mb-1">Code *</span>
            <input
              name="code"
              value={form.code}
              onChange={handleChange}
              required
              className="bg-gray-800 border border-gray-700 rounded-lg p-2"
              placeholder="DV"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-sm text-gray-400 mb-1">Label *</span>
            <input
              name="label"
              value={form.label}
              onChange={handleChange}
              required
              className="bg-gray-800 border border-gray-700 rounded-lg p-2"
              placeholder="Dry Van"
            />
          </label>
          <label className="flex flex-col md:col-span-2">
            <span className="text-sm text-gray-400 mb-1">Description</span>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={2}
              className="bg-gray-800 border border-gray-700 rounded-lg p-2"
              placeholder="Standard enclosed trailer..."
            />
          </label>
          <label className="flex flex-col">
            <span className="text-sm text-gray-400 mb-1">Default Length (ft)</span>
            <input
              name="default_length_feet"
              value={form.default_length_feet}
              onChange={handleChange}
              type="number"
              className="bg-gray-800 border border-gray-700 rounded-lg p-2"
              placeholder="53"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-sm text-gray-400 mb-1">Allowed Lengths (comma)</span>
            <input
              name="allowed_lengths_feet"
              value={form.allowed_lengths_feet}
              onChange={handleChange}
              className="bg-gray-800 border border-gray-700 rounded-lg p-2"
              placeholder="48,53"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-sm text-gray-400 mb-1">Max Weight (lbs)</span>
            <input
              name="max_weight_lbs"
              value={form.max_weight_lbs}
              onChange={handleChange}
              type="number"
              className="bg-gray-800 border border-gray-700 rounded-lg p-2"
              placeholder="45000"
            />
          </label>
        </div>

        {/* toggles */}
        <div className="flex flex-wrap gap-4 mt-2">
          {[
            ["has_temp_control", "Temperature Controlled"],
            ["is_open_deck", "Open Deck"],
            ["is_power_only", "Power Only"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={key}
                checked={form[key]}
                onChange={handleChange}
              />
              {label}
            </label>
          ))}
        </div>

        {/* message + button */}
        {msg && (
          <div
            className={`flex items-center gap-2 text-sm rounded-lg p-2 ${
              msg.type === "success"
                ? "text-green-400 bg-green-900/30 border border-green-700/50"
                : "text-red-400 bg-red-900/30 border border-red-700/50"
            }`}
          >
            {msg.type === "success" ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow transition disabled:opacity-60"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </span>
          ) : (
            "Save Equipment Type"
          )}
        </button>
      </form>
    </div>
  );
}
