// src/pages/Loads.jsx
import { useEffect, useState } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  X,
  ChevronDown,
  Pencil,
  StickyNote,
  AlertTriangle,
  FileText, // 🆕
} from "lucide-react";
import { Link } from "react-router-dom"; // 🆕
import { supabase } from "../lib/supabase";
import AddLoadModal from "../components/AddLoadModal";

/** MUST match DB enum/check */
const STATUS_CHOICES = [
  { label: "Available", value: "AVAILABLE" },
  { label: "In Transit", value: "IN_TRANSIT" },
  { label: "Delivered", value: "DELIVERED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "At Risk", value: "AT_RISK" },
  { label: "Problem", value: "PROBLEM" },
];

const EQUIPMENT_OPTIONS = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Conestoga",
  "Power Only",
  "Hotshot",
  "Tanker",
  "Other",
];

function fromLocalInputValue(s) {
  if (!s) return null;
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

function toLocalInputValue(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
}

export default function Loads() {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);

  // notes column presence
  const [notesMissing, setNotesMissing] = useState(false);

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastErr, setLastErr] = useState("");

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedLoad, setSelectedLoad] = useState(null);

  // Inline status
  const [updatingId, setUpdatingId] = useState(null);

  // Notes modal (quick edit)
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesLoad, setNotesLoad] = useState(null);
  const [notesText, setNotesText] = useState("");

  // Full Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editLoad, setEditLoad] = useState({
    id: "",
    reference: "",
    shipper: "",
    origin: "",
    destination: "",
    status: "AVAILABLE",
    rate: "",
    pickup_local: "",
    delivery_local: "",
    notes: "",
    equipment_type: "",
  });

  // Add form
  const [newLoad, setNewLoad] = useState({
    reference: "",
    shipper: "",
    origin: "",
    destination: "",
    status: "AVAILABLE",
    rate: "",
    pickup_local: "",
    delivery_local: "",
    equipment_type: "",
  });

  useEffect(() => {
    fetchLoads();
  }, []);

  async function fetchLoads() {
    try {
      setLoading(true);
      setNotesMissing(false);

      const baseCols =
        "id, reference, shipper, origin, destination, status, rate, pickup_at, delivery_at, created_at, equipment_type";
      let { data, error } = await supabase
        .from("loads")
        .select(`${baseCols}, notes`)
        .order("created_at", { ascending: false });

      if (error) {
        // missing column -> retry without it
        if (
          String(error.code || "").includes("42703") ||
          /column .*notes.* does not exist/i.test(error.message || "")
        ) {
          setNotesMissing(true);
          const retry = await supabase
            .from("loads")
            .select(baseCols)
            .order("created_at", { ascending: false });
          if (retry.error) throw retry.error;
          data = retry.data;
        } else {
          throw error;
        }
      }
      setLoads(data || []);
    } catch (err) {
      console.error("[Loads] fetch error:", err);
      setLoads([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddLoad(e) {
    e.preventDefault();
    setLastErr("");

    if (!newLoad.shipper || !newLoad.origin || !newLoad.destination) {
      alert("Please fill shipper, origin, and destination.");
      return;
    }

    if (!newLoad.equipment_type) {
      alert("Please select an equipment type.");
      return;
    }

    const rateNumber =
      newLoad.rate === "" || newLoad.rate === null ? 0 : Number(newLoad.rate);
    if (Number.isNaN(rateNumber) || rateNumber < 0) {
      alert("Rate must be a non-negative number.");
      return;
    }

    const payload = {
      reference: newLoad.reference?.trim() || null,
      shipper: newLoad.shipper.trim(),
      origin: newLoad.origin.trim(),
      destination: newLoad.destination.trim(),
      status: newLoad.status,
      rate: rateNumber,
      pickup_at: fromLocalInputValue(newLoad.pickup_local),
      delivery_at: fromLocalInputValue(newLoad.delivery_local),
      equipment_type: newLoad.equipment_type,
    };

    setSubmitting(true);
    try {
      const selectCols = notesMissing
        ? "id, reference, shipper, origin, destination, status, rate, pickup_at, delivery_at, created_at, equipment_type"
        : "id, reference, shipper, origin, destination, status, rate, pickup_at, delivery_at, notes, created_at, equipment_type";
      const { data, error } = await supabase
        .from("loads")
        .insert([payload])
        .select(selectCols);

      if (error) throw error;
      if (data?.length) setLoads((prev) => [data[0], ...prev]);
      setShowAddModal(false);
      setNewLoad({
        reference: "",
        shipper: "",
        origin: "",
        destination: "",
        status: "AVAILABLE",
        rate: "",
        pickup_local: "",
        delivery_local: "",
        equipment_type: "",
      });
    } catch (err) {
      console.error("[Loads] add error:", err);
      const details =
        err?.message ||
        err?.hint ||
        err?.details ||
        (typeof err === "object" ? JSON.stringify(err) : String(err)) ||
        "Insert failed.";
      setLastErr(details);
      alert(details);
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleteClick(load) {
    setSelectedLoad(load);
    setShowDeleteModal(true);
  }

  async function handleDeleteLoad() {
    if (!selectedLoad) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("loads")
        .delete()
        .eq("id", selectedLoad.id);
      if (error) throw error;
      setLoads((prev) => prev.filter((l) => l.id !== selectedLoad.id));
      setShowDeleteModal(false);
      setSelectedLoad(null);
    } catch (err) {
      console.error("[Loads] delete error:", err);
      alert(err?.message || "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleStatusChange(id, newStatus) {
    setUpdatingId(id);
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({ status: String(newStatus).toUpperCase() })
        .eq("id", id)
        .select("id, status");
      if (error) throw error;
      if (data?.length) {
        setLoads((prev) =>
          prev.map((l) => (l.id === id ? { ...l, status: data[0].status } : l))
        );
      }
    } catch (err) {
      console.error("[Loads] status update error:", err);
      alert(err?.message || "Failed to update status.");
    } finally {
      setUpdatingId(null);
    }
  }

  // Quick notes modal
  function openNotes(load) {
    if (notesMissing) {
      alert(
        "Notes column is not in the database yet.\n\nRun this in Supabase SQL:\n\nALTER TABLE loads ADD COLUMN notes text;"
      );
      return;
    }
    setNotesLoad({ id: load.id });
    setNotesText(load.notes || "");
    setShowNotesModal(true);
  }

  function closeNotes() {
    setShowNotesModal(false);
    setNotesLoad(null);
    setNotesText("");
    setNotesSaving(false);
  }

  async function saveNotes() {
    if (!notesLoad?.id) return;
    setNotesSaving(true);
    try {
      const { data, error } = await supabase
        .from("loads")
        .update({ notes: notesText })
        .eq("id", notesLoad.id)
        .select("id, notes");
      if (error) throw error;
      if (data?.length) {
        setLoads((prev) =>
          prev.map((l) => (l.id === notesLoad.id ? { ...l, notes: data[0].notes } : l))
        );
      }
      closeNotes();
    } catch (err) {
      console.error("[Loads] save notes error:", err);
      alert(err?.message || "Failed to save notes.");
      setNotesSaving(false);
    }
  }

  // Full edit modal
  function openEdit(load) {
    setEditLoad({
      id: load.id,
      reference: load.reference || "",
      shipper: load.shipper || "",
      origin: load.origin || "",
      destination: load.destination || "",
      status: (load.status || "AVAILABLE").toUpperCase(),
      rate: load.rate?.toString?.() ?? String(load.rate ?? ""),
      pickup_local: toLocalInputValue(load.pickup_at),
      delivery_local: toLocalInputValue(load.delivery_at),
      notes: notesMissing ? "" : load.notes || "",
      equipment_type: load.equipment_type || "",
    });
    setShowEditModal(true);
  }

  function closeEdit() {
    setShowEditModal(false);
    setEditSaving(false);
    setEditLoad({
      id: "",
      reference: "",
      shipper: "",
      origin: "",
      destination: "",
      status: "AVAILABLE",
      rate: "",
      pickup_local: "",
      delivery_local: "",
      notes: "",
      equipment_type: "",
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editLoad.id) return;

    if (!editLoad.shipper || !editLoad.origin || !editLoad.destination) {
      alert("Please fill shipper, origin, and destination.");
      return;
    }
    if (!editLoad.equipment_type) {
      alert("Please select an equipment type.");
      return;
    }
    const rateNumber =
      editLoad.rate === "" || editLoad.rate === null ? 0 : Number(editLoad.rate);
    if (Number.isNaN(rateNumber) || rateNumber < 0) {
      alert("Rate must be a non-negative number.");
      return;
    }

    const payload = {
      reference: editLoad.reference?.trim() || null,
      shipper: editLoad.shipper.trim(),
      origin: editLoad.origin.trim(),
      destination: editLoad.destination.trim(),
      status: String(editLoad.status).toUpperCase(),
      rate: rateNumber,
      pickup_at: fromLocalInputValue(editLoad.pickup_local),
      delivery_at: fromLocalInputValue(editLoad.delivery_local),
      equipment_type: editLoad.equipment_type,
      ...(notesMissing ? {} : { notes: editLoad.notes }),
    };

    setEditSaving(true);
    try {
      const { data, error } = await supabase
        .from("loads")
        .update(payload)
        .eq("id", editLoad.id)
        .select(
          notesMissing
            ? "id, reference, shipper, origin, destination, status, rate, pickup_at, delivery_at, created_at, equipment_type"
            : "id, reference, shipper, origin, destination, status, rate, pickup_at, delivery_at, notes, created_at, equipment_type"
        );
      if (error) throw error;

      if (data?.length) {
        const updated = data[0];
        setLoads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      }
      closeEdit();
    } catch (err) {
      console.error("[Loads] save edit error:", err);
      alert(err?.message || "Failed to update load.");
      setEditSaving(false);
    }
  }

  return (
    <div className="relative min-h-screen p-6 text-gray-200">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-6 mb-6 border-b border-gray-800 bg-[#0f131a]/80 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
        <div className="mx-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Loads</h1>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-4 py-2 rounded-lg shadow-md transition focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <Plus size={18} />
            Add Load
          </button>
        </div>
      </div>

      {/* Soft warning if 'notes' column missing */}
      {notesMissing && (
        <div className="mb-4 rounded-xl border border-amber-600/40 bg-amber-500/10 p-3 text-amber-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">Notes column not found.</div>
            <div className="opacity-90">
              Add it to enable per-load notes:
              <code className="ml-2 whitespace-pre rounded bg-black/30 px-2 py-1">
                ALTER TABLE loads ADD COLUMN notes text;
              </code>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowAddModal(true)}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center justify-center rounded-full p-4 shadow-lg bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        title="Add Load"
        aria-label="Add Load"
      >
        <Plus className="w-5 h-5 text-white" />
      </button>

      {/* List */}
      {loading ? (
        <div className="flex justify-center items-center h-40 text-gray-400">
          <Loader2 className="animate-spin mr-2" /> Loading...
        </div>
      ) : loads.length === 0 ? (
        <div className="text-center text-gray-400">
          <p className="mb-4">No loads available.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-md transition"
          >
            <Plus size={18} />
            Add Your First Load
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {loads.map((load) => (
            <div
              key={load.id}
              className="bg-[#171c26] border border-gray-700 rounded-xl p-4 flex flex-wrap md:flex-nowrap gap-4 md:gap-6 items-center hover:border-gray-600 transition-colors"
            >
              <div className="flex-1 min-w-[260px]">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-white">
                    {load.reference || "No Reference"} — {load.shipper}
                  </p>

                  {/* Edit whole load */}
                  <button
                    onClick={() => openEdit(load)}
                    className="p-1 rounded hover:bg-gray-700 transition-colors"
                    title="Edit load"
                  >
                    <Pencil className="w-4 h-4 text-gray-300 hover:text-blue-400" />
                  </button>

                  {/* Quick notes */}
                  {!notesMissing && (
                    <button
                      onClick={() => openNotes(load)}
                      className="p-1 rounded hover:bg-gray-700 transition-colors"
                      title="Edit notes"
                    >
                      <StickyNote className="w-4 h-4 text-gray-300 hover:text-blue-400" />
                    </button>
                  )}
                </div>

                <p className="text-sm text-gray-400">
                  {load.origin} → {load.destination}
                </p>

                {load.equipment_type && (
                  <p className="text-[11px] text-blue-400 mt-1">
                    Equipment: {load.equipment_type}
                  </p>
                )}

                {(load.pickup_at || load.delivery_at) && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    {load.pickup_at && <>PU: {new Date(load.pickup_at).toLocaleString()} </>}
                    {load.delivery_at && <>• DEL: {new Date(load.delivery_at).toLocaleString()}</>}
                  </p>
                )}

                {!notesMissing &&
                  (load.notes ? (
                    <p className="text-[12px] text-gray-300 mt-2 line-clamp-2">
                      <span className="opacity-70">Notes: </span>
                      {load.notes}
                    </p>
                  ) : (
                    <p className="text-[12px] text-gray-500 mt-2 italic">
                      No notes yet — use the 🗒️ button.
                    </p>
                  ))}
              </div>

              {/* Inline status + actions */}
              <div className="flex items-center gap-2 ml-auto">
                <div className="relative">
                  <select
                    value={load.status}
                    onChange={(e) => handleStatusChange(load.id, e.target.value)}
                    className="appearance-none pr-7 bg-gray-800 text-gray-100 rounded-lg px-3 py-2 text-sm border border-gray-700"
                    title="Update status"
                    disabled={updatingId === load.id}
                  >
                    {STATUS_CHOICES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                </div>

                {updatingId === load.id && (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" title="Saving..." />
                )}
                
                <button
                  onClick={() => handleDeleteClick(load)}
                  className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                  title="Delete Load"
                >
                  <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={(e) => {
            // Close modal if clicking on backdrop
            if (e.target === e.currentTarget) {
              setShowAddModal(false);
            }
          }}
        >
          <div className="bg-[#171c26] rounded-2xl p-6 w-full max-w-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Add New Load</h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setLastErr("");
                }}
                className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddLoad} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextInput
                  label="Reference (optional)"
                  value={newLoad.reference}
                  onChange={(v) => setNewLoad((s) => ({ ...s, reference: v }))}
                />
                <TextInput
                  label="Shipper *"
                  value={newLoad.shipper}
                  onChange={(v) => setNewLoad((s) => ({ ...s, shipper: v }))}
                  required
                />
                <TextInput
                  label="Origin *"
                  placeholder="City, ST or address"
                  value={newLoad.origin}
                  onChange={(v) => setNewLoad((s) => ({ ...s, origin: v }))}
                  required
                />
                <TextInput
                  label="Destination *"
                  placeholder="City, ST or address"
                  value={newLoad.destination}
                  onChange={(v) => setNewLoad((s) => ({ ...s, destination: v }))}
                  required
                />

                <SelectInput
                  label="Status *"
                  value={newLoad.status}
                  onChange={(v) => setNewLoad((s) => ({ ...s, status: v }))}
                  options={STATUS_CHOICES}
                />
                <div>
                  <label className="block text-sm text-gray-400">Equipment Type *</label>
                  <div className="relative">
                    <select
                      value={newLoad.equipment_type}
                      onChange={(e) => setNewLoad((s) => ({ ...s, equipment_type: e.target.value }))}
                      required
                      className="appearance-none pr-7 w-full bg-gray-800 text-white rounded-lg p-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700"
                    >
                      <option value="">Select type</option>
                      {EQUIPMENT_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-[22px] h-4 w-4 text-gray-400" />
                  </div>
                </div>
                <NumberInput
                  label="Rate ($)"
                  value={newLoad.rate}
                  onChange={(v) => setNewLoad((s) => ({ ...s, rate: v }))}
                />

                <DateTimeInput
                  label="Pickup (PU)"
                  value={newLoad.pickup_local}
                  onChange={(v) => setNewLoad((s) => ({ ...s, pickup_local: v }))}
                />
                <DateTimeInput
                  label="Delivery (DEL)"
                  value={newLoad.delivery_local}
                  onChange={(v) => setNewLoad((s) => ({ ...s, delivery_local: v }))}
                />
              </div>

              {lastErr && (
                <div className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2">
                  {lastErr}
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setLastErr("");
                  }}
                  className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-white disabled:opacity-60 transition-colors flex items-center gap-2"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> 
                      <span>Saving…</span>
                    </>
                  ) : (
                    "Save Load"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && selectedLoad && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#171c26] rounded-2xl p-6 w-full max-w-md border border-gray-700">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-900/30 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold mb-2">Delete Load</h2>
                <p className="text-gray-400 mb-4">
                  Are you sure you want to delete this load? This action cannot be undone.
                </p>
                <div className="bg-gray-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-white font-medium">
                    {selectedLoad.reference || "No Reference"} — {selectedLoad.shipper}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {selectedLoad.origin} → {selectedLoad.destination}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedLoad(null);
                }}
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteLoad}
                className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-white disabled:opacity-60 transition-colors"
                disabled={deleting}
              >
                {deleting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Deleting…
                  </span>
                ) : (
                  "Delete Load"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#171c26] rounded-2xl p-6 w-full max-w-lg border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Load Notes</h2>
              <button
                onClick={closeNotes}
                className="p-1 rounded hover:bg-gray-700 transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              rows={8}
              className="w-full bg-gray-800 text-white rounded-lg p-3 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Driver updates, customer notes, reference numbers, etc."
            />

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={closeNotes}
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
                disabled={notesSaving}
              >
                Cancel
              </button>
              <button
                onClick={saveNotes}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-white disabled:opacity-60 transition-colors"
                disabled={notesSaving}
              >
                {notesSaving ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                  </span>
                ) : (
                  "Save Notes"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#171c26] rounded-2xl p-6 w-full max-w-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Edit Load</h2>
              <button
                onClick={closeEdit}
                className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextInput
                  label="Reference (optional)"
                  value={editLoad.reference}
                  onChange={(v) => setEditLoad((s) => ({ ...s, reference: v }))}
                />
                <TextInput
                  label="Shipper *"
                  value={editLoad.shipper}
                  onChange={(v) => setEditLoad((s) => ({ ...s, shipper: v }))}
                  required
                />
                <TextInput
                  label="Origin *"
                  value={editLoad.origin}
                  onChange={(v) => setEditLoad((s) => ({ ...s, origin: v }))}
                  placeholder="City, ST or address"
                  required
                />
                <TextInput
                  label="Destination *"
                  value={editLoad.destination}
                  onChange={(v) => setEditLoad((s) => ({ ...s, destination: v }))}
                  placeholder="City, ST or address"
                  required
                />

                <SelectInput
                  label="Status *"
                  value={editLoad.status}
                  onChange={(v) => setEditLoad((s) => ({ ...s, status: v }))}
                  options={STATUS_CHOICES}
                />
                <div>
                  <label className="block text-sm text-gray-400">Equipment Type *</label>
                  <div className="relative">
                    <select
                      value={editLoad.equipment_type}
                      onChange={(e) => setEditLoad((s) => ({ ...s, equipment_type: e.target.value }))}
                      required
                      className="appearance-none pr-7 w-full bg-gray-800 text-white rounded-lg p-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700"
                    >
                      <option value="">Select type</option>
                      {EQUIPMENT_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-[22px] h-4 w-4 text-gray-400" />
                  </div>
                </div>
                <NumberInput
                  label="Rate ($)"
                  value={editLoad.rate}
                  onChange={(v) => setEditLoad((s) => ({ ...s, rate: v }))}
                />

                <DateTimeInput
                  label="Pickup (PU)"
                  value={editLoad.pickup_local}
                  onChange={(v) => setEditLoad((s) => ({ ...s, pickup_local: v }))}
                />
                <DateTimeInput
                  label="Delivery (DEL)"
                  value={editLoad.delivery_local}
                  onChange={(v) =>
                    setEditLoad((s) => ({ ...s, delivery_local: v }))
                  }
                />

                {!notesMissing && (
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-400">Notes</label>
                    <textarea
                      value={editLoad.notes}
                      onChange={(e) =>
                        setEditLoad((s) => ({ ...s, notes: e.target.value }))
                      }
                      rows={6}
                      className="mt-1 w-full bg-gray-800 text-white rounded-lg p-3 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Driver updates, appointment changes, etc."
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-white disabled:opacity-60 transition-colors"
                  disabled={editSaving}
                >
                  {editSaving ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Updating…
                    </span>
                  ) : (
                    "Update Load"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AddLoadModal Component (if you want to use it) */}
      <AddLoadModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreated={() => {
          fetchLoads();
          setOpenCreate(false);
        }}
      />
    </div>
  );
}

/* ------------------------ Small input components ------------------------ */
function TextInput({ label, value, onChange, placeholder, required }) {
  return (
    <div>
      <label className="block text-sm text-gray-400">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-gray-800 text-white rounded-lg p-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function NumberInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm text-gray-400">{label}</label>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 text-white rounded-lg p-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="0.00"
      />
    </div>
  );
}

function SelectInput({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-sm text-gray-400">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none pr-7 w-full bg-gray-800 text-white rounded-lg p-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-[22px] h-4 w-4 text-gray-400" />
      </div>
    </div>
  );
}

function DateTimeInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm text-gray-400">{label}</label>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 text-white rounded-lg p-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
