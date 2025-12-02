// FILE: src/pages/CustomerDetail.jsx
// Purpose: Detailed view of a single customer with load history, contacts, stats

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  User,
  Pencil,
  Trash2,
  X,
  TruckIcon,
  DollarSign,
  Calendar,
  Clock,
  FileText,
  Plus,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function formatPhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

function formatCurrency(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/* ------------------------- tiny toast hook ----------------------- */
function useToast() {
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState("ok");
  const t = useRef(null);
  const show = useCallback((m, _tone = "ok") => {
    setMsg(m);
    setTone(_tone);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 3600);
  }, []);
  const View = useMemo(() => {
    if (!msg) return null;
    return (
      <div
        className={cx(
          "fixed z-50 bottom-10 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-xl text-sm shadow-lg border",
          tone === "ok" && "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
          tone === "err" && "bg-rose-500/10 text-rose-200 border-rose-500/30",
          tone === "info" && "bg-sky-500/10 text-sky-200 border-sky-500/30"
        )}
        role="status"
      >
        {msg}
      </div>
    );
  }, [msg, tone]);
  return { show, ToastView: View };
}

/* ----------------------- Edit Customer Modal --------------------- */
function EditCustomerModal({ customer, onClose, onSaved, show: toastShow }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: customer?.name || customer?.company_name || "",
    company_name: customer?.company_name || "",
    customer_type: customer?.customer_type || "shipper",
    mc_number: customer?.mc_number || "",
    dot_number: customer?.dot_number || "",
    contact_name: customer?.contact_name || "",
    contact_phone: customer?.contact_phone || "",
    contact_email: customer?.contact_email || "",
    address_line1: customer?.address_line1 || "",
    address_line2: customer?.address_line2 || "",
    city: customer?.city || "",
    state: customer?.state || "",
    zip_code: customer?.zip_code || "",
    payment_terms: customer?.payment_terms || "Net 30",
    credit_limit: customer?.credit_limit || "",
    notes: customer?.notes || "",
    status: customer?.status || "active",
  });

  const handleChange = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const customerName = form.name.trim() || form.company_name.trim();
    if (!customerName) {
      toastShow("Customer name is required", "err");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: customerName,
        company_name: form.company_name.trim() || customerName,
        customer_type: form.customer_type || "shipper",
        mc_number: form.mc_number.trim() || null,
        dot_number: form.dot_number.trim() || null,
        contact_name: form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        contact_email: form.contact_email.trim() || null,
        address_line1: form.address_line1.trim() || null,
        address_line2: form.address_line2.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip_code: form.zip_code.trim() || null,
        payment_terms: form.payment_terms || "Net 30",
        credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
        notes: form.notes.trim() || null,
        status: form.status || "active",
      };

      const { error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", customer.id);
      if (error) throw error;
      toastShow("Customer updated", "ok");
      onSaved();
      onClose();
    } catch (err) {
      console.error("Save customer error:", err);
      toastShow(err.message || "Failed to save customer", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60">
          <h2 className="text-lg font-semibold text-zinc-100">Edit Customer</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Company Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
              Company Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange("name")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="ABC Freight Inc."
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Customer Type</label>
                <select
                  value={form.customer_type}
                  onChange={handleChange("customer_type")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
                >
                  <option value="shipper">Shipper</option>
                  <option value="broker">Broker</option>
                  <option value="carrier">Carrier</option>
                  <option value="consignee">Consignee</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={handleChange("status")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">MC Number</label>
                <input
                  type="text"
                  value={form.mc_number}
                  onChange={handleChange("mc_number")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="MC-123456"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">DOT Number</label>
                <input
                  type="text"
                  value={form.dot_number}
                  onChange={handleChange("dot_number")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="DOT-123456"
                />
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Primary Contact</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={form.contact_name}
                  onChange={handleChange("contact_name")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="John Smith"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.contact_phone}
                  onChange={handleChange("contact_phone")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Email</label>
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={handleChange("contact_email")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="john@abcfreight.com"
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Address</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">Address Line 1</label>
                <input
                  type="text"
                  value={form.address_line1}
                  onChange={handleChange("address_line1")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="123 Main St"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">Address Line 2</label>
                <input
                  type="text"
                  value={form.address_line2}
                  onChange={handleChange("address_line2")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="Suite 100"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={handleChange("city")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="Sacramento"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">State</label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={handleChange("state")}
                    maxLength={2}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 uppercase"
                    placeholder="CA"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">ZIP</label>
                  <input
                    type="text"
                    value={form.zip_code}
                    onChange={handleChange("zip_code")}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                    placeholder="95814"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Billing */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Billing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Payment Terms</label>
                <select
                  value={form.payment_terms}
                  onChange={handleChange("payment_terms")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
                >
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 45">Net 45</option>
                  <option value="Net 60">Net 60</option>
                  <option value="Quick Pay">Quick Pay</option>
                  <option value="COD">COD</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Credit Limit</label>
                <input
                  type="number"
                  value={form.credit_limit}
                  onChange={handleChange("credit_limit")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="50000"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={handleChange("notes")}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 resize-none"
              placeholder="Internal notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-700/60">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800/60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={cx(
                "px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium",
                saving && "opacity-60 cursor-not-allowed"
              )}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ----------------------- Delete Confirmation --------------------- */
function DeleteConfirm({ customer, onClose, onDeleted, show: toastShow }) {
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("id", customer.id);
      if (error) throw error;
      toastShow("Customer deleted", "ok");
      onDeleted();
      onClose();
      navigate("/customers");
    } catch (err) {
      console.error("Delete customer error:", err);
      toastShow(err.message || "Failed to delete customer", "err");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">Delete Customer?</h2>
        <p className="text-sm text-zinc-400 mb-6">
          Are you sure you want to delete{" "}
          <span className="text-zinc-200 font-medium">
            {customer.name || customer.company_name}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800/60"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={cx(
              "px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium",
              deleting && "opacity-60 cursor-not-allowed"
            )}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ page ----------------------------- */
export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadsLoading, setLoadsLoading] = useState(true);

  // Modals
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { show, ToastView } = useToast();

  const fetchCustomer = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      setCustomer(data);
    } catch (err) {
      console.error("Fetch customer error:", err);
      show(err.message || "Failed to load customer", "err");
    } finally {
      setLoading(false);
    }
  }, [id, show]);

  const fetchLoads = useCallback(async () => {
    if (!customer) return;
    setLoadsLoading(true);
    try {
      // Query loads by customer name (loads.customer is a text field)
      const customerName = customer.name || customer.company_name;
      if (!customerName) {
        setLoads([]);
        return;
      }

      const { data, error } = await supabase
        .from("loads")
        .select("id, reference, status, rate, origin, destination, pickup_at, delivery_at, created_at")
        .or(`customer.ilike.%${customerName}%,shipper.ilike.%${customerName}%`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setLoads(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch loads error:", err);
      // Don't show error toast for loads, just log it
    } finally {
      setLoadsLoading(false);
    }
  }, [customer]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  // Fetch loads after customer is loaded
  useEffect(() => {
    if (customer) {
      fetchLoads();
    }
  }, [customer, fetchLoads]);

  // Stats
  const stats = useMemo(() => {
    const totalLoads = loads.length;
    const totalRevenue = loads.reduce((sum, l) => sum + (Number(l.rate) || 0), 0);
    const deliveredCount = loads.filter((l) => l.status === "delivered").length;
    const inTransitCount = loads.filter((l) => l.status === "in_transit").length;
    return { totalLoads, totalRevenue, deliveredCount, inTransitCount };
  }, [loads]);

  const statusBadge = (status) => {
    const styles = {
      active: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      inactive: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
      on_hold: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    };
    const labels = {
      active: "Active",
      inactive: "Inactive",
      on_hold: "On Hold",
    };
    return (
      <span className={cx("px-2 py-0.5 rounded-full text-xs border", styles[status] || styles.inactive)}>
        {labels[status] || status || "—"}
      </span>
    );
  };

  const loadStatusBadge = (status) => {
    const styles = {
      delivered: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      in_transit: "bg-blue-500/10 text-blue-300 border-blue-500/30",
      pending: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      cancelled: "bg-rose-500/10 text-rose-300 border-rose-500/30",
      draft: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
    };
    return (
      <span className={cx("px-2 py-0.5 rounded-full text-xs border capitalize", styles[status] || styles.draft)}>
        {status?.replace(/_/g, " ") || "—"}
      </span>
    );
  };

  const typeBadge = (type) => {
    const styles = {
      shipper: "bg-blue-500/10 text-blue-300 border-blue-500/30",
      broker: "bg-purple-500/10 text-purple-300 border-purple-500/30",
      carrier: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      consignee: "bg-teal-500/10 text-teal-300 border-teal-500/30",
    };
    return (
      <span className={cx("px-2 py-0.5 rounded-full text-xs border capitalize", styles[type] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/30")}>
        {type || "—"}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="text-zinc-400">Loading customer…</div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-4 md:p-6">
        <div className="text-zinc-400">Customer not found.</div>
        <Link to="/customers" className="text-blue-400 hover:underline text-sm mt-2 inline-block">
          ← Back to Customers
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      {ToastView}

      {/* Back + Header */}
      <div className="mb-6">
        <Link
          to="/customers"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Customers
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-zinc-800 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-7 h-7 text-zinc-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-zinc-100">
                {customer.name || customer.company_name || "Unnamed Customer"}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                {typeBadge(customer.customer_type)}
                {statusBadge(customer.status)}
                {customer.mc_number && (
                  <span className="text-xs text-zinc-500">{customer.mc_number}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEditModal(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
            >
              <Pencil className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-600/40 text-rose-400 hover:bg-rose-600/10"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
            <TruckIcon className="w-4 h-4" />
            Total Loads
          </div>
          <div className="text-2xl font-semibold text-zinc-100">{stats.totalLoads}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
            <DollarSign className="w-4 h-4" />
            Total Revenue
          </div>
          <div className="text-2xl font-semibold text-zinc-100">{formatCurrency(stats.totalRevenue)}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Delivered
          </div>
          <div className="text-2xl font-semibold text-zinc-100">{stats.deliveredCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
            <TruckIcon className="w-4 h-4 text-blue-400" />
            In Transit
          </div>
          <div className="text-2xl font-semibold text-zinc-100">{stats.inTransitCount}</div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Customer Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Contact Info */}
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">Contact</h3>
            <div className="space-y-3">
              {customer.contact_name && (
                <div className="flex items-center gap-3">
                  <User className="w-4 h-4 text-zinc-500" />
                  <span className="text-zinc-200">{customer.contact_name}</span>
                </div>
              )}
              {customer.contact_phone && (
                <div className="flex items-center gap-3">
                  <Phone className="w-4 h-4 text-zinc-500" />
                  <a href={`tel:${customer.contact_phone}`} className="text-zinc-200 hover:text-blue-400">
                    {formatPhone(customer.contact_phone)}
                  </a>
                </div>
              )}
              {customer.contact_email && (
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-zinc-500" />
                  <a href={`mailto:${customer.contact_email}`} className="text-zinc-200 hover:text-blue-400 truncate">
                    {customer.contact_email}
                  </a>
                </div>
              )}
              {(customer.city || customer.state) && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-zinc-500" />
                  <span className="text-zinc-200">
                    {[customer.address_line1, customer.city, customer.state, customer.zip_code]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              )}
              {!customer.contact_name && !customer.contact_phone && !customer.contact_email && (
                <div className="text-zinc-500 text-sm">No contact info</div>
              )}
            </div>
          </div>

          {/* Billing Info */}
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">Billing</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Payment Terms</span>
                <span className="text-zinc-200">{customer.payment_terms || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Credit Limit</span>
                <span className="text-zinc-200">
                  {customer.credit_limit ? formatCurrency(customer.credit_limit) : "—"}
                </span>
              </div>
              {customer.avg_days_to_pay && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Avg Days to Pay</span>
                  <span className="text-zinc-200">{customer.avg_days_to_pay} days</span>
                </div>
              )}
              {customer.on_time_pay_rate && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">On-Time Pay Rate</span>
                  <span className="text-zinc-200">{(customer.on_time_pay_rate * 100).toFixed(0)}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {customer.notes && (
            <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-3">Notes</h3>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </div>

        {/* Right Column - Load History */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/60">
              <h3 className="text-sm font-medium text-zinc-100">Load History</h3>
              <button
                onClick={fetchLoads}
                className="p-1.5 rounded-lg hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
                title="Refresh"
              >
                <RefreshCw className={cx("w-4 h-4", loadsLoading && "animate-spin")} />
              </button>
            </div>

            {loadsLoading && (
              <div className="p-6 text-center text-zinc-400">Loading loads…</div>
            )}

            {!loadsLoading && loads.length === 0 && (
              <div className="p-6 text-center text-zinc-400">
                <TruckIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No loads for this customer yet.</p>
              </div>
            )}

            {!loadsLoading && loads.length > 0 && (
              <div className="divide-y divide-zinc-800/60">
                {loads.map((load) => (
                  <Link
                    key={load.id}
                    to={`/loads/${load.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/40 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-100">
                          #{load.reference || load.id.slice(0, 8)}
                        </span>
                        {loadStatusBadge(load.status)}
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {load.origin || "—"} → {load.destination || "—"}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <div className="text-sm font-medium text-zinc-200">
                        {formatCurrency(load.rate)}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {formatDateShort(load.pickup_at || load.created_at)}
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-zinc-500 ml-3" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showEditModal && (
        <EditCustomerModal
          customer={customer}
          onClose={() => setShowEditModal(false)}
          onSaved={fetchCustomer}
          show={show}
        />
      )}

      {showDeleteModal && (
        <DeleteConfirm
          customer={customer}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {}}
          show={show}
        />
      )}
    </div>
  );
}