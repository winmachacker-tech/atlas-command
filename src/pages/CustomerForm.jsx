// src/pages/CustomerForm.jsx
import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  Save,
  Loader2,
  Building2,
  Phone,
  Mail,
  MapPin,
  DollarSign,
  FileText,
  Truck,
} from "lucide-react";

/* ---------------- helpers ---------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/* ---------------- main component ---------------- */
export default function CustomerForm() {
  const { id: customerId } = useParams();
  const navigate = useNavigate();
  const isEdit = !!customerId;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [formData, setFormData] = useState({
    company_name: "",
    customer_type: "customer",
    status: "active",
    
    // Primary Contact
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    
    // Address
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip_code: "",
    country: "USA",
    
    // Billing
    billing_contact_name: "",
    billing_contact_phone: "",
    billing_contact_email: "",
    billing_address_same_as_primary: true,
    billing_address_line1: "",
    billing_address_line2: "",
    billing_city: "",
    billing_state: "",
    billing_zip_code: "",
    
    // Business
    mc_number: "",
    dot_number: "",
    tax_id: "",
    
    // Financial
    credit_limit: "",
    payment_terms: "",
    default_rate_per_mile: "",
    
    // Notes
    notes: "",
  });

  /* --------------- fetch customer (edit mode) --------------- */
  const fetchCustomer = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();
      
      if (err) throw err;
      if (!data) throw new Error("Customer not found");
      
      // Populate form with existing data
      setFormData({
        company_name: data.company_name || "",
        customer_type: data.customer_type || "customer",
        status: data.status || "active",
        contact_name: data.contact_name || "",
        contact_phone: data.contact_phone || "",
        contact_email: data.contact_email || "",
        address_line1: data.address_line1 || "",
        address_line2: data.address_line2 || "",
        city: data.city || "",
        state: data.state || "",
        zip_code: data.zip_code || "",
        country: data.country || "USA",
        billing_contact_name: data.billing_contact_name || "",
        billing_contact_phone: data.billing_contact_phone || "",
        billing_contact_email: data.billing_contact_email || "",
        billing_address_same_as_primary: data.billing_address_same_as_primary ?? true,
        billing_address_line1: data.billing_address_line1 || "",
        billing_address_line2: data.billing_address_line2 || "",
        billing_city: data.billing_city || "",
        billing_state: data.billing_state || "",
        billing_zip_code: data.billing_zip_code || "",
        mc_number: data.mc_number || "",
        dot_number: data.dot_number || "",
        tax_id: data.tax_id || "",
        credit_limit: data.credit_limit || "",
        payment_terms: data.payment_terms || "",
        default_rate_per_mile: data.default_rate_per_mile || "",
        notes: data.notes || "",
      });
    } catch (err) {
      console.error("fetchCustomer error:", err);
      setError(err?.message || "Failed to load customer.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  /* --------------- initial load --------------- */
  useEffect(() => {
    if (isEdit) {
      fetchCustomer();
    }
  }, [isEdit, fetchCustomer]);

  /* --------------- handle input change --------------- */
  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  /* --------------- validate form --------------- */
  const validateForm = () => {
    if (!formData.company_name.trim()) {
      setError("Company name is required");
      return false;
    }
    if (formData.contact_email && !formData.contact_email.includes("@")) {
      setError("Invalid email address");
      return false;
    }
    return true;
  };

  /* --------------- save customer --------------- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    setError("");

    try {
      const payload = {
        company_name: formData.company_name.trim(),
        customer_type: formData.customer_type,
        status: formData.status,
        contact_name: formData.contact_name.trim() || null,
        contact_phone: formData.contact_phone.trim() || null,
        contact_email: formData.contact_email.trim() || null,
        address_line1: formData.address_line1.trim() || null,
        address_line2: formData.address_line2.trim() || null,
        city: formData.city.trim() || null,
        state: formData.state.trim() || null,
        zip_code: formData.zip_code.trim() || null,
        country: formData.country || "USA",
        billing_contact_name: formData.billing_contact_name.trim() || null,
        billing_contact_phone: formData.billing_contact_phone.trim() || null,
        billing_contact_email: formData.billing_contact_email.trim() || null,
        billing_address_same_as_primary: formData.billing_address_same_as_primary,
        billing_address_line1: formData.billing_address_line1.trim() || null,
        billing_address_line2: formData.billing_address_line2.trim() || null,
        billing_city: formData.billing_city.trim() || null,
        billing_state: formData.billing_state.trim() || null,
        billing_zip_code: formData.billing_zip_code.trim() || null,
        mc_number: formData.mc_number.trim() || null,
        dot_number: formData.dot_number.trim() || null,
        tax_id: formData.tax_id.trim() || null,
        credit_limit: formData.credit_limit ? parseFloat(formData.credit_limit) : null,
        payment_terms: formData.payment_terms.trim() || null,
        default_rate_per_mile: formData.default_rate_per_mile ? parseFloat(formData.default_rate_per_mile) : null,
        notes: formData.notes.trim() || null,
      };

      if (isEdit) {
        // Update existing customer
        const { error: updateErr } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", customerId);
        
        if (updateErr) throw updateErr;
        navigate(`/customers/${customerId}`);
      } else {
        // Create new customer
        const { data: newCustomer, error: insertErr } = await supabase
          .from("customers")
          .insert([payload])
          .select()
          .single();
        
        if (insertErr) throw insertErr;
        navigate(`/customers/${newCustomer.id}`);
      }
    } catch (err) {
      console.error("save error:", err);
      setError(err?.message || "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- UI ---------------- */
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-zinc-300">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading customer…
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* ------ top nav ------ */}
      <div className="flex items-center justify-between">
        <Link
          to={isEdit ? `/customers/${customerId}` : "/customers"}
          className="inline-flex items-center gap-2 text-zinc-300 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {isEdit ? "Customer" : "Customers"}
        </Link>
      </div>

      {/* ------ header ------ */}
      <div>
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <Building2 className="w-6 h-6" />
          {isEdit ? "Edit Customer" : "Add New Customer"}
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          {isEdit ? "Update customer information" : "Create a new customer record"}
        </p>
      </div>

      {/* ------ error alert ------ */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200">
          {error}
        </div>
      )}

      {/* ------ form ------ */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
          <h2 className="text-lg font-medium text-zinc-200 mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-zinc-300 mb-1.5">
                Company Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={formData.company_name}
                onChange={(e) => handleChange("company_name", e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="e.g. Walmart Distribution"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Customer Type</label>
              <select
                value={formData.customer_type}
                onChange={(e) => handleChange("customer_type", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                <option value="customer">Direct Customer</option>
                <option value="broker">Broker</option>
                <option value="both">Both</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Status</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange("status", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        {/* Primary Contact */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
          <h2 className="text-lg font-medium text-zinc-200 mb-4 flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Primary Contact
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Contact Name</label>
              <input
                type="text"
                value={formData.contact_name}
                onChange={(e) => handleChange("contact_name", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Phone</label>
              <input
                type="tel"
                value={formData.contact_phone}
                onChange={(e) => handleChange("contact_phone", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="555-0101"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Email</label>
              <input
                type="email"
                value={formData.contact_email}
                onChange={(e) => handleChange("contact_email", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="john@company.com"
              />
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
          <h2 className="text-lg font-medium text-zinc-200 mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Address
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Address Line 1</label>
              <input
                type="text"
                value={formData.address_line1}
                onChange={(e) => handleChange("address_line1", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="123 Main St"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Address Line 2</label>
              <input
                type="text"
                value={formData.address_line2}
                onChange={(e) => handleChange("address_line2", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="Suite 100"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-300 mb-1.5">City</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => handleChange("city", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  placeholder="Dallas"
                />
              </div>

              <div>
                <label className="block text-sm text-zinc-300 mb-1.5">State</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => handleChange("state", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  placeholder="TX"
                  maxLength={2}
                />
              </div>

              <div>
                <label className="block text-sm text-zinc-300 mb-1.5">ZIP Code</label>
                <input
                  type="text"
                  value={formData.zip_code}
                  onChange={(e) => handleChange("zip_code", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  placeholder="75001"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Business Details */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
          <h2 className="text-lg font-medium text-zinc-200 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5" />
            Business Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">MC Number</label>
              <input
                type="text"
                value={formData.mc_number}
                onChange={(e) => handleChange("mc_number", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="123456"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">DOT Number</label>
              <input
                type="text"
                value={formData.dot_number}
                onChange={(e) => handleChange("dot_number", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="7654321"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Tax ID / EIN</label>
              <input
                type="text"
                value={formData.tax_id}
                onChange={(e) => handleChange("tax_id", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="12-3456789"
              />
            </div>
          </div>
        </div>

        {/* Financial Terms */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
          <h2 className="text-lg font-medium text-zinc-200 mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Financial Terms
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Payment Terms</label>
              <input
                type="text"
                value={formData.payment_terms}
                onChange={(e) => handleChange("payment_terms", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="Net 30"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Credit Limit</label>
              <input
                type="number"
                step="0.01"
                value={formData.credit_limit}
                onChange={(e) => handleChange("credit_limit", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="50000.00"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-300 mb-1.5">Default Rate Per Mile</label>
              <input
                type="number"
                step="0.01"
                value={formData.default_rate_per_mile}
                onChange={(e) => handleChange("default_rate_per_mile", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="2.50"
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
          <h2 className="text-lg font-medium text-zinc-200 mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Notes
          </h2>
          <textarea
            value={formData.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
            placeholder="Any additional notes or special requirements..."
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {isEdit ? "Update Customer" : "Create Customer"}
              </>
            )}
          </button>

          <Link
            to={isEdit ? `/customers/${customerId}` : "/customers"}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-zinc-700/60 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}