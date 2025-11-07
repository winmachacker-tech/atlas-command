// src/pages/Drivers.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  RefreshCw,
  Pencil,
  X,
  Upload,
  Trash2,
  FileText,
  CheckCircle2,
  Loader2,
  Search,
  Eye, // ✅ added
} from "lucide-react";
import { supabase } from "../lib/supabase";

const STATUS_CHOICES = [
  { label: "Active", value: "ACTIVE" },
  { label: "Assigned", value: "ASSIGNED" },
  { label: "Inactive", value: "INACTIVE" },
];
const CDL_CLASS_CHOICES = ["A", "B", "C"];

/* ---------- helpers ---------- */
function Badge({ children, tone = "default" }) {
  const toneMap = {
    default: "bg-zinc-700/40 text-zinc-100 border border-zinc-700/60",
    ACTIVE: "bg-emerald-700/30 text-emerald-200 border border-emerald-700/50",
    ASSIGNED: "bg-amber-700/30 text-amber-200 border border-amber-700/50",
    INACTIVE: "bg-zinc-700/30 text-zinc-200 border border-zinc-700/50",
  };
  return (
    <span className={`text-xs px-3 py-1 rounded-full ${toneMap[tone] || toneMap.default}`}>
      {children}
    </span>
  );
}
function prettyPhone(p) {
  if (!p) return "—";
  const digits = ("" + p).replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  return p;
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return "—";
  }
}
function getField(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key) ? obj[key] : undefined;
}
function getCdlNumber(obj) {
  const keys = ["cdl_number", "cdl", "cdlno", "cdl_num", "license_number", "license_no"];
  for (const k of keys) {
    const v = getField(obj, k);
    if (v !== undefined && v !== null && `${v}`.trim() !== "") return v;
  }
  return null;
}
function fieldExistsInRows(rows, key) {
  return rows.some((r) => Object.prototype.hasOwnProperty.call(r ?? {}, key));
}
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

/* =============================== PAGE =============================== */
export default function Drivers() {
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [busyIds, setBusyIds] = useState(new Set());
  const [addOpen, setAddOpen] = useState(false);

  const loadDrivers = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("drivers")
        .select("*")
        .order("last_name", { ascending: true });
      if (error) throw error;
      setDrivers(data || []);
    } catch (err) {
      console.error("[Drivers] fetch error:", err);
      alert(err.message || "Failed to load drivers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDrivers();
  }, [loadDrivers]);

  useEffect(() => {
    const ch = supabase
      .channel("drivers-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () =>
        loadDrivers()
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadDrivers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return drivers;
    const q = search.toLowerCase();
    return drivers.filter((d) => {
      const name = `${d.first_name || ""} ${d.last_name || ""}`.toLowerCase();
      return (
        name.includes(q) ||
        (d.email || "").toLowerCase().includes(q) ||
        (getCdlNumber(d) || "").toLowerCase().includes(q)
      );
    });
  }, [drivers, search]);

  async function setStatus(id, status) {
    try {
      setBusyIds((s) => new Set(s).add(id));
      const { error } = await supabase.from("drivers").update({ status }).eq("id", id);
      if (error) throw error;
    } catch (err) {
      console.error("status update failed", err);
      alert(err.message || "Failed to update status");
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  const hasCdlClass = fieldExistsInRows(drivers, "cdl_class");
  const hasCdlExp = fieldExistsInRows(drivers, "cdl_exp");
  const hasMedExp = fieldExistsInRows(drivers, "med_exp");

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Drivers</h1>
          <Badge>v1</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-70" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, CDL #"
              className="pl-8 pr-3 py-2 rounded-xl bg-zinc-900/40 border border-zinc-700/60 outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>
          <button
            onClick={loadDrivers}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700/60 hover:bg-zinc-800/40"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>

          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-black font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Driver
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-amber-700/60">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="[&>th]:text-left [&>th]:px-4 [&>th]:py-3 [&>th]:font-semibold text-zinc-300">
              <th>Name</th>
              <th>Phone</th>
              <th>CDL #</th>
              <th>Class</th>
              <th>CDL Exp.</th>
              <th>Med Exp.</th>
              <th>Status</th>
              <th className="text-right pr-6">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <div className="inline-flex items-center gap-2 text-zinc-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading drivers…
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-zinc-400">
                  No drivers found.
                </td>
              </tr>
            ) : (
              filtered.map((d) => {
                const fullName = [d.last_name, d.first_name].filter(Boolean).join(", ") || "—";
                const tone = d.status || "default";
                const busy = busyIds.has(d.id);
                const cdlNum = getCdlNumber(d);
                return (
                  <tr key={d.id} className="border-t border-zinc-800/70 hover:bg-zinc-900/30 transition">
                    <td className="px-4 py-4">
                      <div className="flex flex-col">
                        {/* ✅ make name clickable to profile */}
                        <Link
                          to={`/drivers/${d.id}`}
                          className="font-medium hover:underline underline-offset-2"
                          title="Open driver profile"
                        >
                          {fullName}
                        </Link>
                        <span className="text-xs text-zinc-400">{d.email || "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">{prettyPhone(d.phone)}</td>
                    <td className="px-4 py-4">{cdlNum || "—"}</td>
                    <td className="px-4 py-4">{hasCdlClass ? d.cdl_class || "—" : "—"}</td>
                    <td className="px-4 py-4">{hasCdlExp ? fmtDate(d.cdl_exp) : "—"}</td>
                    <td className="px-4 py-4">{hasMedExp ? fmtDate(d.med_exp) : "—"}</td>
                    <td className="px-4 py-4">
                      <Badge tone={tone}>{d.status || "—"}</Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {/* ✅ profile button */}
                        <Link
                          to={`/drivers/${d.id}`}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700/60 hover:bg-zinc-800/40"
                          title="Open profile"
                        >
                          <Eye className="h-4 w-4" />
                          Profile
                        </Link>

                        <select
                          disabled={busy}
                          value={d.status || "ACTIVE"}
                          onChange={(e) => setStatus(d.id, e.target.value)}
                          className="bg-zinc-900/40 border border-zinc-700/60 rounded-lg py-1.5 px-2 text-xs"
                        >
                          {STATUS_CHOICES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => setEditTarget(d)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700/60 hover:bg-zinc-800/40"
                          title="Edit driver"
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </button>

                        <DriverDocsButton driver={d} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {addOpen && <QuickAddDriverModal onClose={() => setAddOpen(false)} onCreated={loadDrivers} />}
      {editTarget && (
        <EditDriverModal
          drivers={drivers}
          driver={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            loadDrivers();
          }}
        />
      )}
    </div>
  );
}

/* --------------------------- Quick Add Modal --------------------------- */
function QuickAddDriverModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    cdl_number: "",
    cdl_class: "A",
    cdl_exp: "",
    med_exp: "",
    status: "ACTIVE",
  });
  const [saving, setSaving] = useState(false);
  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e) {
    e?.preventDefault();
    try {
      setSaving(true);
      const payload = {
        ...form,
        cdl_exp: form.cdl_exp || null,
        med_exp: form.med_exp || null,
      };
      const { error } = await supabase.from("drivers").insert([payload]);
      if (error) throw error;
      onCreated?.();
      onClose?.();
    } catch (err) {
      console.error("add driver failed", err);
      alert(err.message || "Failed to add driver");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center z-50">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-700/60 bg-[#101012]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800/70">
          <h2 className="text-lg font-semibold">Add Driver</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800/40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={save} className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField label="First Name" value={form.first_name} onChange={(v) => setField("first_name", v)} />
          <TextField label="Last Name" value={form.last_name} onChange={(v) => setField("last_name", v)} />
          <TextField label="Email" value={form.email} onChange={(v) => setField("email", v)} />
          <TextField label="Phone" value={form.phone} onChange={(v) => setField("phone", v)} />
          <TextField label="CDL #" value={form.cdl_number} onChange={(v) => setField("cdl_number", v)} />
          <SelectField
            label="CDL Class"
            value={form.cdl_class}
            onChange={(v) => setField("cdl_class", v)}
            options={CDL_CLASS_CHOICES.map((c) => ({ label: c, value: c }))}
          />
          <DateField label="CDL Expiration" value={form.cdl_exp} onChange={(v) => setField("cdl_exp", v)} />
          <DateField label="Medical Expiration" value={form.med_exp} onChange={(v) => setField("med_exp", v)} />
          <SelectField label="Status" value={form.status} onChange={(v) => setField("status", v)} options={STATUS_CHOICES} />

          <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl border border-zinc-700/60">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-black font-medium"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save Driver
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------------------- Edit Modal ---------------------------- */
function EditDriverModal({ drivers, driver, onClose, onSaved }) {
  const has = useMemo(() => {
    const keys = [
      "first_name",
      "last_name",
      "email",
      "phone",
      "cdl_class",
      "cdl_exp",
      "med_exp",
      "status",
      "cdl_number",
      "cdl",
      "cdlno",
      "cdl_num",
      "license_number",
      "license_no",
    ];
    const presence = {};
    for (const k of keys) presence[k] = fieldExistsInRows(drivers, k);
    return presence;
  }, [drivers]);

  const [form, setForm] = useState(() => ({
    first_name: driver.first_name || "",
    last_name: driver.last_name || "",
    email: driver.email || "",
    phone: driver.phone || "",
    cdl_class: driver.cdl_class || "A",
    cdl_exp: driver.cdl_exp || "",
    med_exp: driver.med_exp || "",
    status: driver.status || "ACTIVE",
    _cdl_key: ["cdl_number", "cdl", "cdlno", "cdl_num", "license_number", "license_no"].find((k) => has[k]),
    _cdl_value: getCdlNumber(driver) || "",
  }));
  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    try {
      const patch = {};
      if (has.first_name) patch.first_name = form.first_name;
      if (has.last_name) patch.last_name = form.last_name;
      if (has.email) patch.email = form.email;
      if (has.phone) patch.phone = form.phone;
      if (has.cdl_class) patch.cdl_class = form.cdl_class;
      if (has.cdl_exp) patch.cdl_exp = form.cdl_exp || null;
      if (has.med_exp) patch.med_exp = form.med_exp || null;
      if (has.status) patch.status = form.status;
      if (form._cdl_key) patch[form._cdl_key] = form._cdl_value || null;

      const { error } = await supabase.from("drivers").update(patch).eq("id", driver.id);
      if (error) throw error;
      onSaved?.();
    } catch (err) {
      console.error("save driver failed", err);
      alert(err.message || "Failed to save");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center z-50">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-700/60 bg-[#101012]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800/70">
          <h2 className="text-lg font-semibold">Edit Driver</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800/40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {has.first_name && <TextField label="First Name" value={form.first_name} onChange={(v) => setField("first_name", v)} />}
          {has.last_name && <TextField label="Last Name" value={form.last_name} onChange={(v) => setField("last_name", v)} />}
          {has.email && <TextField label="Email" value={form.email} onChange={(v) => setField("email", v)} />}
          {has.phone && <TextField label="Phone" value={form.phone} onChange={(v) => setField("phone", v)} />}
          {form._cdl_key && (
            <TextField
              label="CDL #"
              value={form._cdl_value}
              onChange={(v) => setField("_cdl_value", v)}
              placeholder={`(${form._cdl_key})`}
            />
          )}
          {has.cdl_class && (
            <SelectField
              label="CDL Class"
              value={form.cdl_class || "A"}
              onChange={(v) => setField("cdl_class", v)}
              options={CDL_CLASS_CHOICES.map((c) => ({ label: c, value: c }))}
            />
          )}
          {has.cdl_exp && <DateField label="CDL Expiration" value={form.cdl_exp || ""} onChange={(v) => setField("cdl_exp", v)} />}
          {has.med_exp && <DateField label="Medical Expiration" value={form.med_exp || ""} onChange={(v) => setField("med_exp", v)} />}
          {has.status && (
            <SelectField label="Status" value={form.status || "ACTIVE"} onChange={(v) => setField("status", v)} options={STATUS_CHOICES} />
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-zinc-800/70">
          <div className="text-xs text-zinc-400 inline-flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" />
            RLS-secured update
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-xl border border-zinc-700/60">
              Cancel
            </button>
            <button
              onClick={save}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-black font-medium"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Document Manager --------------------------- */
function DriverDocsButton({ driver }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700/60 hover:bg-zinc-800/40"
        title="Driver documents"
      >
        <FileText className="h-4 w-4" />
        Docs
      </button>
      {open && <DriverDocsModal driver={driver} onClose={() => setOpen(false)} />}
    </>
  );
}

function DriverDocsModal({ driver, onClose }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  // upload queue state
  const [queue, setQueue] = useState([]); // {name, size, status: 'queued'|'uploading'|'done'|'error', error?}
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef(null);

  const bucket = "driver-docs";
  const prefix = `${driver.id}/`;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: 100,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      setFiles(data || []);
    } catch (err) {
      console.error("list docs failed", err);
      alert(err.message || "Failed to list documents");
    } finally {
      setLoading(false);
    }
  }, [bucket, prefix]);

  useEffect(() => {
    load();
  }, [load]);

  function handlePick() {
    inputRef.current?.click();
  }

  function onFilesChosen(fileList) {
    if (!fileList || fileList.length === 0) return;
    const newItems = Array.from(fileList).map((f) => ({
      file: f,
      name: f.name,
      size: f.size,
      status: "queued",
    }));
    setQueue((q) => [...q, ...newItems]);
  }

  async function uploadAll() {
    if (queue.length === 0) return;
    setIsUploading(true);
    try {
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].status === "done") continue;
        const item = queue[i];
        setQueue((q) => {
          const next = [...q];
          next[i] = { ...next[i], status: "uploading" };
          return next;
        });

        const safeName = item.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${prefix}${Date.now()}_${i}_${safeName}`;

        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, item.file, { upsert: false, cacheControl: "3600" });

        if (error) {
          console.error("upload failed", error);
          setQueue((q) => {
            const next = [...q];
            next[i] = { ...next[i], status: "error", error: error.message || "Upload failed" };
            return next;
          });
        } else {
          setQueue((q) => {
            const next = [...q];
            next[i] = { ...next[i], status: "done" };
            return next;
          });
        }
      }
      await load(); // refresh listing after batch
    } finally {
      setIsUploading(false);
    }
  }

  async function onDelete(name) {
    if (!confirm("Delete this file?")) return;
    try {
      const { error } = await supabase.storage.from(bucket).remove([`${prefix}${name}`]);
      if (error) throw error;
      await load();
    } catch (err) {
      console.error("delete failed", err);
      alert(err.message || "Delete failed");
    }
  }

  async function signedUrl(name) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(`${prefix}${name}`, 60 * 10);
    if (error) throw error;
    return data.signedUrl;
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center z-50">
      <div className="w-full max-w-4xl rounded-2xl border border-zinc-700/60 bg-[#101012]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800/70">
          <div>
            <h3 className="text-lg font-semibold">Driver Documents</h3>
            <p className="text-xs text-zinc-400">
              {driver.last_name}, {driver.first_name} — {driver.email || "no email"}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800/40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Uploader */}
          <div className="rounded-xl border border-zinc-800/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Upload documents</div>
                <div className="text-xs text-zinc-400">
                  Select multiple files at once — supports 5+ docs per driver. Allowed: PDF, images, DOC/DOCX.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePick}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700/60 hover:bg-zinc-800/40"
                  disabled={isUploading}
                >
                  <Upload className="h-4 w-4" />
                  Choose files
                </button>
                <button
                  onClick={uploadAll}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-black font-medium disabled:opacity-60"
                  disabled={isUploading || queue.length === 0}
                >
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Upload {queue.length > 0 ? `(${queue.length})` : ""}
                </button>
              </div>
            </div>

            {/* hidden input */}
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                onFilesChosen(e.target.files);
                e.target.value = "";
              }}
              accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.tif,.tiff,.doc,.docx"
            />

            {/* queue list */}
            {queue.length > 0 && (
              <div className="mt-4 rounded-lg border border-zinc-800/70 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900/60">
                    <tr className="[&>th]:text-left [&>th]:px-4 [&>th]:py-2 [&>th]:font-semibold text-zinc-300">
                      <th>File</th>
                      <th>Size</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((q, idx) => (
                      <tr key={`${q.name}-${idx}`} className="border-t border-zinc-800/70">
                        <td className="px-4 py-2">{q.name}</td>
                        <td className="px-4 py-2">{formatBytes(q.size)}</td>
                        <td className="px-4 py-2">
                          {q.status === "queued" && <span className="text-zinc-400">Queued</span>}
                          {q.status === "uploading" && (
                            <span className="inline-flex items-center gap-2 text-zinc-300">
                              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
                            </span>
                          )}
                          {q.status === "done" && (
                            <span className="inline-flex items-center gap-1 text-emerald-300">
                              <CheckCircle2 className="h-4 w-4" /> Done
                            </span>
                          )}
                          {q.status === "error" && <span className="text-red-400">Error: {q.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 text-xs text-zinc-500">
              Stored at <code className="text-amber-300">/driver-docs/{driver.id}</code>
            </div>
          </div>

          {/* Existing files */}
          <div className="rounded-xl border border-zinc-800/70 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60">
                <tr className="[&>th]:text-left [&>th]:px-4 [&>th]:py-3 [&>th]:font-semibold text-zinc-300">
                  <th>File</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th className="text-right pr-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-300">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      Loading…
                    </td>
                  </tr>
                ) : files.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                      No documents uploaded yet.
                    </td>
                  </tr>
                ) : (
                  files.map((f) => (
                    <tr key={f.name} className="border-t border-zinc-800/70">
                      <td className="px-4 py-3 break-all">{f.name}</td>
                      <td className="px-4 py-3">{formatBytes(f.metadata?.size)}</td>
                      <td className="px-4 py-3">
                        {f.updated_at ? new Date(f.updated_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href="#"
                            onClick={async (e) => {
                              e.preventDefault();
                              try {
                                const url = await signedUrl(f.name);
                                window.open(url, "_blank", "noopener,noreferrer");
                              } catch (err) {
                                alert(err.message || "Failed to open file");
                              }
                            }}
                            className="px-3 py-2 rounded-xl border border-zinc-700/60 hover:bg-zinc-800/40"
                          >
                            Preview
                          </a>
                          <button
                            onClick={() => onDelete(f.name)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-800/60 hover:bg-red-900/20 text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Small UI ------------------------------ */
function TextField({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        className="px-3 py-2 rounded-xl bg-zinc-900/40 border border-zinc-700/60 outline-none focus:ring-2 focus:ring-amber-500/40"
      />
    </label>
  );
}
function DateField({ label, value, onChange }) {
  const v = value ? String(value).slice(0, 10) : "";
  return <TextField label={label} value={v} onChange={onChange} type="date" />;
}
function SelectField({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-xl bg-zinc-900/40 border border-zinc-700/60 outline-none focus:ring-2 focus:ring-amber-500/40"
      >
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}
