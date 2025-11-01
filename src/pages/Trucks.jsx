// src/pages/Trucks.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Plus,
  PencilLine,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  Clock,
  ShieldAlert,
  FileWarning,
  Link as LinkIcon,
  X,
  Save,
  CheckCircle2,
} from "lucide-react";

/* ------------------------------- utilities ------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

// days until a date (positive = in future, negative = past)
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  const diff = Math.ceil((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  return diff;
}

// RYG pill for a date threshold
function ExpiryPill({ label, date }) {
  const dleft = daysUntil(date);
  let intent = "default";
  let text = "—";
  if (dleft !== null) {
    text = `${new Date(date).toLocaleDateString()} (${dleft}d)`;
    if (dleft < 0) intent = "red";
    else if (dleft <= 30) intent = "amber";
    else intent = "green";
  }
  const map = {
    default:
      "bg-zinc-100 text-zinc-700 border border-zinc-200/60 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700/60",
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={cx("text-xs px-2 py-1 rounded-lg", map[intent])}>{text}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    ACTIVE: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
    IN_REPAIR: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    INACTIVE: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    RETIRED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  };
  return (
    <span className={cx("text-xs px-2 py-1 rounded-lg border border-transparent", map[status] || map.INACTIVE)}>
      {status || "—"}
    </span>
  );
}

/* --------------------------------- Modal --------------------------------- */
function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-[61] w-[95vw] max-w-3xl rounded-2xl bg-white dark:bg-neutral-950 border border-zinc-200 dark:border-neutral-800 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-neutral-800">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-neutral-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-zinc-200 dark:border-neutral-800">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ Trucks Page ------------------------------ */
export default function TrucksPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // row being edited

  const [drivers, setDrivers] = useState([]);
  const [loads, setLoads] = useState([]);

  const [showAudit, setShowAudit] = useState(false);
  const [auditTruck, setAuditTruck] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // form state
  const emptyForm = {
    truck_number: "",
    vin: "",
    make: "",
    model: "",
    model_year: "",
    status: "ACTIVE",
    current_driver_id: null,
    current_load_id: null,
    registration_expiry: "",
    inspection_expiry: "",
    ifta_expiry: "",
    insurance_expiry: "",
    odometer_miles: "",
    maintenance_due_miles: "",
    last_service_date: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  // fetch list
  async function fetchTrucks() {
    setLoading(true);
    setErrorMsg("");
    const { data, error } = await supabase
      .from("v_trucks_active")
      .select("*")
      .order("truck_number", { ascending: true })
      .limit(1000);
    if (error) {
      console.error(error);
      setErrorMsg(error.message);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }

  async function fetchDriversLoads() {
    const [d1, d2] = await Promise.all([
      supabase.from("drivers").select("id, first_name, last_name").order("last_name", { ascending: true }).limit(500),
      supabase.from("loads").select("id, reference, status").order("created_at", { ascending: false }).limit(300),
    ]);
    if (!d1.error) setDrivers(d1.data || []);
    if (!d2.error) setLoads(d2.data || []);
  }

  // realtime subscription for trucks
  useEffect(() => {
    fetchTrucks();
    fetchDriversLoads();
    const channel = supabase
      .channel("trucks-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "trucks" }, () => fetchTrucks())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((r) => {
      return (
        (r.truck_number || "").toLowerCase().includes(k) ||
        (r.vin || "").toLowerCase().includes(k) ||
        (r.make || "").toLowerCase().includes(k) ||
        (r.model || "").toLowerCase().includes(k) ||
        (r.current_driver_name || "").toLowerCase().includes(k) ||
        (r.current_load_reference || "").toLowerCase().includes(k)
      );
    });
  }, [rows, q]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      truck_number: row.truck_number || "",
      vin: row.vin || "",
      make: row.make || "",
      model: row.model || "",
      model_year: row.model_year || "",
      status: row.status || "ACTIVE",
      current_driver_id: row.current_driver_id || null,
      current_load_id: row.current_load_id || null,
      registration_expiry: row.registration_expiry || "",
      inspection_expiry: row.inspection_expiry || "",
      ifta_expiry: row.ifta_expiry || "",
      insurance_expiry: row.insurance_expiry || "",
      odometer_miles: row.odometer_miles ?? "",
      maintenance_due_miles: row.maintenance_due_miles ?? "",
      last_service_date: row.last_service_date || "",
      notes: row.notes || "",
    });
    setShowForm(true);
  }

  async function saveForm(e) {
    e?.preventDefault?.();
    setSaving(true);
    setErrorMsg("");

    const payload = {
      ...form,
      model_year: form.model_year ? Number(form.model_year) : null,
      odometer_miles: form.odometer_miles === "" ? null : Number(form.odometer_miles),
      maintenance_due_miles: form.maintenance_due_miles === "" ? null : Number(form.maintenance_due_miles),
      current_driver_id: form.current_driver_id || null,
      current_load_id: form.current_load_id || null,
      last_service_date: form.last_service_date || null,
      registration_expiry: form.registration_expiry || null,
      inspection_expiry: form.inspection_expiry || null,
      ifta_expiry: form.ifta_expiry || null,
      insurance_expiry: form.insurance_expiry || null,
    };

    let error = null;
    if (editing) {
      const { error: e1 } = await supabase.from("trucks").update(payload).eq("id", editing.id);
      error = e1;
    } else {
      const { error: e2 } = await supabase.from("trucks").insert(payload);
      error = e2;
    }

    if (error) {
      console.error(error);
      setErrorMsg(error.message);
    } else {
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      await fetchTrucks();
    }
    setSaving(false);
  }

  async function deactivate(row) {
    if (!confirm(`Deactivate (active=false) truck ${row.truck_number}?`)) return;
    const { error } = await supabase.from("trucks").update({ active: false, status: "INACTIVE" }).eq("id", row.id);
    if (error) {
      alert(error.message);
    } else {
      await fetchTrucks();
    }
  }

  function driverUrl(id) {
    return id ? `/drivers/${id}` : null;
  }
  function loadUrl(id) {
    return id ? `/loads/${id}` : null;
  }

  async function openAudit(row) {
    setAuditTruck(row);
    setShowAudit(true);
    setAuditLoading(true);
    const { data, error } = await supabase
      .from("trucks_audit")
      .select("*")
      .eq("truck_id", row.id)
      .order("changed_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error(error);
      setAuditRows([]);
    } else {
      setAuditRows(data || []);
    }
    setAuditLoading(false);
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Trucks</h1>
          <div className="hidden md:flex items-center gap-2 text-xs text-zinc-500">
            <FileWarning className="w-4 h-4" />
            <span>Track registrations, inspections, IFTA, insurance</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search truck #, VIN, driver, load…"
              className="pl-8 pr-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-neutral-700"
            />
          </div>
          <button
            onClick={fetchTrucks}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-sm hidden md:inline">Refresh</span>
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black text-white hover:bg-black/90"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm">Add Truck</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading trucks…</span>
          </div>
        ) : errorMsg ? (
          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-red-700 dark:text-red-200">
            {errorMsg}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-neutral-800 p-8 text-center">
            <div className="mx-auto w-10 h-10 rounded-full grid place-items-center bg-zinc-100 dark:bg-neutral-900 mb-3">
              <TruckIcon />
            </div>
            <div className="font-medium">No trucks found</div>
            <div className="text-sm text-zinc-500">Try a different search or add a truck.</div>
            <div className="mt-4">
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black text-white hover:bg-black/90"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">Add Truck</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-neutral-800">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-neutral-900/50 text-zinc-700 dark:text-zinc-300">
                <tr>
                  <Th>Truck #</Th>
                  <Th>VIN</Th>
                  <Th>Make / Model / Year</Th>
                  <Th>Status</Th>
                  <Th>Driver</Th>
                  <Th>Load</Th>
                  <Th>Compliance</Th>
                  <Th>Odometer</Th>
                  <Th className="text-right pr-3">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-neutral-900">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50/60 dark:hover:bg-neutral-900/40">
                    <Td mono>{r.truck_number || "—"}</Td>
                    <Td mono className="truncate max-w-[160px]" title={r.vin || ""}>
                      {r.vin || "—"}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{r.make || "—"}</span>
                        <span className="text-zinc-500">/</span>
                        <span>{r.model || "—"}</span>
                        <span className="text-zinc-500">/</span>
                        <span>{r.model_year || "—"}</span>
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>
                      {r.current_driver_id ? (
                        <a
                          href={driverUrl(r.current_driver_id)}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                          title="Open driver"
                        >
                          <LinkIcon className="w-3.5 h-3.5" />
                          {r.current_driver_name || r.current_driver_id}
                        </a>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </Td>
                    <Td>
                      {r.current_load_id ? (
                        <a
                          href={loadUrl(r.current_load_id)}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                          title="Open load"
                        >
                          <LinkIcon className="w-3.5 h-3.5" />
                          {r.current_load_reference || r.current_load_id}
                        </a>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <ExpiryPill label="Reg" date={r.registration_expiry} />
                        <ExpiryPill label="Insp" date={r.inspection_expiry} />
                        <ExpiryPill label="IFTA" date={r.ifta_expiry} />
                        <ExpiryPill label="Ins" date={r.insurance_expiry} />
                      </div>
                    </Td>
                    <Td mono>{r.odometer_miles ?? "—"}</Td>
                    <Td className="text-right pr-3">
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn title="View audit" onClick={() => openAudit(r)}>
                          <Clock className="w-4 h-4" />
                        </IconBtn>
                        <IconBtn title="Edit" onClick={() => openEdit(r)}>
                          <PencilLine className="w-4 h-4" />
                        </IconBtn>
                        <IconBtn title="Deactivate" onClick={() => deactivate(r)}>
                          <Trash2 className="w-4 h-4" />
                        </IconBtn>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit modal */}
      <Modal
        open={showForm}
        onClose={() => {
          if (!saving) setShowForm(false);
        }}
        title={editing ? `Edit Truck — ${editing.truck_number}` : "Add Truck"}
        footer={
          <div className="flex items-center justify-between">
            {errorMsg ? (
              <div className="text-sm text-red-600 dark:text-red-300">{errorMsg}</div>
            ) : (
              <div className="text-sm text-zinc-500">Fields with “*” are required.</div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                onClick={saveForm}
                disabled={saving}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black text-white hover:bg-black/90 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{editing ? "Save Changes" : "Create Truck"}</span>
              </button>
            </div>
          </div>
        }
      >
        <form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={(e) => e.preventDefault()}>
          <Field label="Truck # *">
            <input
              required
              value={form.truck_number}
              onChange={(e) => setForm((f) => ({ ...f, truck_number: e.target.value }))}
              className="inp"
              placeholder="AC-101"
            />
          </Field>
          <Field label="VIN">
            <input
              value={form.vin}
              onChange={(e) => setForm((f) => ({ ...f, vin: e.target.value }))}
              className="inp"
              placeholder="1HTMMMMM0PH123456"
            />
          </Field>

          <Field label="Make">
            <input
              value={form.make}
              onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))}
              className="inp"
              placeholder="Freightliner"
            />
          </Field>
          <Field label="Model">
            <input
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              className="inp"
              placeholder="Cascadia"
            />
          </Field>

          <Field label="Model Year">
            <input
              type="number"
              value={form.model_year}
              onChange={(e) => setForm((f) => ({ ...f, model_year: e.target.value }))}
              className="inp"
              placeholder="2023"
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="inp"
            >
              <option>ACTIVE</option>
              <option>IN_REPAIR</option>
              <option>INACTIVE</option>
              <option>RETIRED</option>
            </select>
          </Field>

          <Field label="Assigned Driver">
            <select
              value={form.current_driver_id || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, current_driver_id: e.target.value || null }))
              }
              className="inp"
            >
              <option value="">— None —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.last_name}, {d.first_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned Load">
            <select
              value={form.current_load_id || ""}
              onChange={(e) => setForm((f) => ({ ...f, current_load_id: e.target.value || null }))}
              className="inp"
            >
              <option value="">— None —</option>
              {loads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.reference} ({l.status})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Registration Expiry">
            <input
              type="date"
              value={form.registration_expiry || ""}
              onChange={(e) => setForm((f) => ({ ...f, registration_expiry: e.target.value }))}
              className="inp"
            />
          </Field>
          <Field label="Inspection Expiry">
            <input
              type="date"
              value={form.inspection_expiry || ""}
              onChange={(e) => setForm((f) => ({ ...f, inspection_expiry: e.target.value }))}
              className="inp"
            />
          </Field>

          <Field label="IFTA Expiry">
            <input
              type="date"
              value={form.ifta_expiry || ""}
              onChange={(e) => setForm((f) => ({ ...f, ifta_expiry: e.target.value }))}
              className="inp"
            />
          </Field>
          <Field label="Insurance Expiry">
            <input
              type="date"
              value={form.insurance_expiry || ""}
              onChange={(e) => setForm((f) => ({ ...f, insurance_expiry: e.target.value }))}
              className="inp"
            />
          </Field>

          <Field label="Odometer (mi)">
            <input
              type="number"
              step="0.1"
              value={form.odometer_miles}
              onChange={(e) => setForm((f) => ({ ...f, odometer_miles: e.target.value }))}
              className="inp"
              placeholder="152340.0"
            />
          </Field>
          <Field label="Maint. Due (mi)">
            <input
              type="number"
              step="0.1"
              value={form.maintenance_due_miles}
              onChange={(e) => setForm((f) => ({ ...f, maintenance_due_miles: e.target.value }))}
              className="inp"
              placeholder="160000.0"
            />
          </Field>

          <Field label="Last Service Date">
            <input
              type="date"
              value={form.last_service_date || ""}
              onChange={(e) => setForm((f) => ({ ...f, last_service_date: e.target.value }))}
              className="inp"
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="inp"
                placeholder="Maintenance notes, special permits, etc."
              />
            </Field>
          </div>
        </form>
      </Modal>

      {/* Audit modal */}
      <Modal
        open={showAudit}
        onClose={() => setShowAudit(false)}
        title={
          auditTruck
            ? `Audit — ${auditTruck.truck_number} (${auditTruck.make || "—"} ${auditTruck.model || "—"})`
            : "Audit"
        }
      >
        {auditLoading ? (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading audit…</span>
          </div>
        ) : auditRows.length === 0 ? (
          <div className="text-sm text-zinc-500">No audit entries.</div>
        ) : (
          <div className="space-y-3">
            {auditRows.map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-zinc-200 dark:border-neutral-800 p-3 bg-white dark:bg-neutral-950"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-zinc-500" />
                    <span className="text-xs text-zinc-500">
                      {new Date(a.changed_at).toLocaleString()}
                    </span>
                  </div>
                  <span
                    className={cx(
                      "text-xs px-2 py-1 rounded-lg",
                      a.action === "INSERT"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                        : a.action === "UPDATE"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
                    )}
                  >
                    {a.action}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="text-xs">
                    <div className="font-medium mb-1">Old</div>
                    <pre className="p-2 rounded-lg bg-zinc-50 dark:bg-neutral-900 overflow-x-auto">
{JSON.stringify(a.old_row, null, 2)}
                    </pre>
                  </div>
                  <div className="text-xs">
                    <div className="font-medium mb-1">New</div>
                    <pre className="p-2 rounded-lg bg-zinc-50 dark:bg-neutral-900 overflow-x-auto">
{JSON.stringify(a.new_row, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* --------------------------------- bits ---------------------------------- */
function Th({ children, className = "" }) {
  return (
    <th className={cx("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide", className)}>
      {children}
    </th>
  );
}
function Td({ children, className = "", mono = false }) {
  return (
    <td className={cx("px-3 py-2 align-top", mono && "font-mono", className)}>{children}</td>
  );
}
function IconBtn({ title, onClick, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 rounded-lg border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900"
    >
      {children}
    </button>
  );
}
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6 text-zinc-600 dark:text-zinc-300">
      <path
        fill="currentColor"
        d="M18 6h-5v7h9V9l-4-3zM2 13h10V6H2v7zm3 6a2 2 0 1 0 0-4a2 2 0 0 0 0 4m12 0a2 2 0 1 0 0-4a2 2 0 0 0 0 4"
      />
    </svg>
  );
}

/* --------------------------------- styles -------------------------------- */
const style = document.createElement("style");
style.innerHTML = `
.inp {
  @apply w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-neutral-700;
}
`;
document.head.appendChild(style);
