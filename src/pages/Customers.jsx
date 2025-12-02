// FILE: src/pages/Customers.jsx
// Purpose: Customer management - add, edit, view customers
// With pagination for performance

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  RefreshCw,
  Plus,
  Search as SearchIcon,
  Building2,
  Phone,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  TruckIcon,
  User,
} from "lucide-react";

/* ---------------------------- constants -------------------------- */
const PAGE_SIZE = 25;

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

/* ----------------------- Add/Edit Customer Modal ----------------- */
function CustomerModal({ customer, onClose, onSaved, show: toastShow }) {
  const isEdit = !!customer?.id;
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

      if (isEdit) {
        const { error } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", customer.id);
        if (error) throw error;
        toastShow("Customer updated", "ok");
      } else {
        const { error } = await supabase.from("customers").insert([payload]);
        if (error) throw error;
        toastShow("Customer added", "ok");
      }

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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60">
          <h2 className="text-lg font-semibold text-zinc-100">
            {isEdit ? "Edit Customer" : "Add Customer"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Company Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
              Company Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">
                  Company Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange("name")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="ABC Freight Inc."
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">
                  Customer Type
                </label>
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
                <label className="block text-sm text-zinc-400 mb-1">
                  MC Number
                </label>
                <input
                  type="text"
                  value={form.mc_number}
                  onChange={handleChange("mc_number")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="MC-123456"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">
                  DOT Number
                </label>
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

          {/* Primary Contact */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
              Primary Contact
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">
                  Contact Name
                </label>
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
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
              Address
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">
                  Address Line 1
                </label>
                <input
                  type="text"
                  value={form.address_line1}
                  onChange={handleChange("address_line1")}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
                  placeholder="123 Main St"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-zinc-400 mb-1">
                  Address Line 2
                </label>
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
                  <label className="block text-sm text-zinc-400 mb-1">
                    State
                  </label>
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
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
              Billing
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-1">
                  Payment Terms
                </label>
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
                <label className="block text-sm text-zinc-400 mb-1">
                  Credit Limit
                </label>
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
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={handleChange("notes")}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 resize-none"
                placeholder="Internal notes about this customer..."
              />
            </div>
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
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Customer"}
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
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">
          Delete Customer?
        </h2>
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

/* ----------------------- Row Actions Dropdown -------------------- */
function RowActions({ customer, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="p-2 rounded-lg hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl z-20 py-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onEdit(customer);
            }}
            className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800/60 flex items-center gap-2"
          >
            <Pencil className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete(customer);
            }}
            className="w-full px-3 py-2 text-left text-sm text-rose-400 hover:bg-zinc-800/60 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ page ----------------------------- */
export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [deleteCustomer, setDeleteCustomer] = useState(null);

  const { show, ToastView } = useToast();

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      // Build query
      let query = supabase
        .from("customers")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Apply status filter
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      // Apply search filter (server-side for better performance)
      if (q.trim()) {
        query = query.or(
          `name.ilike.%${q.trim()}%,company_name.ilike.%${q.trim()}%,mc_number.ilike.%${q.trim()}%,city.ilike.%${q.trim()}%,contact_name.ilike.%${q.trim()}%`
        );
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setCustomers(Array.isArray(data) ? data : []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error("Fetch customers error:", err);
      show(err.message || "Failed to load customers", "err");
    } finally {
      setLoading(false);
    }
  }, [show, page, statusFilter, q]);

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0);
  }, [q, statusFilter]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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
      <span
        className={cx(
          "px-2 py-0.5 rounded-full text-xs border",
          styles[status] || styles.inactive
        )}
      >
        {labels[status] || status || "—"}
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
      <span
        className={cx(
          "px-2 py-0.5 rounded-full text-xs border capitalize",
          styles[type] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
        )}
      >
        {type || "—"}
      </span>
    );
  };

  return (
    <div className="p-4 md:p-6">
      {ToastView}

      {/* Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30">
            <Building2 className="w-4 h-4 text-blue-300" />
          </span>
          <h1 className="text-xl font-semibold text-zinc-100">Customers</h1>
          <span className="ml-2 px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-xs">
            {totalCount}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchCustomers}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
            title="Refresh"
          >
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Customer
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-zinc-700/60 bg-zinc-900/40 text-zinc-200 w-full sm:max-w-md">
          <SearchIcon className="w-4 h-4 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-transparent outline-none w-full placeholder:text-zinc-500"
            placeholder="Search by name, MC#, city, contact..."
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-zinc-700/60 bg-zinc-900/40 text-zinc-200 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="on_hold">On Hold</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-zinc-700/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-900/50 text-xs text-zinc-400 border-b border-zinc-700/60">
                <th className="px-4 py-3 text-left font-medium">Customer</th>
                <th className="px-4 py-3 text-left font-medium">Contact</th>
                <th className="px-4 py-3 text-left font-medium">Location</th>
                <th className="px-4 py-3 text-center font-medium">Type</th>
                <th className="px-4 py-3 text-center font-medium">Loads</th>
                <th className="px-4 py-3 text-center font-medium">Terms</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium w-16">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                    Loading customers…
                  </td>
                </tr>
              )}

              {!loading && customers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                    No customers found.{" "}
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="text-blue-400 hover:underline"
                    >
                      Add your first customer
                    </button>
                  </td>
                </tr>
              )}

              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-zinc-900/40 cursor-pointer"
                  onClick={() => navigate(`/customers/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-4 h-4 text-zinc-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-100 truncate">
                          {c.name || c.company_name || "Unnamed"}
                        </div>
                        {c.mc_number && (
                          <div className="text-xs text-zinc-500">
                            {c.mc_number}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {c.contact_name && (
                        <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                          <User className="w-3.5 h-3.5 flex-shrink-0 text-zinc-500" />
                          {c.contact_name}
                        </div>
                      )}
                      {c.contact_phone && (
                        <div className="flex items-center gap-1.5 text-sm text-zinc-400">
                          <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                          {formatPhone(c.contact_phone)}
                        </div>
                      )}
                      {c.contact_email && (
                        <div className="flex items-center gap-1.5 text-sm text-zinc-400 truncate max-w-[180px]">
                          <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                          {c.contact_email}
                        </div>
                      )}
                      {!c.contact_name && !c.contact_phone && !c.contact_email && (
                        <span className="text-sm text-zinc-600">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.city || c.state ? (
                      <div className="flex items-center gap-1.5 text-sm text-zinc-400">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        {[c.city, c.state].filter(Boolean).join(", ")}
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {typeBadge(c.customer_type)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-sm text-zinc-300">
                      <TruckIcon className="w-3.5 h-3.5 text-zinc-500" />
                      {c.total_loads || 0}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-zinc-400">
                    {c.payment_terms || "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {statusBadge(c.status)}
                  </td>
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActions
                      customer={c}
                      onEdit={(cust) => setEditCustomer(cust)}
                      onDelete={(cust) => setDeleteCustomer(cust)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800/60 bg-zinc-900/30">
            <div className="text-sm text-zinc-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className={cx(
                  "p-2 rounded-lg border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800/60",
                  page === 0 && "opacity-40 cursor-not-allowed"
                )}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-zinc-400 px-2">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={cx(
                  "p-2 rounded-lg border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800/60",
                  page >= totalPages - 1 && "opacity-40 cursor-not-allowed"
                )}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddModal && (
        <CustomerModal
          customer={null}
          onClose={() => setShowAddModal(false)}
          onSaved={fetchCustomers}
          show={show}
        />
      )}

      {editCustomer && (
        <CustomerModal
          customer={editCustomer}
          onClose={() => setEditCustomer(null)}
          onSaved={fetchCustomers}
          show={show}
        />
      )}

      {deleteCustomer && (
        <DeleteConfirm
          customer={deleteCustomer}
          onClose={() => setDeleteCustomer(null)}
          onDeleted={fetchCustomers}
          show={show}
        />
      )}
    </div>
  );
}