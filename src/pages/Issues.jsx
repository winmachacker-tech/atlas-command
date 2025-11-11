// src/pages/Issues.jsx
import { useEffect, useMemo, useState } from "react";
import {
  Bug,
  Plus,
  Loader2,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  X,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/** Stable choices (no breaking changes if the DB enums differ yet) */
const STATUS_CHOICES = [
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

const PRIORITY_CHOICES = [
  { label: "Low", value: "LOW" },
  { label: "Medium", value: "MEDIUM" },
  { label: "High", value: "HIGH" },
  { label: "Critical", value: "CRITICAL" },
];

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function fmtDate(d) {
  if (!d) return "â€”";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

export default function Issues() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  /** Fetch with graceful failure if table doesn't exist yet */
  useEffect(() => {
    let isMounted = true;
    (async () => {
      setLoading(true);
      setFetchError("");
      try {
        const { data, error, status } = await supabase
          .from("issues")
          .select(
            `
            id,
            title,
            description,
            status,
            priority,
            related_load,
            created_at,
            updated_at,
            created_by
          `
          )
          .order("created_at", { ascending: false });

        if (error) {
          // If table not found or RLS blocking, just show empty UI without crashing the app.
          console.warn("[Issues] fetch error:", error?.message || error);
          if (status === 406 || status === 404) {
            // Table may not exist yet in your environment.
            setFetchError(
              "No issues found. (If you havenâ€™t created the issues table yet, I can give you the SQL next.)"
            );
            if (isMounted) setIssues([]);
          } else {
            setFetchError(error.message || "Failed to load issues.");
          }
        } else if (isMounted) {
          setIssues(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        console.warn("[Issues] unexpected fetch exception:", e);
        setFetchError("Failed to load issues.");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return issues.filter((it) => {
      const matchesSearch =
        !term ||
        (it.title || "").toLowerCase().includes(term) ||
        (it.description || "").toLowerCase().includes(term) ||
        (it.related_load || "").toLowerCase().includes(term);

      const matchesStatus =
        statusFilter === "ALL" || it.status === statusFilter;
      const matchesPriority =
        priorityFilter === "ALL" || it.priority === priorityFilter;

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [issues, search, statusFilter, priorityFilter]);

  async function createIssue(payload, onDone) {
    try {
      const { data, error } = await supabase
        .from("issues")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      setIssues((prev) => [data, ...prev]);
      onDone?.();
    } catch (e) {
      alert(
        e?.message ||
          "Failed to create issue. If the table doesnâ€™t exist yet, I can give you the SQL next."
      );
    }
  }

  async function updateStatus(id, nextStatus) {
    try {
      const { data, error } = await supabase
        .from("issues")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      setIssues((prev) => prev.map((i) => (i.id === id ? data : i)));
    } catch (e) {
      alert(e?.message || "Failed to update status.");
    }
  }

  async function deleteIssue(id) {
    if (!confirm("Delete this issue? This cannot be undone.")) return;
    try {
      const { error } = await supabase.from("issues").delete().eq("id", id);
      if (error) throw error;
      setIssues((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      alert(e?.message || "Failed to delete issue.");
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10">
            <Bug className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Issues</h1>
            <p className="text-sm text-white/60">
              Track problems, blockers, and follow-ups without breaking the app.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 focus:outline-none"
        >
          <Plus className="h-4 w-4" />
          New Issue
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, load #â€¦"
            className="w-72 rounded-xl border border-white/10 bg-transparent px-9 py-2 text-sm outline-none placeholder:text-white/50"
          />
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-2 py-1">
          <Filter className="h-4 w-4 opacity-70" />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ label: "All statuses", value: "ALL" }, ...STATUS_CHOICES]}
          />
          <div className="h-5 w-px bg-white/10" />
          <Select
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { label: "All priorities", value: "ALL" },
              ...PRIORITY_CHOICES,
            ]}
          />
        </div>
      </div>

      {/* Body */}
      <div className="rounded-2xl border border-white/10">
        {loading ? (
          <div className="grid place-items-center p-16">
            <div className="inline-flex items-center gap-2 text-white/70">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading issuesâ€¦</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8">
            <EmptyState hint={fetchError} onNew={() => setIsCreateOpen(true)} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-left">
                  <Th>Title</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  <Th>Related</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t border-white/10 hover:bg-white/5"
                  >
                    <Td>
                      <div className="flex flex-col">
                        <span className="font-medium">{it.title || "â€”"}</span>
                        <span className="text-xs text-white/60 line-clamp-2">
                          {it.description || "No description"}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge value={it.status} />
                    </Td>
                    <Td>
                      <PriorityBadge value={it.priority} />
                    </Td>
                    <Td>
                      <span className="rounded-md border border-white/10 px-2 py-0.5 text-xs">
                        {it.related_load || "â€”"}
                      </span>
                    </Td>
                    <Td>{fmtDate(it.created_at)}</Td>
                    <Td className="text-right">
                      <div className="inline-flex items-center gap-2">
                        {it.status !== "RESOLVED" && it.status !== "CLOSED" ? (
                          <button
                            onClick={() => updateStatus(it.id, "RESOLVED")}
                            className="rounded-lg border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
                          >
                            Mark Resolved
                          </button>
                        ) : (
                          <button
                            onClick={() => updateStatus(it.id, "OPEN")}
                            className="rounded-lg border border-amber-500/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10"
                          >
                            Reopen
                          </button>
                        )}
                        <button
                          onClick={() => deleteIssue(it.id)}
                          className="rounded-lg border border-white/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {isCreateOpen && (
        <CreateIssueModal
          onClose={() => setIsCreateOpen(false)}
          onCreate={createIssue}
        />
      )}
    </div>
  );
}

/* --------------------------- Small UI bits --------------------------- */

function Th({ children, className = "" }) {
  return (
    <th className={cx("px-4 py-3 text-xs font-medium text-white/70", className)}>
      {children}
    </th>
  );
}
function Td({ children, className = "" }) {
  return <td className={cx("px-4 py-3 align-top", className)}>{children}</td>;
}

function StatusBadge({ value }) {
  const map = {
    OPEN: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    IN_PROGRESS: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    RESOLVED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    CLOSED: "bg-white/10 text-white/70 border-white/20",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs",
        map[value] || "bg-white/10 text-white/70 border-white/20"
      )}
    >
      {value === "RESOLVED" ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : value === "OPEN" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : null}
      {value || "â€”"}
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
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs",
        map[value] || "bg-white/10 text-white/70 border-white/20"
      )}
    >
      {value || "â€”"}
    </span>
  );
}

function EmptyState({ hint, onNew }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-white/10 p-10">
      <div className="flex max-w-xl flex-col items-center text-center">
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10">
          <Bug className="h-6 w-6 text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold">No issues yet</h2>
        <p className="mt-1 text-sm text-white/60">
          Create your first issue to track problems and follow-ups.
          {hint ? <> <br /> <span className="opacity-80">{hint}</span></> : null}
        </p>
        <button
          onClick={onNew}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400"
        >
          <Plus className="h-4 w-4" />
          New Issue
        </button>
      </div>
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg border border-white/10 bg-transparent px-3 py-1.5 pr-8 text-sm outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#0B0B0F]">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
    </div>
  );
}

/* ----------------------------- Create Modal ----------------------------- */

function CreateIssueModal({ onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [relatedLoad, setRelatedLoad] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) {
      alert("Title is required.");
      return;
    }
    setSaving(true);
    await onCreate(
      {
        title: title.trim(),
        description: description.trim() || null,
        status: "OPEN",
        priority,
        related_load: relatedLoad.trim() || null,
      },
      () => onClose?.()
    );
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--bg-base, #0B0B0F)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10">
              <Bug className="h-4 w-4 text-amber-400" />
            </div>
            <h3 className="text-base font-semibold">New Issue</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 p-1 hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/70">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary"
              className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/70">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details, steps to reproduce, expectationsâ€¦"
              rows={5}
              className="w-full resize-y rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
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
                Related Load (optional)
              </label>
              <input
                value={relatedLoad}
                onChange={(e) => setRelatedLoad(e.target.value)}
                placeholder="e.g., AC-000123"
                className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
              />
            </div>
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
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Issue
          </button>
        </div>
      </div>
    </div>
  );
}

