// src/pages/TruckProfile.jsx
import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  Gauge,
  Info,
  Loader2,
  MapPin,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Truck,
  UserCheck,
  UserX,
  Wrench,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import TruckDocumentsModal from "../components/TruckDocumentsModal.jsx";
import PMSchedulerModal from "../components/PMSchedulerModal.jsx";

/* ---------- constants & helpers ---------- */
const STATUS_CHOICES = ["ACTIVE", "INACTIVE", "MAINTENANCE"];
const DOCS_BUCKET = "truck-docs";
const PHOTO_BUCKET = "truck-photos"; // 👈 NEW

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function fmtDate(d) {
  try {
    return d ? new Date(d).toLocaleDateString() : "—";
  } catch {
    return "—";
  }
}
function daysUntil(d) {
  if (!d) return null;
  const due = new Date(d);
  if (isNaN(+due)) return null;
  const now = new Date();
  const diffMs = due.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
function duePill(d) {
  const n = daysUntil(d);
  if (n === null) return { text: "—", className: "bg-transparent text-[var(--text-soft)]" };
  if (n < 0) {
    return { text: `${fmtDate(d)} (${n}d)`, className: "bg-red-500/20 text-red-300 border border-red-500/30 shadow-sm" };
  }
  if (n <= 7) {
    return { text: `${fmtDate(d)} (+${n}d)`, className: "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm" };
  }
  return { text: fmtDate(d), className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25" };
}
function driverDisplayName(d) {
  if (!d) return "Driver";
  const fn = (d.first_name || "").trim();
  const ln = (d.last_name || "").trim();
  const name = [fn, ln].filter(Boolean).join(" ");
  return name || "Driver";
}

/* ---------- modal shell ---------- */
function ModalShell({ title, onClose, children, footer, maxWidth = "max-w-xl" }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 backdrop-blur-sm p-4">
      <div className={`w-full ${maxWidth} rounded-2xl border bg-[var(--panel)] shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold text-lg">{title}</div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">{footer}</div>
      </div>
    </div>
  );
}

/* ---------- Update Odometer modal ---------- */
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
      if (!Number.isFinite(value) || value < 0) throw new Error("Enter a valid non-negative number.");
      const { error } = await supabase.from("trucks").update({ odometer: value }).eq("id", truck.id);
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
          <button onClick={onClose} className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">{err}</div>}
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

/* ---------- Assign Driver modal (simple) ---------- */
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
      const { error } = await supabase.from("trucks").update(payload).eq("id", truck.id);
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
          <button onClick={onClose} className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">{err}</div>}
      <div className="mb-2 text-sm opacity-80">Search & select a driver:</div>
      <div className="relative mb-3">
        <Info className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-70" />
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
                  <tr key={d.id} className={cx("border-b", selected === d.id ? "bg-black/10" : "hover:bg-black/5")}>
                    <td className="px-3 py-2">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="radio" name="driver" checked={selected === d.id} onChange={() => setSelected(d.id)} />
                        <div>
                          <div className="font-medium">{name}</div>
                          <div className="text-xs opacity-70">{d.status || "—"}</div>
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

/* ---------- Truck Profile Page ---------- */
export default function TruckProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [truck, setTruck] = useState(null);
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);
  const [odoOpen, setOdoOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [docPresence, setDocPresence] = useState(false);
  const [uploading, setUploading] = useState(false); // 👈 NEW

  const [maint, setMaint] = useState([]);
  const [maintBusy, setMaintBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: tErr } = await supabase
          .from("trucks")
          .select("id, truck_number, vin, make, model, year, status, driver_id, odometer, reg_due, insp_due, ifta_due, ins_due, photo_url") // 👈 photo_url
          .eq("id", id)
          .maybeSingle();
        if (tErr) throw tErr;
        if (!data) throw new Error("Truck not found");

        // load driver (if any)
        let d = null;
        if (data.driver_id) {
          const { data: dData, error: dErr } = await supabase
            .from("drivers")
            .select("id, first_name, last_name, status")
            .eq("id", data.driver_id)
            .maybeSingle();
          if (dErr) throw dErr;
          d = dData || null;
        }

        // docs presence
        let hasDocs = false;
        try {
          const { data: list, error: lErr } = await supabase.storage.from(DOCS_BUCKET).list(`${data.id}`, { limit: 1 });
          hasDocs = !lErr && (list || []).length > 0;
        } catch {
          hasDocs = false;
        }

        // recent maintenance
        const { data: mData, error: mErr } = await supabase
          .from("truck_maintenance")
          .select("id, date, type, odometer, cost, notes, created_at")
          .eq("truck_id", data.id)
          .order("date", { ascending: false })
          .limit(10);
        if (mErr && !String(mErr?.message || "").includes("does not exist")) throw mErr;

        if (mounted) {
          setTruck(data);
          setDriver(d);
          setDocPresence(hasDocs);
          setMaint(mData || []);
        }
      } catch (e) {
        if (mounted) setError(e.message || "Failed to load truck");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  async function refetch() {
    setRefetching(true);
    setError(null);
    try {
      const { data, error: tErr } = await supabase
        .from("trucks")
        .select("id, truck_number, vin, make, model, year, status, driver_id, odometer, reg_due, insp_due, ifta_due, ins_due, photo_url") // 👈 photo_url
        .eq("id", id)
        .maybeSingle();
      if (tErr) throw tErr;
      setTruck(data);

      // driver
      if (data?.driver_id) {
        const { data: dData, error: dErr } = await supabase
          .from("drivers")
          .select("id, first_name, last_name, status")
          .eq("id", data.driver_id)
          .maybeSingle();
        if (dErr) throw dErr;
        setDriver(dData || null);
      } else {
        setDriver(null);
      }

      // docs presence
      try {
        const { data: list, error: lErr } = await supabase.storage.from(DOCS_BUCKET).list(`${id}`, { limit: 1 });
        setDocPresence(!lErr && (list || []).length > 0);
      } catch {
        setDocPresence(false);
      }

      // maintenance
      setMaintBusy(true);
      try {
        const { data: mData, error: mErr } = await supabase
          .from("truck_maintenance")
          .select("id, date, type, odometer, cost, notes, created_at")
          .eq("truck_id", id)
          .order("date", { ascending: false })
          .limit(10);
        if (mErr && !String(mErr?.message || "").includes("does not exist")) throw mErr;
        setMaint(mData || []);
      } finally {
        setMaintBusy(false);
      }
    } catch (e) {
      setError(e.message || "Failed to refresh");
    } finally {
      setRefetching(false);
    }
  }

  async function unassignDriver() {
    if (!truck) return;
    const { error } = await supabase.from("trucks").update({ driver_id: null }).eq("id", truck.id);
    if (error) {
      alert(error.message || "Failed to unassign");
      return;
    }
    await refetch();
  }

  // 👇 NEW: upload handler for truck photo
  async function handleUploadPhoto(e) {
    try {
      const file = e.target.files?.[0];
      if (!file || !truck?.id) return;

      setUploading(true);

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `${truck.id}.${ext}`;
      const filePath = `${truck.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(filePath);
      const url = pub?.publicUrl;
      if (!url) throw new Error("Could not get public URL");

      const { error: dbError } = await supabase
        .from("trucks")
        .update({ photo_url: url })
        .eq("id", truck.id);
      if (dbError) throw dbError;

      await refetch();
    } catch (err) {
      alert(err.message || "Upload failed");
    } finally {
      setUploading(false);
      // clear the input value so the same file can be re-selected if needed
      if (e?.target) e.target.value = "";
    }
  }

  const reg = duePill(truck?.reg_due);
  const insp = duePill(truck?.insp_due);
  const ifta = duePill(truck?.ifta_due);
  const ins = duePill(truck?.ins_due);

  const statusBadge =
    (truck?.status || "").toUpperCase() === "ACTIVE"
      ? "bg-sky-500/20 text-sky-300 border border-sky-500/25"
      : (truck?.status || "").toUpperCase() === "MAINTENANCE"
      ? "bg-violet-500/20 text-violet-300 border border-violet-500/25"
      : "bg-zinc-500/20 text-zinc-300 border border-zinc-500/25";

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="mb-4">
          <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
        <div className="grid place-items-center h-48 text-[var(--text-soft)]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 md:p-6">
        <div className="mb-4">
          <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
        <div className="rounded-xl border p-4 text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <div className="font-semibold">Failed to load truck</div>
            <div className="opacity-80">{error}</div>
          </div>
        </div>
      </div>
    );
  }
  if (!truck) return null;

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/5" title="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="text-2xl font-semibold tracking-tight">
              {truck.truck_number ? `Truck ${truck.truck_number}` : "Truck"}
            </div>
            <div className="text-sm opacity-70">
              VIN {truck.vin || "—"} • {(truck.make || "—") + " / " + (truck.model || "—") + " / " + (truck.year || "—")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refetch}
            className={cx("inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm", "hover:bg-[var(--bg-hover)] transition")}
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
            onClick={() => setPmOpen(true)}
            className={cx("inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm", "hover:bg-[var(--bg-hover)] transition")}
            title="PM Scheduler"
          >
            <Wrench className="w-4 h-4" />
            PM Scheduler
          </button>
          <button
            onClick={() => setDocsOpen(true)}
            className={cx(
              "inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm",
              docPresence ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "hover:bg-[var(--bg-hover)]"
            )}
            title={docPresence ? "View documents" : "Add documents"}
          >
            <Paperclip className="w-4 h-4" />
            {docPresence ? "Files" : "Add Docs"}
          </button>
        </div>
      </div>

      {/* 👇 NEW: Truck Photo uploader / preview */}
      <div className="mb-6 flex items-center gap-4">
        {truck.photo_url ? (
          <img
            src={truck.photo_url}
            alt="Truck photo"
            className="w-40 h-28 object-cover rounded-xl border"
          />
        ) : (
          <div className="w-40 h-28 rounded-xl border grid place-items-center text-xs opacity-50">
            No photo
          </div>
        )}
        <div>
          <label className="block mb-2 text-sm opacity-70">
            {uploading ? "Uploading…" : "Change / Upload Photo"}
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleUploadPhoto}
            disabled={uploading}
            className="block text-sm"
          />
          <div className="text-xs opacity-60 mt-1">
            Stored in bucket <span className="font-mono">{PHOTO_BUCKET}</span> at <span className="font-mono">{`/${id}/…`}</span>
          </div>
        </div>
      </div>

      {/* Top meta */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="rounded-2xl border p-4">
          <div className="text-xs opacity-70 mb-1">Status</div>
          <div className="flex items-center gap-2">
            <span className={cx("px-2 py-1 rounded-lg text-xs", statusBadge)}>{(truck.status || "—").toUpperCase()}</span>
            <button
              onClick={() => setAssignOpen(true)}
              className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
            >
              <Edit3 className="w-4 h-4" />
              Edit / Assign
            </button>
          </div>
          <div className="mt-3 text-xs opacity-70">Odometer</div>
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold">{truck.odometer ?? "—"}</div>
            <button
              onClick={() => setOdoOpen(true)}
              className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
            >
              <Gauge className="w-4 h-4" />
              Update
            </button>
          </div>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="text-xs opacity-70 mb-1">Assigned Driver</div>
          {truck.driver_id && driver ? (
            <div className="flex items-center gap-3">
              <Link
                to={`/drivers/${driver.id}`}
                className="underline underline-offset-2 hover:opacity-90"
                title="Open driver profile"
              >
                {driverDisplayName(driver)}
              </Link>
              <span className="text-xs opacity-70">• {driver.status || "—"}</span>
              <button
                onClick={unassignDriver}
                className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
              >
                <UserX className="w-4 h-4" />
                Unassign
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="opacity-60">Unassigned</span>
              <button
                onClick={() => setAssignOpen(true)}
                className="px-2 py-1 rounded-lg border text-xs hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
              >
                <UserCheck className="w-4 h-4" />
                Assign
              </button>
            </div>
          )}
          <div className="mt-3 text-xs opacity-70">VIN</div>
          <div className="font-medium">{truck.vin || "—"}</div>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="text-xs opacity-70 mb-2">Compliance</div>
          <div className="flex flex-wrap items-center gap-2">
            <span title="Registration">
              <span className={cx("px-2 py-1 rounded-full text-xs", reg.className)}>Reg: {reg.text}</span>
            </span>
            <span title="Inspection">
              <span className={cx("px-2 py-1 rounded-full text-xs", insp.className)}>Insp: {insp.text}</span>
            </span>
            <span title="IFTA">
              <span className={cx("px-2 py-1 rounded-full text-xs", ifta.className)}>IFTA: {ifta.text}</span>
            </span>
            <span title="Insurance">
              <span className={cx("px-2 py-1 rounded-full text-xs", ins.className)}>Ins: {ins.text}</span>
            </span>
          </div>
          <div className="text-xs opacity-60 mt-2">Hover to see labels; colors reflect urgency.</div>
        </div>
      </div>

      {/* Two-column: Recent maintenance / Documents quick view */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="font-semibold">Recent Maintenance</div>
            <div className="text-xs opacity-70">Showing last 10</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-black/10 text-left text-[var(--text-soft)]">
                <tr>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Odometer</th>
                  <th className="px-3 py-3">Cost</th>
                  <th className="px-3 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {maintBusy ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center">
                      <Loader2 className="inline w-4 h-4 animate-spin" /> Loading…
                    </td>
                  </tr>
                ) : maint.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center opacity-70">
                      No entries yet.
                    </td>
                  </tr>
                ) : (
                  maint.map((r, i) => {
                    const zebra = i % 2 ? "bg-black/5" : "";
                    return (
                      <tr key={r.id} className={cx(zebra, "border-t")}>
                        <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="px-3 py-3">{r.type || "—"}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{r.odometer ?? "—"}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {r.cost != null ? `$${Number(r.cost).toLocaleString()}` : "—"}
                        </td>
                        <td className="px-3 py-3">{r.notes || "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t text-right">
            <Link
              to="/trucks"
              className="text-xs opacity-70 underline underline-offset-2 hover:opacity-100"
              title="Manage maintenance in Trucks table (Actions › Maintenance)"
            >
              Manage maintenance from the Trucks page
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Documents</div>
            <button
              onClick={() => setDocsOpen(true)}
              className={cx(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs",
                docPresence ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "hover:bg-[var(--bg-hover)]"
              )}
            >
              <Paperclip className="w-4 h-4" />
              {docPresence ? "Open" : "Add"}
            </button>
          </div>
          <div className="mt-3 text-sm opacity-80">
            Store registration, insurance, IFTA, inspections, and shop invoices per truck.
          </div>
          <div className="mt-3 text-xs opacity-60">
            Bucket: <span className="font-mono">{DOCS_BUCKET}</span> • Path: <span className="font-mono">{`/${id}/…`}</span>
          </div>
        </div>
      </div>

      {/* Modals */}
      <TruckDocumentsModal open={docsOpen} onClose={() => setDocsOpen(false)} truck={truck} />
      <PMSchedulerModal open={pmOpen} onClose={() => setPmOpen(false)} truck={truck} onSaved={refetch} />
      <OdometerModal open={odoOpen} onClose={() => setOdoOpen(false)} truck={truck} onSaved={refetch} />
      <AssignDriverModal open={assignOpen} onClose={() => setAssignOpen(false)} truck={truck} onSaved={refetch} />
    </div>
  );
}
