// src/pages/DriverDetail.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import DriverFitBadge from "../components/DriverFitBadge.jsx";
import { supabase } from "../lib/supabase";
import DriverCreateForm from "../components/DriverCreateForm.jsx";
import {
  Loader2,
  ArrowLeft,
  Truck,
  IdCard,
  Upload,
  Trash2,
  RefreshCw,
  FileText,
  Phone,
  Mail,
  BadgeCheck,
} from "lucide-react";

/* Live refetch on DB changes (safe, single-subscription) */
import useRealtimeRefetch from "../hooks/useRealtimeRefetch";

/* Feature panels/components */
import AIRecPanel from "../components/AIRecPanel";
import DriverPreferences from "../components/DriverPreferences.jsx";
import DriverThumbsBar from "../components/DriverThumbsBar.jsx";
import DriverFitChip from "../components/DriverFitChip.jsx";

/* ---------------- helpers (match Drivers.jsx style) ---------------- */
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
function getField(obj, key, fallback = "—") {
  if (!obj || typeof obj !== "object") return fallback;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return fallback;
  const v = obj[key];
  if (v === null || v === undefined || v === "") return fallback;
  return v;
}
/** Try several keys and return the first value found (useful for schema drift). */
function getFirstAvailable(obj, keys = [], fallback = "—") {
  for (const k of keys) {
    const val = getField(obj, k, null);
    if (val !== null && val !== "—") return val;
  }
  return fallback;
}

/* ---------------- constants ---------------- */
const DOC_BUCKET = "driver-docs"; // make sure this bucket exists
const AVATAR_SIZE = 72;

/* ---------------- page ---------------- */
export default function DriverDetail() {
  const { id: driverId } = useParams();
  const isNewDriver = driverId === "new";
  
  const [loading, setLoading] = useState(true);
  const [driver, setDriver] = useState(null);
  const [error, setError] = useState("");

  const [files, setFiles] = useState([]); // { name, id, path, created_at, updated_at, ... }
  const [uploading, setUploading] = useState(false);
  const [deletingPath, setDeletingPath] = useState("");
  const fileInputRef = useRef(null);

  /* ---------- ADDED: local refresh key for post-thumb refetch ---------- */
  const [refreshKey, setRefreshKey] = useState(0);
  const refetchDriver = () => setRefreshKey((n) => n + 1);

  /* --------------- fetch driver --------------- */
  const fetchDriver = useCallback(async () => {
    // ✅ Don't try to fetch if creating new driver
    if (!driverId || isNewDriver) {
      setLoading(false);
      return;
    }
    
    setError("");
    try {
      // ✅ Use "*" so missing columns (like equipment_type) don't throw
      const { data, error: err } = await supabase
        .from("drivers")
        .select("*")
        .eq("id", driverId)
        .single();
      if (err) throw err;
      setDriver(data);
    } catch (err) {
      console.error("fetchDriver error:", err);
      setError(err?.message || "Failed to load driver.");
    }
  }, [driverId, isNewDriver]);

  /* --------------- fetch storage documents --------------- */
  const listDocs = useCallback(async () => {
    // ✅ Don't try to list docs for new driver
    if (!driverId || isNewDriver) return;
    
    try {
      const prefix = `${driverId}/`;
      const { data, error: err } = await supabase.storage
        .from(DOC_BUCKET)
        .list(prefix, { limit: 100, offset: 0, sortBy: { column: "created_at", order: "desc" } });
      if (err) throw err;
      const decorated =
        (data || []).map((f) => ({
          ...f,
          path: `${prefix}${f.name}`,
        })) || [];
      setFiles(decorated);
    } catch (err) {
      console.error("listDocs error:", err);
      // non-fatal
    }
  }, [driverId, isNewDriver]);

  /* --------------- upload document --------------- */
  const handlePickFile = () => {
    fileInputRef.current?.click();
  };
  const handleUploadDoc = async (evt) => {
    const file = evt?.target?.files?.[0];
    if (!file || !driverId || isNewDriver) return;
    setUploading(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeName = file.name.replace(/[^\w\-.]+/g, "_");
      const path = `${driverId}/${stamp}-${safeName}`;

      const { error: upErr } = await supabase.storage.from(DOC_BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;

      await listDocs();
    } catch (err) {
      console.error("upload error:", err);
      alert(err?.message || "Failed to upload file.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* --------------- delete document --------------- */
  const handleDeleteDoc = async (path) => {
    if (!path) return;
    const confirm = window.confirm("Delete this document?");
    if (!confirm) return;
    setDeletingPath(path);
    try {
      const { error: delErr } = await supabase.storage.from(DOC_BUCKET).remove([path]);
      if (delErr) throw delErr;
      setFiles((prev) => prev.filter((f) => f.path !== path));
    } catch (err) {
      console.error("delete error:", err);
      alert(err?.message || "Failed to delete file.");
    } finally {
      setDeletingPath("");
    }
  };

  /* --------------- initial loads --------------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await Promise.all([fetchDriver(), listDocs()]);
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [fetchDriver, listDocs, refreshKey]); // ← ADDED refreshKey

  /* --------------- realtime refetch --------------- */
  useRealtimeRefetch({
    table: "drivers",
    schema: "public",
    events: ["UPDATE"],
    filter: { column: "id", op: "eq", value: driverId },
    onAny: () => {
      // ✅ Don't refetch for new driver
      if (!isNewDriver) {
        fetchDriver();
      }
    },
  });

  const fullName = useMemo(() => {
    if (isNewDriver) return "New Driver";
    const first = getField(driver, "first_name", "");
    const last = getField(driver, "last_name", "");
    const joined = [first, last].filter(Boolean).join(" ");
    return joined || "Unnamed Driver";
  }, [driver, isNewDriver]);

  const statusTone = useMemo(() => {
    const s = (getField(driver, "status", "") || "").toUpperCase();
    if (s === "ACTIVE") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    if (s === "ASSIGNED") return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    if (s === "INACTIVE") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    return "bg-zinc-700/40 text-zinc-200 border-zinc-600/60";
  }, [driver]);

  /* ---------------- UI ---------------- */
  if (loading && !isNewDriver) {
    return (
      <div className="p-6 flex items-center gap-2 text-zinc-300">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading driver…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/drivers" className="inline-flex items-center gap-2 text-zinc-300 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          Back to Drivers
        </Link>
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200">
          {error}
        </div>
      </div>
    );
  }

  // ✅ Show create form for new driver
  if (isNewDriver) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/drivers" className="inline-flex items-center gap-2 text-zinc-300 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            Back to Drivers
          </Link>
        </div>

        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-6">
          <h1 className="text-2xl font-semibold text-white mb-4">Create New Driver</h1>
          <DriverCreateForm onCancel={() => window.history.back()} />
        </div>
      </div>
    );
  }

  // Try multiple keys for equipment to survive schema differences
  const equipmentValue = getFirstAvailable(driver, [
    "equipment_type",
    "equipment",
    "equipmentType",
    "truck_type",
    "power_unit_type",
    "trailer_type",
  ]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* ------ top nav ------ */}
      <div className="flex items-center justify-between">
        <Link to="/drivers" className="inline-flex items-center gap-2 text-zinc-300 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          Back to Drivers
        </Link>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Auto-realtime</span>
        </div>
      </div>

      {/* ------ header card ------ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
          <div className="flex items-start gap-4">
            <div
              className="rounded-full bg-zinc-800/60 border border-zinc-700 overflow-hidden"
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            >
              {/* Avatar fallback */}
              <div className="w-full h-full flex items-center justify-center text-zinc-400">
                <IdCard className="w-8 h-8" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl md:text-2xl font-semibold text-white truncate">{fullName}</h1>
                <span
                  className={cx(
                    "text-[11px] px-2.5 py-1 rounded-full border",
                    statusTone
                  )}
                >
                  {getField(driver, "status")}
                </span>
                <DriverFitBadge driverId={driverId} />
                <DriverFitChip driverId={driverId} />
              </div>

              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2 text-zinc-300">
                  <Phone className="w-4 h-4 text-zinc-400" />
                  <span>{getField(driver, "phone")}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Mail className="w-4 h-4 text-zinc-400" />
                  <span className="truncate">{getField(driver, "email")}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Truck className="w-4 h-4 text-zinc-400" />
                  <span>{equipmentValue}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <BadgeCheck className="w-4 h-4 text-zinc-400" />
                  <span>CDL {getField(driver, "cdl_class")}</span>
                </div>
              </div>

              <div className="mt-3 text-xs text-zinc-500">
                <div>Created: {fmtDate(getField(driver, "created_at", ""))}</div>
                <div>Updated: {fmtDate(getField(driver, "updated_at", ""))}</div>
              </div>
            </div>
          </div>

          {/* thumbs/learning bar */}
          <div className="mt-4">
            <DriverThumbsBar
              driverId={driverId}              // string from useParams OR driver object; both OK
              onChange={() => refetchDriver()} // optional; triggers a local refetch if you want
            />
          </div>
        </div>

        {/* right rail actions */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5 space-y-4">
          <div className="text-sm font-medium text-zinc-200">Quick Actions</div>
          <button
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-200 py-2.5"
            onClick={handlePickFile}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            <span>Upload Document</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUploadDoc}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt"
          />
        </div>
      </div>

      {/* ------ grid: prefs / documents / AI ------ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Preferences */}
        <div className="xl:col-span-2 rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
          <div className="p-4 md:p-5 border-b border-zinc-700/60">
            <div className="text-sm font-medium text-zinc-200">Driver Preferences</div>
            <div className="text-xs text-zinc-500">What they like, what they avoid, recent feedback.</div>
          </div>
          <div className="p-4 md:p-5">
            <DriverPreferences driverId={driverId} />
          </div>
        </div>

        {/* Documents */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
          <div className="p-4 md:p-5 border-b border-zinc-700/60">
            <div className="text-sm font-medium text-zinc-200">Documents</div>
            <div className="text-xs text-zinc-500">
              Upload licenses, med cards, orientation docs, etc.
            </div>
          </div>

          <div className="p-4 md:p-5">
            {files.length === 0 ? (
              <div className="text-sm text-zinc-400 italic">No documents yet.</div>
            ) : (
              <div className="mt-1 space-y-2">
                {files.map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between gap-3 border border-zinc-700/60 rounded-xl p-2.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-zinc-200 truncate">{f.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          {fmtDate(f.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* Open (signed URL) */}
                      <button
                        onClick={async () => {
                          try {
                            const { data, error: urlErr } = await supabase.storage
                              .from(DOC_BUCKET)
                              .createSignedUrl(f.path, 60);
                            if (urlErr) throw urlErr;
                            const url = data?.signedUrl;
                            if (url) window.open(url, "_blank", "noopener,noreferrer");
                          } catch (err) {
                            console.error("open url error:", err);
                            alert("Failed to open file.");
                          }
                        }}
                        className="px-2 py-1 rounded-lg border border-zinc-700/60 hover:bg-zinc-800 text-zinc-300 text-xs"
                        title="Open"
                      >
                        Open
                      </button>

                      <button
                        onClick={() => handleDeleteDoc(f.path)}
                        className={cx(
                          "p-1.5 rounded-lg text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 border border-transparent"
                        )}
                        title="Delete document"
                        disabled={deletingPath === f.path}
                      >
                        {deletingPath === f.path ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------ AI panel (recommendations/insights) ------ */}
      <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
        <div className="p-4 md:p-5 border-b border-zinc-700/60">
          <div className="text-sm font-medium text-zinc-200">AI Recommendations</div>
          <div className="text-xs text-zinc-500">
            Suggestions and reasoning to improve dispatch fit and reduce friction.
          </div>
        </div>
        <div className="p-4 md:p-5">
          <AIRecPanel driverId={driverId} />
        </div>
      </div>
    </div>
  );
}