// src/pages/Trucks.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  RefreshCw,
  Search,
  AlertTriangle,
  Filter,
  Info,
  Loader2,
  Paperclip,
  MoreVertical,
  Edit3,
  Wrench,
  UserCheck,
  UserX,
  Gauge,
  FileText,
  X,
  Hammer,
  Download,
  Trash2,
  Pencil,
  Bell,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import TruckDocumentsModal from "../components/TruckDocumentsModal.jsx";
import PMSchedulerModal from "../components/PMSchedulerModal.jsx";
import { Link } from "react-router-dom"; // 👈 ADDED

/** Status options must match DB enum/check */
const STATUS_CHOICES = ["ACTIVE", "INACTIVE", "MAINTENANCE"];

/** Helper: join class names */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/** Helpers for driver name (replace full_name) */
function driverDisplayName(d) {
  if (!d) return "Driver";
  const fn = (d.first_name || "").trim();
  const ln = (d.last_name || "").trim();
  const name = [fn, ln].filter(Boolean).join(" ");
  return name || "Driver";
}
function driverNameFromMap(map, id) {
  const n = map[id];
  return n || "Driver";
}

/** Compute days from today to a due date (ISO string or Date). Negative = overdue */
function daysUntil(d) {
  if (!d) return null;
  const due = new Date(d);
  if (isNaN(+due)) return null;
  const now = new Date();
  const diffMs = due.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function fmtDate(d) {
  try {
    return d ? new Date(d).toLocaleDateString() : "—";
  } catch {
    return "—";
  }
}

/** Pick label/bg for a due date */
function duePill(d) {
  const n = daysUntil(d);
  if (n === null) {
    return { text: "—", className: "bg-transparent text-[var(--text-soft)]" };
  }
  if (n < 0) {
    return {
      text: `${fmtDate(d)} (${n}d)`,
      className:
        "bg-red-500/20 text-red-300 border border-red-500/30 shadow-sm",
    };
  }
  if (n <= 7) {
    return {
      text: `${fmtDate(d)} (+${n}d)`,
      className:
        "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm",
    };
  }
  return {
    text: fmtDate(d),
    className:
      "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25",
  };
}

/** ACTIONS POPUP */
function ActionsMenu({
  onEdit,
  onOdometer,
  onAssign,
  onUnassign,
  onDocs,
  onMaint,
  onOpenPM,
  onClose,
  anchorRef,
}) {
  // Close when clicking outside
  const menuRef = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (!menuRef.current) return;
      if (!anchorRef?.current) return;
      if (
        menuRef.current.contains(e.target) ||
        anchorRef.current.contains(e.target)
      )
        return;
      onClose?.();
    }
    function onEsc(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      className="absolute z-50 mt-2 min-w-[240px] rounded-xl border bg-[var(--panel)] shadow-xl overflow-hidden"
      style={{ right: 0 }}
    >
      <button
        onClick={() => {
          onEdit?.();
          onClose?.();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-sm"
      >
        <Edit3 className="w-4 h-4" /> Edit compliance & status
      </button>
      <button
        onClick={() => {
          onOdometer?.();
          onClose?.();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-sm"
      >
        <Gauge className="w-4 h-4" /> Update odometer
      </button>
      <button
        onClick={() => {
          onAssign?.();
          onClose?.();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-sm"
      >
        <UserCheck className="w-4 h-4" /> Assign / Change driver
      </button>
      <button
        onClick={() => {
          onUnassign?.();
          onClose?.();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-sm"
      >
        <UserX className="w-4 h-4" /> Unassign driver
      </button>
      <button
        onClick={() => {
          onDocs?.();
          onClose?.();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-sm"
      >
        <FileText className="w-4 h-4" /> Documents
      </button>
      <button
        onClick={() => {
          onMaint?.();
          onClose?.();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-sm"
      >
        <Hammer className="w-4 h-4" /> Maintenance log
      </button>
      <div className="h-px bg-white/10 my-1" />
      <button
        onClick={() => {
          onOpenPM?.();
          onClose?.();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-sm"
      >
        <Wrench className="w-4 h-4" /> PM Scheduler
      </button>
    </div>
  );
}

/** MODAL SHELL */
function ModalShell({ title, onClose, children, footer, maxWidth = "max-w-xl" }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 backdrop-blur-sm p-4">
      <div className={`w-full ${maxWidth} rounded-2xl border bg-[var(--panel)] shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold text-lg">{title}</div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
          {footer}
        </div>
      </div>
    </div>
  );
}

/** MODAL: Update Odometer */
function OdometerModal({ open, onClose, truck, onSaved }) {
  const [odo, setOdo] = useState(truck?.odometer ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setOdo(truck?.odometer ?? "");
    setErr(null);
  }, [truck]);

  if (!open || !truck) return null;

  async function save() {
    try {
      setBusy(true);
      setErr(null);
      const value = Number(odo);
      if (!Number.isFinite(value) || value < 0)
        throw new Error("Enter a valid non-negative number.");
      const { error } = await supabase
        .from("trucks")
        .update({ odometer: value })
        .eq("id", truck.id);
      if (error) throw error;
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || "Failed to update odometer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={`Update Odometer • ${truck.truck_number ?? truck.vin ?? truck.id}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
          {err}
        </div>
      )}
      <label className="text-sm block mb-1 opacity-80">Odometer</label>
      <input
        type="number"
        inputMode="numeric"
        value={odo}
        onChange={(e) => setOdo(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border bg-transparent"
        placeholder="e.g. 452310"
      />
    </ModalShell>
  );
}

/** MODAL: Assign / Change Driver */
function AssignDriverModal({ open, onClose, truck, onSaved }) {
  const [drivers, setDrivers] = useState([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(truck?.driver_id || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setErr(null);
        // 🔧 swapped full_name -> first_name, last_name
        const { data, error } = await supabase
          .from("drivers")
          .select("id, first_name, last_name, status")
          .order("last_name", { ascending: true })
          .order("first_name", { ascending: true });
        if (error) throw error;
        if (mounted) setDrivers(data || []);
      } catch (e) {
        if (mounted) setErr(e.message || "Failed to load drivers");
      }
    }
    if (open) load();
    return () => {
      mounted = false;
    };
  }, [open]);

  useEffect(() => {
    setSelected(truck?.driver_id || null);
    setErr(null);
  }, [truck]);

  if (!open || !truck) return null;

  const filtered = (drivers || []).filter((d) => {
    const name = driverDisplayName(d);
    const hay = [name, d.status].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  async function save() {
    try {
      setBusy(true);
      setErr(null);
      const payload = { driver_id: selected || null };
      const { error } = await supabase
        .from("trucks")
        .update(payload)
        .eq("id", truck.id);
      if (error) throw error;
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || "Failed to assign driver.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={`Assign Driver • ${truck.truck_number ?? truck.vin ?? truck.id}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
          {err}
        </div>
      )}
      <div className="mb-2 text-sm opacity-80">Search & select a driver:</div>
      <div className="relative mb-3">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-70" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a driver name or status…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border bg-transparent outline-none"
        />
      </div>
      <div className="max-h-64 overflow-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="px-3 py-3 opacity-70">No drivers</td>
              </tr>
            ) : (
              filtered.map((d) => {
                const name = driverDisplayName(d);
                return (
                  <tr
                    key={d.id}
                    className={cx(
                      "border-b",
                      selected === d.id ? "bg-black/10" : "hover:bg-black/5"
                    )}
                  >
                    <td className="px-3 py-2">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="driver"
                          checked={selected === d.id}
                          onChange={() => setSelected(d.id)}
                        />
                        <div>
                          <div className="font-medium">{name}</div>
                          <div className="text-xs opacity-70">
                            {d.status || "—"}
                          </div>
                        </div>
                      </label>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}

/** MODAL: Edit Compliance + Status */
function EditComplianceModal({ open, onClose, truck, onSaved }) {
  const [form, setForm] = useState({
    status: truck?.status || "ACTIVE",
    reg_due: truck?.reg_due || "",
    insp_due: truck?.insp_due || "",
    ifta_due: truck?.ifta_due || "",
    ins_due: truck?.ins_due || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setForm({
      status: truck?.status || "ACTIVE",
      reg_due: truck?.reg_due || "",
      insp_due: truck?.insp_due || "",
      ifta_due: truck?.ifta_due || "",
      ins_due: truck?.ins_due || "",
    });
    setErr(null);
  }, [truck]);

  if (!open || !truck) return null;

  function change(k, v) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    try {
      setBusy(true);
      setErr(null);
      const payload = {
        status: form.status || null,
        reg_due: form.reg_due || null,
        insp_due: form.insp_due || null,
        ifta_due: form.ifta_due || null,
        ins_due: form.ins_due || null,
      };
      const { error } = await supabase
        .from("trucks")
        .update(payload)
        .eq("id", truck.id);
      if (error) throw error;
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || "Failed to save changes.");
    } finally {
      setBusy(false);
    }
  }

  const field = (label, key) => (
    <div>
      <label className="text-sm block mb-1 opacity-80">{label}</label>
      <input
        type="date"
        value={form[key] ? String(form[key]).slice(0, 10) : ""}
        onChange={(e) => change(key, e.target.value || "")}
        className="w-full px-3 py-2 rounded-xl border bg-transparent"
      />
    </div>
  );

  return (
    <ModalShell
      title={`Edit Compliance & Status • ${truck.truck_number ?? truck.vin ?? truck.id}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
          {err}
        </div>
      )}
      <div className="grid gap-4">
        <div>
          <label className="text-sm block mb-1 opacity-80">Status</label>
          <select
            value={form.status}
            onChange={(e) => change("status", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border bg-transparent"
          >
            {STATUS_CHOICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {field("Registration Due", "reg_due")}
          {field("Inspection Due", "insp_due")}
          {field("IFTA Due", "ifta_due")}
          {field("Insurance Due", "ins_due")}
        </div>
      </div>
    </ModalShell>
  );
}

/** MODAL: Maintenance Log (CRUD) */
function MaintenanceModal({ open, onClose, truck, onSaved }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null); // record or null
  const [form, setForm] = useState({
    date: "",
    type: "",
    odometer: "",
    cost: "",
    notes: "",
  });

  useEffect(() => {
    if (!open || !truck?.id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, truck?.id]);

  function resetForm() {
    setEditing(null);
    setForm({ date: "", type: "", odometer: "", cost: "", notes: "" });
  }

  async function load() {
    try {
      setBusy(true);
      setErr(null);
      const { data, error } = await supabase
        .from("truck_maintenance")
        .select("id, truck_id, date, type, odometer, cost, notes, created_at")
        .eq("truck_id", truck.id)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setErr(
        (e?.message || "").includes("does not exist")
          ? "Table truck_maintenance not found. I’ll send you the SQL migration next."
          : e?.message || "Failed to load maintenance."
      );
    } finally {
      setBusy(false);
    }
  }

  function change(k, v) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function beginEdit(rec) {
    setEditing(rec);
    setForm({
      date: rec.date ? String(rec.date).slice(0, 10) : "",
      type: rec.type || "",
      odometer: rec.odometer ?? "",
      cost: rec.cost ?? "",
      notes: rec.notes || "",
    });
  }

  async function save() {
    try {
      setBusy(true);
      setErr(null);
      const payload = {
        truck_id: truck.id,
        date: form.date || null,
        type: form.type || null,
        odometer: form.odometer === "" ? null : Number(form.odometer),
        cost: form.cost === "" ? null : Number(form.cost),
        notes: form.notes || null,
      };
      if (
        payload.odometer != null &&
        (!Number.isFinite(payload.odometer) || payload.odometer < 0)
      ) {
        throw new Error("Odometer must be a non-negative number.");
      }
      if (payload.cost != null && !Number.isFinite(payload.cost)) {
        throw new Error("Cost must be a number.");
      }
      if (editing) {
        const { error } = await supabase
          .from("truck_maintenance")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("truck_maintenance")
          .insert(payload);
        if (error) throw error;
      }
      resetForm();
      await load();
      onSaved?.();
    } catch (e) {
      setErr(e.message || "Failed to save maintenance entry.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!id) return;
    try {
      setBusy(true);
      setErr(null);
      const { error } = await supabase
        .from("truck_maintenance")
        .delete()
        .eq("id", id);
      if (error) throw error;
      if (editing?.id === id) resetForm();
      await load();
      onSaved?.();
    } catch (e) {
      setErr(e.message || "Failed to delete entry.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || !truck) return null;

  return (
    <ModalShell
      title={`Maintenance • ${truck.truck_number ?? truck.vin ?? truck.id}`}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50"
          >
            {busy ? "Saving…" : editing ? "Update Entry" : "Add Entry"}
          </button>
        </>
      }
    >
      {err && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {/* Form */}
      <div className="grid md:grid-cols-5 gap-3 mb-4">
        <div className="md:col-span-1">
          <label className="text-sm block mb-1 opacity-80">Date</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => change("date", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border bg-transparent"
          />
        </div>
        <div className="md:col-span-1">
          <label className="text-sm block mb-1 opacity-80">Type</label>
          <input
            placeholder="PM A, Tires, DOT, etc."
            value={form.type}
            onChange={(e) => change("type", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border bg-transparent"
          />
        </div>
        <div className="md:col-span-1">
          <label className="text-sm block mb-1 opacity-80">Odometer</label>
          <input
            type="number"
            inputMode="numeric"
            value={form.odometer}
            onChange={(e) => change("odometer", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border bg-transparent"
            placeholder="452310"
          />
        </div>
        <div className="md:col-span-1">
          <label className="text-sm block mb-1 opacity-80">Cost ($)</label>
          <input
            type="number"
            inputMode="decimal"
            value={form.cost}
            onChange={(e) => change("cost", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border bg-transparent"
            placeholder="500"
          />
        </div>
        <div className="md:col-span-1">
          <label className="text-sm block mb-1 opacity-80">Notes</label>
          <input
            placeholder="Shop, parts, etc."
            value={form.notes}
            onChange={(e) => change("notes", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border bg-transparent"
          />
        </div>
      </div>

      {/* List */}
      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-black/10 text-left text-[var(--text-soft)]">
            <tr>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Odometer</th>
              <th className="px-3 py-3">Cost</th>
              <th className="px-3 py-3">Notes</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {busy && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center">
                  <Loader2 className="inline w-4 h-4 animate-spin" /> Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center opacity-70">
                  No entries yet.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const zebra = i % 2 ? "bg-black/5" : "";
                return (
                  <tr key={r.id} className={cx(zebra, "border-t")}>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {fmtDate(r.date)}
                    </td>
                    <td className="px-3 py-3">{r.type || "—"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.odometer ?? "—"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.cost != null
                        ? `$${Number(r.cost).toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-3 py-3">{r.notes || "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
                          onClick={() => beginEdit(r)}
                        >
                          <Pencil className="w-4 h-4" /> Edit
                        </button>
                        <button
                          className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] text-red-300 border-red-500/30 inline-flex items-center gap-1"
                          onClick={() => remove(r.id)}
                        >
                          <Trash2 className="w-4 h-4" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}

/** SLIDE-OVER: PM Alerts Drawer */
function PMAlertsDrawer({
  open,
  onClose,
  alerts,
  onResolve,
  onGotoTruck,
  refetching,
  onRefresh,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-lg bg-[var(--panel)] border-l shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            <div className="font-semibold">PM Alerts</div>
            <span className="text-xs opacity-70">
              (Open: {alerts?.length ?? 0})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
              title="Refresh alerts"
            >
              {refetching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Refreshing…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {alerts?.length ? (
            <div className="space-y-3">
              {alerts.map((a) => {
                const sev =
                  a.status === "OVERDUE"
                    ? "bg-red-500/15 text-red-300 border-red-500/30"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/30";
                return (
                  <div
                    key={a.id}
                    className={cx(
                      "rounded-xl border p-4",
                      "hover:bg-white/[0.02] transition"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cx(
                              "px-2 py-0.5 rounded-lg text-xs border",
                              sev
                            )}
                          >
                            {a.status}
                          </span>
                          <div className="font-semibold">
                            {a.truck?.truck_number
                              ? `Truck ${a.truck.truck_number}`
                              : a.truck?.vin || "Truck"}
                          </div>
                        </div>
                        <div className="text-sm opacity-80 mt-1">
                          {a.policy?.name || "Policy"} • {a.reason || "—"}
                        </div>
                        <div className="text-xs opacity-60 mt-1">
                          Opened {new Date(a.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
                          onClick={() => onGotoTruck?.(a.truck_id)}
                          title="Go to truck row"
                        >
                          <Info className="w-4 h-4" />
                          Open
                        </button>
                        <button
                          className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
                          onClick={() => onResolve?.(a.id)}
                          title="Mark as resolved"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Resolve
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-full grid place-items-center text-center">
              <div className="opacity-70">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-60" />
                <div className="font-medium">No open PM alerts</div>
                <div className="text-sm">You’re all set for now.</div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function Trucks() {
  const [trucks, setTrucks] = useState([]);
  const [driversById, setDriversById] = useState({});
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  /** Filters */
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [complianceFilter, setComplianceFilter] = useState("ALL"); // ALL | OVERDUE | DUE_SOON
  const [hasDriver, setHasDriver] = useState("ANY"); // ANY | HAS | NONE
  const [sortBy, setSortBy] = useState("EARLIEST_DUE"); // EARLIEST_DUE | TRUCK_NUMBER

  /** Docs modal */
  const [docsOpen, setDocsOpen] = useState(false);
  const [activeTruck, setActiveTruck] = useState(null);
  const [docPresence, setDocPresence] = useState({}); // { [truck.id]: boolean }
  const DOCS_BUCKET = "truck-docs";

  /** Action menu state */
  const [menuFor, setMenuFor] = useState(null); // truck.id
  const menuAnchorRef = useRef({}); // map of refs by truck id
  const [odoOpen, setOdoOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);

  /** Alerts UI */
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: tData, error: tErr } = await supabase
          .from("trucks")
          .select(
            `
            id,
            truck_number,
            vin,
            make,
            model,
            year,
            status,
            driver_id,
            odometer,
            reg_due,
            insp_due,
            ifta_due,
            ins_due
          `
          )
          .order("truck_number", { ascending: true });

        if (tErr) throw tErr;

        const ids = Array.from(
          new Set(tData.map((t) => t?.driver_id).filter(Boolean))
        );
        let map = {};
        if (ids.length) {
          // 🔧 swapped full_name -> first_name,last_name
          const { data: dData, error: dErr } = await supabase
            .from("drivers")
            .select("id, first_name, last_name")
            .in("id", ids);
          if (dErr) throw dErr;
          map = (dData || []).reduce((acc, d) => {
            acc[d.id] = driverDisplayName(d);
            return acc;
          }, {});
        }

        if (mounted) {
          setTrucks(tData || []);
          setDriversById(map);
          setLastUpdated(new Date());
        }

        // Docs presence check
        if (mounted && (tData || []).length) {
          const presenceMap = {};
          await Promise.all(
            (tData || []).map(async (t) => {
              try {
                const { data, error: listErr } = await supabase.storage
                  .from(DOCS_BUCKET)
                  .list(`${t.id}`, { limit: 1 });
                presenceMap[t.id] = !listErr && (data || []).length > 0;
              } catch {
                presenceMap[t.id] = false;
              }
            })
          );
          if (mounted) setDocPresence(presenceMap);
        }
      } catch (e) {
        if (mounted) setError(e.message || "Failed to load trucks");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refetch() {
    setRefetching(true);
    setError(null);
    try {
      const { data: tData, error: tErr } = await supabase
        .from("trucks")
        .select(
          `
          id,
          truck_number,
          vin,
          make,
          model,
          year,
          status,
          driver_id,
          odometer,
          reg_due,
          insp_due,
          ifta_due,
          ins_due
        `
        )
        .order("truck_number", { ascending: true });
      if (tErr) throw tErr;

      const ids = Array.from(
        new Set(tData.map((t) => t?.driver_id).filter(Boolean))
      );
      let map = {};
      if (ids.length) {
        // 🔧 swapped full_name -> first_name,last_name
        const { data: dData, error: dErr } = await supabase
          .from("drivers")
          .select("id, first_name, last_name")
          .in("id", ids);
        if (dErr) throw dErr;
        map = (dData || []).reduce((acc, d) => {
          acc[d.id] = driverDisplayName(d);
          return acc;
        }, {});
      }

      setTrucks(tData || []);
      setDriversById(map);
      setLastUpdated(new Date());

      const presenceMap = {};
      await Promise.all(
        (tData || []).map(async (t) => {
          try {
            const { data, error: listErr } = await supabase.storage
              .from(DOCS_BUCKET)
              .list(`${t.id}`, { limit: 1 });
            presenceMap[t.id] = !listErr && (data || []).length > 0;
          } catch {
            presenceMap[t.id] = false;
          }
        })
      );
      setDocPresence(presenceMap);
    } catch (e) {
      setError(e.message || "Failed to refresh");
    } finally {
      setRefetching(false);
    }
  }

  /** Alerts fetch/resolve */
  async function fetchAlerts() {
    setAlertsLoading(true);
    try {
      // Bring joined truck/policy names for display
      const { data, error } = await supabase
        .from("pm_alerts")
        .select(
          `
          id,
          policy_id,
          truck_id,
          status,
          reason,
          created_at,
          resolved_at,
          truck:trucks( truck_number, vin ),
          policy:truck_pm_policy( name )
        `
        )
        .is("resolved_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAlerts(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setAlertsLoading(false);
    }
  }

  async function resolveAlert(id) {
    try {
      const { error } = await supabase
        .from("pm_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await fetchAlerts();
    } catch (e) {
      alert(e.message || "Failed to resolve alert");
    }
  }

  function earliestDue(t) {
    const pool = [t?.reg_due, t?.insp_due, t?.ifta_due, t?.ins_due]
      .map((d) => (d ? new Date(d) : null))
      .filter((d) => d && !isNaN(+d));
    if (!pool.length) return null;
    return new Date(Math.min(...pool.map((d) => +d)));
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (trucks || [])
      .filter((t) => {
        if (query) {
          const hay =
            [
              t.truck_number,
              t.vin,
              t.make,
              t.model,
              t.year,
              driverNameFromMap(driversById, t.driver_id),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase() || "";
          if (!hay.includes(query)) return false;
        }
        if (statusFilter !== "ALL") {
          if ((t.status || "").toUpperCase() !== statusFilter) return false;
        }
        if (hasDriver === "HAS" && !t.driver_id) return false;
        if (hasDriver === "NONE" && t.driver_id) return false;

        if (complianceFilter !== "ALL") {
          const dArr = [t.reg_due, t.insp_due, t.ifta_due, t.ins_due];
          const daysArr = dArr.map(daysUntil).filter((n) => n !== null);
          if (!daysArr.length) return false;
          const anyOverdue = daysArr.some((n) => n < 0);
          const anyDueSoon = daysArr.some((n) => n >= 0 && n <= 7);
          if (complianceFilter === "OVERDUE" && !anyOverdue) return false;
          if (complianceFilter === "DUE_SOON" && !anyDueSoon) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "TRUCK_NUMBER") {
          const A = (a.truck_number || "").toString().padStart(6, "0");
          const B = (b.truck_number || "").toString().padStart(6, "0");
          return A.localeCompare(B);
        }
        const ea = earliestDue(a);
        const eb = earliestDue(b);
        if (!ea && !eb) return 0;
        if (!ea) return 1;
        if (!eb) return -1;
        return +ea - +eb;
      });
  }, [
    trucks,
    q,
    statusFilter,
    complianceFilter,
    hasDriver,
    sortBy,
    driversById,
  ]);

  function openDocs(truck) {
    setActiveTruck(truck);
    setDocsOpen(true);
  }
  function closeDocs() {
    setDocsOpen(false);
    setActiveTruck(null);
  }

  async function unassignDriver(truck) {
    await supabase
      .from("trucks")
      .update({ driver_id: null })
      .eq("id", truck.id);
    await refetch();
  }

  /** Export CSV of filtered trucks */
  function exportCsv() {
    const headers = [
      "truck_number",
      "vin",
      "make",
      "model",
      "year",
      "status",
      "driver_name",
      "odometer",
      "reg_due",
      "insp_due",
      "ifta_due",
      "ins_due",
    ];
    const lines = [headers.join(",")];
    filtered.forEach((t) => {
      const row = [
        t.truck_number ?? "",
        t.vin ?? "",
        t.make ?? "",
        t.model ?? "",
        t.year ?? "",
        (t.status || "").toUpperCase(),
        driverNameFromMap(driversById, t.driver_id) ?? "",
        t.odometer ?? "",
        t.reg_due ?? "",
        t.insp_due ?? "",
        t.ifta_due ?? "",
        t.ins_due ?? "",
      ]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(",");
      lines.push(row);
    });
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trucks_${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Alerts button clicked */
  async function openAlertsDrawer() {
    await fetchAlerts();
    setAlertsOpen(true);
  }

  /** Jump to truck in table from alert drawer */
  function goToTruckRow(truckId) {
    setAlertsOpen(false);
    // Optional: could focus a specific row if needed
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Trucks</h1>
        <div className="flex items-center gap-2">
          {/* Alerts badge */}
          <button
            onClick={openAlertsDrawer}
            className={cx(
              "relative inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm",
              "hover:bg-[var(--bg-hover)] transition"
            )}
            title="Open PM alerts"
          >
            <Bell className="w-4 h-4" />
            Alerts
            {alertsLoading ? (
              <Loader2 className="w-4 h-4 animate-spin ml-1" />
            ) : alerts?.length ? (
              <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-[20px] text-xs rounded-full bg-red-500/20 text-red-300 border border-red-500/30 px-1">
                {alerts.length}
              </span>
            ) : null}
          </button>

          <button
            onClick={exportCsv}
            className={cx(
              "inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm",
              "hover:bg-[var(--bg-hover)] transition"
            )}
            title="Export CSV (filtered)"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={refetch}
            className={cx(
              "inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm",
              "hover:bg-[var(--bg-hover)] transition"
            )}
            title="Refresh"
          >
            {refetching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Refreshing…
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Refresh
              </>
            )}
          </button>
          <button
            className={cx(
              "inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm",
              "bg-[var(--bg-active)] hover:opacity-90 transition"
            )}
            onClick={() => alert("TODO: Add Truck modal")}
          >
            <Plus className="w-4 h-4" />
            Add Truck
          </button>
        </div>
      </div>

      <div className="text-xs text-[var(--text-soft)] mb-3">
        Track registrations, inspections, IFTA, insurance
        <span className="mx-2">•</span>
        {lastUpdated ? (
          <span>Last updated {lastUpdated.toLocaleTimeString()}</span>
        ) : (
          <span>Loading…</span>
        )}
      </div>

      {/* Filters */}
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4 mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-70" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search truck #, VIN, make/model, driver…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border bg-transparent outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-70">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border bg-transparent"
          >
            <option value="ALL">All</option>
            {STATUS_CHOICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-70">Compliance</span>
          <select
            value={complianceFilter}
            onChange={(e) => setComplianceFilter(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border bg-transparent"
          >
            <option value="ALL">All</option>
            <option value="OVERDUE">Overdue</option>
            <option value="DUE_SOON">Due ≤ 7 days</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-70">Driver</span>
          <select
            value={hasDriver}
            onChange={(e) => setHasDriver(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border bg-transparent"
          >
            <option value="ANY">Any</option>
            <option value="HAS">Has driver</option>
            <option value="NONE">Unassigned</option>
          </select>
        </div>
      </div>

      {/* Sort row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm">
          <Filter className="w-4 h-4" />
          <span className="opacity-70">Sort by</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 rounded-lg border bg-transparent"
          >
            <option value="EARLIEST_DUE">Earliest Compliance Due</option>
            <option value="TRUCK_NUMBER">Truck #</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs opacity-70">
          <Info className="w-4 h-4" />
          <span className="hidden md:inline">
            Tooltips: hover over Reg/Insp/IFTA/Ins to see labels
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="text-left text-[var(--text-soft)]">
            <tr className="bg-black/10">
              <th className="px-3 py-3">Truck #</th>
              <th className="px-3 py-3">VIN</th>
              <th className="px-3 py-3">Make / Model / Year</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Driver</th>
              <th className="px-3 py-3">Compliance</th>
              <th className="px-3 py-3">Odometer</th>
              <th className="px-3 py-3">Docs</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center">
                  <div className="inline-flex items-center gap-2 text-[var(--text-soft)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading trucks…
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={9} className="px-3 py-6">
                  <div className="flex items-start gap-2 text-red-300">
                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                    <div>
                      <div className="font-medium">Failed to load</div>
                      <div className="opacity-80">{error}</div>
                    </div>
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center opacity-70">
                  No trucks match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((t, idx) => {
                const zebra = idx % 2 === 1 ? "bg-black/5" : "";
                const reg = duePill(t.reg_due);
                const insp = duePill(t.insp_due);
                const ifta = duePill(t.ifta_due);
                const ins = duePill(t.ins_due);

                const statusBadge =
                  (t.status || "").toUpperCase() === "ACTIVE"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/25"
                    : (t.status || "").toUpperCase() === "MAINTENANCE"
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/25"
                    : "bg-zinc-500/20 text-zinc-300 border border-zinc-500/25";

                const hasDocs = !!docPresence[t.id];

                if (!menuAnchorRef.current[t.id])
                  menuAnchorRef.current[t.id] = { current: null };

                return (
                  <tr key={t.id} className={cx(zebra, "border-t relative")}>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {/* 👇 LINK to truck profile */}
                      {t.truck_number ? (
                        <Link
                          to={`/trucks/${t.id}`}
                          className="underline underline-offset-2 hover:opacity-90"
                          title="Open truck profile"
                        >
                          {t.truck_number}
                        </Link>
                      ) : (
                        <Link
                          to={`/trucks/${t.id}`}
                          className="underline underline-offset-2 hover:opacity-90"
                          title="Open truck profile"
                        >
                          —
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {/* 👇 LINK to truck profile */}
                      {t.vin ? (
                        <Link
                          to={`/trucks/${t.id}`}
                          className="underline underline-offset-2 hover:opacity-90"
                          title="Open truck profile"
                        >
                          {t.vin}
                        </Link>
                      ) : (
                        <Link
                          to={`/trucks/${t.id}`}
                          className="underline underline-offset-2 hover:opacity-90"
                          title="Open truck profile"
                        >
                          —
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {(t.make || "—") +
                        " / " +
                        (t.model || "—") +
                        " / " +
                        (t.year || "—")}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cx(
                          "px-2 py-1 rounded-lg text-xs",
                          statusBadge
                        )}
                      >
                        {(t.status || "—").toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {t.driver_id ? (
                        <Link
                          className="underline underline-offset-2 hover:opacity-90"
                          to={`/drivers/${t.driver_id}`} // 👈 LINK to driver profile
                          title="Open driver profile"
                        >
                          {driverNameFromMap(driversById, t.driver_id)}
                        </Link>
                      ) : (
                        <span className="opacity-60">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span title="Registration">
                          <span
                            className={cx(
                              "px-2 py-1 rounded-full text-xs",
                              reg.className
                            )}
                          >
                            Reg: {reg.text}
                          </span>
                        </span>
                        <span title="Inspection">
                          <span
                            className={cx(
                              "px-2 py-1 rounded-full text-xs",
                              insp.className
                            )}
                          >
                            Insp: {insp.text}
                          </span>
                        </span>
                        <span title="IFTA (Fuel Tax)">
                          <span
                            className={cx(
                              "px-2 py-1 rounded-full text-xs",
                              ifta.className
                            )}
                          >
                            IFTA: {ifta.text}
                          </span>
                        </span>
                        <span title="Insurance">
                          <span
                            className={cx(
                              "px-2 py-1 rounded-full text-xs",
                              ins.className
                            )}
                          >
                            Ins: {ins.text}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">{t.odometer ?? "—"}</td>
                    <td className="px-3 py-3">
                      <button
                        className={cx(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs",
                          hasDocs
                            ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                            : "hover:bg-[var(--bg-hover)]"
                        )}
                        title={hasDocs ? "View documents" : "Add documents"}
                        onClick={() => openDocs(t)}
                      >
                        <Paperclip className="w-4 h-4" />
                        {hasDocs ? "Files" : "Add"}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right relative">
                      <button
                        ref={(el) =>
                          (menuAnchorRef.current[t.id].current = el)
                        }
                        className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
                        onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === t.id}
                        aria-controls={`menu-${t.id}`}
                      >
                        <MoreVertical className="w-4 h-4" />
                        Actions
                      </button>

                      {menuFor === t.id && (
                        <div id={`menu-${t.id}`} className="relative">
                          <ActionsMenu
                            anchorRef={menuAnchorRef.current[t.id]}
                            onClose={() => setMenuFor(null)}
                            onEdit={() => {
                              setActiveTruck(t);
                              setEditOpen(true);
                            }}
                            onOdometer={() => {
                              setActiveTruck(t);
                              setOdoOpen(true);
                            }}
                            onAssign={() => {
                              setActiveTruck(t);
                              setAssignOpen(true);
                            }}
                            onUnassign={async () => {
                              await unassignDriver(t);
                            }}
                            onDocs={() => openDocs(t)}
                            onMaint={() => {
                              setActiveTruck(t);
                              setMaintOpen(true);
                            }}
                            onOpenPM={() => {
                              setActiveTruck(t);
                              setPmOpen(true);
                            }}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* MODALS / DRAWERS */}
      <TruckDocumentsModal
        open={docsOpen}
        onClose={closeDocs}
        truck={activeTruck}
      />
      <OdometerModal
        open={odoOpen}
        onClose={() => setOdoOpen(false)}
        truck={activeTruck}
        onSaved={refetch}
      />
      <PMSchedulerModal
        open={pmOpen}
        onClose={() => setPmOpen(false)}
        truck={activeTruck}
        onSaved={refetch}
      />
      <AssignDriverModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        truck={activeTruck}
        onSaved={refetch}
      />
      <EditComplianceModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        truck={activeTruck}
        onSaved={refetch}
      />
      <MaintenanceModal
        open={maintOpen}
        onClose={() => setMaintOpen(false)}
        truck={activeTruck}
        onSaved={refetch}
      />

      <PMAlertsDrawer
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        alerts={alerts}
        onResolve={resolveAlert}
        onGotoTruck={goToTruckRow}
        refetching={alertsLoading}
        onRefresh={fetchAlerts}
      />
    </div>
  );
}
