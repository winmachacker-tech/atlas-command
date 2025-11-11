import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Plus,
  Save,
  Trash2,
  Loader2,
  Calendar,
  Gauge,
  Download,
  Wrench,
  Pencil,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * PMSchedulerModal
 * - Per-truck Preventive Maintenance scheduler
 * - Tables expected (SQL coming next message):
 *   - public.truck_pm_policy:
 *       id uuid PK, truck_id uuid FK, name text,
 *       interval_miles int, interval_days int,
 *       last_service_odo int, last_service_date date,
 *       notes text, active boolean default true, created_at timestamptz
 *   - public.truck_pm_event:
 *       id uuid PK, truck_id uuid FK, policy_id uuid FK,
 *       service_date date, service_odo int, notes text, cost numeric, created_at timestamptz
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - truck: trucks row (needs id, truck_number/vin/odometer)
 *  - onSaved?: () => void   // called after create/update/delete/log service
 */
export default function PMSchedulerModal({ open, onClose, truck, onSaved }) {
  const [policies, setPolicies] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // editor state
  const [editing, setEditing] = useState(null); // policy row being edited
  const [form, setForm] = useState(emptyForm());
  const [logFor, setLogFor] = useState(null); // policy row being logged
  const [logForm, setLogForm] = useState(emptyLogForm());

  const truckTitle = useMemo(() => {
    if (!truck) return "PM Scheduler";
    const name =
      [truck.truck_number, truck.vin, `${truck.make || ""} ${truck.model || ""}`.trim(), truck.id]
        .filter(Boolean)[0] || "Truck";
    return `PM Scheduler â€¢ ${name}`;
  }, [truck]);

  useEffect(() => {
    if (!open || !truck?.id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, truck?.id]);

  function emptyForm() {
    return {
      name: "",
      interval_miles: "",
      interval_days: "",
      last_service_odo: "",
      last_service_date: "",
      notes: "",
      active: true,
    };
  }

  function emptyLogForm() {
    return {
      service_date: new Date().toISOString().slice(0, 10),
      service_odo: "",
      cost: "",
      notes: "",
    };
  }

  function setField(k, v) {
    setForm((s) => ({ ...s, [k]: v }));
  }
  function setLogField(k, v) {
    setLogForm((s) => ({ ...s, [k]: v }));
  }

  async function load() {
    try {
      setBusy(true);
      setErr(null);
      const { data, error } = await supabase
        .from("truck_pm_policy")
        .select(
          "id, truck_id, name, interval_miles, interval_days, last_service_odo, last_service_date, notes, active, created_at"
        )
        .eq("truck_id", truck.id)
        .order("name", { ascending: true });
      if (error) throw error;
      setPolicies(data || []);
    } catch (e) {
      setErr(
        (e?.message || "").includes("does not exist")
          ? "PM tables not found. Iâ€™ll provide the SQL migration next."
          : e?.message || "Failed to load PM policies."
      );
    } finally {
      setBusy(false);
    }
  }

  function beginAdd(template) {
    setEditing(null);
    const base = emptyForm();
    if (template) {
      base.name = template.name;
      base.interval_miles = template.interval_miles ?? "";
      base.interval_days = template.interval_days ?? "";
      base.notes = template.notes ?? "";
    }
    setForm(base);
  }

  function beginEdit(p) {
    setEditing(p);
    setForm({
      name: p.name || "",
      interval_miles: p.interval_miles ?? "",
      interval_days: p.interval_days ?? "",
      last_service_odo: p.last_service_odo ?? "",
      last_service_date: p.last_service_date ? String(p.last_service_date).slice(0, 10) : "",
      notes: p.notes || "",
      active: p.active !== false,
    });
  }

  function beginLog(p) {
    setLogFor(p);
    setLogForm({
      service_date: new Date().toISOString().slice(0, 10),
      service_odo: "",
      cost: "",
      notes: "",
    });
  }

  async function savePolicy() {
    try {
      setBusy(true);
      setErr(null);
      const payload = {
        truck_id: truck.id,
        name: (form.name || "").trim(),
        interval_miles: form.interval_miles === "" ? null : Number(form.interval_miles),
        interval_days: form.interval_days === "" ? null : Number(form.interval_days),
        last_service_odo: form.last_service_odo === "" ? null : Number(form.last_service_odo),
        last_service_date: form.last_service_date || null,
        notes: form.notes || null,
        active: !!form.active,
      };
      if (!payload.name) throw new Error("Name is required.");
      if (
        (payload.interval_miles == null || !Number.isFinite(payload.interval_miles)) &&
        (payload.interval_days == null || !Number.isFinite(payload.interval_days))
      ) {
        throw new Error("Provide interval miles and/or interval days.");
      }
      const table = supabase.from("truck_pm_policy");
      if (editing) {
        const { error } = await table.update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await table.insert(payload);
        if (error) throw error;
      }
      setEditing(null);
      setForm(emptyForm());
      await load();
      onSaved?.();
    } catch (e) {
      setErr(e.message || "Failed to save policy.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePolicy(id) {
    if (!id) return;
    try {
      setBusy(true);
      setErr(null);
      const { error } = await supabase.from("truck_pm_policy").delete().eq("id", id);
      if (error) throw error;
      if (editing?.id === id) {
        setEditing(null);
        setForm(emptyForm());
      }
      await load();
      onSaved?.();
    } catch (e) {
      setErr(e.message || "Failed to delete policy.");
    } finally {
      setBusy(false);
    }
  }

  async function logService() {
    if (!logFor) return;
    try {
      setBusy(true);
      setErr(null);
      const payloadEvent = {
        truck_id: truck.id,
        policy_id: logFor.id,
        service_date: logForm.service_date || null,
        service_odo: logForm.service_odo === "" ? null : Number(logForm.service_odo),
        cost: logForm.cost === "" ? null : Number(logForm.cost),
        notes: logForm.notes || null,
      };
      if (payloadEvent.service_odo != null && (!Number.isFinite(payloadEvent.service_odo) || payloadEvent.service_odo < 0)) {
        throw new Error("Service odometer must be a non-negative number.");
      }
      if (payloadEvent.cost != null && !Number.isFinite(payloadEvent.cost)) {
        throw new Error("Cost must be a number.");
      }

      // Insert event
      const { error: e1 } = await supabase.from("truck_pm_event").insert(payloadEvent);
      if (e1) throw e1;

      // Update policy last service markers
      const updatePolicy = {
        last_service_date: payloadEvent.service_date,
        last_service_odo: payloadEvent.service_odo,
      };
      const { error: e2 } = await supabase.from("truck_pm_policy").update(updatePolicy).eq("id", logFor.id);
      if (e2) throw e2;

      setLogFor(null);
      setLogForm(emptyLogForm());
      await load();
      onSaved?.();
    } catch (e) {
      setErr(e.message || "Failed to log service.");
    } finally {
      setBusy(false);
    }
  }

  /** Status computation */
  function computeStatus(p) {
    const now = new Date();
    // date based
    let dateStatus = null;
    if (p.interval_days != null && Number.isFinite(p.interval_days) && p.interval_days > 0) {
      const last = p.last_service_date ? new Date(p.last_service_date) : null;
      if (last && !isNaN(+last)) {
        const next = new Date(last);
        next.setDate(next.getDate() + p.interval_days);
        const daysDiff = Math.round((next.setHours(0,0,0,0) - now.setHours(0,0,0,0)) / (1000*60*60*24));
        if (daysDiff < 0) dateStatus = { kind: "OVERDUE", badge: "bg-red-500/20 text-red-300 border-red-500/30", detail: `${fmtDate(next)} (${daysDiff}d)` };
        else if (daysDiff <= 7) dateStatus = { kind: "SOON", badge: "bg-amber-500/20 text-amber-300 border-amber-500/30", detail: `${fmtDate(next)} (+${daysDiff}d)` };
        else dateStatus = { kind: "OK", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25", detail: fmtDate(next) };
      } else {
        dateStatus = { kind: "NA", badge: "text-[var(--text-soft)]", detail: "â€”" };
      }
    }

    // miles based (requires truck.odometer)
    let milesStatus = null;
    if (p.interval_miles != null && Number.isFinite(p.interval_miles) && p.interval_miles > 0 && Number.isFinite(truck?.odometer)) {
      const lastOdo = p.last_service_odo ?? null;
      if (lastOdo != null) {
        const nextOdo = lastOdo + p.interval_miles;
        const delta = nextOdo - (truck.odometer || 0);
        if (delta < 0) milesStatus = { kind: "OVERDUE", badge: "bg-red-500/20 text-red-300 border-red-500/30", detail: `${nextOdo.toLocaleString()} (${delta}mi)` };
        else if (delta <= 1000) milesStatus = { kind: "SOON", badge: "bg-amber-500/20 text-amber-300 border-amber-500/30", detail: `${nextOdo.toLocaleString()} (+${delta}mi)` };
        else milesStatus = { kind: "OK", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25", detail: nextOdo.toLocaleString() };
      } else {
        milesStatus = { kind: "NA", badge: "text-[var(--text-soft)]", detail: "â€”" };
      }
    }

    // merge: worst wins (OVERDUE > SOON > OK > NA)
    const order = { OVERDUE: 3, SOON: 2, OK: 1, NA: 0 };
    const both = [dateStatus, milesStatus].filter(Boolean);
    if (both.length === 0) return { label: "â€”", badge: "text-[var(--text-soft)]", detail: "â€”" };
    let winner = both[0];
    for (const s of both) {
      if (order[s.kind] > order[winner.kind]) winner = s;
    }
    const label =
      winner.kind === "OVERDUE" ? "Overdue"
      : winner.kind === "SOON" ? "Due Soon"
      : winner.kind === "OK" ? "OK"
      : "â€”";
    return { label, badge: winner.badge, detail: winner.detail };
  }

  function fmtDate(d) {
    try {
      return new Date(d).toLocaleDateString();
    } catch {
      return "â€”";
    }
  }

  function exportCsv() {
    const headers = [
      "name",
      "interval_miles",
      "interval_days",
      "last_service_odo",
      "last_service_date",
      "status_label",
      "status_detail",
      "active",
    ];
    const rows = (policies || []).map((p) => {
      const s = computeStatus(p);
      return [
        p.name || "",
        p.interval_miles ?? "",
        p.interval_days ?? "",
        p.last_service_odo ?? "",
        p.last_service_date ?? "",
        s.label,
        s.detail,
        (p.active !== false) ? "true" : "false",
      ]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(",");
    });
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pm_${(truck?.truck_number || truck?.vin || "truck").toString().replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // basic templates to speed setup
  const templates = [
    { name: "PM A", interval_miles: 15000, interval_days: 180, notes: "Oil + filters" },
    { name: "PM B", interval_miles: 30000, interval_days: 365, notes: "Oil, filters, inspection" },
    { name: "DOT Annual", interval_days: 365, notes: "Annual inspection" },
    { name: "IFTA Quarter", interval_days: 90, notes: "IFTA reporting" },
    { name: "Tires Rotation", interval_miles: 30000, notes: "Rotate tires" },
  ];

  if (!open || !truck) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl rounded-2xl border bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold text-lg">{truckTitle}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              className="px-3 py-2 rounded-xl border text-sm hover:bg-[var(--bg-hover)] inline-flex items-center gap-2"
              title="Export PM policies as CSV"
            >
              <Download className="w-4 h-4" /> Export
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 transition"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
              {err}
            </div>
          )}

          {/* Quick templates */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm opacity-80">Add from template:</span>
            {templates.map((t) => (
              <button
                key={t.name}
                onClick={() => beginAdd(t)}
                className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)]"
              >
                + {t.name}
              </button>
            ))}
            <button
              onClick={() => beginAdd()}
              className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)]"
            >
              <Plus className="w-3 h-3 inline -mt-0.5" /> Custom
            </button>
          </div>

          {/* Edit/Create form */}
          {(editing || form.name) && (
            <div className="rounded-xl border p-4">
              <div className="grid md:grid-cols-6 gap-3">
                <div className="md:col-span-2">
                  <label className="text-sm block mb-1 opacity-80">Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder="PM A, DOT, Tiresâ€¦"
                  />
                </div>
                <div>
                  <label className="text-sm block mb-1 opacity-80">Interval (miles)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={form.interval_miles}
                    onChange={(e) => setField("interval_miles", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder="15000"
                  />
                </div>
                <div>
                  <label className="text-sm block mb-1 opacity-80">Interval (days)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={form.interval_days}
                    onChange={(e) => setField("interval_days", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder="180"
                  />
                </div>
                <div>
                  <label className="text-sm block mb-1 opacity-80">Last Service Odo</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={form.last_service_odo}
                    onChange={(e) => setField("last_service_odo", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder={Number.isFinite(truck?.odometer) ? `â‰¤ ${truck.odometer}` : "e.g. 452000"}
                  />
                </div>
                <div>
                  <label className="text-sm block mb-1 opacity-80">Last Service Date</label>
                  <input
                    type="date"
                    value={form.last_service_date}
                    onChange={(e) => setField("last_service_date", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="text-sm block mb-1 opacity-80">Notes</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder="Oil, filters, vendor, etc."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="pm-active"
                    type="checkbox"
                    checked={!!form.active}
                    onChange={(e) => setField("active", e.target.checked)}
                  />
                  <label htmlFor="pm-active" className="text-sm">Active</label>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={savePolicy}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {editing ? "Update Policy" : "Save Policy"}
                </button>
                {(editing || form.name) && (
                  <button
                    onClick={() => { setEditing(null); setForm(emptyForm()); }}
                    className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
                  >
                    Cancel
                  </button>
                )}
                {editing && (
                  <button
                    onClick={() => deletePolicy(editing.id)}
                    className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)] text-red-300 border-red-500/30 inline-flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Policies table */}
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-black/10 text-left text-[var(--text-soft)]">
                <tr>
                  <th className="px-3 py-3">Policy</th>
                  <th className="px-3 py-3">Interval</th>
                  <th className="px-3 py-3">Last Service</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {busy && policies.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-10 text-center"><Loader2 className="inline w-4 h-4 animate-spin" /> Loadingâ€¦</td></tr>
                ) : policies.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center opacity-70">No PM policies yet. Use templates above to add.</td></tr>
                ) : (
                  policies.map((p, idx) => {
                    const zebra = idx % 2 ? "bg-black/5" : "";
                    const s = computeStatus(p);
                    const intervalStr = [
                      (p.interval_miles != null ? `${p.interval_miles.toLocaleString()} mi` : null),
                      (p.interval_days != null ? `${p.interval_days} d` : null),
                    ].filter(Boolean).join(" / ") || "â€”";
                    const lastStr = [
                      (p.last_service_odo != null ? `${p.last_service_odo.toLocaleString()} mi` : null),
                      (p.last_service_date ? new Date(p.last_service_date).toLocaleDateString() : null),
                    ].filter(Boolean).join(" â€¢ ") || "â€”";

                    return (
                      <tr key={p.id} className={zebra}>
                        <td className="px-3 py-3">
                          <div className="font-medium flex items-center gap-2">
                            <Wrench className="w-4 h-4" /> {p.name || "â€”"}
                            {p.active === false && (
                              <span className="text-xs opacity-60">(inactive)</span>
                            )}
                          </div>
                          <div className="text-xs opacity-70">{p.notes || ""}</div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{intervalStr}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{lastStr}</td>
                        <td className="px-3 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs border ${s.badge}`}>
                            {s.label}: {s.detail}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
                              onClick={() => beginEdit(p)}
                            >
                              <Pencil className="w-4 h-4" /> Edit
                            </button>
                            <button
                              className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
                              onClick={() => beginLog(p)}
                            >
                              <Calendar className="w-4 h-4" /> Log Service
                            </button>
                            <button
                              className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] text-red-300 border-red-500/30 inline-flex items-center gap-1"
                              onClick={() => deletePolicy(p.id)}
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

          {/* Log service inline form */}
          {logFor && (
            <div className="rounded-xl border p-4">
              <div className="font-medium mb-2">Log Service â€¢ {logFor.name}</div>
              <div className="grid md:grid-cols-5 gap-3">
                <div>
                  <label className="text-sm block mb-1 opacity-80">Service Date</label>
                  <input
                    type="date"
                    value={logForm.service_date}
                    onChange={(e) => setLogField("service_date", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                  />
                </div>
                <div>
                  <label className="text-sm block mb-1 opacity-80">Service Odometer</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={logForm.service_odo}
                    onChange={(e) => setLogField("service_odo", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder={Number.isFinite(truck?.odometer) ? `â‰ˆ ${truck.odometer}` : "e.g. 453000"}
                  />
                </div>
                <div>
                  <label className="text-sm block mb-1 opacity-80">Cost ($)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={logForm.cost}
                    onChange={(e) => setLogField("cost", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder="0.00"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm block mb-1 opacity-80">Notes</label>
                  <input
                    value={logForm.notes}
                    onChange={(e) => setLogField("notes", e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent"
                    placeholder="Shop, parts, etc."
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={logService}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Log
                </button>
                <button
                  onClick={() => { setLogFor(null); setLogForm(emptyLogForm()); }}
                  className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

