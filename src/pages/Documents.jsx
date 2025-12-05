// FILE: src/pages/Documents.jsx
// Purpose: Document management - upload, view, filter, link to loads/customers/drivers
// With pagination, drag & drop upload, preview modal

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  RefreshCw,
  Plus,
  Search as SearchIcon,
  FileText,
  File,
  FileImage,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Upload,
  AlertTriangle,
  Eye,
  Download,
  Truck,
  Building2,
  UserRound,
  Clock,
} from "lucide-react";

/* ---------------------------- constants -------------------------- */
const PAGE_SIZE = 25;

const DOCUMENT_TYPES = [
  { value: "rate_confirmation", label: "Rate Confirmation", color: "blue", linkTo: ["load", "customer"] },
  { value: "bol", label: "BOL", color: "purple", linkTo: ["load"] },
  { value: "pod", label: "POD", color: "emerald", linkTo: ["load"] },
  { value: "carrier_packet", label: "Carrier Packet", color: "amber", linkTo: [] }, // Company doc
  { value: "contract", label: "Contract", color: "sky", linkTo: ["customer"] },
  { value: "insurance", label: "Insurance", color: "rose", linkTo: [] }, // Company doc
  { value: "w9", label: "W9", color: "orange", linkTo: ["customer"] }, // Could be ours or customer's
  { value: "authority", label: "Authority", color: "indigo", linkTo: [] }, // Company doc
  { value: "cdl", label: "CDL", color: "teal", linkTo: ["driver"], required: "driver" },
  { value: "medical_card", label: "Medical Card", color: "pink", linkTo: ["driver"], required: "driver" },
  { value: "mvr", label: "MVR", color: "cyan", linkTo: ["driver"], required: "driver" },
  { value: "other", label: "Other", color: "zinc", linkTo: ["load", "customer", "driver"] },
];

/* ---------------------------- helpers ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const expDate = new Date(expiresAt);
  const now = new Date();
  const daysUntil = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
  return daysUntil <= 30 && daysUntil > 0;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function getFileIcon(fileType) {
  if (!fileType) return File;
  const type = fileType.toLowerCase();
  if (type === "pdf" || type === "application/pdf") return FileText;
  if (type.startsWith("image") || ["png", "jpg", "jpeg", "webp", "tiff"].includes(type)) return FileImage;
  return File;
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

/* ----------------------- Upload Document Modal ------------------- */
function UploadModal({ onClose, onUploaded, show: toastShow, preselect, orgId }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({
    document_type: preselect?.document_type || "other",
    load_id: preselect?.load_id || "",
    customer_id: preselect?.customer_id || "",
    driver_id: preselect?.driver_id || "",
    expires_at: "",
    notes: "",
  });

  // Lookup data for linking
  const [loads, setLoads] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Get current document type config
  const currentDocType =
    DOCUMENT_TYPES.find((dt) => dt.value === form.document_type) ||
    DOCUMENT_TYPES[DOCUMENT_TYPES.length - 1];
  const showLoad = currentDocType.linkTo.includes("load");
  const showCustomer = currentDocType.linkTo.includes("customer");
  const showDriver = currentDocType.linkTo.includes("driver");
  const requiredField = currentDocType.required;
  const isCompanyDoc = currentDocType.linkTo.length === 0;

  useEffect(() => {
    async function fetchLookups() {
      setLoadingLookups(true);
      try {
        // If we have orgId from parent, use it to further scope queries on top of RLS.
        let loadsQuery = supabase
          .from("loads")
          .select("id, reference, origin, destination")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(100);

        let customersQuery = supabase
          .from("customers")
          .select("id, name, company_name")
          .is("deleted_at", null)
          .eq("status", "active")
          .order("name", { ascending: true })
          .limit(100);

        let driversQuery = supabase
          .from("drivers")
          .select("id, full_name, first_name, last_name")
          .order("full_name", { ascending: true })
          .limit(100);

        if (orgId) {
          loadsQuery = loadsQuery.eq("org_id", orgId);
          customersQuery = customersQuery.eq("org_id", orgId);
          driversQuery = driversQuery.eq("org_id", orgId);
        }

        const [loadsRes, customersRes, driversRes] = await Promise.all([
          loadsQuery,
          customersQuery,
          driversQuery,
        ]);

        if (loadsRes.data) setLoads(loadsRes.data);
        if (customersRes.data) setCustomers(customersRes.data);
        if (driversRes.data) setDrivers(driversRes.data);
      } catch (err) {
        console.error("Failed to fetch lookups:", err);
      } finally {
        setLoadingLookups(false);
      }
    }
    fetchLookups();
  }, [orgId]);

  // Clear irrelevant links when document type changes
  useEffect(() => {
    setForm((f) => ({
      ...f,
      load_id: showLoad ? f.load_id : "",
      customer_id: showCustomer ? f.customer_id : "",
      driver_id: showDriver ? f.driver_id : "",
    }));
  }, [form.document_type, showLoad, showCustomer, showDriver]);

  const handleChange = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  };

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...selected]);
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (files.length === 0) {
      toastShow("Please select at least one file", "err");
      return;
    }

    // Validate required linking
    if (requiredField === "driver" && !form.driver_id) {
      toastShow(`${currentDocType.label} requires selecting a driver`, "err");
      return;
    }
    if (requiredField === "load" && !form.load_id) {
      toastShow(`${currentDocType.label} requires selecting a load`, "err");
      return;
    }
    if (requiredField === "customer" && !form.customer_id) {
      toastShow(`${currentDocType.label} requires selecting a customer`, "err");
      return;
    }

    setUploading(true);
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Prefer orgId from parent; fall back to RPC if not provided.
      let effectiveOrgId = orgId;
      if (!effectiveOrgId) {
        const { data: orgData, error: orgError } = await supabase.rpc("current_org_id");
        if (orgError) throw orgError;
        if (!orgData) throw new Error("No org found");
        effectiveOrgId = orgData;
      }

      let uploadedCount = 0;

      for (const file of files) {
        // Generate unique file path: org_id/document_type/timestamp_filename
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const filePath = `${effectiveOrgId}/${form.document_type}/${timestamp}_${safeName}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(filePath, file, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) {
          console.error("Upload error:", uploadError);
          toastShow(`Failed to upload ${file.name}: ${uploadError.message}`, "err");
          continue;
        }

        // Get public URL (will be signed URL since bucket is private)
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(filePath);

        // Insert document record
        const docPayload = {
          org_id: effectiveOrgId,
          name: file.name,
          file_path: filePath,
          file_url: urlData?.publicUrl || null,
          file_type: file.type || file.name.split(".").pop(),
          file_size: file.size,
          document_type: form.document_type,
          load_id: form.load_id || null,
          customer_id: form.customer_id || null,
          driver_id: form.driver_id || null,
          expires_at: form.expires_at || null,
          notes: form.notes.trim() || null,
          uploaded_by: user.id,
        };

        const { error: insertError } = await supabase.from("documents").insert([docPayload]);

        if (insertError) {
          console.error("Insert error:", insertError);
          toastShow(`Failed to save ${file.name}: ${insertError.message}`, "err");
          continue;
        }

        uploadedCount++;
      }

      if (uploadedCount > 0) {
        toastShow(
          `${uploadedCount} document${uploadedCount > 1 ? "s" : ""} uploaded`,
          "ok"
        );
        onUploaded();
        onClose();
      }
    } catch (err) {
      console.error("Upload error:", err);
      toastShow(err.message || "Failed to upload documents", "err");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60">
          <h2 className="text-lg font-semibold text-zinc-100">Upload Documents</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cx(
              "border-2 border-dashed rounded-xl p-8 text-center transition-colors",
              dragOver
                ? "border-blue-500 bg-blue-500/10"
                : "border-zinc-700/60 hover:border-zinc-600"
            )}
          >
            <Upload className="w-10 h-10 mx-auto text-zinc-500 mb-3" />
            <p className="text-sm text-zinc-300 mb-1">
              Drag & drop files here, or{" "}
              <label className="text-blue-400 hover:underline cursor-pointer">
                browse
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
                />
              </label>
            </p>
            <p className="text-xs text-zinc-500">
              PDF, PNG, JPG, WEBP, TIFF up to 50MB
            </p>
          </div>

          {/* Selected Files */}
          {files.length > 0 && (
            <div className="space-y-2">
              <label className="block text-sm text-zinc-400">Selected Files</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                      <span className="text-sm text-zinc-200 truncate">
                        {file.name}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Document Type */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Document Type *
            </label>
            <select
              value={form.document_type}
              onChange={handleChange("document_type")}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
            >
              {DOCUMENT_TYPES.map((dt) => (
                <option key={dt.value} value={dt.value}>
                  {dt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Smart Linking Section */}
          {!isCompanyDoc && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide flex items-center gap-2">
                Link To
                {requiredField && (
                  <span className="text-xs text-amber-400 normal-case font-normal">
                    (Required for {currentDocType.label})
                  </span>
                )}
              </h3>

              <div
                className={cx(
                  "grid gap-4",
                  showLoad && showCustomer && showDriver
                    ? "grid-cols-1 md:grid-cols-3"
                    : (showLoad && showCustomer) ||
                      (showLoad && showDriver) ||
                      (showCustomer && showDriver)
                    ? "grid-cols-1 md:grid-cols-2"
                    : "grid-cols-1"
                )}
              >
                {/* Load dropdown */}
                {showLoad && (
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">
                      <span className="flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5" />
                        Load{" "}
                        {requiredField === "load" && (
                          <span className="text-rose-400">*</span>
                        )}
                      </span>
                    </label>
                    <select
                      value={form.load_id}
                      onChange={handleChange("load_id")}
                      disabled={loadingLookups}
                      className={cx(
                        "w-full px-3 py-2 rounded-lg bg-zinc-800/60 border text-zinc-100 focus:outline-none focus:border-blue-500/50",
                        requiredField === "load" && !form.load_id
                          ? "border-amber-500/50"
                          : "border-zinc-700/60"
                      )}
                    >
                      <option value="">Select a load...</option>
                      {loads.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.reference || `${l.origin} → ${l.destination}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Customer dropdown */}
                {showCustomer && (
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" />
                        Customer{" "}
                        {requiredField === "customer" && (
                          <span className="text-rose-400">*</span>
                        )}
                      </span>
                    </label>
                    <select
                      value={form.customer_id}
                      onChange={handleChange("customer_id")}
                      disabled={loadingLookups}
                      className={cx(
                        "w-full px-3 py-2 rounded-lg bg-zinc-800/60 border text-zinc-100 focus:outline-none focus:border-blue-500/50",
                        requiredField === "customer" && !form.customer_id
                          ? "border-amber-500/50"
                          : "border-zinc-700/60"
                      )}
                    >
                      <option value="">Select a customer...</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.company_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Driver dropdown */}
                {showDriver && (
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">
                      <span className="flex items-center gap-1.5">
                        <UserRound className="w-3.5 h-3.5" />
                        Driver{" "}
                        {requiredField === "driver" && (
                          <span className="text-rose-400">*</span>
                        )}
                      </span>
                    </label>
                    <select
                      value={form.driver_id}
                      onChange={handleChange("driver_id")}
                      disabled={loadingLookups}
                      className={cx(
                        "w-full px-3 py-2 rounded-lg bg-zinc-800/60 border text-zinc-100 focus:outline-none focus:border-blue-500/50",
                        requiredField === "driver" && !form.driver_id
                          ? "border-amber-500/50"
                          : "border-zinc-700/60"
                      )}
                    >
                      <option value="">Select a driver...</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name || `${d.first_name} ${d.last_name}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Company Doc Notice */}
          {isCompanyDoc && (
            <div className="px-4 py-3 rounded-lg bg-zinc-800/40 border border-zinc-700/40">
              <p className="text-sm text-zinc-400">
                <span className="text-zinc-300 font-medium">
                  {currentDocType.label}
                </span>{" "}
                is a company-level document and doesn't need to be linked to a
                specific load, customer, or driver.
              </p>
            </div>
          )}

          {/* Expiration - show for certain doc types */}
          {["cdl", "medical_card", "insurance", "authority"].includes(
            form.document_type
          ) && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                Expiration Date{" "}
                {["cdl", "medical_card"].includes(form.document_type) && (
                  <span className="text-rose-400">*</span>
                )}
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={handleChange("expires_at")}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
              />
              <p className="mt-1 text-xs text-zinc-500">
                We'll alert you when this document is expiring soon
              </p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={handleChange("notes")}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 resize-none"
              placeholder="Optional notes about this document..."
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
              disabled={uploading || files.length === 0}
              className={cx(
                "px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-2",
                (uploading || files.length === 0) &&
                  "opacity-60 cursor-not-allowed"
              )}
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload {files.length > 0 && `(${files.length})`}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ----------------------- Edit Document Modal --------------------- */
function EditModal({ document, onClose, onSaved, show: toastShow, orgId }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: document?.name || "",
    document_type: document?.document_type || "other",
    load_id: document?.load_id || "",
    customer_id: document?.customer_id || "",
    driver_id: document?.driver_id || "",
    expires_at: document?.expires_at ? document.expires_at.split("T")[0] : "",
    notes: document?.notes || "",
  });

  // Lookup data
  const [loads, setLoads] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [drivers, setDrivers] = useState([]);

  useEffect(() => {
    async function fetchLookups() {
      try {
        let loadsQuery = supabase
          .from("loads")
          .select("id, reference, origin, destination")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(100);

        let customersQuery = supabase
          .from("customers")
          .select("id, name, company_name")
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .limit(100);

        let driversQuery = supabase
          .from("drivers")
          .select("id, full_name, first_name, last_name")
          .order("full_name", { ascending: true })
          .limit(100);

        if (orgId) {
          loadsQuery = loadsQuery.eq("org_id", orgId);
          customersQuery = customersQuery.eq("org_id", orgId);
          driversQuery = driversQuery.eq("org_id", orgId);
        }

        const [loadsRes, customersRes, driversRes] = await Promise.all([
          loadsQuery,
          customersQuery,
          driversQuery,
        ]);

        if (loadsRes.data) setLoads(loadsRes.data);
        if (customersRes.data) setCustomers(customersRes.data);
        if (driversRes.data) setDrivers(driversRes.data);
      } catch (err) {
        console.error("Failed to fetch lookups:", err);
      }
    }
    fetchLookups();
  }, [orgId]);

  const handleChange = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toastShow("Document name is required", "err");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        document_type: form.document_type,
        load_id: form.load_id || null,
        customer_id: form.customer_id || null,
        driver_id: form.driver_id || null,
        expires_at: form.expires_at || null,
        notes: form.notes.trim() || null,
      };

      let query = supabase.from("documents").update(payload).eq("id", document.id);
      // Extra safety: also require the current org_id if we know it.
      if (orgId) {
        query = query.eq("org_id", orgId);
      }

      const { error } = await query;

      if (error) throw error;
      toastShow("Document updated", "ok");
      onSaved();
      onClose();
    } catch (err) {
      console.error("Update error:", err);
      toastShow(err.message || "Failed to update document", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60">
          <h2 className="text-lg font-semibold text-zinc-100">Edit Document</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={handleChange("name")}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Document Type</label>
            <select
              value={form.document_type}
              onChange={handleChange("document_type")}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
            >
              {DOCUMENT_TYPES.map((dt) => (
                <option key={dt.value} value={dt.value}>
                  {dt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Load</label>
              <select
                value={form.load_id}
                onChange={handleChange("load_id")}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
              >
                <option value="">None</option>
                {loads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.reference || `${l.origin} → ${l.destination}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Customer</label>
              <select
                value={form.customer_id}
                onChange={handleChange("customer_id")}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
              >
                <option value="">None</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.company_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Driver</label>
              <select
                value={form.driver_id}
                onChange={handleChange("driver_id")}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
              >
                <option value="">None</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name || `${d.first_name} ${d.last_name}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Expiration Date</label>
            <input
              type="date"
              value={form.expires_at}
              onChange={handleChange("expires_at")}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={handleChange("notes")}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 resize-none"
            />
          </div>

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
function DeleteConfirm({ document, onClose, onDeleted, show: toastShow, orgId }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // Soft delete - set deleted_at (extra safety: scoped by org_id if we know it)
      let query = supabase
        .from("documents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", document.id);

      if (orgId) {
        query = query.eq("org_id", orgId);
      }

      const { error } = await query;
      if (error) throw error;

      toastShow("Document deleted", "ok");
      onDeleted();
      onClose();
    } catch (err) {
      console.error("Delete error:", err);
      toastShow(err.message || "Failed to delete document", "err");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">
          Delete Document?
        </h2>
        <p className="text-sm text-zinc-400 mb-6">
          Are you sure you want to delete{" "}
          <span className="text-zinc-200 font-medium">{document.name}</span>?
          This action cannot be undone.
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

/* ----------------------- Preview Modal --------------------------- */
function PreviewModal({ document, onClose }) {
  const [loading, setLoading] = useState(true);
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    async function getSignedUrl() {
      try {
        const { data, error } = await supabase.storage
          .from("documents")
          .createSignedUrl(document.file_path, 3600); // 1 hour

        if (error) throw error;
        setSignedUrl(data.signedUrl);
      } catch (err) {
        console.error("Failed to get signed URL:", err);
      } finally {
        setLoading(false);
      }
    }
    getSignedUrl();
  }, [document.file_path]);

  const fileType = document.file_type?.toLowerCase() || "";
  const isImage =
    fileType.startsWith("image") ||
    ["png", "jpg", "jpeg", "webp", "tiff"].includes(fileType);
  const isPdf = fileType === "pdf" || fileType === "application/pdf";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-5xl max-h-[95vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-zinc-400 flex-shrink-0" />
            <span className="text-lg font-semibold text-zinc-100 truncate">
              {document.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {signedUrl && (
              <a
                href={signedUrl}
                download={document.name}
                className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 bg-zinc-950">
          {loading ? (
            <div className="flex items-center justify-center h-96">
              <RefreshCw className="w-8 h-8 text-zinc-500 animate-spin" />
            </div>
          ) : signedUrl ? (
            <>
              {isPdf && (
                <iframe
                  src={signedUrl}
                  className="w-full h-[80vh] rounded-lg border border-zinc-700/60"
                  title={document.name}
                />
              )}
              {isImage && (
                <img
                  src={signedUrl}
                  alt={document.name}
                  className="max-w-full max-h-[80vh] mx-auto rounded-lg"
                />
              )}
              {!isPdf && !isImage && (
                <div className="flex flex-col items-center justify-center h-96 text-zinc-400">
                  <File className="w-16 h-16 mb-4" />
                  <p className="mb-4">
                    Preview not available for this file type
                  </p>
                  <a
                    href={signedUrl}
                    download={document.name}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Download File
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-96 text-zinc-400">
              Failed to load document
            </div>
          )}
        </div>

        {/* Footer with metadata */}
        <div className="px-6 py-3 border-t border-zinc-700/60 bg-zinc-900/50">
          <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
            <span>Size: {formatBytes(document.file_size)}</span>
            <span>Type: {document.file_type}</span>
            <span>Uploaded: {formatDateTime(document.created_at)}</span>
            {document.expires_at && (
              <span
                className={
                  isExpired(document.expires_at) ? "text-rose-400" : ""
                }
              >
                Expires: {formatDate(document.expires_at)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- Row Actions Dropdown -------------------- */
function RowActions({ doc, onPreview, onEdit, onDelete }) {
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
        <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl z-20 py-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onPreview(doc);
            }}
            className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800/60 flex items-center gap-2"
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onEdit(doc);
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
              onDelete(doc);
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
export default function Documents() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [documents, setDocuments] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState(
    searchParams.get("type") || "all"
  );
  const [expirationFilter, setExpirationFilter] = useState("all");
  const [page, setPage] = useState(0);

  // Org context (critical for multi-tenant safety)
  const [orgId, setOrgId] = useState(null);
  const [orgLoading, setOrgLoading] = useState(true);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editDocument, setEditDocument] = useState(null);
  const [deleteDocument, setDeleteDocument] = useState(null);
  const [previewDocument, setPreviewDocument] = useState(null);

  const { show, ToastView } = useToast();

  // Load current org_id once
  useEffect(() => {
    async function loadOrg() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setOrgId(null);
          return;
        }

        const { data: orgData, error: orgError } = await supabase.rpc(
          "current_org_id"
        );
        if (orgError) throw orgError;
        setOrgId(orgData || null);
      } catch (err) {
        console.error("Failed to load org context:", err);
        show("Failed to load org context", "err");
        setOrgId(null);
      } finally {
        setOrgLoading(false);
      }
    }
    loadOrg();
  }, [show]);

  const fetchDocuments = useCallback(async () => {
    // Don't query until we know org status
    if (orgLoading) return;

    // If for some reason there's no org, fail closed: show nothing.
    if (!orgId) {
      setDocuments([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let query = supabase
        .from("documents_with_relations")
        .select("*", { count: "exact" })
        // 🔒 Critical: scope to current org_id so we never see cross-org docs
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Type filter
      if (typeFilter !== "all") {
        query = query.eq("document_type", typeFilter);
      }

      // Expiration filter
      if (expirationFilter === "expired") {
        query = query.lt("expires_at", new Date().toISOString());
      } else if (expirationFilter === "expiring_soon") {
        const now = new Date();
        const thirtyDaysFromNow = new Date(
          now.getTime() + 30 * 24 * 60 * 60 * 1000
        );
        query = query
          .gte("expires_at", now.toISOString())
          .lte("expires_at", thirtyDaysFromNow.toISOString());
      }

      // Search filter
      if (q.trim()) {
        query = query.or(
          `name.ilike.%${q.trim()}%,notes.ilike.%${q.trim()}%,load_reference.ilike.%${q.trim()}%,customer_name.ilike.%${q.trim()}%,driver_name.ilike.%${q.trim()}%`
        );
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setDocuments(Array.isArray(data) ? data : []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error("Fetch documents error:", err);
      show(err.message || "Failed to load documents", "err");
    } finally {
      setLoading(false);
    }
  }, [show, page, typeFilter, expirationFilter, q, orgId, orgLoading]);

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0);
  }, [q, typeFilter, expirationFilter]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Update URL params when filter changes
  useEffect(() => {
    if (typeFilter !== "all") {
      setSearchParams({ type: typeFilter });
    } else {
      setSearchParams({});
    }
  }, [typeFilter, setSearchParams]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const typeBadge = (type) => {
    const dt = DOCUMENT_TYPES.find((d) => d.value === type);
    const colorMap = {
      blue: "bg-blue-500/10 text-blue-300 border-blue-500/30",
      purple: "bg-purple-500/10 text-purple-300 border-purple-500/30",
      emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      sky: "bg-sky-500/10 text-sky-300 border-sky-500/30",
      rose: "bg-rose-500/10 text-rose-300 border-rose-500/30",
      orange: "bg-orange-500/10 text-orange-300 border-orange-500/30",
      indigo: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
      teal: "bg-teal-500/10 text-teal-300 border-teal-500/30",
      pink: "bg-pink-500/10 text-pink-300 border-pink-500/30",
      cyan: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
      zinc: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
    };

    return (
      <span
        className={cx(
          "px-2 py-0.5 rounded-full text-xs border whitespace-nowrap",
          colorMap[dt?.color] || colorMap.zinc
        )}
      >
        {dt?.label || type || "Other"}
      </span>
    );
  };

  // Count expiring/expired for quick stats
  const expiringCount = documents.filter((d) => isExpiringSoon(d.expires_at))
    .length;
  const expiredCount = documents.filter((d) => isExpired(d.expires_at)).length;

  return (
    <div className="p-4 md:p-6">
      {ToastView}

      {/* Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30">
            <FileText className="w-4 h-4 text-purple-300" />
          </span>
          <h1 className="text-xl font-semibold text-zinc-100">Documents</h1>
          <span className="ml-2 px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-xs">
            {totalCount}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDocuments}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
            title="Refresh"
          >
            <RefreshCw
              className={cx("w-4 h-4", loading && "animate-spin")}
            />
            Refresh
          </button>

          <button
            onClick={() => setShowUploadModal(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            <Plus className="w-4 h-4" />
            Upload
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      {(expiringCount > 0 || expiredCount > 0) && (
        <div className="mb-4 flex flex-wrap gap-3">
          {expiredCount > 0 && (
            <button
              onClick={() => setExpirationFilter("expired")}
              className={cx(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm",
                expirationFilter === "expired"
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                  : "border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
              )}
            >
              <AlertTriangle className="w-4 h-4" />
              {expiredCount} Expired
            </button>
          )}
          {expiringCount > 0 && (
            <button
              onClick={() => setExpirationFilter("expiring_soon")}
              className={cx(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm",
                expirationFilter === "expiring_soon"
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                  : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              )}
            >
              <Clock className="w-4 h-4" />
              {expiringCount} Expiring Soon
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-zinc-700/60 bg-zinc-900/40 text-zinc-200 w-full sm:max-w-md">
          <SearchIcon className="w-4 h-4 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-transparent outline-none w-full placeholder:text-zinc-500"
            placeholder="Search by name, load, customer, driver..."
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-zinc-700/60 bg-zinc-900/40 text-zinc-200 focus:outline-none"
        >
          <option value="all">All Types</option>
          {DOCUMENT_TYPES.map((dt) => (
            <option key={dt.value} value={dt.value}>
              {dt.label}
            </option>
          ))}
        </select>

        <select
          value={expirationFilter}
          onChange={(e) => setExpirationFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-zinc-700/60 bg-zinc-900/40 text-zinc-200 focus:outline-none"
        >
          <option value="all">All Documents</option>
          <option value="expiring_soon">Expiring Soon (30 days)</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-zinc-700/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-900/50 text-xs text-zinc-400 border-b border-zinc-700/60">
                <th className="px-4 py-3 text-left font-medium">Document</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Linked To</th>
                <th className="px-4 py-3 text-center font-medium">Size</th>
                <th className="px-4 py-3 text-center font-medium">Expires</th>
                <th className="px-4 py-3 text-left font-medium">Uploaded</th>
                <th className="px-4 py-3 text-right font-medium w-16">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-zinc-400"
                  >
                    Loading documents…
                  </td>
                </tr>
              )}

              {!loading && documents.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-zinc-400"
                  >
                    No documents found.{" "}
                    <button
                      onClick={() => setShowUploadModal(true)}
                      className="text-blue-400 hover:underline"
                    >
                      Upload your first document
                    </button>
                  </td>
                </tr>
              )}

              {documents.map((doc) => {
                const FileIcon = getFileIcon(doc.file_type);
                const expired = isExpired(doc.expires_at);
                const expiringSoon = isExpiringSoon(doc.expires_at);

                return (
                  <tr
                    key={doc.id}
                    className="hover:bg-zinc-900/40 cursor-pointer"
                    onClick={() => setPreviewDocument(doc)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                          <FileIcon className="w-4 h-4 text-zinc-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-zinc-100 truncate max-w-[200px]">
                            {doc.name}
                          </div>
                          {doc.notes && (
                            <div className="text-xs text-zinc-500 truncate max-w-[200px]">
                              {doc.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {typeBadge(doc.document_type)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {doc.load_reference && (
                          <div
                            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-blue-400 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/loads/${doc.load_id}`);
                            }}
                          >
                            <Truck className="w-3 h-3" />
                            {doc.load_reference}
                          </div>
                        )}
                        {doc.customer_name && (
                          <div
                            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-blue-400 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/customers/${doc.customer_id}`);
                            }}
                          >
                            <Building2 className="w-3 h-3" />
                            {doc.customer_name}
                          </div>
                        )}
                        {doc.driver_name && (
                          <div
                            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-blue-400 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/drivers/${doc.driver_id}`);
                            }}
                          >
                            <UserRound className="w-3 h-3" />
                            {doc.driver_name}
                          </div>
                        )}
                        {!doc.load_reference &&
                          !doc.customer_name &&
                          !doc.driver_name && (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-zinc-400">
                      {formatBytes(doc.file_size)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {doc.expires_at ? (
                        <div
                          className={cx(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
                            expired &&
                              "bg-rose-500/10 text-rose-300 border border-rose-500/30",
                            expiringSoon &&
                              !expired &&
                              "bg-amber-500/10 text-amber-300 border border-amber-500/30",
                            !expired &&
                              !expiringSoon &&
                              "text-zinc-400"
                          )}
                        >
                          {(expired || expiringSoon) && (
                            <AlertTriangle className="w-3 h-3" />
                          )}
                          {formatDate(doc.expires_at)}
                        </div>
                      ) : (
                        <span className="text-sm text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-400">
                        {formatDate(doc.created_at)}
                      </div>
                      {doc.uploaded_by_name && (
                        <div className="text-xs text-zinc-500">
                          {doc.uploaded_by_name}
                        </div>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowActions
                        doc={doc}
                        onPreview={(d) => setPreviewDocument(d)}
                        onEdit={(d) => setEditDocument(d)}
                        onDelete={(d) => setDeleteDocument(d)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800/60 bg-zinc-900/30">
            <div className="text-sm text-zinc-500">
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
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
                  page >= totalPages - 1 &&
                    "opacity-40 cursor-not-allowed"
                )}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onUploaded={fetchDocuments}
          show={show}
          orgId={orgId}
        />
      )}

      {editDocument && (
        <EditModal
          document={editDocument}
          onClose={() => setEditDocument(null)}
          onSaved={fetchDocuments}
          show={show}
          orgId={orgId}
        />
      )}

      {deleteDocument && (
        <DeleteConfirm
          document={deleteDocument}
          onClose={() => setDeleteDocument(null)}
          onDeleted={fetchDocuments}
          show={show}
          orgId={orgId}
        />
      )}

      {previewDocument && (
        <PreviewModal
          document={previewDocument}
          onClose={() => setPreviewDocument(null)}
        />
      )}
    </div>
  );
}
