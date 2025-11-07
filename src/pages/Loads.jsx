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
  FileText,            // for Documents button
} from "lucide-react";
import { supabase } from "../lib/supabase";
import AddLoadModal from "../components/AddLoadModal";
import AssignDriverModal from "../components/AssignDriverModal";
import EditLoadModal from "../components/EditLoadModal";
import LoadDocuments from "../components/LoadDocuments";
import { Link } from "react-router-dom";


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
function cx(...a) { return a.filter(Boolean).join(" "); }
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleString(); } catch { return String(d); } }
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
        "inline-flex items-center justify-center rounded-lg border",
        "h-8 w-8",
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

  useEffect(() => {
    let active = true;

    (async () => {
      // whoami for default owner
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user && active) setMe({ email: data.user.email || "", id: data.user.id });
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

    return () => { active = false; };
  }, []);

  // Freshen a single row (so modals show latest)
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

  // Filtering logic
  const visibleRows = useMemo(() => {
    let rows = loads;

    // Priority filter takes precedence: when set, show ONLY problem loads with that priority
    if (priorityFilter !== "ALL") {
      rows = rows.filter(
        (r) => r.status === "PROBLEM" && (r.problem_priority || "") === priorityFilter
      );
    } else if (showProblemsOnly) {
      rows = rows.filter((r) => r.status === "PROBLEM");
    }

    return rows;
  }, [loads, showProblemsOnly, priorityFilter]);

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
    } catch (e) {
      alert(e?.message || "Failed to update status.");
    }
  }

  // Problems workflow
  function openReport(load) { setReportingLoad(load); }
  function closeReport() { setReportingLoad(null); }

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
      const { data, error } = await supabase.from("loads").update(full).eq("id", loadId).select(`
        *,
        driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
      `).single();
      if (error) {
        // Retry minimal if optional cols missing
        if (String(error?.message || "").includes("column") || error?.code === "42703") {
          const { data: data2, error: e2 } = await supabase
            .from("loads")
            .update({ status: "PROBLEM", updated_at: new Date().toISOString() })
            .eq("id", loadId)
            .select(`
              *,
              driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
            `)
            .single();
          if (e2) throw e2;
          setLoads((prev) => prev.map((l) => (l.id === loadId ? data2 : l))); // fixed prev.id bug
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
    const basic = { status: "IN_TRANSIT", updated_at: new Date().toISOString() };
    const full = { ...basic, problem_note: null, problem_priority: null, problem_owner: null, problem_flagged_at: null };
    try {
      const { data, error } = await supabase.from("loads").update(full).eq("id", loadId).select(`
        *,
        driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
      `).single();
      if (error) {
        if (String(error?.message || "").includes("column") || error?.code === "42703") {
          const { data: data2, error: e2 } = await supabase
            .from("loads")
            .update(basic)
            .eq("id", loadId)
            .select(`
              *,
              driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
            `)
            .single();
          if (e2) throw e2;
          setLoads((prev) => prev.map((l) => (l.id === loadId ? data2 : l)));
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
  function openNotes(load) { setEditingNotesLoad(load); }
  function closeNotes() { setEditingNotesLoad(null); }
  async function saveNotes(loadId, notes) {
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({ notes: notes ?? null, updated_at: new Date().toISOString() })
        .eq("id", loadId)
        .select(`
          *,
          driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
        `)
        .single();
      if (error) {
        if (String(error?.message || "").includes("column") || error?.code === "42703") {
          alert("The 'notes' column doesn't exist yet. Run the migration to enable notes.");
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
  function openAssignDriver(load) { setAssigningDriverLoad(load); }
  function closeAssignDriver() { setAssigningDriverLoad(null); }

  /* ------------------------------ Render ------------------------------ */
  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5">
            <Ico as={ShieldCheck} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Loads</h1>
            <p className="text-sm text-white/60">Create, track, and manage loads.</p>
          </div>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 focus:outline-none"
        >
          <Ico as={Plus} />
          Add Load
        </button>
      </div>

      {/* Problems toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="accent-amber-500"
            checked={showProblemsOnly}
            onChange={(e) => setShowProblemsOnly(e.target.checked)}
          />
          <span className="inline-flex items-center gap-1">
            <Ico as={Bug} />
            Show problems only
          </span>
        </label>

        <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-2 py-1">
          <Ico as={Filter} className="opacity-70" />
          <Select
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[{ label: "All priorities", value: "ALL" }, ...PRIORITY_CHOICES]}
          />
        </div>
      </div>

      {/* Body */}
      <div className="rounded-2xl border border-white/10">
        {loading ? (
          <div className="grid place-items-center p-16">
            <div className="inline-flex items-center gap-2 text-white/70">
              <Ico as={Loader2} className="animate-spin" />
              <span>Loading loads…</span>
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-8">
            <div className="grid place-items-center rounded-2xl border border-white/10 p-10">
              <div className="flex max-w-xl flex-col items-center text-center">
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
                  <TruckGlyph />
                </div>
                <h2 className="text-lg font-semibold">
                  {priorityFilter !== "ALL" || showProblemsOnly ? "No matching problem loads" : "No loads yet"}
                </h2>
                <p className="mt-1 text-sm text-white/60">
                  {priorityFilter !== "ALL" || showProblemsOnly
                    ? "Adjust filters or priority to see more."
                    : "Create your first load to get started."}
                </p>
                {priorityFilter === "ALL" && !showProblemsOnly && (
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
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-left">
                  <Th>Load #</Th>
                  <Th>Shipper</Th>
                  <Th>Driver</Th>
                  <Th>Origin</Th>
                  <Th>Destination</Th>
                  <Th>Pickup</Th>
                  <Th>Delivery</Th>
                  <Th>Rate</Th>
                  <Th>Status</Th>
                  <Th>Problem</Th>
                  <Th>Updated</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((l) => (
                  <tr key={l.id} className="border-t border-white/10 hover:bg-white/5">
                    {/* 🔗 Only change: make Load # a link to /loads/:id */}
                    <Td>
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
                    </Td>

                    <Td>{l.shipper || "—"}</Td>
                    <Td>
                      {l.driver ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs text-sky-300">
                          <Ico as={UserCheck} />
                          {l.driver.last_name}, {l.driver.first_name}
                        </span>
                      ) : (
                        <span className="text-xs text-white/40">—</span>
                      )}
                    </Td>
                    <Td>{l.origin || "—"}</Td>
                    <Td>{l.destination || "—"}</Td>
                    <Td>
                      {l.pickup_date ? (
                        <div className="text-xs">
                          <div className="font-medium">{new Date(l.pickup_date).toLocaleDateString()}</div>
                          {l.pickup_time && <div className="text-white/60">{l.pickup_time}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-white/40">—</span>
                      )}
                    </Td>
                    <Td>
                      {l.delivery_date ? (
                        <div className="text-xs">
                          <div className="font-medium">{new Date(l.delivery_date).toLocaleDateString()}</div>
                          {l.delivery_time && <div className="text-white/60">{l.delivery_time}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-white/40">—</span>
                      )}
                    </Td>
                    <Td>
                      {l.rate ? (
                        <span className="font-mono text-xs font-medium text-emerald-300">
                          ${parseFloat(l.rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-xs text-white/40">—</span>
                      )}
                    </Td>
                    <Td><StatusBadge value={l.status} /></Td>
                    <Td>
                      {l.status === "PROBLEM" ? (
                        <div className="flex items-center gap-2">
                          <PriorityBadge value={l.problem_priority} />
                          <span className="inline-flex items-center gap-1 text-xs text-white/70">
                            <Ico as={Clock} />
                            {since(l.problem_flagged_at || l.updated_at)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-white/40">—</span>
                      )}
                    </Td>
                    <Td>{fmtDate(l.updated_at || l.created_at)}</Td>
                    <Td className="text-right">
                      <div className="inline-flex items-center gap-2">
                        {/* Primary action - prominent button */}
                        {l.status === "PROBLEM" ? (
                          <button
                            onClick={() => resolveProblem(l.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                          >
                            <Ico as={CheckCircle2} />
                            <span>Resolve</span>
                          </button>
                        ) : l.status === "IN_TRANSIT" ? (
                          <button
                            onClick={() => updateStatus(l.id, "DELIVERED")}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                          >
                            <Ico as={CheckCircle2} />
                            <span>Delivered</span>
                          </button>
                        ) : l.status === "DELIVERED" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400">
                            <Ico as={CheckCircle2} />
                            <span>Complete</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => setReportingLoad(l)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/30 transition-colors"
                          >
                            <Ico as={AlertTriangle} />
                            <span>Report</span>
                          </button>
                        )}

                        {/* Driver - icon button */}
                        <IconButton
                          title={l.driver_id ? "Change Driver" : "Assign Driver"}
                          onClick={() => openAssignDriver(l)}
                        >
                          <Ico as={UserCheck} />
                        </IconButton>

                        {/* Notes - icon button */}
                        <IconButton
                          title="View/Edit Notes"
                          onClick={() => openNotes(l)}
                        >
                          <Ico as={StickyNote} />
                        </IconButton>

                        {/* Documents - icon button */}
                        <IconButton
                          title="Documents"
                          onClick={() => setDocsLoad(l)}
                        >
                          <Ico as={FileText} />
                        </IconButton>

                        {/* More actions - dropdown menu */}
                        <MoreActionsMenu
                          load={l}
                          onViewProblem={() => openViewProblem(l.id)}
                          onSetTransit={() => updateStatus(l.id, "IN_TRANSIT")}
                          onDelete={() => deleteLoad(l.id)}
                          onEditLoad={() => setEditingLoad(l)}
                        />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Load modal */}
      {isAddOpen && (
        <AddLoadModal
          onClose={() => setIsAddOpen(false)}
          onAdded={(row) => setLoads((prev) => [row, ...prev])}
        />
      )}

      {/* Edit Load modal */}
      {!!editingLoad && (
        <EditLoadModal
          load={editingLoad}
          onClose={() => setEditingLoad(null)}
          onUpdated={async (updatedLoad) => {
            // ensure embedded driver is hydrated
            const fresh = await refreshOne(updatedLoad.id);
            if (fresh) {
              setLoads((prev) => prev.map((l) => (l.id === fresh.id ? fresh : l)));
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
            // updatedLoad may not include embedded driver; refresh to hydrate
            const fresh = await refreshOne(updatedLoad.id);
            if (fresh) {
              setLoads((prev) => prev.map((l) => (l.id === fresh.id ? fresh : l)));
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
                .select(`
                  *,
                  driver:drivers!loads_driver_id_fkey(id, first_name, last_name)
                `)
                .single();

              if (error) {
                if (String(error?.message || "").includes("column") || error?.code === "42703") {
                  alert("Problem columns are missing. Run the migration to enable editing.");
                  return;
                }
                throw error;
              }
              setLoads((prev) => prev.map((l) => (l.id === data.id ? data : l)));
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
        <DocumentsModal
          load={docsLoad}
          onClose={() => setDocsLoad(null)}
        />
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
  return <th className={cx("px-4 py-3 text-xs font-medium text-white/70", className)}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={cx("px-4 py-3 align-top", className)}>{children}</td>;
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
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs",
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
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs",
        map[value] || "bg-white/10 text-white/70 border-white/20"
      )}
    >
      {value}
    </span>
  );
}

/* --------------------------- More Actions Dropdown --------------------------- */
function MoreActionsMenu({ load, onViewProblem, onSetTransit, onDelete, onEditLoad }) {
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
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown menu */}
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
        className="appearance-none rounded-lg border border-white/10 bg-transparent px-3 py-1.5 pr-8 text-sm outline-none"
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
      <Ico as={ChevronDown} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
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
    if (!priority) { alert("Select a priority."); return; }
    setSaving(true);
    try {
      await onSubmit({ note: note.trim() || null, priority, owner: owner.trim() || null });
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10">
              <Ico as={AlertTriangle} className="text-red-300" />
            </div>
            <h3 className="text-base font-semibold">Report Problem</h3>
          </div>
          <IconButton title="Close" onClick={onClose}><Ico as={X} /></IconButton>
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
              <label className="mb-1 block text-xs text-white/70">Priority</label>
              <Select value={priority} onChange={setPriority} options={PRIORITY_CHOICES} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-white/70">Problem Note</label>
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

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-red-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-red-400 disabled:opacity-60"
          >
            {saving ? <Ico as={Loader2} className="animate-spin" /> : <Ico as={AlertTriangle} />}
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
    try { await onSave({ note: note.trim() || null, priority, owner: owner.trim() || null }); }
    finally { setSaving(false); }
  }

  const flagged = fmtDate(load?.problem_flagged_at) || "—";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10">
              <Ico as={Eye} className="text-red-300" />
            </div>
            <h3 className="text-base font-semibold">Problem Details</h3>
          </div>
          <IconButton title="Close" onClick={onClose}><Ico as={X} /></IconButton>
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
              <Select value={priority} onChange={setPriority} options={PRIORITY_CHOICES} />
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
              <div className="text-sm font-medium">{flagged}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-60"
          >
            {saving ? <Ico as={Loader2} className="animate-spin" /> : <Ico as={Save} />}
            Save
          </button>
          <button
            onClick={onResolve}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400"
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
    try { await onSave(text.trim() || null); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10">
              <Ico as={StickyNote} className="text-white/80" />
            </div>
            <h3 className="text-base font-semibold">Load Notes</h3>
          </div>
          <IconButton title="Close" onClick={onClose}><Ico as={X} /></IconButton>
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
              <label className="mb-1 block text-xs text-white/70">Updated</label>
              <input
                value={fmtDate(load?.updated_at || load?.created_at)}
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70"
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

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-60"
          >
            {saving ? <Ico as={Loader2} className="animate-spin" /> : <Ico as={Save} />}
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
    <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[var(--bg-base,#0B0B0F)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10">
              <Ico as={FileText} className="text-white/80" />
            </div>
            <h3 className="text-base font-semibold">
              Documents — <span className="font-normal opacity-80">{load?.reference || load?.id}</span>
            </h3>
          </div>
          <IconButton title="Close" onClick={onClose}><Ico as={X} /></IconButton>
        </div>

        {/* LoadDocuments embedded */}
        <div className="mt-2">
          <LoadDocuments loadId={load?.id} />
        </div>
      </div>
    </div>
  );
}
