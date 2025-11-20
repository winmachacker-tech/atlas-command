// FILE: src/pages/LoadDetails.jsx
// Purpose:
// - Load details UI with comprehensive enhancements
// - Edit Load functionality
// - Status Timeline/Progress Bar
// - Quick Actions Menu
// - Assigned Driver Info display
// - Activity/History Log
// - Inline editing for key fields
// - Print/Export options
// - Related Loads section
// - Profitability metrics with REAL DIESEL PRICES from EIA API
// - Stop status tracking
// - Keyboard shortcuts
// - Dark Google Map with multi-stop route + GREEN polyline (collapsible)
// - AI Recommendations section (collapsible)
// - TEMP: Best-Fit Drivers card is static (no hook) to avoid crashes while AI stack is under diagnostics
// - "Train AI" button placeholder (calls RPC – you can wire to your real one)
// - "Load Documents" buttons (Upload/Refresh/Open/Delete)
// - "Send Instructions" button with email/SMS capabilities
// - AUTO-CALCULATE MILES using Google Distance Matrix API (WITH FALLBACK TO LOADS.ORIGIN/DESTINATION)
// - RATE PER MILE display in profitability metrics

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { calculateFuelCost } from "../services/fuelPriceService";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Upload,
  Eye,
  PlayCircle,
  Send,
  Loader2,
  FileText,
  Map as MapIcon,
  ChevronDown,
  Copy,
  Edit,
  MoreVertical,
  CheckCircle2,
  Clock,
  TrendingUp,
  DollarSign,
  Printer,
  Download,
  Save,
  X,
  User,
  Truck,
  Phone,
  Mail,
  History,
  Package,
  MapPin,
  Calculator,
} from "lucide-react";
import AiRecommendationsForLoad from "../components/AiRecommendationsForLoad.jsx";
import {
  GoogleMap,
  Marker,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";

/* ------------------------- config ------------------------- */

const DOC_BUCKET = "load_docs";
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const LOAD_STATUSES = [
  "AVAILABLE",
  "DISPATCHED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
];

const STOP_STATUSES = [
  "PENDING",
  "EN_ROUTE",
  "ARRIVED",
  "COMPLETED",
];

/* ------------------------- helpers ------------------------- */

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function formatDateTime(dt) {
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    return d.toLocaleString();
  } catch {
    return dt;
  }
}

function buildStopAddress(stop) {
  if (!stop) return "";
  const parts = [];
  if (stop.address_line1) parts.push(stop.address_line1);
  if (stop.city) parts.push(stop.city);
  if (stop.state) parts.push(stop.state);
  if (stop.postal_code) parts.push(stop.postal_code);
  if (stop.country) parts.push(stop.country);
  return parts.join(", ");
}

function parseCityState(text) {
  if (!text) return { city: "", state: "" };
  const [cityPart, rest] = text.split(",");
  const city = (cityPart || "").trim();
  const state = (rest || "").trim().split(/\s+/)[0] || "";
  return { city, state };
}

/* ------------------------- Status Timeline Component ------------------------- */

function StatusTimeline({ status }) {
  const statuses = ["AVAILABLE", "DISPATCHED", "IN_TRANSIT", "DELIVERED"];
  const currentIndex = statuses.indexOf(status || "AVAILABLE");

  return (
    <div className="flex items-center gap-2">
      {statuses.map((s, idx) => {
        const isActive = idx <= currentIndex;
        const isCurrent = idx === currentIndex;
        return (
          <div key={s} className="flex items-center">
            <div
              className={cx(
                "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                isCurrent
                  ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/60"
                  : isActive
                  ? "bg-slate-700/60 text-slate-300 border border-slate-600"
                  : "bg-slate-900/60 text-slate-500 border border-slate-700"
              )}
            >
              {isActive && (
                <CheckCircle2
                  className={cx(
                    "h-3 w-3",
                    isCurrent ? "text-emerald-300" : "text-slate-400"
                  )}
                />
              )}
              {!isActive && <Clock className="h-3 w-3" />}
              <span>{s.replace("_", " ")}</span>
            </div>
            {idx < statuses.length - 1 && (
              <div
                className={cx(
                  "w-8 h-0.5 mx-1",
                  isActive ? "bg-emerald-500/60" : "bg-slate-700"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------- Map component ------------------------- */

function RouteMap({ stops }) {
  const [coords, setCoords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeStops = useMemo(
    () => (stops || []).filter((s) => s && (s.city || s.address_line1 || s.location_name)),
    [stops]
  );

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY || "",
  });

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !activeStops.length) {
      setCoords([]);
      return;
    }

    let cancelled = false;

    async function geocodeStops() {
      try {
        setLoading(true);
        setError("");
        const results = [];

        for (const stop of activeStops) {
          let addr = buildStopAddress(stop);
          
          // If buildStopAddress returns empty, use location_name as fallback
          if (!addr && stop.location_name) {
            addr = stop.location_name;
          }
          
          if (!addr) continue;

          const url =
            "https://maps.googleapis.com/maps/api/geocode/json?address=" +
            encodeURIComponent(addr) +
            `&key=${GOOGLE_MAPS_API_KEY}`;

          const res = await fetch(url);
          const data = await res.json();

          if (data.status === "OK" && data.results?.[0]) {
            const { lat, lng } = data.results[0].geometry.location;
            results.push({ lat, lng });
          }
        }

        if (!cancelled) {
          setCoords(results);
        }
      } catch (err) {
        console.error("[RouteMap] geocode error", err);
        if (!cancelled) setError("Could not load map for this route.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    geocodeStops();

    return () => {
      cancelled = true;
    };
  }, [activeStops]);

  const center = useMemo(() => {
    if (!coords.length) {
      return { lat: 39.5, lng: -98.35 };
    }
    const lat =
      coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
    const lng =
      coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
    return { lat, lng };
  }, [coords]);

  const containerStyle = {
    width: "100%",
    height: "320px",
    borderRadius: "1rem",
    overflow: "hidden",
  };

  const darkMapStyles = [
    { elementType: "geometry", stylers: [{ color: "#020617" }] },
    {
      elementType: "labels.text.fill",
      stylers: [{ color: "#e5e7eb" }],
    },
    {
      elementType: "labels.text.stroke",
      stylers: [{ color: "#020617" }],
    },
    {
      featureType: "road",
      elementType: "geometry",
      stylers: [{ color: "#0f172a" }],
    },
    {
      featureType: "road",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d1d5db" }],
    },
    {
      featureType: "water",
      elementType: "geometry",
      stylers: [{ color: "#0b1120" }],
    },
    {
      featureType: "poi",
      elementType: "geometry",
      stylers: [{ color: "#020617" }],
    },
  ];

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="text-sm text-amber-300/80">
        Google Maps API key is not configured. Set
        <span className="font-mono px-2">
          VITE_GOOGLE_MAPS_API_KEY
        </span>
        in your <code>.env</code>.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-sm text-rose-300/80">
        Error loading Google Maps script.
      </div>
    );
  }

  if (!activeStops.length) {
    return (
      <div className="text-sm text-slate-300/80">
        No stops found for this load yet. Add at least one pickup
        and one delivery to see the route.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-300/80">
          <Loader2 className="h-4 w-4 animate-spin" />
          Geocoding stops and loading the map…
        </div>
      )}
      {error && (
        <div className="text-xs text-rose-300/80">{error}</div>
      )}

      {isLoaded && !!coords.length && (
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={center}
          zoom={coords.length === 1 ? 10 : 7}
          options={{
            styles: darkMapStyles,
            disableDefaultUI: true,
            zoomControl: true,
            fullscreenControl: false,
            gestureHandling: "greedy",
          }}
        >
          {coords.length > 1 && (
            <Polyline
              path={coords}
              options={{
                strokeColor: "#22c55e",
                strokeOpacity: 0.95,
                strokeWeight: 4,
              }}
            />
          )}

          {coords.map((c, idx) => (
            <Marker
              key={`${c.lat}-${c.lng}-${idx}`}
              position={c}
              label={`${idx + 1}`}
            />
          ))}
        </GoogleMap>
      )}
    </div>
  );
}

/* ------------------------- Main page ------------------------- */

export default function LoadDetails() {
  const { id: loadId } = useParams();
  const navigate = useNavigate();

  const [load, setLoad] = useState(null);
  const [stops, setStops] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // driver info
  const [assignedDriver, setAssignedDriver] = useState(null);
  const [loadingDriver, setLoadingDriver] = useState(false);

  // activity log
  const [activityLog, setActivityLog] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // related loads
  const [relatedLoads, setRelatedLoads] = useState([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  // edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // inline editing
  const [inlineEditing, setInlineEditing] = useState(null); // field name
  const [inlineValue, setInlineValue] = useState("");

  // quick actions menu
  const [showQuickActions, setShowQuickActions] = useState(false);

  // instructions modal + email/SMS state
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructionsText, setInstructionsText] = useState("");
  const [driverView, setDriverView] = useState("company");
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [smsTo, setSmsTo] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [instructionStatus, setInstructionStatus] = useState("");

  // stop status editing
  const [editingStopStatus, setEditingStopStatus] = useState(null);

  // miles calculation
  const [calculatingMiles, setCalculatingMiles] = useState(false);

  // fuel calculation with real diesel prices
  const [fuelCalculation, setFuelCalculation] = useState({
    fuelCost: 0,
    gallons: 0,
    pricePerGallon: 3.87, // Default fallback
  });

  const fileInputRef = useRef(null);
  const quickActionsRef = useRef(null);

  // collapse state
  const [showRouteMap, setShowRouteMap] = useState(true);
  const [showAiSection, setShowAiSection] = useState(true);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showRelatedLoads, setShowRelatedLoads] = useState(false);

  const loadKey = load?.id?.slice(0, 6) ?? "—";

  /* -------- keyboard shortcuts -------- */
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Only trigger if not in an input/textarea
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA"
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "e":
          setShowEditModal(true);
          break;
        case "i":
          handleOpenInstructionsModal();
          break;
        case "r":
          fetchData();
          break;
        case "p":
          handlePrintRateConfirmation();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /* -------- click outside for quick actions -------- */
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        quickActionsRef.current &&
        !quickActionsRef.current.contains(e.target)
      ) {
        setShowQuickActions(false);
      }
    };

    if (showQuickActions) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [showQuickActions]);

  /* -------- Calculate fuel cost when load miles change -------- */
  useEffect(() => {
    const fetchFuelCost = async () => {
      if (load?.miles) {
        const calculation = await calculateFuelCost(load.miles);
        setFuelCalculation(calculation);
        console.log('[LoadDetails] Fuel calculation updated:', calculation);
      }
    };

    fetchFuelCost();
  }, [load?.miles]);

  /* -------- fetch load + stops + driver + activity + related -------- */

  const fetchData = useCallback(async () => {
    if (!loadId) return;
    try {
      setLoading(true);
      setError("");

      const { data: loadRow, error: loadErr } = await supabase
        .from("loads")
        .select("*")
        .eq("id", loadId)
        .single();

      if (loadErr) throw loadErr;

      const { data: stopRows, error: stopErr } = await supabase
        .from("load_stops")
        .select("*")
        .eq("load_id", loadId)
        .order("sequence", { ascending: true });

      if (stopErr) throw stopErr;

      setLoad(loadRow);
      setStops(stopRows || []);

      // Fetch assigned driver if driver_id exists
      if (loadRow.driver_id) {
        fetchAssignedDriver(loadRow.driver_id);
      }

      // Fetch activity log
      fetchActivityLog(loadRow.id);

      // Fetch related loads (same customer)
      if (loadRow.customer_id) {
        fetchRelatedLoads(loadRow.customer_id, loadRow.id);
      }

      await refreshDocuments(loadRow);
    } catch (err) {
      console.error("[LoadDetails] fetch error", err);
      setError("Could not load this load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [loadId]);

  const fetchAssignedDriver = async (driverId) => {
    try {
      setLoadingDriver(true);
      const { data, error: driverErr } = await supabase
        .from("drivers")
        .select("*")
        .eq("id", driverId)
        .single();

      if (driverErr) throw driverErr;
      setAssignedDriver(data);
    } catch (err) {
      console.error("[LoadDetails] fetch driver error", err);
    } finally {
      setLoadingDriver(false);
    }
  };

  const fetchActivityLog = async (loadIdParam) => {
    try {
      setLoadingActivity(true);
      // Try to fetch from load_activity table if it exists
      // Otherwise create a synthetic log from load metadata
      const { data, error: activityErr } = await supabase
        .from("load_activity")
        .select("*")
        .eq("load_id", loadIdParam)
        .order("created_at", { ascending: false })
        .limit(20);

      if (activityErr) {
        // Table might not exist yet, create synthetic log
        setActivityLog([
          {
            id: "synthetic-1",
            action: "Load created",
            timestamp: load?.created_at,
            user: "System",
          },
        ]);
      } else {
        setActivityLog(data || []);
      }
    } catch (err) {
      console.error("[LoadDetails] fetch activity error", err);
      setActivityLog([]);
    } finally {
      setLoadingActivity(false);
    }
  };

  const fetchRelatedLoads = async (customerId, currentLoadId) => {
    try {
      setLoadingRelated(true);
      const { data, error: relatedErr } = await supabase
        .from("loads")
        .select("id, load_number, status, pickup_at, delivery_at")
        .eq("customer_id", customerId)
        .neq("id", currentLoadId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (relatedErr) throw relatedErr;
      setRelatedLoads(data || []);
    } catch (err) {
      console.error("[LoadDetails] fetch related loads error", err);
      setRelatedLoads([]);
    } finally {
      setLoadingRelated(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]);

  /* -------- documents -------- */

  const refreshDocuments = useCallback(
    async (loadRowOverride) => {
      const activeLoad = loadRowOverride || load;
      if (!activeLoad || !activeLoad.org_id) return;

      try {
        setLoadingDocs(true);
        const folder = `${activeLoad.org_id}/${activeLoad.id}`;

        const { data, error: listErr } = await supabase.storage
          .from(DOC_BUCKET)
          .list(folder, { limit: 100 });

        if (listErr) throw listErr;

        setDocs(
          (data || []).map((d) => ({
            name: d.name,
            path: `${folder}/${d.name}`,
            updated_at: d.updated_at,
          }))
        );
      } catch (err) {
        console.error("[LoadDetails] docs list error", err);
      } finally {
        setLoadingDocs(false);
      }
    },
    [load]
  );

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !load?.org_id || !load?.id) return;

    try {
      setUploading(true);
      const folder = `${load.org_id}/${load.id}`;
      const filePath = `${folder}/${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from(DOC_BUCKET)
        .upload(filePath, file, {
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      await refreshDocuments();

      // Log activity
      await logActivity("Document uploaded", file.name);
    } catch (err) {
      console.error("[LoadDetails] upload error", err);
      alert("Upload failed. Check console for details.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleOpenDoc = async (doc) => {
    try {
      const { data, error: urlErr } = await supabase.storage
        .from(DOC_BUCKET)
        .createSignedUrl(doc.path, 60 * 10);

      if (urlErr) throw urlErr;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[LoadDetails] open doc error", err);
      alert("Could not open document.");
    }
  };

  const handleDeleteDoc = async (doc) => {
    if (
      !window.confirm(
        `Delete document "${doc.name}" from this load?`
      )
    )
      return;

    try {
      const { error: delErr } = await supabase.storage
        .from(DOC_BUCKET)
        .remove([doc.path]);

      if (delErr) throw delErr;
      await refreshDocuments();
      await logActivity("Document deleted", doc.name);
    } catch (err) {
      console.error("[LoadDetails] delete doc error", err);
      alert("Could not delete document.");
    }
  };

  /* -------- activity logging helper -------- */

  const logActivity = async (action, details = "") => {
    try {
      // Try to insert into load_activity if table exists
      await supabase.from("load_activity").insert({
        load_id: load.id,
        action,
        details,
        user: "Current User", // Replace with actual user from auth
      });
    } catch (err) {
      // Table might not exist yet, silently fail
      console.log("[LoadDetails] activity log insert skipped", err);
    }
  };

  /* -------- edit load handlers -------- */

  const handleOpenEditModal = () => {
    setEditForm({
      load_number: load.load_number || "",
      status: load.status || "AVAILABLE",
      equipment_type: load.equipment_type || "DRY_VAN",
      rate: load.rate || "",
      miles: load.miles || "",
      reference: load.reference || "",
      commodity: load.commodity || "",
      pickup_at: load.pickup_at || "",
      delivery_at: load.delivery_at || "",
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    try {
      setSaving(true);

      const { error: updateErr } = await supabase
        .from("loads")
        .update({
          load_number: editForm.load_number,
          status: editForm.status,
          equipment_type: editForm.equipment_type,
          rate: parseFloat(editForm.rate) || null,
          miles: parseInt(editForm.miles) || null,
          reference: editForm.reference,
          commodity: editForm.commodity,
          pickup_at: editForm.pickup_at,
          delivery_at: editForm.delivery_at,
        })
        .eq("id", load.id);

      if (updateErr) throw updateErr;

      await logActivity("Load details updated");
      await fetchData();
      setShowEditModal(false);
    } catch (err) {
      console.error("[LoadDetails] save edit error", err);
      alert("Could not save changes. Check console for details.");
    } finally {
      setSaving(false);
    }
  };

  /* -------- inline editing handlers -------- */

  const handleInlineEdit = (field, currentValue) => {
    setInlineEditing(field);
    setInlineValue(currentValue);
  };

  const handleInlineSave = async () => {
    if (!inlineEditing) return;

    try {
      const updateData = { [inlineEditing]: inlineValue };

      // Handle numeric fields
      if (inlineEditing === "rate" || inlineEditing === "miles") {
        updateData[inlineEditing] = parseFloat(inlineValue) || null;
      }

      const { error: updateErr } = await supabase
        .from("loads")
        .update(updateData)
        .eq("id", load.id);

      if (updateErr) throw updateErr;

      await logActivity(`Updated ${inlineEditing}`, inlineValue);
      await fetchData();
      setInlineEditing(null);
    } catch (err) {
      console.error("[LoadDetails] inline save error", err);
      alert("Could not save change.");
    }
  };

  const handleInlineCancel = () => {
    setInlineEditing(null);
    setInlineValue("");
  };

  /* -------- stop status update -------- */

  const handleUpdateStopStatus = async (stopId, newStatus) => {
    try {
      const { error: updateErr } = await supabase
        .from("load_stops")
        .update({ status: newStatus })
        .eq("id", stopId);

      if (updateErr) throw updateErr;

      await logActivity("Stop status updated", `Stop ${stopId}: ${newStatus}`);
      await fetchData();
      setEditingStopStatus(null);
    } catch (err) {
      console.error("[LoadDetails] update stop status error", err);
      alert("Could not update stop status.");
    }
  };

  /* -------- print/export handlers -------- */

  const handlePrintRateConfirmation = () => {
    const printWindow = window.open("", "_blank");
    const pickupStop = stops[0];
    const deliveryStop = stops[stops.length - 1];

    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Rate Confirmation - ${load.load_number || loadKey}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; }
          h1 { color: #059669; }
          .section { margin-bottom: 20px; }
          .label { font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Rate Confirmation</h1>
        <div class="section">
          <div><span class="label">Load Number:</span> ${load.load_number || loadKey}</div>
          <div><span class="label">Status:</span> ${load.status || "AVAILABLE"}</div>
          <div><span class="label">Equipment:</span> ${load.equipment_type || "DRY_VAN"}</div>
        </div>
        <div class="section">
          <div><span class="label">Pickup:</span> ${pickupStop ? buildStopAddress(pickupStop) : "TBD"}</div>
          <div><span class="label">Pickup Time:</span> ${formatDateTime(pickupStop?.scheduled_start || load.pickup_at)}</div>
        </div>
        <div class="section">
          <div><span class="label">Delivery:</span> ${deliveryStop ? buildStopAddress(deliveryStop) : "TBD"}</div>
          <div><span class="label">Delivery Time:</span> ${formatDateTime(deliveryStop?.scheduled_end || load.delivery_at)}</div>
        </div>
        <div class="section">
          <div><span class="label">Miles:</span> ${load.miles || "—"}</div>
          <div><span class="label">Rate:</span> ${load.rate != null ? load.rate.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—"}</div>
        </div>
        <div class="section">
          <div><span class="label">Reference:</span> ${load.reference || "—"}</div>
          <div><span class="label">Commodity:</span> ${load.commodity || "—"}</div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.print();
  };

  const handleExportCSV = () => {
    const csvData = [
      ["Field", "Value"],
      ["Load Number", load.load_number || loadKey],
      ["Status", load.status || "AVAILABLE"],
      ["Equipment", load.equipment_type || "DRY_VAN"],
      ["Miles", load.miles || ""],
      ["Rate", load.rate || ""],
      ["Reference", load.reference || ""],
      ["Commodity", load.commodity || ""],
      ["Pickup Date", load.pickup_at || ""],
      ["Delivery Date", load.delivery_at || ""],
    ];

    const csvContent =
      "data:text/csv;charset=utf-8," +
      csvData.map((e) => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `load_${load.load_number || loadKey}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* -------- quick actions handlers -------- */

  const handleDuplicateLoad = async () => {
    try {
      const { data: newLoad, error: dupErr } = await supabase
        .from("loads")
        .insert({
          org_id: load.org_id,
          customer_id: load.customer_id,
          equipment_type: load.equipment_type,
          commodity: load.commodity,
          miles: load.miles,
          rate: load.rate,
          status: "AVAILABLE",
          origin: load.origin,
          destination: load.destination,
        })
        .select()
        .single();

      if (dupErr) throw dupErr;

      // Duplicate stops
      if (stops.length > 0) {
        const stopsToInsert = stops.map((s) => ({
          load_id: newLoad.id,
          sequence: s.sequence,
          stop_type: s.stop_type,
          location_name: s.location_name,
          address_line1: s.address_line1,
          city: s.city,
          state: s.state,
          postal_code: s.postal_code,
          country: s.country,
          scheduled_start: s.scheduled_start,
          scheduled_end: s.scheduled_end,
        }));

        await supabase.from("load_stops").insert(stopsToInsert);
      }

      alert(`Load duplicated! New load ID: ${newLoad.id.slice(0, 6)}`);
      setShowQuickActions(false);
    } catch (err) {
      console.error("[LoadDetails] duplicate load error", err);
      alert("Could not duplicate load.");
    }
  };

  const handleMarkDelivered = async () => {
    if (!window.confirm("Mark this load as delivered?")) return;

    try {
      const { error: updateErr } = await supabase
        .from("loads")
        .update({ status: "DELIVERED" })
        .eq("id", load.id);

      if (updateErr) throw updateErr;

      await logActivity("Load marked as delivered");
      await fetchData();
      setShowQuickActions(false);
    } catch (err) {
      console.error("[LoadDetails] mark delivered error", err);
      alert("Could not mark as delivered.");
    }
  };

  const handleCancelLoad = async () => {
    if (!window.confirm("Cancel this load?")) return;

    try {
      const { error: updateErr } = await supabase
        .from("loads")
        .update({ status: "CANCELLED" })
        .eq("id", load.id);

      if (updateErr) throw updateErr;

      await logActivity("Load cancelled");
      await fetchData();
      setShowQuickActions(false);
    } catch (err) {
      console.error("[LoadDetails] cancel load error", err);
      alert("Could not cancel load.");
    }
  };

  /* -------- AI train + instructions helpers -------- */

  const handleTrainAI = async () => {
    if (!load) return;
    try {
      const { error: rpcErr } = await supabase.rpc(
        "rpc_ai_train_for_org_from_loads",
        {}
      );
      if (rpcErr) throw rpcErr;
      alert("AI training started for your org (stub RPC).");
    } catch (err) {
      console.error("[LoadDetails] train AI error", err);
      alert("Could not start AI training. Check console for details.");
    }
  };

  const handleBack = () => {
    navigate(-1);
  };

  const buildInstructionsTemplate = (view = driverView) => {
    if (!load) return "";

    const pickupStop = stops[0];
    const deliveryStop = stops[stops.length - 1];

    const { city: fallbackPickupCity, state: fallbackPickupState } =
      parseCityState(
        load?.origin ||
          [load?.origin_city, load?.origin_state]
            .filter(Boolean)
            .join(", ")
      );

    const {
      city: fallbackDeliveryCity,
      state: fallbackDeliveryState,
    } = parseCityState(
      load?.destination ||
        [
          load?.dest_city || load?.destination_city,
          load?.dest_state || load?.destination_state,
        ]
          .filter(Boolean)
          .join(", ")
    );

    const pickupAddress =
      pickupStop && buildStopAddress(pickupStop)
        ? buildStopAddress(pickupStop)
        : [fallbackPickupCity, fallbackPickupState]
            .filter(Boolean)
            .join(", ") || "TBD";

    const deliveryAddress =
      deliveryStop && buildStopAddress(deliveryStop)
        ? buildStopAddress(deliveryStop)
        : [fallbackDeliveryCity, fallbackDeliveryState]
            .filter(Boolean)
            .join(", ") || "TBD";

    const pickupDisplayDateTime =
      pickupStop?.scheduled_start || load?.pickup_at;
    const deliveryDisplayDateTime =
      deliveryStop?.scheduled_end || load?.delivery_at;

    const commodity =
      load?.commodity ||
      load?.commodity_description ||
      load?.load_type ||
      "General freight";

    const lines = [];

    lines.push(`Load ${load.load_number || loadKey}`);
    lines.push(`Pickup: ${pickupAddress}`);
    lines.push(`Pickup time: ${formatDateTime(pickupDisplayDateTime)}`);
    lines.push(`Delivery: ${deliveryAddress}`);
    lines.push(
      `Delivery time: ${formatDateTime(deliveryDisplayDateTime)}`
    );
    lines.push(`Commodity: ${commodity}`);

    if (view === "oo") {
      const rateText =
        load.rate != null
          ? load.rate.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })
          : "TBD";
      lines.push(`Rate: ${rateText}`);
    }

    lines.push(`Stops: ${stops.length}`);

    return lines.join("\n");
  };

  const handleOpenInstructionsModal = () => {
    setDriverView("company");
    setInstructionsText(buildInstructionsTemplate("company"));
    setEmailTo(assignedDriver?.email || "");
    setSmsTo(assignedDriver?.phone || "");
    setInstructionStatus("");
    setShowInstructions(true);
  };

  const handleDriverViewChange = (view) => {
    setDriverView(view);
    setInstructionsText(buildInstructionsTemplate(view));
    setInstructionStatus(
      view === "company"
        ? "Company driver view: rate is hidden."
        : "Owner-Operator view: rate is included."
    );
  };

  const handleCopyInstructions = async () => {
    try {
      await navigator.clipboard.writeText(instructionsText);
      setInstructionStatus("Instructions copied to clipboard.");
    } catch (err) {
      console.error("[LoadDetails] copy instructions error", err);
      setInstructionStatus(
        "Could not copy to clipboard. Please copy manually."
      );
    }
  };

  const handleSendEmail = async () => {
    if (!emailTo) {
      setInstructionStatus("Add a recipient email first.");
      return;
    }
    if (!instructionsText.trim()) {
      setInstructionStatus("Instructions text is empty.");
      return;
    }

    try {
      setEmailSending(true);
      setInstructionStatus("");

      const subject = `Load ${
        load.load_number || loadKey
      } instructions`;

      const { error: fnError } = await supabase.functions.invoke(
        "send-load-instructions-email",
        {
          body: {
            to: emailTo,
            subject,
            body: instructionsText,
            loadId: load.id,
            mode: "email",
          },
        }
      );

      if (fnError) {
        console.error(
          "[LoadDetails] send instructions email error",
          fnError
        );
        setInstructionStatus(
          "Could not send email. Check console and Supabase logs."
        );
      } else {
        setInstructionStatus("Email sent successfully.");
        await logActivity("Load instructions sent via email", emailTo);
      }
    } catch (err) {
      console.error("[LoadDetails] send instructions email error", err);
      setInstructionStatus(
        "Could not send email. Check console and Supabase logs."
      );
    } finally {
      setEmailSending(false);
    }
  };

  const handleSendSms = () => {
    if (!smsTo) {
      setInstructionStatus("Add a phone number first.");
      return;
    }
    if (!instructionsText.trim()) {
      setInstructionStatus("Instructions text is empty.");
      return;
    }

    setSmsSending(true);
    setTimeout(() => {
      setSmsSending(false);
      setInstructionStatus(
        "SMS option is ready in the UI. Once Twilio is approved, we'll wire this button to your SMS Edge Function. For now, copy/paste these instructions into a text."
      );
    }, 300);
  };

  /* -------------------- render helpers -------------------- */

  const pickupStop = stops[0];
  const deliveryStop = stops[stops.length - 1];

  const { city: fallbackPickupCity, state: fallbackPickupState } =
    parseCityState(
      load?.origin ||
        [load?.origin_city, load?.origin_state]
          .filter(Boolean)
          .join(", ")
    );

  const {
    city: fallbackDeliveryCity,
    state: fallbackDeliveryState,
  } = parseCityState(
    load?.destination ||
      [
        load?.dest_city || load?.destination_city,
        load?.dest_state || load?.destination_state,
      ]
        .filter(Boolean)
        .join(", ")
  );

  const pickupDisplayCity =
    pickupStop?.city || fallbackPickupCity || "—";
  const pickupDisplayState =
    pickupStop?.state || fallbackPickupState || "";

  const deliveryDisplayCity =
    deliveryStop?.city || fallbackDeliveryCity || "—";
  const deliveryDisplayState =
    deliveryStop?.state || fallbackDeliveryState || "";

  const pickupDisplayDateTime =
    pickupStop?.scheduled_start || load?.pickup_at;
  const deliveryDisplayDateTime =
    deliveryStop?.scheduled_end || load?.delivery_at;

  const displayStops = useMemo(() => {
    if (stops && stops.length > 0) return stops;

    if (!load) return [];

    const virtual = [];

    if (fallbackPickupCity || fallbackPickupState) {
      virtual.push({
        id: "virtual-pickup",
        sequence: 1,
        stop_type: "PICKUP",
        location_name:
          [fallbackPickupCity, fallbackPickupState]
            .filter(Boolean)
            .join(", ") || "Pickup",
        city: fallbackPickupCity || "",
        state: pickupDisplayState || fallbackPickupState || "",
        scheduled_start: pickupDisplayDateTime || null,
        scheduled_end: pickupDisplayDateTime || null,
        address_line1: null,
        postal_code: null,
        country: null,
        status: "PENDING",
      });
    }

    if (fallbackDeliveryCity || fallbackDeliveryState) {
      virtual.push({
        id: "virtual-delivery",
        sequence: virtual.length + 1,
        stop_type: "DELIVERY",
        location_name:
          [fallbackDeliveryCity, fallbackDeliveryState]
            .filter(Boolean)
            .join(", ") || "Delivery",
        city: fallbackDeliveryCity || "",
        state: deliveryDisplayState || fallbackDeliveryState || "",
        scheduled_start: deliveryDisplayDateTime || null,
        scheduled_end: deliveryDisplayDateTime || null,
        address_line1: null,
        postal_code: null,
        country: null,
        status: "PENDING",
      });
    }

    return virtual;
  }, [
    stops,
    load,
    fallbackPickupCity,
    fallbackPickupState,
    fallbackDeliveryCity,
    fallbackDeliveryState,
    pickupDisplayDateTime,
    deliveryDisplayDateTime,
    pickupDisplayState,
    deliveryDisplayState,
  ]);

  /* -------- AUTO-CALCULATE MILES (moved here to access displayStops) -------- */

  const handleCalculateMiles = useCallback(async () => {
    if (!GOOGLE_MAPS_API_KEY) {
      alert("Google Maps API key is not configured. Set VITE_GOOGLE_MAPS_API_KEY in your .env file.");
      return;
    }

    console.log('[Auto-Calculate Miles] displayStops:', displayStops);
    console.log('[Auto-Calculate Miles] actual stops from DB:', stops);
    
    if (displayStops.length < 2) {
      alert("You need at least 2 stops (pickup and delivery) to calculate miles.");
      return;
    }

    try {
      setCalculatingMiles(true);

      // Build waypoints array
      const waypoints = [];
      
      // Check if we have actual stops from load_stops table (not virtual stops)
      const hasRealStops = stops && stops.length >= 2;
      
      if (hasRealStops) {
        // Scenario 1: Use actual stops from load_stops table (manually created loads)
        console.log('[Auto-Calculate Miles] Using load_stops records');
        for (const stop of stops) {
          let addr = buildStopAddress(stop);
          console.log('[Auto-Calculate Miles] Stop:', stop.location_name, 'Address from fields:', addr);
          
          // If buildStopAddress returns empty, use location_name as fallback
          if (!addr && stop.location_name) {
            addr = stop.location_name;
            console.log('[Auto-Calculate Miles] Using location_name fallback:', addr);
          }
          
          if (addr) waypoints.push(addr);
        }
      } else {
        // Scenario 2: Fallback to loads.origin and loads.destination (OCR loads)
        console.log('[Auto-Calculate Miles] No load_stops found, using loads.origin and loads.destination');
        
        if (load.origin) {
          waypoints.push(load.origin);
          console.log('[Auto-Calculate Miles] Added origin:', load.origin);
        }
        
        if (load.destination) {
          waypoints.push(load.destination);
          console.log('[Auto-Calculate Miles] Added destination:', load.destination);
        }
      }

      console.log('[Auto-Calculate Miles] Final waypoints:', waypoints);

      if (waypoints.length < 2) {
        alert("Could not build addresses from stops. Please add city/state or location information to your stops.");
        return;
      }

      // Use Google Maps DirectionsService (no CORS issues)
      // @ts-ignore - google is loaded via script
      const directionsService = new google.maps.DirectionsService();

      // Build request for multi-stop route
      const origin = waypoints[0];
      const destination = waypoints[waypoints.length - 1];
      const waypointsForApi = waypoints.slice(1, -1).map(location => ({
        location,
        stopover: true
      }));

      const request = {
        origin,
        destination,
        waypoints: waypointsForApi,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL
      };

      console.log('[Auto-Calculate Miles] Directions API request:', request);

      directionsService.route(request, async (result, status) => {
        try {
          if (status === 'OK' && result) {
            // Calculate total distance from all legs
            let totalMiles = 0;
            const route = result.routes[0];
            
            if (route && route.legs) {
              for (const leg of route.legs) {
                if (leg.distance) {
                  // Distance is in meters, convert to miles
                  const miles = leg.distance.value * 0.000621371;
                  totalMiles += miles;
                  console.log(`[Auto-Calculate Miles] Leg: ${leg.start_address} → ${leg.end_address}: ${miles.toFixed(2)} miles`);
                }
              }
            }

            console.log('[Auto-Calculate Miles] Total miles:', totalMiles);

            if (totalMiles > 0) {
              const roundedMiles = Math.round(totalMiles);
              
              // Update the load with calculated miles
              const { error: updateErr } = await supabase
                .from("loads")
                .update({ miles: roundedMiles })
                .eq("id", load.id);

              if (updateErr) throw updateErr;

              await logActivity("Miles auto-calculated", `${roundedMiles} miles via Google Maps`);
              await fetchData(); // Refresh the load data
              
              alert(`Miles calculated: ${roundedMiles} miles`);
            } else {
              alert("Could not calculate miles. Please check your stops and try again.");
            }
          } else {
            console.error('[Auto-Calculate Miles] Directions API error:', status, result);
            alert(`Could not calculate route: ${status}. Please check that your addresses are valid.`);
          }
        } catch (err) {
          console.error("[LoadDetails] calculate miles error", err);
          alert("Error calculating miles. Check console for details.");
        } finally {
          setCalculatingMiles(false);
        }
      });
    } catch (err) {
      console.error("[LoadDetails] calculate miles error", err);
      alert("Error calculating miles. Check console for details.");
      setCalculatingMiles(false);
    }
  }, [stops, displayStops, load, GOOGLE_MAPS_API_KEY, fetchData, logActivity]);

  // Calculate profitability using REAL diesel prices
  const driverPay = assignedDriver?.rate || 0;
  const estimatedFuel = fuelCalculation.fuelCost; // Using real diesel prices from EIA
  const profit = (load?.rate || 0) - driverPay - estimatedFuel;
  const profitMargin =
    load?.rate > 0 ? ((profit / load.rate) * 100).toFixed(1) : 0;
  
  // Calculate rate per mile
  const ratePerMile = (load?.rate && load?.miles) ? (load.rate / load.miles).toFixed(2) : null;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-200">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading load details…</span>
        </div>
      </div>
    );
  }

  if (error || !load) {
    return (
      <div className="p-6 space-y-4">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 text-sm text-slate-200 hover:text-emerald-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Loads
        </button>
        <div className="bg-rose-950/60 border border-rose-500/40 rounded-2xl p-4 text-rose-100">
          {error || "Load not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-6 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-2 text-sm text-slate-200 hover:text-emerald-300"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Load
              </div>
              <div className="text-lg font-semibold text-slate-50">
                {load.load_number || loadKey}
              </div>
              <div className="text-xs text-slate-400">
                PU:{" "}
                {pickupStop
                  ? formatDateTime(pickupStop.scheduled_start)
                  : formatDateTime(load.pickup_at)}{" "}
                · DEL:{" "}
                {deliveryStop
                  ? formatDateTime(deliveryStop.scheduled_end)
                  : formatDateTime(load.delivery_at)}{" "}
                · Equip: {load.equipment_type || "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleOpenEditModal}
              className="inline-flex items-center gap-2 rounded-full border border-blue-500/60 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-100 hover:bg-blue-500/20"
            >
              <Edit className="h-4 w-4" />
              Edit Load
            </button>
            <button
              onClick={handleOpenInstructionsModal}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20"
            >
              <Send className="h-4 w-4" />
              Send Instructions
            </button>
            <button
              onClick={handleTrainAI}
              className="inline-flex items-center gap-2 rounded-full border border-pink-500/60 bg-pink-500/10 px-3 py-1.5 text-xs font-medium text-pink-100 hover:bg-pink-500/20"
            >
              <PlayCircle className="h-4 w-4" />
              Train AI
            </button>
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <div className="relative" ref={quickActionsRef}>
              <button
                onClick={() => setShowQuickActions(!showQuickActions)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {showQuickActions && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl bg-slate-900 border border-slate-700 shadow-xl z-50">
                  <div className="py-1">
                    <button
                      onClick={handlePrintRateConfirmation}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-100 hover:bg-slate-800"
                    >
                      <Printer className="h-3 w-3" />
                      Print Rate Confirmation
                    </button>
                    <button
                      onClick={handleExportCSV}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-100 hover:bg-slate-800"
                    >
                      <Download className="h-3 w-3" />
                      Export CSV
                    </button>
                    <button
                      onClick={handleDuplicateLoad}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-100 hover:bg-slate-800"
                    >
                      <Copy className="h-3 w-3" />
                      Duplicate Load
                    </button>
                    <button
                      onClick={handleMarkDelivered}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs text-emerald-100 hover:bg-slate-800"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Mark as Delivered
                    </button>
                    <button
                      onClick={handleCancelLoad}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs text-rose-100 hover:bg-slate-800"
                    >
                      <X className="h-3 w-3" />
                      Cancel Load
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Timeline */}
        <div className="overflow-x-auto">
          <StatusTimeline status={load.status} />
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="text-[10px] text-slate-500">
          Keyboard shortcuts: <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">E</kbd> Edit · <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">I</kbd> Instructions · <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">R</kbd> Refresh · <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">P</kbd> Print
        </div>
      </div>

      {/* Top grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-6">
        {/* Load summary */}
        <section className="bg-slate-900/70 border border-emerald-500/30 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-50">
              Load Summary
            </h2>
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-200 border border-emerald-500/40">
              {load.status || "AVAILABLE"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl bg-slate-950/60 border border-slate-700/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                Pickup
              </div>
              <div className="text-slate-50">
                {pickupDisplayCity}, {pickupDisplayState}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {formatDateTime(pickupDisplayDateTime)}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-slate-700/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                Delivery
              </div>
              <div className="text-slate-50">
                {deliveryDisplayCity}, {deliveryDisplayState}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {formatDateTime(deliveryDisplayDateTime)}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-slate-700/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                Equipment
              </div>
              <div className="text-slate-50">
                {load.equipment_type || "DRY_VAN"}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-slate-700/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                Miles
              </div>
              {inlineEditing === "miles" ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={inlineValue}
                    onChange={(e) => setInlineValue(e.target.value)}
                    className="w-20 rounded bg-slate-900 border border-slate-700 px-2 py-0.5 text-xs text-slate-100"
                    autoFocus
                  />
                  <button
                    onClick={handleInlineSave}
                    className="p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30"
                  >
                    <Save className="h-3 w-3 text-emerald-300" />
                  </button>
                  <button
                    onClick={handleInlineCancel}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    <X className="h-3 w-3 text-slate-300" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center gap-2 cursor-pointer group"
                    onClick={() =>
                      handleInlineEdit("miles", load.miles || "")
                    }
                  >
                    <div className="text-slate-50">{load.miles || "—"}</div>
                    <Edit className="h-3 w-3 text-slate-500 group-hover:text-emerald-400" />
                  </div>
                  <button
                    onClick={handleCalculateMiles}
                    disabled={calculatingMiles}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Auto-calculate miles from stops using Google Maps"
                  >
                    {calculatingMiles ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Calculator className="h-2.5 w-2.5" />
                    )}
                    Auto
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-slate-700/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                Rate
              </div>
              {inlineEditing === "rate" ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={inlineValue}
                    onChange={(e) => setInlineValue(e.target.value)}
                    className="w-24 rounded bg-slate-900 border border-slate-700 px-2 py-0.5 text-xs text-slate-100"
                    autoFocus
                  />
                  <button
                    onClick={handleInlineSave}
                    className="p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30"
                  >
                    <Save className="h-3 w-3 text-emerald-300" />
                  </button>
                  <button
                    onClick={handleInlineCancel}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    <X className="h-3 w-3 text-slate-300" />
                  </button>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 cursor-pointer group"
                  onClick={() =>
                    handleInlineEdit("rate", load.rate || "")
                  }
                >
                  <div className="text-slate-50">
                    {load.rate != null
                      ? load.rate.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })
                      : "—"}
                  </div>
                  <Edit className="h-3 w-3 text-slate-500 group-hover:text-emerald-400" />
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-slate-700/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                Reference
              </div>
              {inlineEditing === "reference" ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={inlineValue}
                    onChange={(e) => setInlineValue(e.target.value)}
                    className="w-24 rounded bg-slate-900 border border-slate-700 px-2 py-0.5 text-xs text-slate-100"
                    autoFocus
                  />
                  <button
                    onClick={handleInlineSave}
                    className="p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30"
                  >
                    <Save className="h-3 w-3 text-emerald-300" />
                  </button>
                  <button
                    onClick={handleInlineCancel}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    <X className="h-3 w-3 text-slate-300" />
                  </button>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 cursor-pointer group"
                  onClick={() =>
                    handleInlineEdit("reference", load.reference || "")
                  }
                >
                  <div className="text-slate-50 truncate">
                    {load.reference || "—"}
                  </div>
                  <Edit className="h-3 w-3 text-slate-500 group-hover:text-emerald-400" />
                </div>
              )}
            </div>
          </div>

          {/* Profitability Metrics with Real Diesel Prices */}
          <div className="pt-3 border-t border-slate-700/60">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              <h3 className="text-sm font-semibold text-slate-50">
                Profitability
              </h3>
              <span className="text-[10px] text-emerald-300/60">
                (Live diesel: ${fuelCalculation.pricePerGallon}/gal)
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-slate-950/40 border border-slate-700/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Revenue
                </div>
                <div className="text-slate-50 font-medium">
                  {load.rate != null
                    ? load.rate.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })
                    : "—"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/40 border border-slate-700/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Rate/Mile
                </div>
                <div className="text-slate-50 font-medium">
                  {ratePerMile ? `$${ratePerMile}` : "—"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/40 border border-slate-700/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Est. Profit
                </div>
                <div
                  className={cx(
                    "font-medium",
                    profit > 0 ? "text-emerald-300" : "text-rose-300"
                  )}
                >
                  {profit.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  })}
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/40 border border-slate-700/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Margin
                </div>
                <div
                  className={cx(
                    "font-medium",
                    profitMargin > 15
                      ? "text-emerald-300"
                      : profitMargin > 5
                      ? "text-amber-300"
                      : "text-rose-300"
                  )}
                >
                  {profitMargin}%
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right column: Driver + Best-Fit + docs */}
        <div className="space-y-4">
          {/* Assigned Driver Info */}
          {assignedDriver && (
            <section className="bg-slate-900/70 border border-blue-500/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-300" />
                <h2 className="text-sm font-semibold text-slate-50">
                  Assigned Driver
                </h2>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Truck className="h-3 w-3 text-slate-400" />
                  <span className="text-xs text-slate-100">
                    {assignedDriver.first_name} {assignedDriver.last_name}
                  </span>
                </div>
                {assignedDriver.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3 w-3 text-slate-400" />
                    <span className="text-xs text-slate-100">
                      {assignedDriver.phone}
                    </span>
                  </div>
                )}
                {assignedDriver.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3 w-3 text-slate-400" />
                    <span className="text-xs text-slate-100 truncate">
                      {assignedDriver.email}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <DollarSign className="h-3 w-3 text-slate-400" />
                  <span className="text-xs text-slate-100">
                    Rate: {assignedDriver.rate?.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                    }) || "—"}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* TEMP static Best-Fit Drivers card */}
          <section className="bg-slate-900/70 border border-pink-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-fuchsia-400 shadow shadow-fuchsia-500/60" />
                <h2 className="text-sm font-semibold text-slate-50">
                  Best-Fit Drivers
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span>AI lane matching is being tuned</span>
              </div>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed">
              Best-fit driver suggestions are temporarily paused on
              this page while we stabilize the AI engine. You can
              still assign drivers from the Loads and Drivers pages,
              and your feedback there will continue training Atlas
              AI in the background.
            </div>
          </section>

          {/* Load documents */}
          <section className="bg-slate-900/70 border border-emerald-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold text-slate-50">
                  Load Documents
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-100 hover:bg-emerald-500/20"
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  Upload
                </button>
                <button
                  onClick={() => refreshDocuments()}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-600 px-2.5 py-0.5 text-[11px] text-slate-100 hover:bg-slate-800"
                  disabled={loadingDocs}
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
            </div>

            {loadingDocs && (
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading documents…
              </div>
            )}

            {!loadingDocs && docs.length === 0 && (
              <div className="border-2 border-dashed border-slate-700/60 rounded-xl p-6 text-center">
                <Upload className="h-8 w-8 mx-auto mb-2 text-slate-500" />
                <div className="text-xs text-slate-400 mb-2">
                  No documents yet
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-emerald-300 hover:text-emerald-200"
                >
                  Upload your first document
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {docs.map((doc) => (
                <div
                  key={doc.path}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/60 border border-slate-700/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-slate-50 truncate">
                      {doc.name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Updated {formatDateTime(doc.updated_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenDoc(doc)}
                      className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-900/80 p-1.5 hover:bg-slate-800"
                    >
                      <Eye className="h-3 w-3 text-slate-100" />
                    </button>
                    <button
                      onClick={() => handleDeleteDoc(doc)}
                      className="inline-flex items-center justify-center rounded-full border border-rose-600/70 bg-rose-950/80 p-1.5 hover:bg-rose-900"
                    >
                      <Trash2 className="h-3 w-3 text-rose-200" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Route & Stops with status tracking */}
      <section className="bg-slate-900/70 border border-emerald-500/30 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-50">
            Route &amp; Stops
          </h2>
          <div className="text-xs text-slate-400">
            {displayStops.length} stop
            {displayStops.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="space-y-3">
          {displayStops.map((stop) => (
            <div
              key={stop.id}
              className="rounded-xl bg-slate-950/60 border border-slate-700/70 p-3 space-y-2"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    Stop {stop.sequence} · {stop.stop_type || "STOP"}
                  </div>
                  <div className="text-sm font-medium text-slate-50">
                    {stop.location_name || buildStopAddress(stop) || "—"}
                  </div>
                  <div className="text-xs text-slate-400">
                    {buildStopAddress(stop)}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div>
                    Start: {formatDateTime(stop.scheduled_start)}
                  </div>
                  <div>End: {formatDateTime(stop.scheduled_end)}</div>
                </div>
              </div>

              {/* Stop status */}
              <div className="flex items-center gap-2">
                <MapPin className="h-3 w-3 text-slate-400" />
                {editingStopStatus === stop.id ? (
                  <div className="flex items-center gap-1">
                    <select
                      className="rounded bg-slate-900 border border-slate-700 px-2 py-0.5 text-xs text-slate-100"
                      defaultValue={stop.status || "PENDING"}
                      onChange={(e) =>
                        handleUpdateStopStatus(stop.id, e.target.value)
                      }
                      autoFocus
                    >
                      {STOP_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setEditingStopStatus(null)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700"
                    >
                      <X className="h-3 w-3 text-slate-300" />
                    </button>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 cursor-pointer group"
                    onClick={() => setEditingStopStatus(stop.id)}
                  >
                    <span
                      className={cx(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                        stop.status === "COMPLETED"
                          ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
                          : stop.status === "ARRIVED"
                          ? "bg-blue-500/20 text-blue-200 border border-blue-500/40"
                          : stop.status === "EN_ROUTE"
                          ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                          : "bg-slate-700/60 text-slate-300 border border-slate-600"
                      )}
                    >
                      {(stop.status || "PENDING").replace("_", " ")}
                    </span>
                    <Edit className="h-3 w-3 text-slate-500 group-hover:text-emerald-400" />
                  </div>
                )}
              </div>
            </div>
          ))}

          {displayStops.length === 0 && (
            <div className="text-sm text-slate-300">
              No stops yet. Add pickups and deliveries for this load.
            </div>
          )}
        </div>
      </section>

      {/* Route Map (collapsible) */}
      <section className="bg-slate-900/70 border border-emerald-500/30 rounded-2xl p-5 space-y-4">
        <button
          type="button"
          onClick={() => setShowRouteMap((v) => !v)}
          className="w-full flex items-center justify-between gap-2 mb-1 text-left"
        >
          <div className="flex items-center gap-2">
            <MapIcon className="h-4 w-4 text-emerald-300" />
            <h2 className="text-base font-semibold text-slate-50">
              Route Map
            </h2>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>
              {showRouteMap ? "Collapse" : "Expand"} · Multi-stop · Dark
              mode
            </span>
            <ChevronDown
              className={cx(
                "h-4 w-4 transition-transform",
                showRouteMap ? "rotate-0" : "-rotate-90"
              )}
            />
          </div>
        </button>

        {showRouteMap && <RouteMap stops={displayStops} />}
      </section>

      {/* AI Recommendations (collapsible) */}
      <section className="bg-slate-900/70 border border-pink-500/30 rounded-2xl p-5">
        <button
          type="button"
          onClick={() => setShowAiSection((v) => !v)}
          className="w-full flex items-center justify-between gap-2 mb-4 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-fuchsia-400 shadow shadow-fuchsia-500/60" />
            <h2 className="text-base font-semibold text-slate-50">
              AI Recommendations
            </h2>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>{showAiSection ? "Collapse" : "Expand"}</span>
            <ChevronDown
              className={cx(
                "h-4 w-4 transition-transform",
                showAiSection ? "rotate-0" : "-rotate-90"
              )}
            />
          </div>
        </button>

        {showAiSection && <AiRecommendationsForLoad loadId={load.id} />}
      </section>

      {/* Activity Log (collapsible) */}
      <section className="bg-slate-900/70 border border-purple-500/30 rounded-2xl p-5">
        <button
          type="button"
          onClick={() => setShowActivityLog((v) => !v)}
          className="w-full flex items-center justify-between gap-2 mb-4 text-left"
        >
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-purple-300" />
            <h2 className="text-base font-semibold text-slate-50">
              Activity Log
            </h2>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>{showActivityLog ? "Collapse" : "Expand"}</span>
            <ChevronDown
              className={cx(
                "h-4 w-4 transition-transform",
                showActivityLog ? "rotate-0" : "-rotate-90"
              )}
            />
          </div>
        </button>

        {showActivityLog && (
          <div className="space-y-2">
            {loadingActivity && (
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading activity…
              </div>
            )}
            {!loadingActivity && activityLog.length === 0 && (
              <div className="text-xs text-slate-400">
                No activity recorded yet.
              </div>
            )}
            {activityLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 text-xs rounded-lg bg-slate-950/40 border border-slate-700/60 p-2"
              >
                <div className="flex-shrink-0 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-purple-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-100">{entry.action}</div>
                  {entry.details && (
                    <div className="text-slate-400 text-[10px] mt-0.5">
                      {entry.details}
                    </div>
                  )}
                  <div className="text-slate-500 text-[10px] mt-0.5">
                    {formatDateTime(entry.timestamp || entry.created_at)}{" "}
                    · {entry.user || "System"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Related Loads (collapsible) */}
      {relatedLoads.length > 0 && (
        <section className="bg-slate-900/70 border border-amber-500/30 rounded-2xl p-5">
          <button
            type="button"
            onClick={() => setShowRelatedLoads((v) => !v)}
            className="w-full flex items-center justify-between gap-2 mb-4 text-left"
          >
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-amber-300" />
              <h2 className="text-base font-semibold text-slate-50">
                Related Loads
              </h2>
              <span className="text-xs text-slate-400">
                ({relatedLoads.length})
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>{showRelatedLoads ? "Collapse" : "Expand"}</span>
              <ChevronDown
                className={cx(
                  "h-4 w-4 transition-transform",
                  showRelatedLoads ? "rotate-0" : "-rotate-90"
                )}
              />
            </div>
          </button>

          {showRelatedLoads && (
            <div className="space-y-2">
              {relatedLoads.map((rel) => (
                <button
                  key={rel.id}
                  onClick={() => navigate(`/loads/${rel.id}`)}
                  className="w-full flex items-center justify-between gap-2 text-left rounded-lg bg-slate-950/40 border border-slate-700/60 p-3 hover:bg-slate-950/60 hover:border-amber-500/40 transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-100">
                      {rel.load_number || rel.id.slice(0, 6)}
                    </div>
                    <div className="text-xs text-slate-400">
                      PU: {formatDateTime(rel.pickup_at)} · DEL:{" "}
                      {formatDateTime(rel.delivery_at)}
                    </div>
                  </div>
                  <span
                    className={cx(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                      rel.status === "DELIVERED"
                        ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
                        : rel.status === "IN_TRANSIT"
                        ? "bg-blue-500/20 text-blue-200 border border-blue-500/40"
                        : "bg-slate-700/60 text-slate-300 border border-slate-600"
                    )}
                  >
                    {rel.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Edit Load Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-950 border border-slate-700 p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Edit className="h-5 w-5 text-blue-300" />
                <h2 className="text-lg font-semibold text-slate-50">
                  Edit Load
                </h2>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-full bg-slate-900/80 border border-slate-700 p-2 hover:bg-slate-800"
              >
                <X className="h-4 w-4 text-slate-200" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Load Number
                </label>
                <input
                  type="text"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={editForm.load_number}
                  onChange={(e) =>
                    setEditForm({ ...editForm, load_number: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Status
                </label>
                <select
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm({ ...editForm, status: e.target.value })
                  }
                >
                  {LOAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Equipment Type
                </label>
                <input
                  type="text"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={editForm.equipment_type}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      equipment_type: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Miles
                </label>
                <input
                  type="number"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={editForm.miles}
                  onChange={(e) =>
                    setEditForm({ ...editForm, miles: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Rate
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={editForm.rate}
                  onChange={(e) =>
                    setEditForm({ ...editForm, rate: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Reference
                </label>
                <input
                  type="text"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={editForm.reference}
                  onChange={(e) =>
                    setEditForm({ ...editForm, reference: e.target.value })
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Commodity
                </label>
                <input
                  type="text"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={editForm.commodity}
                  onChange={(e) =>
                    setEditForm({ ...editForm, commodity: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Pickup Date/Time
                </label>
                <input
                  type="datetime-local"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={
                    editForm.pickup_at
                      ? new Date(editForm.pickup_at)
                          .toISOString()
                          .slice(0, 16)
                      : ""
                  }
                  onChange={(e) =>
                    setEditForm({ ...editForm, pickup_at: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Delivery Date/Time
                </label>
                <input
                  type="datetime-local"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 px-3 py-2"
                  value={
                    editForm.delivery_at
                      ? new Date(editForm.delivery_at)
                          .toISOString()
                          .slice(0, 16)
                      : ""
                  }
                  onChange={(e) =>
                    setEditForm({ ...editForm, delivery_at: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4">
              <button
                onClick={() => setShowEditModal(false)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full border border-blue-500/70 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Instructions modal */}
      {showInstructions && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-950 border border-slate-700 p-5 space-y-4 shadow-xl shadow-black/40 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold text-slate-50">
                  Send Load Instructions
                </h2>
              </div>
              <button
                onClick={() => setShowInstructions(false)}
                className="rounded-full bg-slate-900/80 border border-slate-700 p-1.5 hover:bg-slate-800"
              >
                <X className="h-3 w-3 text-slate-200" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Generate a clean set of instructions for this load and
              share them with your driver. Choose{" "}
              <span className="font-semibold text-emerald-200">
                Company
              </span>{" "}
              to hide the rate, or{" "}
              <span className="font-semibold text-emerald-200">
                Owner-Operator
              </span>{" "}
              to include it.
            </p>

            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-slate-400">
                Driver view
              </div>
              <div className="inline-flex rounded-full bg-slate-900 border border-slate-700 p-1">
                <button
                  type="button"
                  onClick={() => handleDriverViewChange("company")}
                  className={cx(
                    "px-3 py-1 text-[11px] rounded-full transition-colors",
                    driverView === "company"
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "text-slate-300"
                  )}
                >
                  Company
                </button>
                <button
                  type="button"
                  onClick={() => handleDriverViewChange("oo")}
                  className={cx(
                    "px-3 py-1 text-[11px] rounded-full transition-colors",
                    driverView === "oo"
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "text-slate-300"
                  )}
                >
                  Owner-Operator
                </button>
              </div>
            </div>

            <textarea
              className="w-full rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 p-3 resize-none h-40"
              value={instructionsText}
              onChange={(e) => setInstructionsText(e.target.value)}
            />

            <div className="space-y-3">
              <div className="space-y-2">
                <label className="block text-[11px] uppercase tracking-wide text-slate-400">
                  Recipient Email
                </label>
                <input
                  type="email"
                  placeholder="driver@example.com"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 px-3 py-2 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] uppercase tracking-wide text-slate-400">
                  SMS Number
                </label>
                <input
                  type="tel"
                  placeholder="+1 555 123 4567"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 px-3 py-2 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={smsTo}
                  onChange={(e) => setSmsTo(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCopyInstructions}
                className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
              >
                <Copy className="h-3 w-3" />
                Copy to Clipboard
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowInstructions(false)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
                  type="button"
                >
                  Close
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={emailSending}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-500/70 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                  type="button"
                >
                  {emailSending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Send via Email
                </button>
                <button
                  onClick={handleSendSms}
                  disabled={smsSending}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                  type="button"
                >
                  {smsSending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Send via SMS (soon)
                </button>
              </div>
            </div>

            {instructionStatus && (
              <div className="text-[11px] text-slate-300 pt-1">
                {instructionStatus}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}