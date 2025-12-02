// src/pages/Loads.jsx
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  X,
  ChevronDown,
  Pencil,
  AlertTriangle,
  ShieldCheck,
  Filter,
  CheckCircle2,
  Bug,
  Clock,
  StickyNote,
  Eye,
  Save,
  MoreVertical,
  UserCheck,
  FileText,
  ThumbsUp,
  ThumbsDown,
  Search,
  DollarSign, // ✅ NEW
} from "lucide-react";
import { supabase } from "../lib/supabase";
import AddLoadModal from "../components/AddLoadModal";
import AssignDriverModal from "../components/AssignDriverModal";
import EditLoadModal from "../components/EditLoadModal";
import LoadDocuments from "../components/LoadDocuments";
import { Link } from "react-router-dom";
import { fitLoadForDriver } from "../lib/driverFit";
import DriverFitPill from "../components/DriverFitPill.jsx";
import AutoAssignDriverButton from "../components/AutoAssignDriverButton";
import AutoAssignDriverButtonCompact from "../components/AutoAssignDriverButtonCompact";
import LoadPredictCell from "../components/LoadPredictCell";
import LearnedSuggestions from "../components/LearnedSuggestions.jsx";
import AiRecommendationsForLoad from "../components/AiRecommendationsForLoad.jsx";
import RCUploader from "../components/RCUploader";

/** MUST match DB enum/check */
const STATUS_CHOICES = [
  { label: "Available", value: "AVAILABLE" },
  { label: "In Transit", value: "IN_TRANSIT" },
  { label: "Delivered", value: "DELIVERED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "At Risk", value: "AT_RISK" },
  { label: "Problem", value: "PROBLEM" },
];

const PRIORITY_CHOICES = [
  { label: "Low", value: "LOW" },
  { label: "Medium", value: "MEDIUM" },
  { label: "High", value: "HIGH" },
  { label: "Critical", value: "CRITICAL" },
];

/* ------------------------------ Utils ------------------------------ */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}
function since(ts) {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  if (isNaN(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Lucide icon helper with better visibility */
function Ico({ as: Icon, className = "", title }) {
  return (
    <Icon
      className={cx("h-4 w-4", className)}
      strokeWidth={2}
      style={{ color: "currentColor", stroke: "currentColor" }}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      focusable="false"
    />
  );
}

/** Improved icon button with fixed size and better contrast */
function IconButton({ title, onClick, className = "", children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cx(
        "inline-flex items-center justify-center rounded-lg border flex-shrink-0",
        "h-7 w-7",
        "bg-white/5 text-white hover:text-white hover:bg-white/10 border-white/30 hover:border-white/40",
        "transition-colors",
        className
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------ Page ------------------------------ */
export default function Loads() {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Search state
  const [searchTerm, setSearchTerm] = useState("");

  async function leaveFeedback(load, accepted, note = null) {
    try {
      if (!load?.id || !load?.driver?.id) {
        alert("Load or driver missing for feedback.");
        return;
      }

      const payload = {
        load_id: load.id,
        driver_id: load.driver.id,
        rating: accepted ? "up" : "down",
        note: note || null,
      };

      const { error } = await supabase
        .from("dispatch_feedback_events")
        .insert(payload);

      if (error) throw error;
    } catch (e) {
      console.error("[leaveFeedback] error:", e);
      alert(e?.message || "Failed to save feedback.");
    }
  }

  // Problems workflow
  const [showProblemsOnly, setShowProblemsOnly] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [reportingLoad, setReportingLoad] = useState(null);
  const [viewingProblemLoad, setViewingProblemLoad] = useState(null);

  // Notes workflow
  const [editingNotesLoad, setEditingNotesLoad] = useState(null);

  // Driver assignment
  const [assigningDriverLoad, setAssigningDriverLoad] = useState(null);

  // Edit load
  const [editingLoad, setEditingLoad] = useState(null);

  // Documents workflow
  const [docsLoad, setDocsLoad] = useState(null);

  const [me, setMe] = useState({ email: "", id: "" });
  const loadIdForAI = assigningDriverLoad?.id ?? null;

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user && active)
          setMe({ email: data.user.email || "", id: data.user.id });
      } catch {}

      setLoading(true);
      setFetchError("");
      try {
        const { data, error } = await supabase
          .from("loads")
          .select(`
            *,
            driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
          `)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (active) setLoads(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn("[Loads] fetch error:", e);
        setFetchError(e?.message || "Failed to load loads.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Freshen a single row
  async function refreshOne(id) {
    try {
      const { data, error } = await supabase
        .from("loads")
        .select(`
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `)
        .eq("id", id)
        .single();
      if (error) throw error;
      setLoads((prev) => prev.map((l) => (l.id === id ? data : l)));
      return data;
    } catch (e) {
      console.warn("[Loads] refreshOne error:", e);
      return null;
    }
  }

  // Filtering with search
  const visibleRows = useMemo(() => {
    let rows = loads;

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      rows = rows.filter((r) => {
        const ref = (r.reference || "").toLowerCase();
        const shipper = (r.shipper || "").toLowerCase();
        const origin = (r.origin || "").toLowerCase();
        const dest = (r.destination || "").toLowerCase();
        const driverName = r.driver
          ? `${r.driver.first_name} ${r.driver.last_name}`.toLowerCase()
          : "";
        const notes = (r.notes || "").toLowerCase();
        const problemNote = (r.problem_note || "").toLowerCase();

        return (
          ref.includes(term) ||
          shipper.includes(term) ||
          origin.includes(term) ||
          dest.includes(term) ||
          driverName.includes(term) ||
          notes.includes(term) ||
          problemNote.includes(term)
        );
      });
    }

    if (priorityFilter !== "ALL") {
      rows = rows.filter(
        (r) =>
          r.status === "PROBLEM" &&
          (r.problem_priority || "") === priorityFilter
      );
    } else if (showProblemsOnly) {
      rows = rows.filter((r) => r.status === "PROBLEM");
    }

    return rows;
  }, [loads, searchTerm, showProblemsOnly, priorityFilter]);

  /* --------------------------- CRUD helpers --------------------------- */

  async function deleteLoad(id) {
    if (!confirm("Delete this load? This cannot be undone.")) return;
    try {
      const { error } = await supabase.from("loads").delete().eq("id", id);
      if (error) throw error;
      setLoads((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      alert(e?.message || "Failed to delete load.");
    }
  }

  // ✅ Mark load as ready for billing WITHOUT changing status
  async function markReadyForBilling(loadId) {
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({
          billing_ready: true,
          billing_marked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", loadId)
        .select(`
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `)
        .single();

      if (error) throw error;

      setLoads((prev) => prev.map((l) => (l.id === loadId ? data : l)));
    } catch (e) {
      console.warn("[Loads] markReadyForBilling error:", e);
      alert(e?.message || "Failed to mark load ready for billing.");
    }
  }

  async function updateStatus(id, next) {
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(`
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `)
        .single();
      if (error) throw error;

      setLoads((prev) => prev.map((l) => (l.id === id ? data : l)));

      // When a load is marked DELIVERED, set the assigned driver back to AVAILABLE
      if (next === "DELIVERED" && data?.driver_id) {
        try {
          const { error: driverErr } = await supabase
            .from("drivers")
            .update({ status: "AVAILABLE" })
            .eq("id", data.driver_id);

          if (driverErr) {
            console.warn(
              "[Loads] failed to update driver status to AVAILABLE after delivery:",
              driverErr
            );
          }
        } catch (e2) {
          console.warn(
            "[Loads] unexpected error when updating driver after delivery:",
            e2
          );
        }
      }
    } catch (e) {
      alert(e?.message || "Failed to update status.");
    }
  }

  // Unassign driver from a load (set driver_id to null)
  async function unassignDriver(loadId) {
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({
          driver_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", loadId)
        .select(`
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `)
        .single();

      if (error) throw error;

      setLoads((prev) => prev.map((l) => (l.id === loadId ? data : l)));
    } catch (e) {
      console.warn("[Loads] unassignDriver error:", e);
      alert(e?.message || "Failed to unassign driver from load.");
    }
  }

  function openReport(load) {
    setReportingLoad(load);
  }
  function closeReport() {
    setReportingLoad(null);
  }

  async function markProblem(loadId, payload) {
    const full = {
      status: "PROBLEM",
      problem_note: payload.note ?? null,
      problem_priority: payload.priority ?? null,
      problem_owner: payload.owner ?? null,
      problem_flagged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      const { data, error } = await supabase
        .from("loads")
        .update(full)
        .eq("id", loadId)
        .select(
          `
        *,
        driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
      `
        )
        .single();
      if (error) {
        if (
          String(error?.message || "").includes("column") ||
          error?.code === "42703"
        ) {
          const { data: data2, error: e2 } = await supabase
            .from("loads")
            .update({ status: "PROBLEM", updated_at: new Date().toISOString() })
            .eq("id", loadId)
            .select(
              `
              *,
              driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
            `
            )
            .single();
          if (e2) throw e2;
          setLoads((prev) =>
            prev.map((l) => (l.id === loadId ? data2 : l))
          );
        } else {
          throw error;
        }
      } else {
        setLoads((prev) => prev.map((l) => (l.id === loadId ? data : l)));
      }
    } catch (e) {
      alert(e?.message || "Failed to mark problem.");
    }
  }

  async function resolveProblem(loadId) {
    const basic = {
      status: "IN_TRANSIT",
      updated_at: new Date().toISOString(),
    };
    const full = {
      ...basic,
      problem_note: null,
      problem_priority: null,
      problem_owner: null,
      problem_flagged_at: null,
    };
    try {
      const { data, error } = await supabase
        .from("loads")
        .update(full)
        .eq("id", loadId)
        .select(
          `
        *,
        driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
      `
        )
        .single();
      if (error) {
        if (
          String(error?.message || "").includes("column") ||
          error?.code === "42703"
        ) {
          const { data: data2, error: e2 } = await supabase
            .from("loads")
            .update(basic)
            .eq("id", loadId)
            .select(
              `
              *,
              driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
            `
            )
            .single();
          if (e2) throw e2;
          setLoads((prev) =>
            prev.map((l) => (l.id === loadId ? data2 : l))
          );
        } else {
          throw error;
        }
      } else {
        setLoads((prev) => prev.map((l) => (l.id === loadId ? data : l)));
      }
    } catch (e) {
      alert(e?.message || "Failed to resolve problem.");
    }
  }

  async function openViewProblem(id) {
    const fresh = await refreshOne(id);
    setViewingProblemLoad(fresh || loads.find((l) => l.id === id) || null);
  }

  // Notes
  function openNotes(load) {
    setEditingNotesLoad(load);
  }
  function closeNotes() {
    setEditingNotesLoad(null);
  }
  async function saveNotes(loadId, notes) {
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({ notes: notes ?? null, updated_at: new Date().toISOString() })
        .eq("id", loadId)
        .select(
          `
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `
        )
        .single();
      if (error) {
        if (
          String(error?.message || "").includes("column") ||
          error?.code === "42703"
        ) {
          alert(
            "The 'notes' column doesn't exist yet. Run the migration to enable notes."
          );
          return;
        }
        throw error;
      }
      setLoads((prev) => prev.map((l) => (l.id === loadId ? data : l)));
    } catch (e) {
      alert(e?.message || "Failed to save notes.");
    }
  }

  // Driver assignment
  function openAssignDriver(load) {
    setAssigningDriverLoad(load);
  }
  function closeAssignDriver() {
    setAssigningDriverLoad(null);
  }

  /* ------------------------------ Render ------------------------------ */
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-full overflow-x-hidden">
      <div className="text-xs text-white/40 mb-2">
        Signed in as: {me.email || "unknown"}
      </div>

      {/* AI dispatch input */}
      <AiRecommendationsForLoad
        loadId={assigningDriverLoad?.id}
        originCity={assigningDriverLoad?.origin_city}
        originState={assigningDriverLoad?.origin_state}
        destCity={assigningDriverLoad?.dest_city}
        destState={assigningDriverLoad?.dest_state}
      />
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">Quick Load Creation</h2>
        <RCUploader
          onLoadCreated={(data) => {
            console.log("Load data ready:", data);
          }}
        />
      </div>

      {/* Learned AI lane memory suggestions (shows only when a load is selected for assigning) */}
      {loadIdForAI && <LearnedSuggestions loadId={loadIdForAI} />}

      {/* Search bar */}
      <div className="mb-4">
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search loads by reference, shipper, route, or driver..."
            className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-10 py-2.5 text-sm outline-none placeholder:text-white/40 focus:border-amber-500/50 focus:bg-white/10 transition-colors"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {searchTerm && (
          <div className="mt-2 text-xs text-white/60">
            Found {visibleRows.length} load
            {visibleRows.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 flex-shrink-0">
            <Ico as={ShieldCheck} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold">Loads</h1>
            <p className="text-xs sm:text-sm text-white/60">
              Create, track, and manage loads.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 focus:outline-none flex-shrink-0"
        >
          <Ico as={Plus} />
          Add Load
        </button>
      </div>

      {/* Problems toolbar */}
      <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
        <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs sm:text-sm flex-shrink-0">
          <input
            type="checkbox"
            className="accent-amber-500 flex-shrink-0"
            checked={showProblemsOnly}
            onChange={(e) => setShowProblemsOnly(e.target.checked)}
          />
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Ico as={Bug} />
            <span className="hidden sm:inline">Show problems only</span>
            <span className="sm:hidden">Problems only</span>
          </span>
        </label>

        <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-2 py-1 flex-shrink-0">
          <Ico as={Filter} className="opacity-70 flex-shrink-0" />
          <Select
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[{ label: "All priorities", value: "ALL" }, ...PRIORITY_CHOICES]}
          />
        </div>
      </div>

      {/* Body */}
      <div className="rounded-xl sm:rounded-2xl border border-white/10 w-full">
        {loading ? (
          <div className="grid place-items-center p-8 sm:p-16">
            <div className="inline-flex items-center gap-2 text-white/70">
              <Ico as={Loader2} className="animate-spin" />
              <span className="text-sm">Loading loads…</span>
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-4 sm:p-8">
            <div className="grid place-items-center rounded-xl sm:rounded-2xl border border-white/10 p-6 sm:p-10">
              <div className="flex max-w-xl flex-col items-center text-center">
                <div className="mb-3 inline-flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl bg-white/5">
                  <TruckGlyph />
                </div>
                <h2 className="text-base sm:text-lg font-semibold">
                  {searchTerm
                    ? "No matching loads found"
                    : priorityFilter !== "ALL" || showProblemsOnly
                    ? "No matching problem loads"
                    : "No loads yet"}
                </h2>
                <p className="mt-1 text-xs sm:text-sm text:white/60">
                  {searchTerm
                    ? "Try adjusting your search terms."
                    : priorityFilter !== "ALL" || showProblemsOnly
                    ? "Adjust filters or priority to see more."
                    : "Create your first load to get started."}
                </p>
                {!searchTerm &&
                  priorityFilter === "ALL" &&
                  !showProblemsOnly && (
                    <button
                      onClick={() => setIsAddOpen(true)}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400"
                    >
                      <Ico as={Plus} />
                      Add Load
                    </button>
                  )}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table view - with horizontal scroll container */}
            <div className="hidden lg:block w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left">
                    <Th className="whitespace-nowrap">Load #</Th>
                    <Th className="whitespace-nowrap">Driver</Th>
                    <Th className="whitespace-nowrap">Route</Th>
                    <Th className="whitespace-nowrap">Dates</Th>
                    <Th className="whitespace-nowrap">Rate</Th>
                    <Th className="whitespace-nowrap">Status</Th>
                    <Th className="whitespace-nowrap text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((l) => {
                    const billingReady = !!l.billing_ready;

                    return (
                      <tr
                        key={l.id}
                        className="border-t border-white/10 hover:bg-white/5"
                      >
                        <Td className="whitespace-nowrap">
                          {l.id ? (
                            <Link
                              to={`/loads/${l.id}`}
                              className="text-emerald-400 hover:underline font-medium"
                            >
                              {l.reference || "—"}
                            </Link>
                          ) : (
                            l.reference || "—"
                          )}
                          <div className="text-xs text-white/50 mt-0.5 truncate max-w-[120px]">
                            {l.shipper || "—"}
                          </div>
                        </Td>

                        <Td>
                          {l.driver ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs text-sky-300 whitespace-nowrap">
                                <Ico as={UserCheck} />
                                <span className="truncate max-w-[100px]">
                                  {l.driver.last_name}, {l.driver.first_name}
                                </span>
                              </span>

                              {/* Live global fit pill */}
                              <DriverFitPill driverId={l.driver.id} />

                              {/* Local fit badge */}
                              <FitBadge load={l} />

                              <ThumbButtons
                                load={l}
                                onFeedback={(accepted) =>
                                  leaveFeedback(l, accepted)
                                }
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-white/40">—</span>
                          )}
                        </Td>

                        <Td>
                          <div className="space-y-0.5 max-w-[180px]">
                            <div className="text-xs">
                              <span className="text-white/60">From: </span>
                              <span className="font-medium truncate block">
                                {l.origin || "—"}
                              </span>
                            </div>
                            <div className="text-xs">
                              <span className="text-white/60">To: </span>
                              <span className="font-medium truncate block">
                                {l.destination || "—"}
                              </span>
                            </div>
                          </div>
                        </Td>

                        <Td>
                          <div className="space-y-0.5">
                            {l.pickup_date ? (
                              <div className="text-xs">
                                <div className="text-white/60">Pickup:</div>
                                <div className="font-medium">
                                  {new Date(
                                    l.pickup_date
                                  ).toLocaleDateString()}
                                </div>
                              </div>
                            ) : null}
                            {l.delivery_date ? (
                              <div className="text-xs">
                                <div className="text-white/60">Delivery:</div>
                                <div className="font-medium">
                                  {new Date(
                                    l.delivery_date
                                  ).toLocaleDateString()}
                                </div>
                              </div>
                            ) : null}
                            {!l.pickup_date && !l.delivery_date && (
                              <span className="text-xs text-white/40">—</span>
                            )}
                          </div>
                        </Td>

                        <Td>
                          {l.rate ? (
                            <span className="font-mono text-xs font-medium text-emerald-300 whitespace-nowrap">
                              $
                              {parseFloat(l.rate).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          ) : (
                            <span className="text-xs text-white/40">—</span>
                          )}
                        </Td>

                        <Td>
                          <StatusBadge value={l.status} />
                          {l.status === "PROBLEM" && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <PriorityBadge value={l.problem_priority} />
                              <span className="inline-flex items-center gap-1 text-xs text-white/70 whitespace-nowrap">
                                <Ico as={Clock} />
                                {since(l.problem_flagged_at || l.updated_at)}
                              </span>
                            </div>
                          )}
                        </Td>

                        <Td className="text-right">
                          <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                            {/* AI Buttons - Compact inline version */}
                            {!l.driver_id && (
                              <AutoAssignDriverButtonCompact
                                load={l}
                                onAssigned={async (updated) => {
                                  const fresh = await refreshOne(updated.id);
                                  if (fresh) {
                                    setLoads((prev) =>
                                      prev.map((row) =>
                                        row.id === fresh.id ? fresh : row
                                      )
                                    );
                                  }
                                }}
                              />
                            )}

                            <LoadPredictCell
                              loadId={l.id}
                              origin={l.origin}
                              destination={l.destination}
                              size="sm"
                            />

                            {l.status === "PROBLEM" ? (
                              <button
                                onClick={() => resolveProblem(l.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30 transition-colors whitespace-nowrap"
                              >
                                <Ico as={CheckCircle2} />
                                <span>Resolve</span>
                              </button>
                            ) : l.status === "IN_TRANSIT" ? (
                              <button
                                onClick={() => updateStatus(l.id, "DELIVERED")}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30 transition-colors whitespace-nowrap"
                              >
                                <Ico as={CheckCircle2} />
                                <span>Delivered</span>
                              </button>
                            ) : l.status === "DELIVERED" ? (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 text-xs text-emerald-400 whitespace-nowrap">
                                  <Ico as={CheckCircle2} />
                                  <span>Complete</span>
                                </span>
                                <button
                                  onClick={() => markReadyForBilling(l.id)}
                                  disabled={billingReady}
                                  className={cx(
                                    "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs whitespace-nowrap border",
                                    billingReady
                                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 cursor-default"
                                      : "bg-amber-500/20 border-amber-500/40 text-amber-200 hover:bg-amber-500/30 transition-colors"
                                  )}
                                  title={
                                    billingReady
                                      ? "Already in billing queue"
                                      : "Mark this load as ready for billing"
                                  }
                                >
                                  <Ico as={DollarSign} />
                                  <span>
                                    {billingReady
                                      ? "Billing Ready"
                                      : "Ready for Billing"}
                                  </span>
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setReportingLoad(l)}
                                className="inline-flex items-center gap-1 rounded-lg bg-red-500/20 border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/30 transition-colors whitespace-nowrap"
                              >
                                <Ico as={AlertTriangle} />
                                <span>Report</span>
                              </button>
                            )}

                            <IconButton
                              title={
                                l.driver_id ? "Change Driver" : "Assign Driver"
                              }
                              onClick={() => openAssignDriver(l)}
                            >
                              <Ico as={UserCheck} />
                            </IconButton>

                            <IconButton
                              title="View/Edit Notes"
                              onClick={() => openNotes(l)}
                            >
                              <Ico as={StickyNote} />
                            </IconButton>

                            <IconButton
                              title="Documents"
                              onClick={() => setDocsLoad(l)}
                            >
                              <Ico as={FileText} />
                            </IconButton>

                            <MoreActionsMenu
                              load={l}
                              onViewProblem={() => openViewProblem(l.id)}
                              onSetTransit={() =>
                                updateStatus(l.id, "IN_TRANSIT")
                              }
                              onDelete={() => deleteLoad(l.id)}
                              onEditLoad={() => setEditingLoad(l)}
                              onUnassign={() => unassignDriver(l.id)}
                            />
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="lg:hidden space-y-3 p-3">
              {visibleRows.map((l) => {
                const billingReady = !!l.billing_ready;

                return (
                  <div
                    key={l.id}
                    className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3"
                  >
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {l.id ? (
                          <Link
                            to={`/loads/${l.id}`}
                            className="text-emerald-400 hover:underline font-medium text-sm block truncate"
                          >
                            {l.reference || "—"}
                          </Link>
                        ) : (
                          <div className="text-sm font-medium truncate">
                            {l.reference || "—"}
                          </div>
                        )}
                        <div className="text-xs text-white/60 mt-0.5 truncate">
                          {l.shipper || "—"}
                        </div>
                      </div>
                      <StatusBadge value={l.status} />
                    </div>

                    {/* Driver info */}
                    {l.driver && (
                      <div className="flex flex-col gap-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs text-sky-300 w-fit">
                          <Ico as={UserCheck} />
                          <span className="truncate max-w-[200px]">
                            {l.driver.last_name}, {l.driver.first_name}
                          </span>
                        </span>

                        {/* Live global fit pill */}
                        <DriverFitPill driverId={l.driver.id} />

                        {/* Local fit badge */}
                        <FitBadge load={l} />

                        <ThumbButtons
                          load={l}
                          onFeedback={(accepted) => leaveFeedback(l, accepted)}
                        />
                      </div>
                    )}

                    {/* Route info */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="text-white/60">Origin</div>
                        <div className="font-medium truncate">
                          {l.origin || "—"}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-white/60">Destination</div>
                        <div className="font-medium truncate">
                          {l.destination || "—"}
                        </div>
                      </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-white/60">Pickup</div>
                        {l.pickup_date ? (
                          <div>
                            <div className="font-medium">
                              {new Date(
                                l.pickup_date
                              ).toLocaleDateString()}
                            </div>
                            {l.pickup_time && (
                              <div className="text-white/60">
                                {l.pickup_time}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-white/40">—</div>
                        )}
                      </div>
                      <div>
                        <div className="text-white/60">Delivery</div>
                        {l.delivery_date ? (
                          <div>
                            <div className="font-medium">
                              {new Date(
                                l.delivery_date
                              ).toLocaleDateString()}
                            </div>
                            {l.delivery_time && (
                              <div className="text-white/60">
                                {l.delivery_time}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-white/40">—</div>
                        )}
                      </div>
                    </div>

                    {/* Rate and problem info */}
                    <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                      <div>
                        {l.rate ? (
                          <span className="font-mono text-xs font-medium text-emerald-300">
                            $
                            {parseFloat(l.rate).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        ) : (
                          <span className="text-white/40">—</span>
                        )}
                      </div>
                      {l.status === "PROBLEM" && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <PriorityBadge value={l.problem_priority} />
                          <span className="inline-flex items-center gap-1 text-white/70 whitespace-nowrap">
                            <Ico as={Clock} />
                            {since(l.problem_flagged_at || l.updated_at)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* AI Buttons */}
                    <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
                      <div className="flex gap-2">
                        {!l.driver_id && (
                          <AutoAssignDriverButton
                            load={l}
                            size="sm"
                            className="flex-1"
                            onAssigned={async (updated) => {
                              const fresh = await refreshOne(updated.id);
                              if (fresh) {
                                setLoads((prev) =>
                                  prev.map((row) =>
                                    row.id === fresh.id ? fresh : row
                                  )
                                );
                              }
                            }}
                          />
                        )}
                        <LoadPredictCell
                          loadId={l.id}
                          origin={l.origin}
                          destination={l.destination}
                          size="sm"
                          className={!l.driver_id ? "" : "flex-1"}
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                      {l.status === "PROBLEM" ? (
                        <button
                          onClick={() => resolveProblem(l.id)}
                          className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                        >
                          <Ico as={CheckCircle2} />
                          <span>Resolve</span>
                        </button>
                      ) : l.status === "IN_TRANSIT" ? (
                        <button
                          onClick={() => updateStatus(l.id, "DELIVERED")}
                          className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                        >
                          <Ico as={CheckCircle2} />
                          <span>Delivered</span>
                        </button>
                      ) : l.status === "DELIVERED" ? (
                        <div className="flex flex-col sm:flex-row gap-2 w-full">
                          <span className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400">
                            <Ico as={CheckCircle2} />
                            <span>Complete</span>
                          </span>
                          <button
                            onClick={() => markReadyForBilling(l.id)}
                            disabled={billingReady}
                            className={cx(
                              "flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs border",
                              billingReady
                                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 cursor-default"
                                : "bg-amber-500/20 border-amber-500/40 text-amber-200 hover:bg-amber-500/30 transition-colors"
                            )}
                            title={
                              billingReady
                                ? "Already in billing queue"
                                : "Mark this load as ready for billing"
                            }
                          >
                            <Ico as={DollarSign} />
                            <span>
                              {billingReady
                                ? "Billing Ready"
                                : "Ready for Billing"}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReportingLoad(l)}
                          className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-500/20 border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/30 transition-colors"
                        >
                          <Ico as={AlertTriangle} />
                          <span>Report</span>
                        </button>
                      )}

                      <IconButton
                        title={l.driver_id ? "Change Driver" : "Assign Driver"}
                        onClick={() => openAssignDriver(l)}
                      >
                        <Ico as={UserCheck} />
                      </IconButton>

                      <IconButton
                        title="View/Edit Notes"
                        onClick={() => openNotes(l)}
                      >
                        <Ico as={StickyNote} />
                      </IconButton>

                      <IconButton
                        title="Documents"
                        onClick={() => setDocsLoad(l)}
                      >
                        <Ico as={FileText} />
                      </IconButton>

                      <MoreActionsMenu
                        load={l}
                        onViewProblem={() => openViewProblem(l.id)}
                        onSetTransit={() => updateStatus(l.id, "IN_TRANSIT")}
                        onDelete={() => deleteLoad(l.id)}
                        onEditLoad={() => setEditingLoad(l)}
                        onUnassign={() => unassignDriver(l.id)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Add Load modal */}
      {isAddOpen && (
        <AddLoadModal
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          onAdded={(row) => setLoads((prev) => [row, ...prev])}
        />
      )}

      {/* Edit Load modal */}
      {editingLoad && (
        <EditLoadModal
          load={editingLoad}
          onClose={() => setEditingLoad(null)}
          onSaved={(updated) => {
            if (updated?.id) {
              setLoads((prev) =>
                prev.map((l) => (l.id === updated.id ? updated : l))
              );
            }
            setEditingLoad(null);
          }}
        />
      )}

      {/* Assign Driver modal */}
      {!!assigningDriverLoad && (
        <AssignDriverModal
          load={assigningDriverLoad}
          onClose={() => setAssigningDriverLoad(null)}
          onAssigned={async (updatedLoad) => {
            const fresh = await refreshOne(updatedLoad.id);
            if (fresh) {
              setLoads((prev) =>
                prev.map((l) => (l.id === fresh.id ? fresh : l))
              );
            }
            setAssigningDriverLoad(null);
          }}
        />
      )}

      {/* Report Problem */}
      {!!reportingLoad && (
        <ReportProblemModal
          load={reportingLoad}
          me={me}
          onClose={() => setReportingLoad(null)}
          onSubmit={async ({ note, priority, owner }) => {
            await markProblem(reportingLoad.id, { note, priority, owner });
            setReportingLoad(null);
          }}
        />
      )}

      {/* View Problem (editable) */}
      {!!viewingProblemLoad && (
        <ViewProblemModal
          load={viewingProblemLoad}
          onClose={() => setViewingProblemLoad(null)}
          onResolve={async () => {
            await resolveProblem(viewingProblemLoad.id);
            setViewingProblemLoad(null);
          }}
          onSave={async ({ note, priority, owner }) => {
            try {
              const { data, error } = await supabase
                .from("loads")
                .update({
                  problem_note: note ?? null,
                  problem_priority: priority ?? null,
                  problem_owner: owner ?? null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", viewingProblemLoad.id)
                .select(
                  `
                  *,
                  driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
                `
                )
                .single();

              if (error) {
                if (
                  String(error?.message || "").includes("column") ||
                  error?.code === "42703"
                ) {
                  alert(
                    "Problem columns are missing. Run the migration to enable editing."
                  );
                  return;
                }
                throw error;
              }
              setLoads((prev) =>
                prev.map((l) => (l.id === data.id ? data : l))
              );
              setViewingProblemLoad(data);
            } catch (e) {
              alert(e?.message || "Failed to save problem details.");
            }
          }}
        />
      )}

      {/* Notes */}
      {!!editingNotesLoad && (
        <NotesModal
          load={editingNotesLoad}
          onClose={() => setEditingNotesLoad(null)}
          onSave={async (text) => {
            await saveNotes(editingNotesLoad.id, text);
            setEditingNotesLoad(null);
          }}
        />
      )}

      {/* Documents modal */}
      {!!docsLoad && (
        <DocumentsModal load={docsLoad} onClose={() => setDocsLoad(null)} />
      )}

      {/* Fetch error (non-blocking) */}
      {fetchError && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {fetchError}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Table Bits --------------------------- */
function Th({ children, className = "" }) {
  return (
    <th
      className={cx(
        "px-2 py-2 text-xs font-medium text-white/70",
        className
      )}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }) {
  return (
    <td className={cx("px-2 py-2 align-top", className)}>{children}</td>
  );
}

function StatusBadge({ value }) {
  const map = {
    AVAILABLE: "bg-white/10 text-white/70 border-white/20",
    IN_TRANSIT: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    DELIVERED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    CANCELLED: "bg-white/10 text-white/50 border-white/20",
    AT_RISK: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    PROBLEM: "bg-red-500/15 text-red-300 border-red-500/30",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs whitespace-nowrap",
        map[value] || "bg-white/10 text-white/70 border-white/20"
      )}
    >
      {value === "PROBLEM" ? <Ico as={AlertTriangle} /> : null}
      {value || "—"}
    </span>
  );
}

function PriorityBadge({ value }) {
  const map = {
    LOW: "bg-white/10 text-white/70 border-white/20",
    MEDIUM: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    HIGH: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    CRITICAL: "bg-red-500/15 text-red-300 border-red-500/30",
  };
  if (!value) return <span className="text-xs text-white/40">—</span>;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs whitespace-nowrap",
        map[value] || "bg-white/10 text-white/70 border-white/20"
      )}
    >
      {value}
    </span>
  );
}

/* --------------------------- More Actions Dropdown --------------------------- */
function MoreActionsMenu({
  load,
  onViewProblem,
  onSetTransit,
  onDelete,
  onEditLoad,
  onUnassign,
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <IconButton
        title="More actions"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Ico as={MoreVertical} />
      </IconButton>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-white/10 bg-[#0B0B0F] py-1 shadow-xl">
            <button
              onClick={() => {
                onEditLoad();
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/5"
            >
              <Ico as={Pencil} />
              Edit Load
            </button>

            {load.driver_id && (
              <button
                onClick={() => {
                  onUnassign && onUnassign();
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/5"
              >
                <Ico as={UserCheck} />
                Unassign Driver
              </button>
            )}

            {load.status === "PROBLEM" && (
              <button
                onClick={() => {
                  onViewProblem();
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/5"
              >
                <Ico as={Eye} />
                View Problem Details
              </button>
            )}
            {load.status !== "IN_TRANSIT" && load.status !== "DELIVERED" && (
              <button
                onClick={() => {
                  onSetTransit();
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/5"
              >
                <Ico as={Save} />
                Mark In Transit
              </button>
            )}
            <button
              onClick={() => {
                onDelete();
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"
            >
              <Ico as={Trash2} />
              Delete Load
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------- Reusable Select --------------------------- */
function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg border border-white/10 bg-transparent px-2 py-1 pr-7 text-xs outline-none"
      >
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            className="bg-[#0B0B0F] text-white"
          >
            {o.label}
          </option>
        ))}
      </select>
      <Ico
        as={ChevronDown}
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-60"
      />
    </div>
  );
}

/* ----------------------------- Misc SVG ----------------------------- */
function TruckGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="text-white/70">
      <path
        d="M3 16V7a1 1 0 0 1 1-1h9v10H3zm10 0h5l3-4h-4V7h-4v9zM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm9 0a2 2 0 1 1 .001-3.999A2 2 0 0 1 16 19z"
        fill="currentColor"
        fillOpacity="0.75"
      />
    </svg>
  );
}

/* ------------------------ Report Problem Modal ------------------------ */
function ReportProblemModal({ load, me, onClose, onSubmit }) {
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState("HIGH");
  const [owner, setOwner] = useState(me?.email || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!priority) {
      alert("Select a priority.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        note: note.trim() || null,
        priority,
        owner: owner.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4 my-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10 flex-shrink-0">
              <Ico as={AlertTriangle} className="text-red-300" />
            </div>
            <h3 className="text-base font-semibold truncate">
              Report Problem
            </h3>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <Ico as={X} />
          </IconButton>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-white/70">Load #</label>
              <input
                value={load?.reference || "—"}
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/70">Owner</label>
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="assignee@email.com"
                className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-white/70">
                Priority
              </label>
              <Select
                value={priority}
                onChange={setPriority}
                options={PRIORITY_CHOICES}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-white/70">
                Problem Note
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What happened? What do we need to do?"
                rows={4}
                className="w-full resize-y rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-red-400 disabled:opacity-60"
          >
            {saving ? (
              <Ico as={Loader2} className="animate-spin" />
            ) : (
              <Ico as={AlertTriangle} />
            )}
            Flag as Problem
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------ View Problem Modal (Editable) ------------------------- */
function ViewProblemModal({ load, onClose, onResolve, onSave }) {
  const [note, setNote] = useState(load?.problem_note || "");
  const [priority, setPriority] = useState(load?.problem_priority || "HIGH");
  const [owner, setOwner] = useState(load?.problem_owner || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        note: note.trim() || null,
        priority,
        owner: owner.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  const flagged = fmtDate(load?.problem_flagged_at) || "—";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4 my-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10 flex-shrink-0">
              <Ico as={Eye} className="text-red-300" />
            </div>
            <h3 className="text-base font-semibold truncate">
              Problem Details
            </h3>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <Ico as={X} />
          </IconButton>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 p-3">
            <div className="text-xs text-white/60 mb-1">Problem Note</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Add context for the team…"
              className="w-full resize-y rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 p-3">
              <div className="text-xs text-white/60 mb-1">Priority</div>
              <Select
                value={priority}
                onChange={setPriority}
                options={PRIORITY_CHOICES}
              />
            </div>
            <div className="rounded-xl border border-white/10 p-3 sm:col-span-1">
              <div className="text-xs text-white/60 mb-1">Owner</div>
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="assignee@email.com"
                className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
              />
            </div>
            <div className="rounded-xl border border-white/10 p-3 sm:col-span-1">
              <div className="text-xs text-white/60 mb-1">Flagged</div>
              <div className="text-sm font-medium break-words">
                {flagged}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-60"
          >
            {saving ? (
              <Ico as={Loader2} className="animate-spin" />
            ) : (
              <Ico as={Save} />
            )}
            Save
          </button>
          <button
            onClick={onResolve}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400"
          >
            <Ico as={CheckCircle2} />
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Notes Modal --------------------------- */
function NotesModal({ load, onClose, onSave }) {
  const [text, setText] = useState(load?.notes || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(text.trim() || null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4 my-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 flex-shrink-0">
              <Ico as={StickyNote} className="text-white/80" />
            </div>
            <h3 className="text-base font-semibold truncate">Load Notes</h3>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <Ico as={X} />
          </IconButton>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-white/70">
                Load #
              </label>
              <input
                value={load?.reference || "—"}
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/70">
                Updated
              </label>
              <input
                value={fmtDate(load?.updated_at || load?.created_at)}
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 truncate"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/70">Notes</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Anything relevant to this load…"
              rows={6}
              className="w-full resize-y rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-60"
          >
            {saving ? (
              <Ico as={Loader2} className="animate-spin" />
            ) : (
              <Ico as={Save} />
            )}
            Save Notes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Documents Modal --------------------------- */
function DocumentsModal({ load, onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4 my-8 max-h-[90vh] overflow-y-auto">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 flex-shrink-0">
              <Ico as={FileText} className="text-white/80" />
            </div>
            <h3 className="text-base font-semibold truncate">
              Documents —{" "}
              <span className="font-normal opacity-80">
                {load?.reference || load?.id}
              </span>
            </h3>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <Ico as={X} />
          </IconButton>
        </div>

        <div className="mt-2">
          <LoadDocuments loadId={load?.id} />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Fit Badge ----------------------------- */
function FitBadge({ load }) {
  const [state, setState] = useState({ status: "idle", text: "", title: "" });

  function pickState(s) {
    if (!s) return "";
    const m = String(s).match(/,\s*([A-Za-z]{2})\b/);
    if (m) return m[1].toUpperCase();
    const t = String(s).trim().split(/\s+/)[0];
    if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
    return "";
  }

  function toFitLoad(l) {
    return {
      origin_state: l.origin_state || pickState(l.origin),
      dest_state: l.dest_state || pickState(l.destination),
      equipment_type:
        l.equipment_type || l.trailer_type || l.equipment || null,
      miles: l.miles ?? null,
      lane_name: l.reference || undefined,
    };
  }

  async function calc() {
    if (!load?.driver?.id) return;
    try {
      setState({ status: "loading", text: "Calculating…", title: "" });
      const { data, error } = await supabase.rpc(
        "driver_preference_profile",
        { p_driver_id: load.driver.id }
      );
      if (error) throw error;

      const fit = fitLoadForDriver(data, toFitLoad(load));
      const t =
        fit.verdict === "excellent"
          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
          : fit.verdict === "good"
          ? "bg-sky-500/15 border-sky-500/30 text-sky-300"
          : fit.verdict === "ok"
          ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
          : "bg-red-500/15 border-red-500/30 text-red-300";

      const title = [
        `Score: ${fit.score} (${fit.verdict})`,
        ...fit.reasons.map((r) => `• ${r}`),
      ].join("\n");

      setState({
        status: "ready",
        text: `Fit: ${fit.score} · ${fit.verdict}`,
        title,
        theme: t,
      });
    } catch (e) {
      setState({
        status: "error",
        text: "Fit: n/a",
        title: e?.message || "Unable to compute fit",
      });
    }
  }

  if (!load?.driver?.id) return null;

  const base =
    state.status === "ready"
      ? state.theme
      : state.status === "loading"
      ? "bg-white/10 border-white/20 text-white/70"
      : state.status === "error"
      ? "bg-red-500/15 border-red-500/30 text-red-300"
      : "bg-white/10 border-white/20 text-white/60";

  return (
    <button
      type="button"
      onMouseEnter={() => state.status === "idle" && calc()}
      onClick={() => calc()}
      title={state.title || "Click to compute fit score"}
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
        "transition-colors whitespace-nowrap",
        base
      )}
    >
      {state.status === "loading" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
      ) : null}
      <span className="truncate">{state.text || "Fit: check"}</span>
    </button>
  );
}

/* ----------------------------- Thumb Buttons ----------------------------- */
function ThumbButtons({ load, onFeedback }) {
  if (!load?.driver?.id) return null;

  return (
    <div className="inline-flex items-center gap-1 mt-1">
      <button
        type="button"
        title="Good match (thumbs up)"
        onClick={() => onFeedback(true)}
        className="inline-flex items-center justify-center h-6 w-6 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 flex-shrink-0"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Poor match (thumbs down)"
        onClick={() => onFeedback(false)}
        className="inline-flex items-center justify-center h-6 w-6 rounded-md border border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25 flex-shrink-0"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
