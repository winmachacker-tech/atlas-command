// src/components/DriverCreateForm.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, Save, X } from "lucide-react";

export default function DriverCreateForm({ onCancel }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    org_id: "",
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    license_number: "",
    license_class: "",
    license_expiry: "",
    med_card_expiry: "",
    cdl_number: "",
    cdl_class: "A",
    cdl_exp: "",
    med_exp: "",
    status: "ACTIVE",
    notes: "",
    driver_code: "",
  });

  const [orgs, setOrgs] = useState([]);

  // Load user's organizations on mount
  useEffect(() => {
    async function loadUserOrgs() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("user_orgs")
        .select("org_id")
        .eq("user_id", user.id);
      
      if (error) {
        console.error("Error loading user orgs:", error);
        return;
      }

      if (data && data.length > 0) {
        const orgIds = data.map(d => d.org_id);
        setOrgs(orgIds);
        // Auto-select first org if only one exists
        if (orgIds.length === 1) {
          setFormData(prev => ({ ...prev, org_id: orgIds[0] }));
        }
      }
    }
    loadUserOrgs();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      // Validate required fields
      if (!formData.org_id) {
        throw new Error("Organization is required");
      }
      if (!formData.first_name.trim()) {
        throw new Error("First name is required");
      }
      if (!formData.last_name.trim()) {
        throw new Error("Last name is required");
      }
      if (!formData.license_number.trim()) {
        throw new Error("License number is required");
      }

      // Get current user for created_by
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Prepare insert data - only include non-empty values
      const insertData = {
        org_id: formData.org_id,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        license_number: formData.license_number.trim(),
        status: formData.status,
        created_by: user?.id || null,
      };

      // Add optional fields only if they have values
      if (formData.email.trim()) insertData.email = formData.email.trim();
      if (formData.phone.trim()) insertData.phone = formData.phone.trim();
      if (formData.license_class.trim()) insertData.license_class = formData.license_class.trim();
      if (formData.license_expiry) insertData.license_expiry = formData.license_expiry;
      if (formData.med_card_expiry) insertData.med_card_expiry = formData.med_card_expiry;
      if (formData.cdl_number.trim()) insertData.cdl_number = formData.cdl_number.trim();
      if (formData.cdl_class) insertData.cdl_class = formData.cdl_class;
      if (formData.cdl_exp) insertData.cdl_exp = formData.cdl_exp;
      if (formData.med_exp) insertData.med_exp = formData.med_exp;
      if (formData.notes.trim()) insertData.notes = formData.notes.trim();
      if (formData.driver_code.trim()) insertData.driver_code = formData.driver_code.trim();

      // Insert driver
      const { data, error: insertError } = await supabase
        .from("drivers")
        .insert([insertData])
        .select()
        .single();

      if (insertError) throw insertError;

      // Success! Navigate to the new driver's detail page
      navigate(`/drivers/${data.id}`);
    } catch (err) {
      console.error("Driver creation error:", err);
      setError(err.message || "Failed to create driver");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200">
          {error}
        </div>
      )}

      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-zinc-200">Basic Information</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm text-zinc-300 mb-1.5">
              Organization <span className="text-rose-400">*</span>
            </label>
            <select
              name="org_id"
              value={formData.org_id}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="">Select Organization</option>
              {orgs.map((orgId) => (
                <option key={orgId} value={orgId}>
                  {orgId}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">
              First Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              name="first_name"
              value={formData.first_name}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">
              Last Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              name="last_name"
              value={formData.last_name}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Phone</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Driver Code</label>
            <input
              type="text"
              name="driver_code"
              value={formData.driver_code}
              onChange={handleChange}
              placeholder="e.g., DR001"
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Status</label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ASSIGNED">Assigned</option>
            </select>
          </div>
        </div>
      </div>

      {/* License Information */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-zinc-200">License Information</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">
              License Number <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              name="license_number"
              value={formData.license_number}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">License Class</label>
            <input
              type="text"
              name="license_class"
              value={formData.license_class}
              onChange={handleChange}
              placeholder="e.g., Class A"
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">License Expiry</label>
            <input
              type="date"
              name="license_expiry"
              value={formData.license_expiry}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Med Card Expiry</label>
            <input
              type="date"
              name="med_card_expiry"
              value={formData.med_card_expiry}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>
      </div>

      {/* CDL Information */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-zinc-200">CDL Information</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">CDL Number</label>
            <input
              type="text"
              name="cdl_number"
              value={formData.cdl_number}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">CDL Class</label>
            <select
              name="cdl_class"
              value={formData.cdl_class}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="A">Class A</option>
              <option value="B">Class B</option>
              <option value="C">Class C</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">CDL Expiry</label>
            <input
              type="date"
              name="cdl_exp"
              value={formData.cdl_exp}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Medical Expiry</label>
            <input
              type="date"
              name="med_exp"
              value={formData.med_exp}
              onChange={handleChange}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm text-zinc-300 mb-1.5">Notes</label>
        <textarea
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          rows={4}
          placeholder="Additional notes about this driver..."
          className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-600 resize-none"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-4 border-t border-zinc-700/60">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Create Driver
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/60 px-4 py-2.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </form>
  );
}