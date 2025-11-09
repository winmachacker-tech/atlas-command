// src/pages/DriverDetail.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  ArrowLeft,
  Truck,
  IdCard,
  Upload,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import AIRecPanel from "../components/AIRecPanel";
import DriverPreferences from "../components/DriverPreferences.jsx";
/** ✅ FIX: use the correct component/file name */
import DriverThumbsBar from "../components/DriverThumbsBar.jsx";

/* ---------- helpers (match Drivers.jsx style) ---------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
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

/* ============================== PAGE ============================== */
export default function DriverDetail() {
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Photo
  const [savingPhoto, setSavingPhoto] = useState(false);
  const photoInputRef = useRef(null);

  // Docs
  const [docs, setDocs] = useState([]);
  const [docsBusy, setDocsBusy] = useState(false);
  const [docsErr, setDocsErr] = useState("");
  const docInputRef = useRef(null);

  // ---------- Fetch (use * so we don't reference missing columns) ----------
  useEffect(() => {
    let ignore = false;
    async function run() {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase.from("drivers").select("*").eq("id", id).maybeSingle();
      if (!ignore) {
        if (error) {
          setErr(error.message);
          setRow(null);
        } else {
          setRow(data);
        }
        setLoading(false);
      }
    }
    run();
    // realtime updates
    const ch = supabase
      .channel(`driver:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drivers", filter: `id=eq.${id}` },
        (payload) => setRow((prev) => ({ ...(prev || {}), ...(payload.new || {}) }))
      )
      .subscribe();
    return () => {
      ignore = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  async function refreshRow() {
    const { data, error } = await supabase.from("drivers").select("*").eq("id", id).maybeSingle();
    if (error) {
      setErr(error.message);
      return;
    }
    setRow(data);
  }

  // ---------- Avatar URL resolver ----------
  const avatarUrl = useMemo(() => {
    if (!row) return "";
    if (row.avatar_url) return row.avatar_url;
    if (row.photo_path) {
      const { data } = supabase.storage.from("driver-photos").getPublicUrl(row.photo_path);
      return data?.publicUrl || "";
    }
    return "";
  }, [row]);

  async function handleUploadPhoto(file) {
    if (!file || !id) return;
    setSavingPhoto(true);
    setErr("");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${id}/avatar.${ext}`;
      const { error: upErr } = await supabase
        .storage
        .from("driver-photos")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("driver-photos").getPublicUrl(path);
      const publicUrl = pub?.publicUrl;

      const { error: updErr } = await supabase
        .from("drivers")
        .update({ avatar_url: publicUrl, photo_path: path, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (updErr) throw updErr;

      await refreshRow();
    } catch (e) {
      console.error("[DriverDetail] handleUploadPhoto error:", e);
      setErr(e?.message || "Failed to upload photo");
    } finally {
      setSavingPhoto(false);
    }
  }

  // ---------- Documents (bucket: driver-docs) ----------
  async function listDocs() {
    if (!id) return;
    setDocsBusy(true);
    setDocsErr("");
    try {
      const { data, error } = await supabase.storage
        .from("driver-docs")
        .list(`${id}`, { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;

      const files = (data || []).map((f) => {
        const path = `${id}/${f.name}`;
        const { data: pub } = supabase.storage.from("driver-docs").getPublicUrl(path);
        return { ...f, path, publicUrl: pub?.publicUrl || "" };
      });
      setDocs(files);
    } catch (e) {
      console.error("[DriverDetail] listDocs error:", e);
      setDocsErr(e?.message || "Could not load documents");
    } finally {
      setDocsBusy(false);
    }
  }
  async function handleUploadDoc(file) {
    if (!file || !id) return;
    setDocsBusy(true);
    setDocsErr("");
    try {
      const safe = file.name.replace(/\s+/g, "_");
      const path = `${id}/${Date.now()}_${safe}`;
      const { error } = await supabase.storage.from("driver-docs").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;
      await listDocs();
    } catch (e) {
      console.error("[DriverDetail] handleUploadDoc error:", e);
      setDocsErr(e?.message || "Upload failed");
    } finally {
      setDocsBusy(false);
    }
  }
  async function handleDeleteDoc(path) {
    if (!path) return;
    setDocsBusy(true);
    setDocsErr("");
    try {
      const { error } = await supabase.storage.from("driver-docs").remove([path]);
      if (error) throw error;
      await listDocs();
    } catch (e) {
      console.error("[DriverDetail] handleDeleteDoc error:", e);
      setDocsErr(e?.message || "Delete failed");
    } finally {
      setDocsBusy(false);
    }
  }
  useEffect(() => {
    listDocs();
  }, [id]);

  // ---------- Derived field names ----------
  const cdlNumber = getCdlNumber(row || {});
  const cdlClass = getField(row || {}, "cdl_class");
  const cdlExp = getField(row || {}, "cdl_exp");
  const medExp = getField(row || {}, "med_exp");

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <Link
          to="/drivers"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </Link>
        <div className="mt-4 flex items-center gap-2 text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (err || !row) {
    return (
      <div className="p-4 md:p-6">
        <Link
          to="/drivers"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </Link>
        <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-red-700 dark:text-red-200">
          {err || "Driver not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/drivers"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </Link>
          <h1 className="text-2xl font-semibold">Driver</h1>
        </div>
        <div className="text-xs text-zinc-500">ID: {row.id}</div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Main profile */}
        <section className="lg:col-span-2 rounded-2xl border border-zinc-200 dark:border-neutral-800 p-4">
          <div className="flex items-start justify-between gap-4">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-zinc-100 dark:bg-neutral-900 flex items-center justify-center border border-zinc-200 dark:border-neutral-800">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Driver photo" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon className="w-8 h-8 opacity-50" />
              )}
            </div>

            {/* Name + status + photo action */}
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xl font-medium">
                    {[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div className="text-xs text-zinc-500">Email: {row.email || "—"}</div>
                </div>
                <span
                  className={cx(
                    "text-xs px-2 py-1 rounded-lg",
                    row.status === "ACTIVE"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                      : row.status === "ASSIGNED"
                      ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  )}
                >
                  {row.status || "UNKNOWN"}
                </span>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900 text-sm"
                  disabled={savingPhoto}
                >
                  {savingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {savingPhoto ? "Saving…" : avatarUrl ? "Replace Photo" : "Upload Photo"}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadPhoto(f);
                    e.currentTarget.value = "";
                  }}
                />
              </div>
            </div>
          </div>

          {/* Info grid */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Info label="Phone">{row.phone || "—"}</Info>
            <Info label="CDL # " icon={<IdCard className="w-4 h-4" />}>
              {cdlNumber || "—"}
            </Info>
            <Info label="CDL Class">{cdlClass || "—"}</Info>
            <Info label="CDL Expiration">
              {row.cdl_exp
                ? new Date(row.cdl_exp).toLocaleDateString()
                : cdlExp
                ? new Date(cdlExp).toLocaleDateString()
                : "—"}
            </Info>
            <Info label="Medical Expiration">
              {row.med_exp
                ? new Date(row.med_exp).toLocaleDateString()
                : medExp
                ? new Date(medExp).toLocaleDateString()
                : "—"}
            </Info>
          </div>

          {/* AI Recommendations Panel */}
          <div className="mt-6">
            <AIRecPanel context_type="DRIVER" context_id={id} />
          </div>

          {/* Preferences + Thumbs (both scoped by driverId) */}
          <div className="mt-6 space-y-4">
            <DriverPreferences driverId={id} />
            {/* ✅ FIX: use DriverThumbsBar instead of DispatchThumbsBar */}
            <DriverThumbsBar driverId={id} compact debugMode />
          </div>

          {/* Timestamps */}
          <div className="mt-6">
            <div className="text-sm font-medium mb-2">Timestamps</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="text-zinc-500">
                Created: <span className="text-zinc-900 dark:text-zinc-100">{fmtDate(row.created_at)}</span>
              </div>
              <div className="text-zinc-500">
                Updated: <span className="text-zinc-900 dark:text-zinc-100">{fmtDate(row.updated_at)}</span>
              </div>
            </div>
          </div>

          {/* Optional notes */}
          {row?.notes ? (
            <div className="mt-6">
              <div className="text-sm font-medium mb-2">Notes</div>
              <div className="rounded-xl border border-zinc-200 dark:border-neutral-800 p-3 text-sm whitespace-pre-wrap">
                {row.notes}
              </div>
            </div>
          ) : null}
        </section>

        {/* RIGHT: Truck + Documents */}
        <section className="rounded-2xl border border-zinc-200 dark:border-neutral-800 p-4 space-y-4">
          <div>
            <div className="text-sm font-medium mb-3">Current Truck</div>
            {row.truck_id ? (
              <Link
                to={`/trucks`}
                className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
                title="Open Trucks"
              >
                <Truck className="w-4 h-4" />
                {row.truck_number || row.truck_id}
              </Link>
            ) : (
              <div className="text-sm text-zinc-500">—</div>
            )}
          </div>

          {/* Documents */}
          <div className="pt-4 border-t border-zinc-200 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium flex items-center gap-2">
                <FileText className="w-4 h-4" /> Driver Documents
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => listDocs()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900 text-xs"
                  disabled={docsBusy}
                  title="Refresh"
                >
                  {docsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {docsBusy ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={() => docInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900 text-xs"
                  disabled={docsBusy}
                >
                  <Upload className="w-4 h-4" /> Upload
                </button>
                <input
                  ref={docInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    for (const f of files) {
                      await handleUploadDoc(f);
                    }
                    e.currentTarget.value = "";
                  }}
                />
              </div>
            </div>

            {docsErr && <div className="mt-3 text-sm text-red-600 dark:text-red-300">{docsErr}</div>}

            <div className="mt-3 space-y-2">
              {docsBusy && docs.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : docs.length === 0 ? (
                <div className="text-sm text-zinc-500">No documents uploaded yet.</div>
              ) : (
                docs.map((f) => (
                  <div
                    key={f.path}
                    className="rounded-xl border border-zinc-200 dark:border-neutral-800 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{f.name}</div>
                      <div className="text-[11px] text-zinc-500">{fmtDate(f.updated_at || row.updated_at)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={f.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900 text-xs"
                      >
                        View
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteDoc(f.path)}
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900 text-xs text-red-600 dark:text-red-300"
                        disabled={docsBusy}
                        title="Delete document"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Info({ label, children, icon = null }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-neutral-800 p-3">
      <div className="text-xs text-zinc-500 flex items-center gap-2">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
