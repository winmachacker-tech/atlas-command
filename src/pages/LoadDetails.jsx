// FILE: src/pages/LoadDetails.jsx
// Purpose:
// - Load details UI
// - Lane-based AI recommendations using rpc_ai_best_drivers_for_lane (via useBestDrivers)
// - Fallback to global driver_fit_scores if lane-based list is empty
// - Per-driver thumbs to train the AI live, plus Assign button
// - "Train AI" button that runs backfill + retrain RPCs
// - "Load Documents" buttons (Upload/Refresh/Open/Delete)
// - "Best-Fit → View" opens the top driver's detail page

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ArrowLeft, RefreshCw, Trash2, Upload, Eye, PlayCircle } from "lucide-react";
import useBestDrivers from "../hooks/useBestDrivers";
import AIThumbs from "../components/AIThumbs.jsx";
import AiRecommendationsForLoad from "../components/AiRecommendationsForLoad.jsx";


/* ------------------------- config ------------------------- */
const DOC_BUCKET = "load_docs";

/* ------------------------- helpers ------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function toUSD(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d ?? "—");
  }
}
function firstKey(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (k in obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}
function smallId(s) {
  if (!s) return "—";
  const t = String(s);
  return t.length > 8 ? `${t.slice(0, 6)}…${t.slice(-2)}` : t;
}

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
  const show = useCallback((m, _tone = "ok") => {
    setMsg(m);
    setTone(_tone);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 3000);
  }, []);
  const View = useMemo(() => {
    if (!msg) return null;
    return (
      <div
        className={cx(
          "fixed z-50 bottom-16 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-xl text-sm shadow-lg border",
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

  // documents state
  const [docs, setDocs] = useState([]);
  const [docsBusy, setDocsBusy] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const fileInputRef = useRef(null);

  // Fallback AI list (when lane-based results are empty)
  const [fallbackDrivers, setFallbackDrivers] = useState([]);
  const [fallbackBusy, setFallbackBusy] = useState(false);

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

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Detect assignable columns; we'll update BOTH if they exist.
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

  const puCity = firstKey(load, ["origin_city", "pickup_city", "pu_city", "origin"]);
  const puState = firstKey(load, ["origin_state", "pickup_state", "pu_state"]);
  const delCity = firstKey(load, ["destination_city", "delivery_city", "del_city", "destination"]);
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
    // NOTE: keep this format in sync with your lane trainer page
    return `LANE ${oc}, ${os} → ${dc}, ${ds}`;
  }, [puCity, puState, delCity, delState]);

  // Pull AI recommendations for this lane
  const {
    data: bestDrivers,
    loading: aiLoading,
    error: aiError,
    refetch: refetchAI,
  } = useBestDrivers(laneKey, { limit: 10 });

  // Fallback recommendations: top global by fit_score (when lane has no rows)
  const fetchFallbackDrivers = useCallback(async () => {
    setFallbackBusy(true);
    setFallbackDrivers([]);
    try {
      const { data, error } = await supabase
        .from("driver_fit_scores")
        .select("driver_id, fit_score, up_events, down_events, last_feedback_at")
        .order("fit_score", { ascending: false })
        .limit(10);

      if (error) throw error;

      const mapped = (data || []).map((r) => ({
        driver_id: r.driver_id,
        score: r.fit_score ?? 0,
        up_events: r.up_events ?? 0,
        down_events: r.down_events ?? 0,
        last_positive_at: r.last_feedback_at ?? null,
        __fallback: true,
      }));

      setFallbackDrivers(mapped);
    } catch (err) {
      console.error(err);
      setFallbackDrivers([]);
    } finally {
      setFallbackBusy(false);
    }
  }, []);

  // When lane-based list changes, decide if we should load fallback
  useEffect(() => {
    if (!laneKey) {
      setFallbackDrivers([]);
      return;
    }
    if (Array.isArray(bestDrivers) && bestDrivers.length > 0) {
      setFallbackDrivers([]); // we have lane-based results; clear fallback
      return;
    }
    // only fetch fallback if lane is valid and lane list is empty
    fetchFallbackDrivers();
  }, [laneKey, bestDrivers, fetchFallbackDrivers]);

  // Fetch driver names/phones for display
  const allShownDriverIds = useMemo(() => {
    const laneIds = (bestDrivers || []).map((r) => r.driver_id).filter(Boolean);
    const fbIds = (fallbackDrivers || []).map((r) => r.driver_id).filter(Boolean);
    return Array.from(new Set([...laneIds, ...fbIds]));
  }, [bestDrivers, fallbackDrivers]);

  useEffect(() => {
    const missing = allShownDriverIds.filter((did) => !driverMeta[did]);
    if (!missing.length) return;

    (async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, full_name, phone")
        .in("id", missing);

      if (!error && Array.isArray(data)) {
        setDriverMeta((prev) => {
          const next = { ...prev };
          for (const r of data) next[r.id] = { full_name: r.full_name || "", phone: r.phone || "" };
          return next;
        });
      }
    })();
  }, [allShownDriverIds, driverMeta]);

  // Helper: try a list of RPC names until one succeeds (for backfill only)
  const callAnyRpc = useCallback(async (candidates, args = {}) => {
    let lastErr;
    for (const fn of candidates) {
      try {
        const { error } = await supabase.rpc(fn, args);
        if (!error) return { ok: true, name: fn };
        lastErr = error;
      } catch (e) {
        lastErr = e;
      }
    }
    return { ok: false, error: lastErr };
  }, []);

  // Train AI: backfill then retrain (with your real retrain func)
  const [training, setTraining] = useState(false);
  const trainAI = useCallback(async () => {
    setTraining(true);
    try {
      // 1) Backfill (optional)
      const backfill = await callAnyRpc(
        ["rpc_ai_backfill_examples_from_raw", "ai_backfill_examples_from_raw", "rpc_ai_backfill", "ai_backfill"],
        { lane_key: laneKey ?? null }
      );
      if (!backfill.ok && backfill.error) {
        console.warn("Backfill RPC not available:", backfill.error?.message || backfill.error);
      }

      // 2) Retrain using your actual function rpc_ai_retrain_model('v1')
      const { error: retrainErr } = await supabase.rpc("rpc_ai_retrain_model", {
        p_model_version: "v1",
      });
      if (retrainErr) throw retrainErr;

      show("AI retrained successfully.");
      await refetchAI();
      await fetchFallbackDrivers();
    } catch (err) {
      console.error(err);
      show(`Train failed: ${err.message}`, "err");
    } finally {
      setTraining(false);
    }
  }, [laneKey, callAnyRpc, show, refetchAI, fetchFallbackDrivers]);

  // Assign handler (no more status changes, to avoid loads_status_check)
  const assignDriver = useCallback(
    async (driverId) => {
      if (!driverId || !id) return;
      setAssigningId(driverId);
      try {
        let updated = false;

        // If the loads table has direct columns, update them (both if present)
        if (assignCols.length > 0) {
          const payload = assignCols.reduce((acc, c) => {
            acc[c] = driverId;
            return acc;
          }, {});
          // DO NOT touch status here; your check constraint controls that.
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
            throw new Error(
              "Add loads.driver_id OR loads.assigned_driver_id OR create load_driver_assignments(load_id, driver_id)."
            );
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
    },
    [id, assignCols, refresh, refetchAI, show]
  );

  /* ---------------------- Documents logic ---------------------- */
  const listDocs = useCallback(
    async () => {
      if (!id) return;
      setDocsBusy(true);
      try {
        const prefix = `${id}/`;
        const { data, error } = await supabase.storage.from(DOC_BUCKET).list(prefix, {
          limit: 100,
          offset: 0,
        });
        if (error) throw error;
        const items = (data || []).map((f) => ({ name: f.name, path: prefix + f.name }));
        setDocs(items);
        if (!items.length) setSelectedDoc(null);
        show("Documents refreshed.", "info");
      } catch (err) {
        console.error(err);
        show(`Docs error: ${err.message}`, "err");
      } finally {
        setDocsBusy(false);
      }
    },
    [id, show]
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onChooseFile = useCallback(async (e) => {
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
  }, [id, show, listDocs]);

  const handleOpen = useCallback(async () => {
    console.log("handleOpen called, selectedDoc:", selectedDoc);
    if (!selectedDoc) {
      show("Select a document first.", "info");
      return;
    }
    try {
      const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(selectedDoc.path, 60);
      if (error) throw error;
      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error(err);
      show(`Open failed: ${err.message}`, "err");
    }
  }, [selectedDoc, show]);

  const handleDelete = useCallback(async () => {
    console.log("handleDelete called, selectedDoc:", selectedDoc);
    if (!selectedDoc) {
      show("Select a document first.", "info");
      return;
    }
    setDocsBusy(true);
    try {
      const { error } = await supabase.storage.from(DOC_BUCKET).remove([selectedDoc.path]);
      if (error) throw error;
      show("Deleted.");
      setSelectedDoc(null);
      await listDocs();
    } catch (err) {
      console.error(err);
      show(`Delete failed: ${err.message}`, "err");
    } finally {
      setDocsBusy(false);
    }
  }, [selectedDoc, show, listDocs]);

  // Extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState(null);
  const [showExtractionModal, setShowExtractionModal] = useState(false);

  const handleExtract = useCallback(async () => {
    console.log("handleExtract called, selectedDoc:", selectedDoc);
    if (!selectedDoc) {
      show("Select a document first.", "info");
      return;
    }
    
    setExtracting(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || supabase.supabaseKey;
      
      const response = await fetch(`${supabaseUrl}/functions/v1/extract-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          filePath: selectedDoc.path,
          loadId: id,
          extractionType: "auto",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Extraction failed");
      }

      const result = await response.json();
      
      if (result.success) {
        setExtractionResult(result.data);
        setShowExtractionModal(true);
        show(`Extracted ${result.data.documentType} with ${result.data.confidence}% confidence.`);
        
        // Refresh load data to show auto-populated fields
        await refresh();
      } else {
        throw new Error(result.error || "Extraction failed");
      }
    } catch (err) {
      console.error("Extraction error:", err);
      show(`Extraction failed: ${err.message}`, "err");
    } finally {
      setExtracting(false);
    }
  }, [selectedDoc, show, id, refresh]);

  // Auto-load doc list when page mounts/changes id
  useEffect(() => {
    listDocs();
  }, [listDocs]);

  /* --------------------------- render --------------------------- */
  const combinedList = bestDrivers && bestDrivers.length > 0 ? bestDrivers : fallbackDrivers;
  const usingFallback = combinedList === fallbackDrivers && fallbackDrivers.length > 0;

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

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={trainAI}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-pink-500/40 text-pink-200 hover:bg-pink-500/10"
            title="Train AI"
            disabled={training}
          >
            <PlayCircle className={cx("w-4 h-4", training && "animate-pulse")} />
            {training ? "Training…" : "Train AI"}
          </button>

          <button
            onClick={() => {
              refresh();
              refetchAI();
              listDocs();
              fetchFallbackDrivers();
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
            title="Refresh"
          >
            <RefreshCw
              className={cx(
                "w-4 h-4",
                (loading || aiLoading || docsBusy || fallbackBusy) && "animate-spin"
              )}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Header strip */}
      <div className="mb-5 rounded-2xl border border-pink-500/30 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-zinc-400 mr-1">Load:</span>
            <span className="font-medium text-zinc-100">{smallId(id)}</span>
          </div>
          <div>
            <span className="text-zinc-400 mr-1">Ref:</span>
            <span className="font-semibold tracking-wide">{reference ?? "—"}</span>
          </div>
          <div className="hidden md:block text-zinc-500">•</div>
          <div>
            <span className="text-zinc-400 mr-1">PU:</span>
            <span className="text-zinc-100">{fmtDateTime(puAt)}</span>
          </div>
          <div className="hidden md:block text-zinc-500">•</div>
          <div>
            <span className="text-zinc-400 mr-1">DEL:</span>
            <span className="text-zinc-100">{fmtDateTime(delAt)}</span>
          </div>
          <div className="hidden md:block text-zinc-500">•</div>
          <div>
            <span className="text-zinc-400 mr-1">Equip:</span>
            <span className="text-zinc-100">{equipment ?? "—"}</span>
          </div>
          {laneKey && (
            <>
              <div className="hidden md:block text-zinc-500">•</div>
              <div>
                <span className="text-zinc-400 mr-1">Lane:</span>
                <span className="text-zinc-100">{laneKey}</span>
              </div>
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
                <Info
                  label="PICKUP"
                  value={`${puCity ?? "—"}, ${puState ?? "—"}`}
                  sub={fmtDateTime(puAt)}
                />
                <Info
                  label="DELIVERY"
                  value={`${delCity ?? "—"}, ${delState ?? "—"}`}
                  sub={fmtDateTime(delAt)}
                />
                <Info label="EQUIPMENT" value={equipment ?? "—"} />
                <Info label="MILES" value={miles ?? "—"} />
                <Info label="RATE" value={toUSD(totalRate)} />
                <Info label="REFERENCE" value={reference ?? "—"} />
              </div>
            </div>
          </section>

          {/* AI Recommendations */}
          <section className="rounded-2xl border border-pink-500/30 bg-zinc-900/40">
            <header className="px-4 py-3 border-b border-pink-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink-400/80" />
                <h2 className="text-zinc-100 font-semibold">
                  {usingFallback ? "AI Recommendations (Global Fallback)" : "AI Recommendations"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    refetchAI();
                    fetchFallbackDrivers();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-pink-500/30 text-zinc-100 hover:bg-zinc-900"
                >
                  <RefreshCw
                    className={cx("w-4 h-4", (aiLoading || fallbackBusy) && "animate-spin")}
                  />
                  Refresh
                </button>
              </div>
            </header>

            {!laneKey && (
              <div className="p-4 text-sm text-zinc-400">
                No lane detected for this load. Add origin/destination city &amp; state to see
                recommendations.
              </div>
            )}

            {laneKey && (
              <div className="divide-y divide-zinc-800/80">
                {(!combinedList || combinedList.length === 0) && (
                  <div className="p-4 text-sm text-zinc-400">
                    No training signals yet. Use 👍/👎 to start teaching, or click{" "}
                    <span className="text-pink-200">Train AI</span>.
                  </div>
                )}

                {(combinedList || []).map((row, idx) => {
                  const meta = driverMeta[row.driver_id] || {};
                  const displayName = meta.full_name || smallId(row.driver_id);
                  return (
                    <div key={row.driver_id} className="p-3 flex items-center gap-3">
                      <div className="w-6 text-zinc-500 text-sm tabular-nums">{idx + 1}</div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full border border-pink-400/60" />
                          <div className="text-zinc-100 font-medium truncate">{displayName}</div>
                          {row.__fallback && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-zinc-700/60 text-zinc-400">
                              global
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                          <span>
                            Score:{" "}
                            <span className="text-zinc-100 font-medium">{row.score}</span>
                          </span>
                          <span>👍 {row.up_events ?? 0}</span>
                          <span>👎 {row.down_events ?? 0}</span>
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
                        // After each thumb: retrain + refresh so score / last+ update
                        onAfterChange={trainAI}
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
          {/* Best-Fit snapshot */}
          <section className="rounded-2xl border border-pink-500/30 bg-zinc-900/40">
            <header className="px-4 py-3 border-b border-pink-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink-400/80" />
                <h2 className="text-zinc-100 font-semibold">Best-Fit Drivers</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    refetchAI();
                    fetchFallbackDrivers();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
                >
                  <RefreshCw
                    className={cx("w-4 h-4", (aiLoading || fallbackBusy) && "animate-spin")}
                  />
                  Refresh
                </button>
                <button
                  onClick={() => {
                    const top =
                      combinedList && combinedList[0] ? combinedList[0].driver_id : null;
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

            {laneKey && combinedList && combinedList[0] && (
              <div className="p-4">
                <div className="rounded-xl border border-zinc-800/80 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full border border-pink-400/60" />
                      <div className="font-medium text-zinc-100">
                        {driverMeta[combinedList[0].driver_id]?.full_name ||
                          smallId(combinedList[0].driver_id)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-zinc-400">top score</div>
                      <div className="text-lg font-semibold">
                        {combinedList[0].score ?? 0}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg border border-zinc-800/70 py-2">
                      <div className="text-xs text-zinc-400">up events</div>
                      <div className="font-semibold">
                        {combinedList[0].up_events ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border border-zinc-800/70 py-2">
                      <div className="text-xs text-zinc-400">down events</div>
                      <div className="font-semibold">
                        {combinedList[0].down_events ?? 0}
                      </div>
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
                  <RefreshCw
                    className={cx("w-4 h-4", docsBusy && "animate-spin")}
                  />
                  Refresh
                </button>
              </div>

              <div className="rounded-xl border border-zinc-800/70 p-3">
                {docs.length === 0 ? (
                  <div className="text-sm text-zinc-400">No documents yet.</div>
                ) : (
                  <div className="space-y-2">
                    {docs.map((f) => {
                      const isSelected = selectedDoc?.path === f.path;
                      return (
                        <div
                          key={f.path}
                          onClick={() => setSelectedDoc(f)}
                          className={cx(
                            "flex items-center justify-between gap-3 rounded-lg border p-2 cursor-pointer transition-colors",
                            "border-zinc-800/70 hover:bg-zinc-800/40",
                            isSelected && "border-pink-500/40 bg-zinc-800/50"
                          )}
                        >
                          <div className="text-sm text-zinc-200 truncate">{f.name}</div>
                          <div
                            className={cx(
                              "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                              isSelected
                                ? "border-pink-400 bg-pink-400"
                                : "border-zinc-600"
                            )}
                          >
                            {isSelected && (
                              <div className="w-2 h-2 rounded-full bg-zinc-900" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExtract}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!selectedDoc || docsBusy || extracting}
                  >
                    {extracting ? "Extracting..." : "Extract Text"}
                  </button>

                  <button
                    onClick={handleOpen}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!selectedDoc || docsBusy}
                  >
                    Open
                  </button>

                  <button
                    onClick={handleDelete}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-200 hover:bg-rose-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Extraction Results Modal */}
      {showExtractionModal && extractionResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-700/60 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-zinc-700/60 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-zinc-100">AI Document Extraction</h2>
                <div className="mt-1 flex items-center gap-3 text-sm">
                  <span className="text-zinc-400">
                    Type: <span className="text-zinc-200 font-medium">{extractionResult.documentType}</span>
                  </span>
                  <span className="text-zinc-500">•</span>
                  <span className="text-zinc-400">
                    Confidence: <span className={cx("font-medium", extractionResult.confidence >= 80 ? "text-emerald-400" : extractionResult.confidence >= 60 ? "text-amber-400" : "text-rose-400")}>{extractionResult.confidence}%</span>
                  </span>
                  <span className="text-zinc-500">•</span>
                  <span className="text-zinc-400">
                    Quality: <span className="text-zinc-200 font-medium">{extractionResult.aiInsights.qualityScore}%</span>
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowExtractionModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* AI Insights */}
              {extractionResult.aiInsights && (
                <div className="rounded-xl border border-pink-500/30 bg-pink-500/5 p-4">
                  <h3 className="text-sm font-semibold text-pink-200 mb-3">AI Insights</h3>
                  
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <div className="text-xs text-zinc-400">Completeness</div>
                      <div className="text-lg font-semibold text-zinc-100">{extractionResult.aiInsights.completeness}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-400">Processing Time</div>
                      <div className="text-lg font-semibold text-zinc-100">{extractionResult.processingTime}ms</div>
                    </div>
                  </div>

                  {extractionResult.aiInsights.riskFlags && extractionResult.aiInsights.riskFlags.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-semibold text-rose-300 mb-1">⚠️ Risk Flags</div>
                      <div className="space-y-1">
                        {extractionResult.aiInsights.riskFlags.map((flag, i) => (
                          <div key={i} className="text-xs text-rose-200 bg-rose-500/10 px-2 py-1 rounded">{flag}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {extractionResult.aiInsights.recommendations && extractionResult.aiInsights.recommendations.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-sky-300 mb-1">💡 Recommendations</div>
                      <div className="space-y-1">
                        {extractionResult.aiInsights.recommendations.map((rec, i) => (
                          <div key={i} className="text-xs text-sky-200 bg-sky-500/10 px-2 py-1 rounded">{rec}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Load Details */}
              {extractionResult.loadDetails && Object.values(extractionResult.loadDetails).some(v => v) && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 mb-3">Load Details</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(extractionResult.loadDetails).map(([key, value]) => value && (
                      <div key={key} className="rounded-lg border border-zinc-800/70 p-2">
                        <div className="text-xs text-zinc-400">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                        <div className="text-sm text-zinc-100 font-medium">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Origin & Destination */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {extractionResult.pickup && Object.values(extractionResult.pickup).some(v => v) && (
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-300 mb-3">📍 Pickup</h3>
                    <div className="space-y-2">
                      {Object.entries(extractionResult.pickup).map(([key, value]) => value && (
                        <div key={key} className="rounded-lg border border-zinc-800/70 p-2">
                          <div className="text-xs text-zinc-400">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                          <div className="text-sm text-zinc-100">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {extractionResult.delivery && Object.values(extractionResult.delivery).some(v => v) && (
                  <div>
                    <h3 className="text-sm font-semibold text-sky-300 mb-3">📍 Delivery</h3>
                    <div className="space-y-2">
                      {Object.entries(extractionResult.delivery).map(([key, value]) => value && (
                        <div key={key} className="rounded-lg border border-zinc-800/70 p-2">
                          <div className="text-xs text-zinc-400">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                          <div className="text-sm text-zinc-100">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Shipment Details */}
              {extractionResult.shipment && Object.values(extractionResult.shipment).some(v => v) && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 mb-3">📦 Shipment Details</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {Object.entries(extractionResult.shipment).map(([key, value]) => value !== null && value !== undefined && (
                      <div key={key} className="rounded-lg border border-zinc-800/70 p-2">
                        <div className="text-xs text-zinc-400">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                        <div className="text-sm text-zinc-100 font-medium">{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Financial Information */}
              {extractionResult.charges && Object.values(extractionResult.charges).some(v => v) && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 mb-3">💰 Charges</h3>
                  <div className="rounded-xl border border-zinc-800/70 p-3 space-y-2">
                    {extractionResult.charges.linehaul && (
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Linehaul</span>
                        <span className="text-zinc-100 font-medium">{toUSD(extractionResult.charges.linehaul)}</span>
                      </div>
                    )}
                    {extractionResult.charges.fuelSurcharge && (
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Fuel Surcharge</span>
                        <span className="text-zinc-100 font-medium">{toUSD(extractionResult.charges.fuelSurcharge)}</span>
                      </div>
                    )}
                    {extractionResult.charges.accessorials && extractionResult.charges.accessorials.length > 0 && (
                      <div className="border-t border-zinc-800/50 pt-2 mt-2">
                        <div className="text-xs text-zinc-400 mb-1">Accessorials</div>
                        {extractionResult.charges.accessorials.map((acc, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-zinc-300">{acc.description}</span>
                            <span className="text-zinc-100">{toUSD(acc.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {extractionResult.charges.totalCharges && (
                      <div className="flex justify-between border-t border-zinc-700/50 pt-2 mt-2">
                        <span className="text-zinc-100 font-semibold">Total</span>
                        <span className="text-emerald-400 font-bold text-lg">{toUSD(extractionResult.charges.totalCharges)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Parties, Driver, Equipment */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {extractionResult.parties && Object.values(extractionResult.parties).some(v => v) && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100 mb-3">👥 Parties</h3>
                    <div className="space-y-2 text-sm">
                      {Object.entries(extractionResult.parties).map(([key, value]) => value && value.name && (
                        <div key={key} className="rounded-lg border border-zinc-800/70 p-2">
                          <div className="text-xs text-zinc-400">{key}</div>
                          <div className="text-zinc-100 font-medium">{value.name}</div>
                          {value.mcNumber && <div className="text-xs text-zinc-400">MC: {value.mcNumber}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {extractionResult.driver && Object.values(extractionResult.driver).some(v => v) && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100 mb-3">🚚 Driver</h3>
                    <div className="space-y-2 text-sm">
                      {Object.entries(extractionResult.driver).map(([key, value]) => value && (
                        <div key={key} className="rounded-lg border border-zinc-800/70 p-2">
                          <div className="text-xs text-zinc-400">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                          <div className="text-zinc-100">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {extractionResult.equipment && Object.values(extractionResult.equipment).some(v => v) && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100 mb-3">🚛 Equipment</h3>
                    <div className="space-y-2 text-sm">
                      {Object.entries(extractionResult.equipment).map(([key, value]) => value && (
                        <div key={key} className="rounded-lg border border-zinc-800/70 p-2">
                          <div className="text-xs text-zinc-400">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                          <div className="text-zinc-100">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-zinc-700/60 flex justify-end gap-3">
              <button
                onClick={() => setShowExtractionModal(false)}
                className="px-4 py-2 rounded-lg border border-zinc-700/60 text-zinc-200 hover:bg-zinc-800/60"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  // Copy extracted data to clipboard
                  await navigator.clipboard.writeText(JSON.stringify(extractionResult, null, 2));
                  show("Copied to clipboard!");
                }}
                className="px-4 py-2 rounded-lg border border-pink-500/40 text-pink-200 hover:bg-pink-500/10"
              >
                Copy JSON
              </button>
            </div>
          </div>
        </div>
      )}
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