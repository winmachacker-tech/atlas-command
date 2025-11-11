// src/pages/AIRecommendations.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  RefreshCw,
  Filter,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Archive,
  Trash2,
  Bot,
  User,
  Truck,
  FileText,
  Info,
  Bell,
  PlaySquare, // NEW: for "Assign now"
} from "lucide-react";
import { supabase } from "../lib/supabase";

/* ----------------------------- tiny utilities ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fmtWhen(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d || "â€”";
  }
}
function useDebouncedValue(value, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* --------------------------------- types --------------------------------- */
/**
 * Expected table (adjust names if your schema differs):
 *  table: ai_recommendations
 *    id uuid (pk, default gen_random_uuid())
 *    created_at timestamptz default now()
 *    title text
 *    content text
 *    source text           -- e.g. "dispatch-intent", "human", "system", "auto"
 *    kind text             -- e.g. "AI" | "HUMAN"    (optional)
 *    severity text         -- "LOW" | "MEDIUM" | "HIGH" (optional)
 *    status text           -- "NEW" | "ACCEPTED" | "REJECTED" | "ARCHIVED"
 *    related_type text     -- "LOAD" | "DRIVER" | "TRUCK" (optional)
 *    related_id uuid       -- reference id to loads/drivers/trucks (optional)
 *    tags text[]           -- (optional)
 *    meta jsonb            -- (optional; used for Assign now)
 *    created_by uuid       -- (optional)
 */

/* ------------------------------- page state ------------------------------ */
const TYPE_FILTERS = [
  { label: "All", value: "ALL" },
  { label: "Loads", value: "LOAD" },
  { label: "Drivers", value: "DRIVER" },
  { label: "Trucks", value: "TRUCK" },
  { label: "Unlinked", value: "NONE" },
];

const STATUS_COLORS = {
  NEW: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ACCEPTED: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  REJECTED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  ARCHIVED: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};
const SEVERITY_COLORS = {
  LOW: "bg-zinc-500/15 text-zinc-200 border-zinc-500/30",
  MEDIUM: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  HIGH: "bg-red-500/15 text-red-300 border-red-500/30",
};

/* --------------------------------- Modal --------------------------------- */
function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
          <button
            className="rounded-lg border border-zinc-800 p-2 text-zinc-300 hover:bg-zinc-800"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ badge chip ------------------------------- */
function Chip({ children, tone = "default", title, className = "" }) {
  const toneMap = {
    default: "bg-zinc-700/40 text-zinc-200 border-zinc-700/60",
    info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    danger: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  };
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium",
        toneMap[tone] || toneMap.default,
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------ main component --------------------------- */
export default function AIRecommendations() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [okMsg, setOkMsg] = useState(null); // NEW: success banner

  const [typeFilter, setTypeFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);

  const [openNew, setOpenNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    content: "",
    source: "dispatch-intent",
    severity: "MEDIUM",
    status: "NEW",
    related_type: "LOAD",
    related_id: "",
    kind: "AI",
    tags: "",
  });

  /* ðŸ”” Live polling for new auto-recs */
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [newAutoCount, setNewAutoCount] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const pollRef = useRef(null);
  const POLL_MS = 30_000; // 30s

  /* ðŸ”Œ Edge Functions env (for dispatch-intent) */
  const [envs, setEnvs] = useState({ functionsUrl: "", anonPresent: false });
  useEffect(() => {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
    const FUNCTIONS_URL =
      import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
      (SUPABASE_URL ? `${new URL(SUPABASE_URL).origin}/functions/v1` : "");
    const ANON = Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);
    setEnvs({ functionsUrl: FUNCTIONS_URL, anonPresent: ANON });
  }, []);

  /* ------------------------------ data fetcher --------------------------- */
  async function fetchData() {
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      let q = supabase
        .from("ai_recommendations")
        .select(
          `
            id, created_at, title, content, source, kind,
            severity, status, related_type, related_id, tags, meta
          `
        )
        .order("created_at", { ascending: false });

      // type filter
      if (typeFilter === "NONE") {
        q = q.is("related_id", null);
      } else if (typeFilter !== "ALL") {
        q = q.eq("related_type", typeFilter);
      }

      // simple search over title/content/source
      if (debounced?.trim()) {
        const s = `%${debounced.trim()}%`;
        q = q.or(
          `title.ilike.${s},content.ilike.${s},source.ilike.${s},related_type.ilike.${s}`
        );
      }

      const { data, error } = await q;
      if (error) throw error;

      setItems(data || []);
      setNewAutoCount(0);
      setLastFetchedAt(new Date().toISOString()); // mark snapshot after successful fetch
    } catch (e) {
      console.error(e);
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, debounced]);

  /* ---------------------------- live polling loop ----------------------- */
  useEffect(() => {
    if (!liveEnabled) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    async function tick() {
      try {
        if (!lastFetchedAt) return; // wait until first load finishes
        // Count NEW auto-recs created since last fetch
        const { count, error } = await supabase
          .from("ai_recommendations")
          .select("id", { count: "exact", head: true })
          .eq("status", "NEW")
          .eq("source", "auto")
          .gt("created_at", lastFetchedAt);
        if (error) throw error;
        setNewAutoCount(count || 0);
      } catch (e) {
        // keep quiet in background
      }
    }

    // run once on attach, then interval
    tick();
    const id = setInterval(tick, POLL_MS);
    pollRef.current = id;
    return () => {
      if (id) clearInterval(id);
    };
  }, [liveEnabled, lastFetchedAt]);

  /* ----------------------------- mutations ------------------------------ */
  async function updateStatus(id, status) {
    try {
      const { error } = await supabase
        .from("ai_recommendations")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
      setItems((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r))
      );
    } catch (e) {
      console.error(e);
      setErr(`Failed to update status: ${e.message || e}`);
    }
  }

  async function deleteItem(id) {
    if (!confirm("Delete this recommendation?")) return;
    try {
      const { error } = await supabase
        .from("ai_recommendations")
        .delete()
        .eq("id", id);
      if (error) throw error;
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error(e);
      setErr(`Failed to delete: ${e.message || e}`);
    }
  }

  async function createItem() {
    setCreating(true);
    setErr(null);
    setOkMsg(null);
    try {
      const payload = {
        title: createForm.title?.trim() || "(untitled)",
        content: createForm.content?.trim() || "",
        source: createForm.source?.trim() || "system",
        severity: createForm.severity,
        status: createForm.status,
        related_type:
          createForm.related_type === "NONE" ? null : createForm.related_type,
        related_id: createForm.related_id?.trim() || null,
        kind: createForm.kind,
        tags:
          createForm.tags?.trim()
            ? createForm.tags
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : null,
      };

      const { data, error } = await supabase
        .from("ai_recommendations")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      setItems((prev) => [data, ...prev]);
      setOpenNew(false);
      setCreateForm({
        title: "",
        content: "",
        source: "dispatch-intent",
        severity: "MEDIUM",
        status: "NEW",
        related_type: "LOAD",
        related_id: "",
        kind: "AI",
        tags: "",
      });
      setLastFetchedAt(new Date().toISOString());
      setOkMsg("Created.");
    } catch (e) {
      console.error(e);
      setErr(`Failed to create: ${e.message || e}`);
    } finally {
      setCreating(false);
    }
  }

  /* --------- call Edge Function for explicit assign (dispatch-intent) ---- */
  async function callFunction(path, body) {
    const { data: s } = await supabase.auth.getSession();
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
    const token = s?.session?.access_token || anonKey;

    const res = await fetch(`${envs.functionsUrl}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { res, data };
  }

  async function assignNow(rec) {
    setErr(null);
    setOkMsg(null);
    try {
      if (!envs.functionsUrl) {
        throw new Error("Missing FUNCTIONS URL (set VITE_SUPABASE_FUNCTIONS_URL or VITE_SUPABASE_URL).");
      }
      if (!rec || rec.status !== "NEW") {
        throw new Error("Only NEW recommendations can be assigned.");
      }
      if (rec.related_type !== "LOAD" || !rec.related_id) {
        throw new Error("Recommendation is not linked to a LOAD.");
      }
      const driverId = rec?.meta?.recommended_driver_id || null;
      if (!driverId) {
        throw new Error("No recommended driver found in meta. Generate new autos with the latest function.");
      }

      // POST to dispatch-intent with explicit IDs
      const { res, data } = await callFunction("dispatch-intent", {
        action: "assign",
        load_id: rec.related_id,
        driver_id: driverId,
        dryRun: false,
      });
      if (!res.ok) {
        const msg = data?.error || data?.message || `Edge error (${res.status})`;
        throw new Error(msg);
      }

      // flip status to ACCEPTED on success
      await updateStatus(rec.id, "ACCEPTED");
      setOkMsg(data?.message || "Assigned driver and marked as ACCEPTED.");
      // refresh to reflect movement in list ordering
      await fetchData();
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  /* ----------------------------- render bits ---------------------------- */
  function RelatedLink({ related_type, related_id }) {
    if (!related_id) {
      return <span className="text-zinc-400">â€”</span>;
    }
    let to = "#";
    let icon = <Info size={14} />;
    if (related_type === "LOAD") {
      to = `/loads/${related_id}`;
      icon = <FileText size={14} />;
    } else if (related_type === "DRIVER") {
      to = `/drivers/${related_id}`;
      icon = <User size={14} />;
    } else if (related_type === "TRUCK") {
      to = `/trucks/${related_id}`;
      icon = <Truck size={14} />;
    }
    return (
      <Link
        to={to}
        className="inline-flex items-center gap-1 text-sm text-sky-300 hover:underline"
      >
        {icon}
        <span className="font-medium">{String(related_id).slice(0, 8)}â€¦</span>
      </Link>
    );
  }

  const empty = !busy && items.length === 0;

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-100">
          AI Recommendations
        </h1>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={liveEnabled}
            onChange={(e) => setLiveEnabled(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          Live updates
        </label>
      </div>
      <p className="mb-4 text-sm text-zinc-400">
        Central hub for AI-generated (and human-curated) dispatch recommendations.
      </p>

      {/* ðŸ”” New auto recs banner */}
      {newAutoCount > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          <Bell className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">
              {newAutoCount} new auto recommendation{newAutoCount > 1 ? "s" : ""} available
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={fetchData}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-800/50 bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-800/30"
              >
                <RefreshCw className="h-4 w-4" />
                Load new items
              </button>
              <button
                onClick={() => setNewAutoCount(0)}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* alerts */}
      {okMsg && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-900/40 bg-emerald-950/30 p-3 text-emerald-200 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{okMsg}</div>
        </div>
      )}
      {err && (
        <div className="mb-3 rounded-xl border border-rose-800/40 bg-rose-900/20 p-3 text-rose-200">
          <div className="mb-1 font-semibold">Error</div>
          <div className="text-sm opacity-90">
            {err}
            <div className="mt-1 text-xs text-rose-300/80">
              Tip: Ensure a table named <code>ai_recommendations</code> exists
              with columns used on this page (title, content, status, meta, etc.).
            </div>
          </div>
        </div>
      )}

      {/* controls */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <select
              className="w-44 rounded-xl border border-zinc-800 bg-zinc-900/80 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 focus:ring-2"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              {TYPE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 pl-9 pr-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-500 focus:ring-2"
              placeholder="Search title/content/sourceâ€¦"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw className={cx("h-4 w-4", busy && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setOpenNew(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            New
          </button>
        </div>
      </div>

      {/* list */}
      <div className="space-y-3">
        {busy && (
          <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-zinc-300">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loadingâ€¦
          </div>
        )}

        {!busy && items.length === 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-400">
            No recommendations yet. Click{" "}
            <span className="text-zinc-200">New</span> to add one.
          </div>
        )}

        {items.map((r) => {
          const hasAssign =
            r?.status === "NEW" &&
            r?.related_type === "LOAD" &&
            !!r?.meta?.recommended_driver_id;

          return (
            <div
              key={r.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-zinc-100">
                      {r.title || "(untitled)"}
                    </h3>
                    <Chip
                      className={STATUS_COLORS[r.status] || undefined}
                      title={`Status: ${r.status || "NEW"}`}
                    >
                      {r.status || "NEW"}
                    </Chip>
                    {r.severity && (
                      <Chip
                        className={SEVERITY_COLORS[r.severity] || undefined}
                        title={`Severity: ${r.severity}`}
                      >
                        {r.severity}
                      </Chip>
                    )}
                    <Chip tone="info" title={`Source: ${r.source || "â€”"}`}>
                      <Bot size={12} />
                      {r.source || "â€”"}
                    </Chip>
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {fmtWhen(r.created_at)} â€¢{" "}
                    <span className="uppercase">
                      {r.related_type || "UNLINKED"}
                    </span>{" "}
                    â€¢{" "}
                    <RelatedLink
                      related_type={r.related_type}
                      related_id={r.related_id}
                    />
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {hasAssign && (
                    <button
                      onClick={() => assignNow(r)}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      title={`Assign ${r?.meta?.recommended_driver_name || "driver"} to this load`}
                    >
                      <PlaySquare className="h-4 w-4" />
                      Assign now
                    </button>
                  )}
                  {r.status === "NEW" && (
                    <button
                      onClick={() => updateStatus(r.id, "ACCEPTED")}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-700/30 bg-emerald-600/15 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-600/25"
                      title="Mark as accepted"
                    >
                      <CheckCircle2 size={14} />
                      Accept
                    </button>
                  )}
                  {r.status === "NEW" && (
                    <button
                      onClick={() => updateStatus(r.id, "REJECTED")}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-700/30 bg-rose-600/15 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-600/25"
                      title="Mark as rejected"
                    >
                      <AlertTriangle size={14} />
                      Reject
                    </button>
                  )}
                  {r.status !== "ARCHIVED" && (
                    <button
                      onClick={() => updateStatus(r.id, "ARCHIVED")}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/30 bg-zinc-700/15 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700/25"
                      title="Archive"
                    >
                      <Archive size={14} />
                      Archive
                    </button>
                  )}
                  <button
                    onClick={() => deleteItem(r.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                {r.content || "â€”"}
              </p>

              {!!r.tags?.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.tags.map((t, i) => (
                    <Chip key={i} tone="default" className="text-[11px]">
                      #{t}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New recommendation modal */}
      <Modal
        open={openNew}
        onClose={() => setOpenNew(false)}
        title="New Recommendation"
        footer={
          <>
            <button
              onClick={() => setOpenNew(false)}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={createItem}
              disabled={creating}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500",
                creating && "opacity-80"
              )}
            >
              {creating ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Create
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Title</label>
            <input
              value={createForm.title}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, title: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-500 focus:ring-2"
              placeholder="Short headline"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Source</label>
            <input
              value={createForm.source}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, source: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-500 focus:ring-2"
              placeholder="dispatch-intent / human / systemâ€¦"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Severity</label>
            <select
              value={createForm.severity}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, severity: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 focus:ring-2"
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Status</label>
            <select
              value={createForm.status}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, status: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 focus:ring-2"
            >
              <option value="NEW">NEW</option>
              <option value="ACCEPTED">ACCEPTED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Related Type</label>
            <select
              value={createForm.related_type}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, related_type: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 focus:ring-2"
            >
              <option value="LOAD">LOAD</option>
              <option value="DRIVER">DRIVER</option>
              <option value="TRUCK">TRUCK</option>
              <option value="NONE">NONE (unlinked)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Related ID (UUID)</label>
            <input
              value={createForm.related_id}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, related_id: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-500 focus:ring-2"
              placeholder="Optional"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-xs text-zinc-400">Content</label>
            <textarea
              rows={6}
              value={createForm.content}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, content: e.target.value }))
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-500 focus:ring-2"
              placeholder="Detailed recommendationâ€¦"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-xs text-zinc-400">Tags (comma-separated)</label>
            <input
              value={createForm.tags}
              onChange={(e) =>
                setCreateForm((s) => ({ ...s, tags: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-500 focus:ring-2"
              placeholder="e.g. detention,routing,follow-up"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

