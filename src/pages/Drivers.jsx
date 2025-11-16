// FILE: src/pages/Drivers.jsx
// Purpose: Editable Drivers page with inline editing + slide-over "Preferences" editor per driver.
// - Auto-detects columns for the table (truck_id vs truck, etc.).
// - Preferences are stored in drivers.preferences (JSON/JSONB). If column is missing, shows a banner with SQL.
// - No route changes required. A "Prefs" button on each row opens the drawer.

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  Pencil,
  Check,
  X,
  Plus,
  Trash2,
  RefreshCw,
  Search as SearchIcon,
  Loader2,
  SlidersHorizontal,
  Save,
  AlertTriangle,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function cleanStr(v) {
  return (v ?? "").toString().trim();
}
function isBlank(v) {
  return cleanStr(v) === "";
}
function toast(setToast, tone, msg) {
  setToast({ tone, msg });
  setTimeout(() => setToast(null), 2400);
}

// Choose the first column name that exists in the table
function firstExisting(cols, candidates) {
  for (const name of candidates) if (cols.includes(name)) return name;
  return null;
}

// Small coercers for preferences
const asArray = (v) =>
  Array.isArray(v)
    ? v
    : typeof v === "string" && v.trim()
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const asString = (arr) => (Array.isArray(arr) ? arr.join(", ") : arr ?? "");
const toInt = (v) => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Fallback columns for an empty drivers table.
 * This fixes the "Add Driver" button not working when there are zero rows,
 * because we still know the expected schema even if no data has been inserted yet.
 */
const FALLBACK_DRIVER_COLS = [
  "id",
  "org_id",
  "full_name",
  "phone",
  "email",
  "status",
  "truck_id",
  "notes",
  "active",
  "preferences",
];

/* ------------------------- tiny toast UI ------------------------- */
function Toast({ tone = "zinc", msg = "" }) {
  if (!msg) return null;
  const t =
    tone === "red"
      ? "bg-red-600 text-white"
      : tone === "green"
      ? "bg-emerald-600 text-white"
      : "bg-zinc-800 text-zinc-100";
  return (
    <div
      className={cx(
        "fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-lg z-50",
        t
      )}
    >
      {msg}
    </div>
  );
}

/* ------------------------- Input cell ---------------------------- */
function EditableCell({
  value,
  onChange,
  onCommit,
  onCancel,
  type = "text",
  disabled,
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);

  return (
    <div className="flex items-center gap-2">
      <input
        disabled={disabled}
        type={type}
        className={cx(
          "w-full bg-zinc-900/40 border border-zinc-700 rounded-md px-2 py-1 text-sm",
          disabled && "opacity-60 cursor-not-allowed"
        )}
        value={v ?? ""}
        onChange={(e) => {
          setV(e.target.value);
          onChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit?.();
          if (e.key === "Escape") onCancel?.();
        }}
      />
      <button
        className="p-1 rounded-md hover:bg-emerald-600/10 border border-emerald-700/40"
        onClick={onCommit}
        title="Save"
      >
        <Check className="w-4 h-4 text-emerald-500" />
      </button>
      <button
        className="p-1 rounded-md hover:bg-red-600/10 border border-red-700/40"
        onClick={onCancel}
        title="Cancel"
      >
        <X className="w-4 h-4 text-red-500" />
      </button>
    </div>
  );
}

/* ------------------------- Row component ------------------------- */
function DriverRow({
  row,
  onSave,
  onDelete,
  onOpenPrefs,
  savingId,
  setToast,
  colKeys, // { nameKey, phoneKey, emailKey, statusKey, notesKey, truckKey, activeKey, idKey }
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(row);
  useEffect(() => {
    if (!edit) setDraft(row);
  }, [row, edit]);

  const saving = savingId === row[colKeys.idKey];

  const commit = async () => {
    if (colKeys.nameKey && isBlank(draft[colKeys.nameKey])) {
      toast(setToast, "red", "Full name is required.");
      return;
    }
    await onSave(row[colKeys.idKey], draft);
    setEdit(false);
  };

  const cancel = () => {
    setDraft(row);
    setEdit(false);
  };

  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-900/40">
      <td className="px-3 py-2 text-zinc-400 text-xs">
        {String(row[colKeys.idKey] ?? "—").slice(0, 8)}
      </td>

      {/* Name */}
      <td className="px-3 py-2">
        {edit ? (
          <EditableCell
            value={draft[colKeys.nameKey]}
            onChange={(v) =>
              setDraft((d) => ({ ...d, [colKeys.nameKey]: v }))
            }
            onCommit={commit}
            onCancel={cancel}
          />
        ) : (
          <span className="text-zinc-100">{row[colKeys.nameKey] || "—"}</span>
        )}
      </td>

      {/* Phone (optional) */}
      {colKeys.phoneKey && (
        <td className="px-3 py-2">
          {edit ? (
            <EditableCell
              type="tel"
              value={draft[colKeys.phoneKey]}
              onChange={(v) =>
                setDraft((d) => ({ ...d, [colKeys.phoneKey]: v }))
              }
              onCommit={commit}
              onCancel={cancel}
            />
          ) : (
            <span className="text-zinc-200">
              {row[colKeys.phoneKey] || "—"}
            </span>
          )}
        </td>
      )}

      {/* Email (optional) */}
      {colKeys.emailKey && (
        <td className="px-3 py-2">
          {edit ? (
            <EditableCell
              type="email"
              value={draft[colKeys.emailKey]}
              onChange={(v) =>
                setDraft((d) => ({ ...d, [colKeys.emailKey]: v }))
              }
              onCommit={commit}
              onCancel={cancel}
            />
          ) : (
            <span className="text-zinc-200">
              {row[colKeys.emailKey] || "—"}
            </span>
          )}
        </td>
      )}

      {/* Status (optional) */}
      {colKeys.statusKey && (
        <td className="px-3 py-2">
          {edit ? (
            <EditableCell
              value={draft[colKeys.statusKey]}
              onChange={(v) =>
                setDraft((d) => ({ ...d, [colKeys.statusKey]: v }))
              }
              onCommit={commit}
              onCancel={cancel}
            />
          ) : (
            <span
              className={cx(
                "px-2 py-0.5 rounded text-xs border",
                row[colKeys.statusKey] === "available" &&
                  "bg-emerald-600/15 text-emerald-400 border-emerald-700/40",
                row[colKeys.statusKey] === "on_load" &&
                  "bg-sky-600/15 text-sky-400 border-sky-700/40",
                !row[colKeys.statusKey] &&
                  "text-zinc-400 border-zinc-700/40"
              )}
            >
              {row[colKeys.statusKey] || "—"}
            </span>
          )}
        </td>
      )}

      {/* Truck (optional; supports truck_id OR truck) */}
      {colKeys.truckKey && (
        <td className="px-3 py-2">
          {edit ? (
            <EditableCell
              value={draft[colKeys.truckKey]}
              onChange={(v) =>
                setDraft((d) => ({ ...d, [colKeys.truckKey]: v }))
              }
              onCommit={commit}
              onCancel={cancel}
            />
          ) : (
            <span className="text-zinc-200">
              {row[colKeys.truckKey] || "—"}
            </span>
          )}
        </td>
      )}

      {/* Notes (optional) */}
      {colKeys.notesKey && (
        <td className="px-3 py-2">
          {edit ? (
            <EditableCell
              value={draft[colKeys.notesKey]}
              onChange={(v) =>
                setDraft((d) => ({ ...d, [colKeys.notesKey]: v }))
              }
              onCommit={commit}
              onCancel={cancel}
            />
          ) : (
            <span className="text-zinc-300 line-clamp-2">
              {row[colKeys.notesKey] || "—"}
            </span>
          )}
        </td>
      )}

      <td className="px-3 py-2 text-center">
        {edit ? (
          <div className="text-xs text-zinc-300">Editing…</div>
        ) : saving ? (
          <Loader2 className="w-4 h-4 animate-spin text-zinc-300 inline-block" />
        ) : (
          <div className="flex items-center justify-center gap-2">
            <button
              className="p-1 rounded hover:bg-zinc-800"
              onClick={() => setEdit(true)}
              title="Edit"
            >
              <Pencil className="w-4 h-4 text-zinc-300" />
            </button>
            <button
              className="p-1 rounded hover:bg-zinc-800"
              onClick={() => onOpenPrefs(row)}
              title="Preferences"
            >
              <SlidersHorizontal className="w-4 h-4 text-sky-300" />
            </button>
            <button
              className="p-1 rounded hover:bg-red-600/10"
              onClick={() => onDelete(row[colKeys.idKey])}
              title="Delete"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/* --------------------------- main page --------------------------- */
export default function Drivers() {
  const [rows, setRows] = useState([]);
  const [knownCols, setKnownCols] = useState([]); // inferred from select('*')
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [query, setQuery] = useState("");
  const [toastState, setToast] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState({}); // created based on existing columns

  // Preferences drawer state
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [prefsColsKnown, setPrefsColsKnown] = useState(false);
  const [prefsDraft, setPrefsDraft] = useState({
    equipment_types: [],
    lane_whitelist: [],
    lane_blacklist: [],
    home_days: [],
    shift: "either",
    max_weight_lbs: null,
    distance_radius_miles: null,
    avoid_customers: [],
    certifications: { twic: false, tsa: false, dod_clearance: false },
    languages: [],
    notes: "",
  });

  // STABLE HANDLERS FOR PREFERENCES - FIXES THE FOCUS LOSS BUG
  const handlePrefsArrayChange = useCallback((field, value) => {
    setPrefsDraft((d) => ({ ...d, [field]: asArray(value) }));
  }, []);

  const handlePrefsTextChange = useCallback((field, value) => {
    setPrefsDraft((d) => ({ ...d, [field]: value }));
  }, []);

  const handlePrefsNumberChange = useCallback((field, value) => {
    setPrefsDraft((d) => ({ ...d, [field]: toInt(value) }));
  }, []);

  const handlePrefsCertChange = useCallback((cert, checked) => {
    setPrefsDraft((d) => ({
      ...d,
      certifications: { ...d.certifications, [cert]: checked },
    }));
  }, []);

  // Derived column keys (decide after we know columns)
  const colKeys = useMemo(() => {
    const cols = knownCols;
    const idKey = firstExisting(cols, ["id", "driver_id", "uuid"]);
    const nameKey = firstExisting(cols, ["full_name", "name", "driver_name"]);
    const phoneKey = firstExisting(cols, ["phone", "phone_number"]);
    const emailKey = firstExisting(cols, ["email"]);
    const statusKey = firstExisting(cols, ["status", "state"]);
    const notesKey = firstExisting(cols, ["notes", "note"]);
    const truckKey = firstExisting(cols, ["truck_id", "truck", "vehicle_id"]);
    const activeKey = firstExisting(cols, ["active", "is_active"]);

    return {
      idKey,
      nameKey,
      phoneKey,
      emailKey,
      statusKey,
      notesKey,
      truckKey,
      activeKey,
    };
  }, [knownCols]);

  const hasPreferencesCol = useMemo(
    () => knownCols.includes("preferences"),
    [knownCols]
  );

  const buildEmptyNewDraft = (cols) => {
    const nameKey = firstExisting(cols, ["full_name", "name", "driver_name"]);
    const statusKey = firstExisting(cols, ["status", "state"]);
    const activeKey = firstExisting(cols, ["active", "is_active"]);
    const defaults = {
      [nameKey ?? "full_name"]: "",
      [statusKey ?? "status"]: "available",
    };
    if (firstExisting(cols, ["phone", "phone_number"]))
      defaults[firstExisting(cols, ["phone", "phone_number"])] = "";
    if (firstExisting(cols, ["email"])) defaults["email"] = "";
    if (firstExisting(cols, ["notes", "note"]))
      defaults[firstExisting(cols, ["notes", "note"])] = "";
    if (firstExisting(cols, ["truck_id", "truck", "vehicle_id"]))
      defaults[firstExisting(cols, ["truck_id", "truck", "vehicle_id"])] = "";
    if (activeKey) defaults[activeKey] = true;
    return defaults;
  };

  const fetchDrivers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .order("id", { ascending: true });
    if (error) {
      console.error("fetch drivers error:", error);
      toast(setToast, "red", `Load failed: ${error.message}`);
      setRows([]);
      setKnownCols([]);
    } else {
      // IMPORTANT FIX:
      // If there are no rows yet, fall back to a known schema so the "Add Driver"
      // quick-add section still works and the button is enabled.
      let cols;
      if (data && data.length > 0) {
        cols = Array.from(
          data.reduce((set, row) => {
            Object.keys(row || {}).forEach((k) => set.add(k));
            return set;
          }, new Set())
        );
      } else {
        cols = [...FALLBACK_DRIVER_COLS];
      }
      setKnownCols(cols);
      setRows(data || []);
      setNewDraft(buildEmptyNewDraft(cols));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDrivers();
  }, []);

  const filtered = useMemo(() => {
    const q = cleanStr(query).toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      cleanStr(JSON.stringify(r)).toLowerCase().includes(q)
    );
  }, [rows, query]);

  const onSave = async (idValue, fullDraft) => {
    try {
      setSavingId(idValue);
      const payload = {};
      // Only include keys that are in knownCols and are not the id column
      for (const k of Object.keys(fullDraft)) {
        if (k !== colKeys.idKey && knownCols.includes(k)) payload[k] = fullDraft[k];
      }
      if (Object.keys(payload).length === 0) {
        toast(setToast, "zinc", "Nothing to update.");
        return;
      }
      const { error } = await supabase
        .from("drivers")
        .update(payload)
        .eq(colKeys.idKey, idValue)
        .select()
        .single();
      if (error) throw error;
      toast(setToast, "green", "Driver updated.");
      await fetchDrivers();
    } catch (e) {
      console.error("save driver error:", e);
      toast(setToast, "red", `Update failed: ${e.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const onDelete = async (idValue) => {
    const sure = window.confirm("Delete this driver? This cannot be undone.");
    if (!sure) return;
    try {
      setSavingId(idValue);
      const { error } = await supabase
        .from("drivers")
        .delete()
        .eq(colKeys.idKey, idValue);
      if (error) throw error;
      toast(setToast, "green", "Driver deleted.");
      setRows((r) => r.filter((x) => x[colKeys.idKey] !== idValue));
    } catch (e) {
      console.error("delete driver error:", e);
      toast(setToast, "red", `Delete failed: ${e.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const onCreate = async () => {
    const nameKey = colKeys.nameKey;
    if (!nameKey) {
      toast(setToast, "red", "No name column found (e.g., full_name or name).");
      return;
    }
    if (isBlank(newDraft[nameKey])) {
      toast(setToast, "red", "Full name is required.");
      return;
    }
    try {
      setCreating(true);
      const payload = {};
      // Only insert fields that exist
      for (const k of Object.keys(newDraft)) {
        if (knownCols.includes(k)) payload[k] = newDraft[k];
      }
      const { data, error } = await supabase
        .from("drivers")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      toast(setToast, "green", "Driver created.");
      setRows((r) => [...r, data]);
      setNewDraft(buildEmptyNewDraft(knownCols));
    } catch (e) {
      console.error("create driver error:", e);
      toast(setToast, "red", `Create failed: ${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  // Build table columns dynamically (show what exists, in a sensible order)
  const idHeader = colKeys.idKey ?? "ID";
  const colsToShow = [
    { key: colKeys.nameKey, label: "Full Name", required: true },
    colKeys.phoneKey ? { key: colKeys.phoneKey, label: "Phone" } : null,
    colKeys.emailKey ? { key: colKeys.emailKey, label: "Email" } : null,
    colKeys.statusKey ? { key: colKeys.statusKey, label: "Status" } : null,
    colKeys.truckKey ? { key: colKeys.truckKey, label: "Truck" } : null,
    colKeys.notesKey ? { key: colKeys.notesKey, label: "Notes" } : null,
  ].filter(Boolean);

  /* ---------------------- Preferences Drawer --------------------- */
  const openPrefs = async (row) => {
    setSelectedDriver(row);
    // Known columns for prefs rely on table-level cols:
    setPrefsColsKnown(hasPreferencesCol);
    // Merge defaults with existing
    const incoming =
      row?.preferences && typeof row.preferences === "object"
        ? row.preferences
        : {};
    setPrefsDraft({
      equipment_types: asArray(incoming.equipment_types),
      lane_whitelist: asArray(incoming.lane_whitelist),
      lane_blacklist: asArray(incoming.lane_blacklist),
      home_days: asArray(incoming.home_days),
      shift: incoming.shift ?? "either",
      max_weight_lbs: incoming.max_weight_lbs ?? null,
      distance_radius_miles: incoming.distance_radius_miles ?? null,
      avoid_customers: asArray(incoming.avoid_customers),
      certifications: {
        twic: Boolean(incoming?.certifications?.twic),
        tsa: Boolean(incoming?.certifications?.tsa),
        dod_clearance: Boolean(incoming?.certifications?.dod_clearance),
      },
      languages: asArray(incoming.languages),
      notes: incoming.notes ?? "",
    });
    setPrefsOpen(true);
  };

  const savePrefs = async () => {
    if (!prefsColsKnown) {
      toast(
        setToast,
        "red",
        "No preferences column on drivers. Add it first (see banner)."
      );
      return;
    }
    if (!selectedDriver) return;
    try {
      setPrefsSaving(true);
      const payload = {
        preferences: {
          ...prefsDraft,
          equipment_types: asArray(prefsDraft.equipment_types),
          lane_whitelist: asArray(prefsDraft.lane_whitelist),
          lane_blacklist: asArray(prefsDraft.lane_blacklist),
          home_days: asArray(prefsDraft.home_days),
          languages: asArray(prefsDraft.languages),
          avoid_customers: asArray(prefsDraft.avoid_customers),
          shift: prefsDraft.shift ?? "either",
          max_weight_lbs: prefsDraft.max_weight_lbs ?? null,
          distance_radius_miles: prefsDraft.distance_radius_miles ?? null,
          certifications: {
            twic: Boolean(prefsDraft?.certifications?.twic),
            tsa: Boolean(prefsDraft?.certifications?.tsa),
            dod_clearance: Boolean(
              prefsDraft?.certifications?.dod_clearance
            ),
          },
          notes: prefsDraft.notes ?? "",
        },
      };

      const idKey = colKeys.idKey;
      const idVal = selectedDriver?.[idKey];
      const { error } = await supabase
        .from("drivers")
        .update(payload)
        .eq(idKey, idVal)
        .select()
        .single();
      if (error) throw error;

      toast(setToast, "green", "Preferences saved.");
      setPrefsOpen(false);
      setSelectedDriver(null);
      await fetchDrivers(); // refresh list
    } catch (e) {
      console.error("save preferences error:", e);
      toast(setToast, "red", `Save failed: ${e.message}`);
    } finally {
      setPrefsSaving(false);
    }
  };

  const PrefsBanner = () =>
    !prefsColsKnown ? (
      <div className="mb-3 p-3 rounded-lg border border-amber-700/40 bg-amber-600/10 text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5" />
        <div className="text-xs">
          <div className="font-medium">Preferences column not found.</div>
          <div className="opacity-90">
            Run this once, then reopen this drawer:
            <pre className="mt-2 p-2 rounded bg-zinc-900/60 border border-zinc-700 text-[11px] overflow-auto">
              {`alter table public.drivers
add column if not exists preferences jsonb not null default '{}';`}
            </pre>
          </div>
        </div>
      </div>
    ) : null;

  const PrefsInput = ({ label, children, help }) => (
    <div className="mb-3">
      <div className="text-xs text-zinc-300 mb-1">{label}</div>
      {children}
      {help && (
        <div className="text-[11px] text-zinc-400 mt-1">{help}</div>
      )}
    </div>
  );

  const PrefsText = (props) => (
    <input
      {...props}
      className={cx(
        "w-full px-2 py-2 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm",
        props.className
      )}
    />
  );

  const PrefsArea = (props) => (
    <textarea
      {...props}
      rows={4}
      className={cx(
        "w-full px-2 py-2 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm",
        props.className
      )}
    />
  );

  /* --------------------------- render ---------------------------- */
  return (
    <div className="p-6">
      <Toast {...(toastState || {})} />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Drivers</h1>
          <p className="text-zinc-400 text-sm">
            Manage, edit, and create drivers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800"
            onClick={fetchDrivers}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row gap-3 mb-5">
        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <SearchIcon className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search anything…"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-700 text-sm"
            />
          </div>
        </div>

        {/* Quick-create block (built from existing columns) */}
        <div className="w-full lg:w-[640px] border border-zinc-700 rounded-lg p-3 bg-zinc-900/40">
          <div className="text-xs text-zinc-400 mb-2">Quick add</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {colKeys.nameKey && (
              <input
                className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm"
                placeholder="Full name *"
                value={newDraft[colKeys.nameKey] ?? ""}
                onChange={(e) =>
                  setNewDraft((d) => ({
                    ...d,
                    [colKeys.nameKey]: e.target.value,
                  }))
                }
              />
            )}
            {colKeys.phoneKey && (
              <input
                className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm"
                placeholder="Phone"
                value={newDraft[colKeys.phoneKey] ?? ""}
                onChange={(e) =>
                  setNewDraft((d) => ({
                    ...d,
                    [colKeys.phoneKey]: e.target.value,
                  }))
                }
              />
            )}
            {colKeys.emailKey && (
              <input
                className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm"
                placeholder="Email"
                value={newDraft[colKeys.emailKey] ?? ""}
                onChange={(e) =>
                  setNewDraft((d) => ({
                    ...d,
                    [colKeys.emailKey]: e.target.value,
                  }))
                }
              />
            )}
            {colKeys.statusKey && (
              <input
                className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm"
                placeholder="Status (e.g., available/on_load)"
                value={newDraft[colKeys.statusKey] ?? ""}
                onChange={(e) =>
                  setNewDraft((d) => ({
                    ...d,
                    [colKeys.statusKey]: e.target.value,
                  }))
                }
              />
            )}
            {colKeys.truckKey && (
              <input
                className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm"
                placeholder="Truck"
                value={newDraft[colKeys.truckKey] ?? ""}
                onChange={(e) =>
                  setNewDraft((d) => ({
                    ...d,
                    [colKeys.truckKey]: e.target.value,
                  }))
                }
              />
            )}
            {colKeys.notesKey && (
              <input
                className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-700 text-sm md:col-span-2"
                placeholder="Notes"
                value={newDraft[colKeys.notesKey] ?? ""}
                onChange={(e) =>
                  setNewDraft((d) => ({
                    ...d,
                    [colKeys.notesKey]: e.target.value,
                  }))
                }
              />
            )}
          </div>
          <div className="flex items-center justify-end mt-2">
            <button
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-700 bg-emerald-600/20 hover:bg-emerald-600/30"
              onClick={onCreate}
              disabled={creating || !colKeys.nameKey}
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add Driver
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900/60 border-b border-zinc-800 text-zinc-300">
            <tr>
              <th className="text-left px-3 py-2 font-medium">
                {idHeader.toUpperCase()}
              </th>
              {colsToShow.map((c) => (
                <th
                  key={c.key}
                  className="text-left px-3 py-2 font-medium"
                >
                  {c.label}
                </th>
              ))}
              <th className="text-center px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              <tr>
                <td
                  colSpan={1 + colsToShow.length + 1}
                  className="px-3 py-8 text-center text-zinc-400"
                >
                  <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
                  Loading drivers…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={1 + colsToShow.length + 1}
                  className="px-3 py-10 text-center text-zinc-400"
                >
                  No drivers found.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <DriverRow
                  key={row[colKeys.idKey]}
                  row={row}
                  onSave={onSave}
                  onDelete={onDelete}
                  onOpenPrefs={openPrefs}
                  savingId={savingId}
                  setToast={setToast}
                  colKeys={colKeys}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Preferences Drawer */}
      {prefsOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setPrefsOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full sm:max-w-xl bg-zinc-950 border-l border-zinc-800 z-50 shadow-2xl flex flex-col">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <div className="text-zinc-100 font-semibold text-lg">
                  Driver Preferences
                </div>
                <div className="text-zinc-400 text-xs">
                  {selectedDriver?.[colKeys.nameKey] || "Driver"} · ID{" "}
                  {String(selectedDriver?.[colKeys.idKey]).slice(0, 8)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800"
                  onClick={() => setPrefsOpen(false)}
                >
                  Close
                </button>
                <button
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-700 bg-emerald-600/20 hover:bg-emerald-600/30"
                  onClick={savePrefs}
                  disabled={prefsSaving || !prefsColsKnown}
                  title={
                    !prefsColsKnown
                      ? "Add preferences column first"
                      : "Save preferences"
                  }
                >
                  {prefsSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto">
              <PrefsBanner />

              <div className="grid grid-cols-1 gap-3">
                <PrefsInput
                  label="Equipment types"
                  help="Comma-separated (e.g., dry van, flatbed, stepdeck, rgn, reefer)"
                >
                  <PrefsText
                    placeholder="dry van, flatbed, stepdeck…"
                    value={asString(prefsDraft.equipment_types)}
                    onChange={(e) =>
                      handlePrefsArrayChange(
                        "equipment_types",
                        e.target.value
                      )
                    }
                  />
                </PrefsInput>

                <PrefsInput
                  label="Preferred lanes"
                  help="Comma-separated. Free text or City, ST → City, ST"
                >
                  <PrefsText
                    placeholder="Sacramento, CA → Phoenix, AZ"
                    value={asString(prefsDraft.lane_whitelist)}
                    onChange={(e) =>
                      handlePrefsArrayChange(
                        "lane_whitelist",
                        e.target.value
                      )
                    }
                  />
                </PrefsInput>

                <PrefsInput
                  label="Avoid lanes/regions"
                  help="Comma-separated"
                >
                  <PrefsText
                    placeholder="Portland, OR, NYC metro"
                    value={asString(prefsDraft.lane_blacklist)}
                    onChange={(e) =>
                      handlePrefsArrayChange(
                        "lane_blacklist",
                        e.target.value
                      )
                    }
                  />
                </PrefsInput>

                <PrefsInput
                  label="Home days"
                  help="Comma-separated: Mon, Tue, Wed, Thu, Fri, Sat, Sun"
                >
                  <PrefsText
                    placeholder="Fri, Sat"
                    value={asString(prefsDraft.home_days)}
                    onChange={(e) =>
                      handlePrefsArrayChange("home_days", e.target.value)
                    }
                  />
                </PrefsInput>

                <div className="grid grid-cols-2 gap-3">
                  <PrefsInput label="Max weight (lbs)">
                    <PrefsText
                      inputMode="numeric"
                      placeholder="e.g., 45000"
                      value={prefsDraft.max_weight_lbs ?? ""}
                      onChange={(e) =>
                        handlePrefsNumberChange(
                          "max_weight_lbs",
                          e.target.value
                        )
                      }
                    />
                  </PrefsInput>
                  <PrefsInput
                    label="Home radius (miles)"
                    help="Preferred dispatch radius around home base"
                  >
                    <PrefsText
                      inputMode="numeric"
                      placeholder="e.g., 100"
                      value={prefsDraft.distance_radius_miles ?? ""}
                      onChange={(e) =>
                        handlePrefsNumberChange(
                          "distance_radius_miles",
                          e.target.value
                        )
                      }
                    />
                  </PrefsInput>
                </div>

                <PrefsInput
                  label="Avoid customers"
                  help="Comma-separated customer names"
                >
                  <PrefsText
                    placeholder="Shipper A, Consignee B"
                    value={asString(prefsDraft.avoid_customers)}
                    onChange={(e) =>
                      handlePrefsArrayChange(
                        "avoid_customers",
                        e.target.value
                      )
                    }
                  />
                </PrefsInput>

                <div className="grid grid-cols-3 gap-2">
                  <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      checked={!!prefsDraft?.certifications?.twic}
                      onChange={(e) =>
                        handlePrefsCertChange("twic", e.target.checked)
                      }
                    />
                    TWIC
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      checked={!!prefsDraft?.certifications?.tsa}
                      onChange={(e) =>
                        handlePrefsCertChange("tsa", e.target.checked)
                      }
                    />
                    TSA
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      checked={!!prefsDraft?.certifications?.dod_clearance}
                      onChange={(e) =>
                        handlePrefsCertChange(
                          "dod_clearance",
                          e.target.checked
                        )
                      }
                    />
                    DOD Clearance
                  </label>
                </div>

                <PrefsInput
                  label="Languages"
                  help="Comma-separated. Example: English, Russian, Ukrainian"
                >
                  <PrefsText
                    placeholder="English, Russian, Ukrainian"
                    value={asString(prefsDraft.languages)}
                    onChange={(e) =>
                      handlePrefsArrayChange("languages", e.target.value)
                    }
                  />
                </PrefsInput>

                <PrefsInput label="Notes">
                  <PrefsArea
                    placeholder="Any extra constraints or preferences…"
                    value={prefsDraft.notes ?? ""}
                    onChange={(e) =>
                      handlePrefsTextChange("notes", e.target.value)
                    }
                  />
                </PrefsInput>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
