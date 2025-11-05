// src/pages/Issues.jsx
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Filter,
  Search,
  ArrowUpDown,
  Loader2,
  Eye,
  UserPlus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldAlert,
  X,
  ChevronDown,
  Edit,
  Trash2,
  ListChecks,
  Building2,
  Info,
  Bug,
  Shield,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * ──────────────────────────────────────────────────────────────────────────────
 *  ISSUES PAGE + DIAGNOSTICS
 * ──────────────────────────────────────────────────────────────────────────────
 * FIELD MAP (adjust to your SQL as needed):
 *  - id:               uuid (pk)
 *  - reference:        text
 *  - type:             text
 *  - severity:         text enum ('CRITICAL','HIGH','MEDIUM','LOW')
 *  - load_id:          text or uuid
 *  - description:      text
 *  - status:           text enum ('NEW','IN_PROGRESS','RESOLVED','ESCALATED')
 *  - assigned_to:      text
 *  - facility:         text
 *  - reported_at:      timestamptz
 *  - resolved_at:      timestamptz (nullable)
 *
 * If you see “No rows” but your table has data, your RLS policies probably
 * don’t allow SELECT for your user. Create a permissive SELECT policy for now:
 *
 *   -- TEMP DEV POLICY (wide-open read)
 *   create policy "dev read issues" on issues
 *   for select using (true);
 *
 * Then tighten later.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const SEVERITY_CHOICES = [
  { label: "Critical", value: "CRITICAL" },
  { label: "High", value: "HIGH" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Low", value: "LOW" },
];

const STATUS_CHOICES = [
  { label: "New", value: "NEW" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Escalated", value: "ESCALATED" },
  { label: "Resolved", value: "RESOLVED" },
];

const TYPE_CHOICES = [
  "Delivery Delay",
  "Equipment Failure",
  "Security Alert",
  "Documentation Issue",
  "Temperature Exception",
  "Detention/TONU",
  "Route Deviation",
  "Other",
];

const DEFAULT_SORT = { key: "reported_at", dir: "desc" };

function severityBadgeClasses(v) {
  switch (v) {
    case "CRITICAL":
      return "bg-red-500/15 text-red-300 border border-red-500/30";
    case "HIGH":
      return "bg-orange-500/15 text-orange-300 border border-orange-500/30";
    case "MEDIUM":
      return "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30";
    case "LOW":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 border border-slate-500/30";
  }
}
function statusBadgeClasses(v) {
  switch (v) {
    case "NEW":
      return "bg-sky-500/15 text-sky-300 border border-sky-500/30";
    case "IN_PROGRESS":
      return "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30";
    case "ESCALATED":
      return "bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30";
    case "RESOLVED":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 border border-slate-500/30";
  }
}
function fmtDate(dt) {
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    return d.toLocaleString();
  } catch {
    return String(dt);
  }
}
function ageSince(dt) {
  if (!dt) return "—";
  const ms = Date.now() - new Date(dt).getTime();
  if (ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
function classNames(...a) {
  return a.filter(Boolean).join(" ");
}

export default function Issues() {
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState("");

  // Diagnostics
  const [sessionInfo, setSessionInfo] = useState({ email: "", userId: "" });
  const [rowCount, setRowCount] = useState(null);
  const [filtersBypassed, setFiltersBypassed] = useState(false);
  const [minimalQuery, setMinimalQuery] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [facility, setFacility] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Sorting & selection
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState("");

  // Create / Edit modal
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setSessionInfo({
        email: data?.user?.email || "",
        userId: data?.user?.id || "",
      });
    })();
  }, []);

  async function fetchIssues() {
    try {
      setLoading(true);
      setError("");

      // count for diagnostics (independent of filters)
      const { count: totalCount, error: cntErr } = await supabase
        .from("issues")
        .select("id", { count: "exact", head: true });
      if (cntErr) {
        console.warn("[Issues] count error:", cntErr);
      }
      setRowCount(typeof totalCount === "number" ? totalCount : null);

      let query = supabase.from("issues").select(
        "id, reference, type, severity, load_id, description, status, assigned_to, facility, reported_at, resolved_at",
        { count: "planned" }
      );

      // Safety: some columns like load_id could be UUID; avoid ILIKE on non-text in minimal mode
      const useFilters = !filtersBypassed;
      const useMinimal = minimalQuery;

      if (useFilters) {
        if (q?.trim() && !useMinimal) {
          const term = `%${q.trim()}%`;
          // Only ILIKE against text columns to avoid type errors on UUID
          query = query.or(
            `reference.ilike.${term},description.ilike.${term},facility.ilike.${term}`
          );
        }
        if (severity) query = query.eq("severity", severity);
        if (status) query = query.eq("status", status);
        if (type) query = query.eq("type", type);
        if (facility) query = query.ilike("facility", `%${facility}%`);
        if (dateFrom) query = query.gte("reported_at", new Date(dateFrom).toISOString());
        if (dateTo) {
          const dt = new Date(dateTo);
          dt.setDate(dt.getDate() + 1);
          query = query.lt("reported_at", dt.toISOString());
        }
      }

      // Sorting
      const ascending = sort.dir === "asc";
      if (sort.key === "severity" || sort.key === "status") {
        const { data, error: err } = await query.order("reported_at", { ascending: false }).limit(200);
        if (err) throw err;
        const order =
          sort.key === "severity"
            ? ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
            : ["NEW", "IN_PROGRESS", "ESCALATED", "RESOLVED"];
        const sorted = [...(data ?? [])].sort((a, b) => {
          const ai = order.indexOf(a[sort.key]);
          const bi = order.indexOf(b[sort.key]);
          return ascending ? ai - bi : bi - ai;
        });
        setIssues(sorted);
      } else {
        const { data, error: err } = await query.order(sort.key, { ascending }).limit(200);
        if (err) throw err;
        setIssues(data ?? []);
      }
    } catch (e) {
      console.error("[Issues] fetch error:", e);
      setError(e.message ?? "Failed to load issues.");
      setIssues([]); // show placeholder if error
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    q,
    severity,
    status,
    type,
    facility,
    dateFrom,
    dateTo,
    sort.key,
    sort.dir,
    filtersBypassed,
    minimalQuery,
  ]);

  const facilities = useMemo(() => {
    const s = new Set(issues.map((i) => i.facility).filter(Boolean));
    return Array.from(s).sort();
  }, [issues]);

  const stats = useMemo(() => {
    const open = issues.filter((i) => i.status !== "RESOLVED");
    const bySeverity = {
      CRITICAL: open.filter((i) => i.severity === "CRITICAL").length,
      HIGH: open.filter((i) => i.severity === "HIGH").length,
      MEDIUM: open.filter((i) => i.severity === "MEDIUM").length,
      LOW: open.filter((i) => i.severity === "LOW").length,
    };
    const resolved = issues.filter((i) => i.resolved_at && i.reported_at);
    let avgMs = 0;
    if (resolved.length) {
      avgMs =
        resolved.reduce(
          (acc, i) => acc + (new Date(i.resolved_at).getTime() - new Date(i.reported_at).getTime()),
          0
        ) / resolved.length;
    }
    const avgHours = avgMs ? Math.round((avgMs / 3600000) * 10) / 10 : 0;

    const key = "__issues_last_open";
    const last = Number(sessionStorage.getItem(key) || "0");
    sessionStorage.setItem(key, String(open.length));
    const trend = open.length === last ? "flat" : open.length > last ? "up" : "down";

    return {
      totalOpen: open.length,
      bySeverity,
      avgResolutionHours: avgHours,
      trend,
    };
  }, [issues]);

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selectedIds.size === issues.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(issues.map((i) => i.id)));
    }
  }
  function clearFilters() {
    setQ("");
    setSeverity("");
    setStatus("");
    setType("");
    setFacility("");
    setDateFrom("");
    setDateTo("");
    setSort(DEFAULT_SORT);
    setSelectedIds(new Set());
  }

  async function updateIssueStatus(issueId, newStatus) {
    const patch = { status: newStatus };
    if (newStatus === "RESOLVED") patch.resolved_at = new Date().toISOString();
    const { error: err } = await supabase.from("issues").update(patch).eq("id", issueId);
    if (err) {
      console.error("[Issues] update status error:", err);
      alert(`Update failed: ${err.message}`);
      return;
    }
    await fetchIssues();
  }
  async function assignIssue(issueId, name) {
    const { error: err } = await supabase.from("issues").update({ assigned_to: name }).eq("id", issueId);
    if (err) {
      console.error("[Issues] assign error:", err);
      alert(`Assign failed: ${err.message}`);
      return;
    }
    await fetchIssues();
  }
  async function bulkUpdateStatus() {
    if (!bulkStatus || !selectedIds.size) return;
    const patch = { status: bulkStatus };
    if (bulkStatus === "RESOLVED") patch.resolved_at = new Date().toISOString();
    const { error: err } = await supabase
      .from("issues")
      .update(patch)
      .in("id", Array.from(selectedIds));
    if (err) {
      console.error("[Issues] bulk status error:", err);
      alert(`Bulk update failed: ${err.message}`);
      return;
    }
    setSelectedIds(new Set());
    setBulkStatus("");
    await fetchIssues();
  }
  function openEdit(issue) {
    setEditingIssue(issue);
    setEditOpen(true);
  }

  return (
    <div className="p-6 space-y-6 text-[var(--text-base)]">
      {/* Diagnostics Bar */}
      <div className="rounded-2xl border border-white/10 bg-[var(--bg-surface)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 text-sm">
            <Bug className="h-4 w-4 opacity-70" />
            <span className="opacity-70">Diagnostics</span>
          </div>
          <div className="text-xs opacity-70">
            <Shield className="inline h-3.5 w-3.5 mr-1" />
            User: <b>{sessionInfo.email || "—"}</b> ({sessionInfo.userId || "no id"})
          </div>
          <div className="text-xs opacity-70">
            Rows (table total):{" "}
            <b>{rowCount === null ? "—" : rowCount}</b>
          </div>
          <div className="text-xs">
            {error ? (
              <span className="text-red-300 inline-flex items-center gap-1">
                <Info className="h-3.5 w-3.5" /> {error}
              </span>
            ) : (
              <span className="opacity-60">No errors</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={filtersBypassed}
                onChange={(e) => setFiltersBypassed(e.target.checked)}
              />
              Bypass filters
            </label>
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={minimalQuery}
                onChange={(e) => setMinimalQuery(e.target.checked)}
              />
              Minimal query
            </label>
            <button
              onClick={fetchIssues}
              className="text-xs rounded-lg border border-white/10 px-2 py-1 hover:bg-white/5"
              title="Refetch"
            >
              Refetch
            </button>
          </div>
        </div>
        <div className="mt-2 text-[11px] opacity-70">
          Tip: If <b>Rows (table total)</b> &gt; 0 but the table below shows “No issues found”, RLS is restricting your user.
          Add a temporary <code>for select using (true)</code> policy on <code>issues</code> to verify.
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Issues & Exceptions</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Centralized hub to track, prioritize, and resolve problems across operations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[var(--bg-surface)] px-4 py-2 hover:bg-white/5"
          >
            <Plus className="h-4 w-4" />
            Create New Issue
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Open Issues"
          value={stats.totalOpen}
          icon={<ListChecks className="h-5 w-5" />}
          subtitle={
            stats.trend === "up"
              ? "Trending up"
              : stats.trend === "down"
              ? "Trending down"
              : "No change"
          }
        />
        <StatCard
          title="Critical"
          value={stats.bySeverity.CRITICAL}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone="critical"
        />
        <StatCard
          title="High"
          value={stats.bySeverity.HIGH}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="high"
        />
        <StatCard
          title="Avg Resolution"
          value={`${stats.avgResolutionHours || 0}h`}
          icon={<Clock className="h-5 w-5" />}
          subtitle="Resolved issues only"
        />
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-white/10 bg-[var(--bg-surface)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search reference, description, facility…"
              className="pl-9 pr-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={severity}
              onChange={setSeverity}
              options={[{ label: "Severity (All)", value: "" }, ...SEVERITY_CHOICES]}
              icon={<Filter className="h-4 w-4 opacity-70" />}
            />
            <Select
              value={status}
              onChange={setStatus}
              options={[{ label: "Status (All)", value: "" }, ...STATUS_CHOICES]}
              icon={<Filter className="h-4 w-4 opacity-70" />}
            />
            <Select
              value={type}
              onChange={setType}
              options={[{ label: "Type (All)", value: "" }, ...TYPE_CHOICES.map((t) => ({ label: t, value: t }))]}
              icon={<Filter className="h-4 w-4 opacity-70" />}
            />
            <Select
              value={facility}
              onChange={setFacility}
              options={[{ label: "Facility (All)", value: "" }, ...facilities.map((f) => ({ label: f, value: f }))]}
              icon={<Building2 className="h-4 w-4 opacity-70" />}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            />
            <span className="opacity-60 text-sm">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            />
          </div>

          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 hover:bg-white/5"
            title="Clear filters"
          >
            <X className="h-4 w-4" />
            Clear
          </button>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm opacity-70">
          {selectedIds.size
            ? `${selectedIds.size} selected`
            : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={bulkStatus}
            onChange={setBulkStatus}
            options={[{ label: "Bulk: Set Status", value: "" }, ...STATUS_CHOICES]}
            icon={<ListChecks className="h-4 w-4 opacity-70" />}
          />
          <button
            onClick={bulkUpdateStatus}
            disabled={!bulkStatus || !selectedIds.size}
            className={classNames(
              "inline-flex items-center gap-2 rounded-xl border px-3 py-2",
              !bulkStatus || !selectedIds.size
                ? "border-white/10 opacity-50 cursor-not-allowed"
                : "border-emerald-500/30 hover:bg-emerald-500/10"
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
            Apply
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-2xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left">
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.size === issues.length && issues.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <ThSort label="Issue ID" active={sort.key === "reference"} dir={sort.dir} onClick={() => toggleSort(setSort, "reference", sort)} />
              <ThSort label="Type" active={sort.key === "type"} dir={sort.dir} onClick={() => toggleSort(setSort, "type", sort)} />
              <ThSort label="Severity" active={sort.key === "severity"} dir={sort.dir} onClick={() => toggleSort(setSort, "severity", sort)} />
              <ThSort label="Status" active={sort.key === "status"} dir={sort.dir} onClick={() => toggleSort(setSort, "status", sort)} />
              <ThSort label="Load" active={sort.key === "load_id"} dir={sort.dir} onClick={() => toggleSort(setSort, "load_id", sort)} />
              <th className="p-3">Description</th>
              <ThSort label="Assigned" active={sort.key === "assigned_to"} dir={sort.dir} onClick={() => toggleSort(setSort, "assigned_to", sort)} />
              <ThSort label="Facility" active={sort.key === "facility"} dir={sort.dir} onClick={() => toggleSort(setSort, "facility", sort)} />
              <ThSort label="Reported" active={sort.key === "reported_at"} dir={sort.dir} onClick={() => toggleSort(setSort, "reported_at", sort)} />
              <th className="p-3 w-[220px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="p-10 text-center">
                  <div className="inline-flex items-center gap-2 opacity-70">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading issues…
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={11} className="p-10 text-center text-red-300">
                  {error}
                </td>
              </tr>
            ) : issues.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-10 text-center opacity-70">
                  No issues found. If your table has data, check RLS policies.
                </td>
              </tr>
            ) : (
              issues.map((i) => (
                <tr key={i.id} className="border-t border-white/10 hover:bg-white/[0.03]">
                  <td className="p-3 align-top">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(i.id)}
                      onChange={() => toggleSelect(i.id)}
                    />
                  </td>
                  <td className="p-3 align-top font-medium">{i.reference || "—"}</td>
                  <td className="p-3 align-top">{i.type || "—"}</td>
                  <td className="p-3 align-top">
                    <span
                      className={classNames(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                        severityBadgeClasses(i.severity)
                      )}
                      title={i.severity}
                    >
                      {i.severity || "—"}
                    </span>
                  </td>
                  <td className="p-3 align-top">
                    <span
                      className={classNames(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                        statusBadgeClasses(i.status)
                      )}
                      title={i.status}
                    >
                      {i.status || "—"}
                    </span>
                  </td>
                  <td className="p-3 align-top">{i.load_id || "—"}</td>
                  <td className="p-3 align-top">
                    <div className="line-clamp-2 opacity-90">{i.description || "—"}</div>
                  </td>
                  <td className="p-3 align-top">{i.assigned_to || "—"}</td>
                  <td className="p-3 align-top">{i.facility || "—"}</td>
                  <td className="p-3 align-top">
                    <div className="flex items-center gap-2">
                      <span>{fmtDate(i.reported_at)}</span>
                      <span className="text-xs opacity-60">({ageSince(i.reported_at)})</span>
                    </div>
                  </td>
                  <td className="p-3 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-2 py-1 hover:bg-white/5"
                        title="View details"
                        onClick={() => openEdit(i)}
                      >
                        <Eye className="h-4 w-4" /> View
                      </button>

                      <div className="relative group">
                        <button className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-2 py-1 hover:bg-white/5">
                          <Edit className="h-4 w-4" /> Update
                          <ChevronDown className="h-3 w-3 opacity-70" />
                        </button>
                        <div className="absolute z-10 hidden group-hover:block mt-1 w-44 rounded-xl border border-white/10 bg-[var(--bg-surface)] p-1">
                          {STATUS_CHOICES.map((s) => (
                            <button
                              key={s.value}
                              onClick={() => updateIssueStatus(i.id, s.value)}
                              className="w-full text-left px-2 py-1 rounded-lg hover:bg-white/5"
                            >
                              Set {s.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="relative group">
                        <button className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-2 py-1 hover:bg-white/5">
                          <UserPlus className="h-4 w-4" /> Assign
                          <ChevronDown className="h-3 w-3 opacity-70" />
                        </button>
                        <div className="absolute z-10 hidden group-hover:block mt-1 w-56 rounded-xl border border-white/10 bg-[var(--bg-surface)] p-2">
                          <InlineAssign
                            currentValue={i.assigned_to || ""}
                            onSubmit={(name) => assignIssue(i.id, name)}
                          />
                        </div>
                      </div>

                      <button
                        className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/30 text-emerald-300 px-2 py-1 hover:bg-emerald-500/10"
                        title="Resolve quickly"
                        onClick={() => updateIssueStatus(i.id, "RESOLVED")}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Resolve
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {createOpen && (
        <CreateIssueModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await fetchIssues();
          }}
        />
      )}

      {/* Edit modal */}
      {editOpen && editingIssue && (
        <EditIssueModal
          issue={editingIssue}
          onClose={() => {
            setEditOpen(false);
            setEditingIssue(null);
          }}
          onSaved={async () => {
            setEditOpen(false);
            setEditingIssue(null);
            await fetchIssues();
          }}
        />
      )}
    </div>
  );
}

/* Components */

function StatCard({ title, value, icon, subtitle, tone }) {
  const ring =
    tone === "critical"
      ? "ring-red-500/30"
      : tone === "high"
      ? "ring-orange-500/30"
      : "ring-white/10";
  return (
    <div className={classNames("rounded-2xl border border-white/10 bg-[var(--bg-surface)] p-4 ring-1", ring)}>
      <div className="flex items-center justify-between">
        <div className="text-sm opacity-70">{title}</div>
        <div className="opacity-70">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {subtitle && <div className="text-xs opacity-60 mt-1">{subtitle}</div>}
    </div>
  );
}

function ThSort({ label, active, dir, onClick }) {
  return (
    <th className="p-3">
      <button
        onClick={onClick}
        className={classNames(
          "inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5",
          active && "bg-white/[0.04]"
        )}
      >
        {label}
        <ArrowUpDown className={classNames("h-3.5 w-3.5 opacity-70", active && "opacity-100")} />
        {active && <span className="sr-only">{dir === "asc" ? "Ascending" : "Descending"}</span>}
      </button>
    </th>
  );
}
function toggleSort(setSort, key, sort) {
  setSort((prev) => {
    if (prev.key !== key) return { key, dir: "desc" };
    return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
  });
}

function Select({ value, onChange, options, icon }) {
  return (
    <div className="relative">
      <div className="absolute left-2 top-1/2 -translate-y-1/2">{icon}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-8 pr-8 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
      >
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 opacity-70 pointer-events-none" />
    </div>
  );
}

function InlineAssign({ currentValue, onSubmit }) {
  const [v, setV] = useState(currentValue);
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 px-2 py-1 rounded-lg bg-black/20 border border-white/10 outline-none"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Assignee name…"
      />
      <button
        onClick={() => onSubmit(v)}
        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2 py-1 hover:bg-emerald-500/10"
      >
        <UserPlus className="h-4 w-4" />
        Save
      </button>
    </div>
  );
}

function CreateIssueModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    reference: "",
    type: "",
    severity: "MEDIUM",
    load_id: "",
    description: "",
    status: "NEW",
    assigned_to: "",
    facility: "",
    reported_at: new Date().toISOString(),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function setField(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    try {
      setSaving(true);
      setErr("");
      const payload = { ...form };
      if (!payload.reference) payload.reference = `ISS-${Date.now().toString().slice(-6)}`;
      const { error } = await supabase.from("issues").insert(payload);
      if (error) throw error;
      await onCreated();
    } catch (e) {
      console.error("[Issues] create error:", e);
      setErr(e.message ?? "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Create New Issue" onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Reference">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.reference}
            onChange={(e) => setField("reference", e.target.value)}
            placeholder="e.g., ISS-1042"
          />
        </Field>
        <Field label="Type">
          <select
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.type}
            onChange={(e) => setField("type", e.target.value)}
          >
            <option value="">Select type…</option>
            {TYPE_CHOICES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.severity}
            onChange={(e) => setField("severity", e.target.value)}
          >
            {SEVERITY_CHOICES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.status}
            onChange={(e) => setField("status", e.target.value)}
          >
            {STATUS_CHOICES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Load / Shipment ID">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.load_id}
            onChange={(e) => setField("load_id", e.target.value)}
            placeholder="e.g., L-230015"
          />
        </Field>
        <Field label="Facility / Location">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.facility}
            onChange={(e) => setField("facility", e.target.value)}
            placeholder="e.g., SDDC Travis AFB"
          />
        </Field>

        <Field label="Assigned To">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.assigned_to}
            onChange={(e) => setField("assigned_to", e.target.value)}
            placeholder="e.g., Danielle"
          />
        </Field>
        <Field label="Reported At">
          <input
            type="datetime-local"
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={toLocal(form.reported_at)}
            onChange={(e) => setField("reported_at", fromLocal(e.target.value))}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea
              rows={4}
              className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Brief description of the problem…"
            />
          </Field>
        </div>
      </div>

      {err && <div className="text-red-300 text-sm mt-2">{err}</div>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 hover:bg-white/5">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2 hover:bg-emerald-500/10"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Issue
        </button>
      </div>
    </ModalShell>
  );
}

function EditIssueModal({ issue, onClose, onSaved }) {
  const [form, setForm] = useState({
    reference: issue.reference || "",
    type: issue.type || "",
    severity: issue.severity || "MEDIUM",
    load_id: issue.load_id || "",
    description: issue.description || "",
    status: issue.status || "NEW",
    assigned_to: issue.assigned_to || "",
    facility: issue.facility || "",
    reported_at: issue.reported_at || new Date().toISOString(),
    resolved_at: issue.resolved_at || null,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function setField(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    try {
      setSaving(true);
      setErr("");
      const payload = { ...form };
      const { error } = await supabase.from("issues").update(payload).eq("id", issue.id);
      if (error) throw error;
      await onSaved();
    } catch (e) {
      console.error("[Issues] edit error:", e);
      setErr(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this issue? This cannot be undone.")) return;
    const { error } = await supabase.from("issues").delete().eq("id", issue.id);
    if (error) {
      alert(error.message);
      return;
    }
    await onSaved();
  }

  return (
    <ModalShell title={`Issue ${issue.reference || issue.id}`} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Reference">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.reference}
            onChange={(e) => setField("reference", e.target.value)}
          />
        </Field>
        <Field label="Type">
          <select
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.type}
            onChange={(e) => setField("type", e.target.value)}
          >
            <option value="">Select type…</option>
            {TYPE_CHOICES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Severity">
          <select
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.severity}
            onChange={(e) => setField("severity", e.target.value)}
          >
            {SEVERITY_CHOICES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.status}
            onChange={(e) => setField("status", e.target.value)}
          >
            {STATUS_CHOICES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Load / Shipment ID">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.load_id}
            onChange={(e) => setField("load_id", e.target.value)}
          />
        </Field>
        <Field label="Facility / Location">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.facility}
            onChange={(e) => setField("facility", e.target.value)}
          />
        </Field>

        <Field label="Assigned To">
          <input
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={form.assigned_to}
            onChange={(e) => setField("assigned_to", e.target.value)}
          />
        </Field>
        <Field label="Reported At">
          <input
            type="datetime-local"
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={toLocal(form.reported_at)}
            onChange={(e) => setField("reported_at", fromLocal(e.target.value))}
          />
        </Field>

        <Field label="Resolved At (optional)">
          <input
            type="datetime-local"
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
            value={toLocal(form.resolved_at)}
            onChange={(e) => setField("resolved_at", fromLocal(e.target.value))}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea
              rows={4}
              className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 outline-none"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </Field>
        </div>
      </div>

      {err && <div className="text-red-300 text-sm mt-2">{err}</div>}

      <div className="mt-4 flex justify-between">
        <button
          onClick={remove}
          className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-red-300 hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 hover:bg-white/5">
            Close
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2 hover:bg-emerald-500/10"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs opacity-70">{label}</span>
      {children}
    </label>
  );
}
function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[var(--bg-base)]">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 p-1 hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
function toLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 16);
}
function fromLocal(localStr) {
  if (!localStr) return null;
  const d = new Date(localStr);
  return d.toISOString();
}
