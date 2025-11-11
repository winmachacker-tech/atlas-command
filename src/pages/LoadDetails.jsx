// FILE: src/pages/LoadDetails.jsx
// Purpose:
// - Load details UI
// - Lane-based AI recommendations using rpc_ai_best_drivers_for_lane
// - Per-driver thumbs to train the AI live, plus Assign button
// - Working "Load Documents" buttons (Upload/Refresh/Open/Delete)
// - "Best-Fit → View" opens the top driver's detail page

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ArrowLeft, RefreshCw, Trash2, Upload, Eye } from "lucide-react";

import useBestDrivers from "../hooks/useBestDrivers";
import AIThumbs from "../components/AIThumbs.jsx";

/* ------------------------- config ------------------------- */
// Change this if your bucket has a different name:
const DOC_BUCKET = "load_docs";

/* ------------------------- helpers ------------------------- */
function cx(...a) { return a.filter(Boolean).join(" "); }
function toUSD(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function fmtDateTime(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); } catch { return String(d ?? "—"); }
}
function firstKey(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) if (k in obj && obj[k] != null && obj[k] !== "") return obj[k];
  return undefined;
}
function smallId(s) { if (!s) return "—"; const t = String(s); return t.length > 8 ? `${t.slice(0,6)}…${t.slice(-2)}` : t; }

/** Merge separate date + time into ISO string, else pass-through existing datetime if present */
function mergeDateTime({ date, time, direct }) {
  if (direct) return direct;
  if (!date && !time) return undefined;
  try {
    const d = date ? new Date(date) : new Date();
    if (typeof time === "string") {
      const [hh = "00", mm = "00"] = time.split(":");
      d.setHours(Number(hh), Number(mm), 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d.toISOString();
  } catch {
    return date || time || undefined;
  }
}

/* ---------------------- lightweight toast ----------------------- */
function useToast() {
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState("ok");
  const t = useRef(null);
  const show = useCallback((m, _tone="ok") => {
    setMsg(m); setTone(_tone);
    clearTimeout(t.current); t.current = setTimeout(() => setMsg(""), 3000);
  }, []);
  const View = useMemo(() => {
    if (!msg) return null;
    return (
      <div
        className={cx(
          "fixed z-50 bottom-16 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-xl text-sm shadow-lg border",
          tone==="ok" && "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
          tone==="err" && "bg-rose-500/10 text-rose-200 border-rose-500/30",
          tone==="info"&& "bg-sky-500/10 text-sky-200 border-sky-500/30"
        )}
        role="status"
      >
        {msg}
      </div>
    );
  }, [msg, tone]);
  return { show, ToastView: View };
}

/* --------------------------- Page ------------------------------- */
export default function LoadDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [load, setLoad] = useState(null);
  const [assigningId, setAssigningId] = useState("");
  const { show, ToastView } = useToast();

  // cache of driver meta so we can show names instead of UUIDs
  const [driverMeta, setDriverMeta] = useState({}); // { [id]: { full_name, phone } }

  // ---------- documents state ----------
  const [docs, setDocs] = useState([]);           // [{ name, id?: string, path }]
  const [docsBusy, setDocsBusy] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const fileInputRef = useRef(null);

  // Safety guard: if id is missing, don't render actions
  useEffect(() => {
    if (!id) show("Missing load id in the URL.", "err");
  }, [id, show]);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from("loads").select("*").eq("id", id).single();
      if (error) throw error;
      setLoad(data ?? null);
    } catch (err) {
      console.error(err);
      show(`Failed to load data: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }, [id, show]);

  useEffect(() => { refresh(); }, [refresh]);

  // Detect assignable columns; we’ll update BOTH if they exist.
  const assignCols = useMemo(() => {
    const cols = [];
    if (load) {
      if ("assigned_driver_id" in load) cols.push("assigned_driver_id");
      if ("driver_id" in load) cols.push("driver_id");
    }
    return cols;
  }, [load]);

  /* ----------------- Map your fields ------------------ */
  const status = firstKey(load, ["status"]) ?? "ACTIVE";
  const reference = firstKey(load, ["ref_no", "reference_no", "ref", "load_ref", "customer_ref", "customer_ref_no"]);
  const equipment = firstKey(load, ["equipment_type", "equipment", "equip", "equip_type"]);

  const puCity  = firstKey(load, ["origin_city", "pickup_city", "pu_city", "origin"]);
  const puState = firstKey(load, ["origin_state", "pickup_state", "pu_state"]);
  const delCity  = firstKey(load, ["destination_city", "delivery_city", "del_city", "destination"]);
  const delState = firstKey(load, ["destination_state", "delivery_state", "del_state"]);

  const puAt = mergeDateTime({
    date: firstKey(load, ["pickup_date", "pu_date"]),
    time: firstKey(load, ["pickup_time", "pu_time"]),
    direct: firstKey(load, ["pu_at", "pickup_at", "pickup_datetime"]),
  });
  const delAt = mergeDateTime({
    date: firstKey(load, ["delivery_date", "del_date"]),
    time: firstKey(load, ["delivery_time", "del_time"]),
    direct: firstKey(load, ["del_at", "delivery_at", "delivery_datetime"]),
  });

  const miles = firstKey(load, ["miles", "distance", "est_miles"]);
  const totalRate = firstKey(load, ["total_rate", "rate", "amount"]);

  // Build laneKey EXACTLY like your Customers page expects.
  const laneKey = useMemo(() => {
    const oc = (puCity || "").trim();
    const os = (puState || "").trim();
    const dc = (delCity || "").trim();
    const ds = (delState || "").trim();
    if (!oc || !os || !dc || !ds) return null;
    return `LANE ${oc}, ${os} → ${dc}, ${ds}`;
  }, [puCity, puState, delCity, delState]);

  // Pull AI recommendations for this lane
  const {
    data: bestDrivers,
    loading: aiLoading,
    error: aiError,
    refetch: refetchAI,
  } = useBestDrivers(laneKey, { limit: 10 });

  // Fetch driver names/phones for display
  useEffect(() => {
    const ids = (bestDrivers || []).map(r => r.driver_id).filter(Boolean);
    const missing = ids.filter(did => !driverMeta[did]);
    if (!missing.length) return;

    (async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, full_name, phone")
        .in("id", missing);

      if (!error && Array.isArray(data)) {
        setDriverMeta(prev => {
          const next = { ...prev };
          for (const r of data) next[r.id] = { full_name: r.full_name || "", phone: r.phone || "" };
          return next;
        });
      }
    })();
  }, [bestDrivers, driverMeta]);

  // Assign handler (after hook so we can call refetchAI)
  const assignDriver = useCallback(async (driverId) => {
    if (!driverId || !id) return;
    setAssigningId(driverId);
    try {
      let updated = false;

      // If the loads table has direct columns, update them (both if present)
      if (assignCols.length > 0) {
        const payload = assignCols.reduce((acc, c) => { acc[c] = driverId; return acc; }, {});
        // Also flip status if present
        if (load && "status" in load && (load.status || "").toUpperCase() !== "ASSIGNED") {
          payload.status = "ASSIGNED";
        }
        payload.updated_at = new Date().toISOString();

        const { error } = await supabase.from("loads").update(payload).eq("id", id);
        if (error) throw error;
        updated = true;
      }

      // Try to also record in a junction table if it exists
      try {
        await supabase
          .from("load_driver_assignments")
          .insert({ load_id: id, driver_id: driverId, assigned_at: new Date().toISOString() });
      } catch {
        /* ignore if table doesn't exist */
      }

      if (!updated) {
        // Neither column existed; require the junction table to be present
        const { error: insErr } = await supabase
          .from("load_driver_assignments")
          .insert({ load_id: id, driver_id: driverId, assigned_at: new Date().toISOString() });
        if (insErr) {
          throw new Error("Add loads.driver_id OR loads.assigned_driver_id OR create load_driver_assignments(load_id, driver_id).");
        }
      }

      show("Driver assigned to load.");
      await refresh();
      refetchAI();
    } catch (err) {
      console.error(err);
      show(`Assign failed: ${err.message}`, "err");
    } finally {
      setAssigningId("");
    }
  }, [id, load, assignCols, refresh, refetchAI, show]);

  /* ---------------------- Documents logic ---------------------- */
  // List documents under `/<loadId>/` prefix in the bucket
  const listDocs = useCallback(async () => {
    if (!id) return;
    setDocsBusy(true);
    try {
      const prefix = `${id}/`;
      const { data, error } = await supabase.storage.from(DOC_BUCKET).list(prefix, { limit: 100, offset: 0 });
      if (error) throw error;
      const items = (data || []).map(f => ({ name: f.name, path: prefix + f.name }));
      setDocs(items);
      if (!items.length) setSelectedDoc(null);
      show("Documents refreshed.", "info");
    } catch (err) {
      console.error(err);
      show(`Docs error: ${err.message}`, "err");
    } finally {
      setDocsBusy(false);
    }
  }, [id, show]);

  // Upload one file → `bucket/loadId/<filename>`
  const handleUploadClick = () => fileInputRef.current?.click();
  const onChooseFile = async (e) => {
    if (!id) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setDocsBusy(true);
    try {
      const path = `${id}/${file.name}`;
      const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true });
      if (error) throw error;
      show("Upload complete.");
      await listDocs();
    } catch (err) {
      console.error(err);
      show(`Upload failed: ${err.message}`, "err");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDocsBusy(false);
    }
  };

  // Open (signed URL)
  const handleOpen = async () => {
    if (!selectedDoc) return show("Select a document first.", "info");
    try {
      const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(selectedDoc.path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
      show(`Open failed: ${err.message}`, "err");
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!selectedDoc) return show("Select a document first.", "info");
    setDocsBusy(true);
    try {
      const { error } = await supabase.storage.from(DOC_BUCKET).remove([selectedDoc.path]);
      if (error) throw error;
      show("Deleted.");
      await listDocs();
    } catch (err) {
      console.error(err);
      show(`Delete failed: ${err.message}`, "err");
    } finally {
      setDocsBusy(false);
    }
  };

  // Extract Text – placeholder toast (hook to OCR later)
  const handleExtract = async () => {
    if (!selectedDoc) return show("Select a document first.", "info");
    show("OCR not wired yet here. Hook this to your OCR edge function.", "info");
  };

  // Auto-load doc list when page mounts/changes id
  useEffect(() => { listDocs(); }, [listDocs]);

  /* --------------------------- render --------------------------- */
  return (
    <div className="p-4 md:p-6">
      {ToastView}

      {/* hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={onChooseFile}
        accept="image/*,application/pdf"
      />

      {/* Top bar */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="ml-auto">
          <button
            onClick={() => { refresh(); refetchAI(); listDocs(); }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
            title="Refresh"
          >
            <RefreshCw className={cx("w-4 h-4", (loading || aiLoading || docsBusy) && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Header strip */}
      <div className="mb-5 rounded-2xl border border-pink-500/30 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div><span className="text-zinc-400 mr-1">Load:</span><span className="font-medium text-zinc-100">{smallId(id)}</span></div>
          <div><span className="text-zinc-400 mr-1">Ref:</span><span className="font-semibold tracking-wide">{reference ?? "—"}</span></div>
          <div className="hidden md:block text-zinc-500">•</div>
          <div><span className="text-zinc-400 mr-1">PU:</span><span className="text-zinc-100">{fmtDateTime(puAt)}</span></div>
          <div className="hidden md:block text-zinc-500">•</div>
          <div><span className="text-zinc-400 mr-1">DEL:</span><span className="text-zinc-100">{fmtDateTime(delAt)}</span></div>
          <div className="hidden md:block text-zinc-500">•</div>
          <div><span className="text-zinc-400 mr-1">Equip:</span><span className="text-zinc-100">{equipment ?? "—"}</span></div>
          {laneKey && (
            <>
              <div className="hidden md:block text-zinc-500">•</div>
              <div><span className="text-zinc-400 mr-1">Lane:</span><span className="text-zinc-100">{laneKey}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT */}
        <div className="lg:col-span-7 space-y-5">
          {/* Load Summary */}
          <section className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
            <header className="px-4 py-3 border-b border-zinc-700/60 flex items-center justify-between">
              <h2 className="text-zinc-100 font-semibold">Load Summary</h2>
              <span
                className={cx(
                  "text-xs px-2 py-0.5 rounded-full border",
                  (status || "").toUpperCase() === "ASSIGNED"
                    ? "text-amber-200 border-amber-500/40 bg-amber-500/10"
                    : "text-emerald-200 border-emerald-500/40 bg-emerald-500/10"
                )}
              >
                {(status || "ACTIVE").toUpperCase().replaceAll(" ", "_")}
              </span>
            </header>

            <div className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                <Info label="PICKUP"   value={`${puCity ?? "—"}, ${puState ?? "—"}`} sub={fmtDateTime(puAt)} />
                <Info label="DELIVERY" value={`${delCity ?? "—"}, ${delState ?? "—"}`} sub={fmtDateTime(delAt)} />
                <Info label="EQUIPMENT" value={equipment ?? "—"} />
                <Info label="MILES" value={miles ?? "—"} />
                <Info label="RATE"  value={toUSD(totalRate)} />
                <Info label="REFERENCE" value={reference ?? "—"} />
              </div>
            </div>
          </section>

          {/* AI Recommendations */}
          <section className="rounded-2xl border border-pink-500/30 bg-zinc-900/40">
            <header className="px-4 py-3 border-b border-pink-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink-400/80" />
                <h2 className="text-zinc-100 font-semibold">AI Recommendations</h2>
              </div>
              <button
                onClick={() => { refetchAI(); }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-pink-500/30 text-zinc-100 hover:bg-zinc-900"
              >
                <RefreshCw className={cx("w-4 h-4", aiLoading && "animate-spin")} />
                Refresh
              </button>
            </header>

            {!laneKey && (
              <div className="p-4 text-sm text-zinc-400">
                No lane detected for this load. Add origin/destination city & state to see recommendations.
              </div>
            )}

            {laneKey && (
              <div className="divide-y divide-zinc-800/80">
                {(!bestDrivers || bestDrivers.length === 0) && (
                  <div className="p-4 text-sm text-zinc-400">
                    No training signals for <span className="text-zinc-200 font-medium">{laneKey}</span> yet. Click 👍/👎 to start teaching.
                  </div>
                )}

                {(bestDrivers || []).map((row, idx) => {
                  const meta = driverMeta[row.driver_id] || {};
                  const displayName = meta.full_name || smallId(row.driver_id);
                  return (
                    <div key={row.driver_id} className="p-3 flex items-center gap-3">
                      <div className="w-6 text-zinc-500 text-sm tabular-nums">{idx + 1}</div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full border border-pink-400/60" />
                          <div className="text-zinc-100 font-medium truncate">{displayName}</div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                          <span>Score: <span className="text-zinc-100 font-medium">{row.score}</span></span>
                          <span>👍 {row.up_events}</span>
                          <span>👎 {row.down_events}</span>
                          <span>last +: {fmtDateTime(row.last_positive_at)}</span>
                        </div>
                      </div>

                      <div className="text-right mr-2">
                        <div className="text-xs text-zinc-400">score</div>
                        <div className="text-base font-semibold">{row.score}</div>
                      </div>

                      <AIThumbs
                        driverId={row.driver_id}
                        laneKey={laneKey}
                        onAfterChange={refetchAI}
                        size="sm"
                      />

                      <button
                        onClick={() => assignDriver(row.driver_id)}
                        disabled={assigningId === row.driver_id}
                        className={cx(
                          "ml-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-2xl border",
                          "border-zinc-700/70 text-emerald-200 hover:bg-zinc-800/60",
                          assigningId === row.driver_id && "opacity-60 cursor-not-allowed"
                        )}
                        title="Assign this driver to the load"
                      >
                        {assigningId === row.driver_id ? "Assigning…" : "Assign"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {aiError && (
              <div className="p-4 text-sm text-rose-400">
                {String(aiError.message || aiError)}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-5 space-y-5">
          {/* Best-Fit snapshot (simple highlight of the first recommendation) */}
          <section className="rounded-2xl border border-pink-500/30 bg-zinc-900/40">
            <header className="px-4 py-3 border-b border-pink-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink-400/80" />
                <h2 className="text-zinc-100 font-semibold">Best-Fit Drivers</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { refetchAI(); }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
                >
                  <RefreshCw className={cx("w-4 h-4", aiLoading && "animate-spin")} />
                  Refresh
                </button>
                <button
                  onClick={() => {
                    const top = (bestDrivers && bestDrivers[0]) ? bestDrivers[0].driver_id : null;
                    if (!top) return show("No best-fit driver yet.", "info");
                    navigate(`/drivers/${top}`);
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
                >
                  <Eye className="w-4 h-4" />
                  View
                </button>
              </div>
            </header>

            {laneKey && bestDrivers && bestDrivers[0] && (
              <div className="p-4">
                <div className="rounded-xl border border-zinc-800/80 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full border border-pink-400/60" />
                      <div className="font-medium text-zinc-100">
                        {driverMeta[bestDrivers[0].driver_id]?.full_name || smallId(bestDrivers[0].driver_id)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-zinc-400">top score</div>
                      <div className="text-lg font-semibold">{bestDrivers[0].score ?? 0}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg border border-zinc-800/70 py-2">
                      <div className="text-xs text-zinc-400">up events</div>
                      <div className="font-semibold">{bestDrivers[0].up_events}</div>
                    </div>
                    <div className="rounded-lg border border-zinc-800/70 py-2">
                      <div className="text-xs text-zinc-400">down events</div>
                      <div className="font-semibold">{bestDrivers[0].down_events}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Documents */}
          <section className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
            <header className="px-4 py-3 border-b border-zinc-700/60">
              <h2 className="text-zinc-100 font-semibold">Load Documents</h2>
            </header>

            <div className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleUploadClick}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
                  disabled={!id || docsBusy}
                  title="Upload a file to this load"
                >
                  <Upload className={cx("w-4 h-4", docsBusy && "opacity-50")} />
                  Upload
                </button>

                <button
                  onClick={listDocs}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
                  disabled={docsBusy}
                  title="Refresh document list"
                >
                  <RefreshCw className={cx("w-4 h-4", docsBusy && "animate-spin")} />
                  Refresh
                </button>
              </div>

              <div className="rounded-xl border border-zinc-800/70 p-3">
                {docs.length === 0 ? (
                  <div className="text-sm text-zinc-400">No documents yet.</div>
                ) : (
                  <div className="space-y-2">
                    {docs.map((f) => (
                      <label
                        key={f.path}
                        className={cx(
                          "flex items-center justify-between gap-3 rounded-lg border p-2 cursor-pointer",
                          "border-zinc-800/70 hover:bg-zinc-800/40",
                          selectedDoc?.path === f.path && "border-pink-500/40 bg-zinc-800/50"
                        )}
                      >
                        <div className="text-sm text-zinc-200 truncate">{f.name}</div>
                        <input
                          type="radio"
                          name="docSel"
                          className="accent-pink-400"
                          checked={selectedDoc?.path === f.path}
                          onChange={() => setSelectedDoc(f)}
                        />
                      </label>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExtract}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
                    disabled={!selectedDoc || docsBusy}
                  >
                    Extract Text
                  </button>

                  <button
                    onClick={handleOpen}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
                    disabled={!selectedDoc || docsBusy}
                  >
                    Open
                  </button>

                  <button
                    onClick={handleDelete}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-200 hover:bg-rose-500/10"
                    disabled={!selectedDoc || docsBusy}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- sub-components ------------------------ */
function Info({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-zinc-800/70 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="text-zinc-100 font-medium">{value ?? "—"}</div>
      {sub && <div className="text-xs text-zinc-400 mt-0.5">{sub}</div>}
    </div>
  );
}
