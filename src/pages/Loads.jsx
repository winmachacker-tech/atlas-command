// src/pages/Loads.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Search,
  RefreshCcw,
  Filter,
  ChevronLeft,
  ChevronRight,
  Truck,
  CheckCircle2,
  TriangleAlert,
  LayoutList,
} from "lucide-react";

/**
 * Atlas Command — Loads (safe v2)
 * - Correct Supabase usage: .from().select(...).eq()/in()/ilike() etc.
 * - RLS-safe: empty arrays render cleanly; errors show a soft banner
 * - Tabs for status (All, In Transit, Delivered, Problem)
 * - Search by reference/shipper/consignee/dispatcher
 * - Lightweight pagination (client-side over current query)
 */

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const TABS = [
  { key: "all", label: "All", icon: LayoutList },
  { key: "in_transit", label: "In Transit", icon: Truck },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 },
  { key: "problem", label: "Problem", icon: TriangleAlert },
];

const PAGE_SIZE = 20;

export default function Loads() {
  const [activeTab, setActiveTab] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    // status filter already applied in fetch; query applied here for snappy UX
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return (rows || []).filter((r) => {
      const fields = [
        r?.reference,
        r?.shipper_name,
        r?.consignee_name,
        r?.dispatcher_name,
        r?.driver_name,
        r?.truck_number,
        r?.trailer_number,
      ]
        .filter(Boolean)
        .map(String)
        .map((s) => s.toLowerCase());
      return fields.some((s) => s.includes(q));
    });
  }, [rows, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Fetch loads from Supabase
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setPage(1);
      try {
        // Base select: pick only fields we actually render
        let q = supabase
          .from("loads")
          .select(
            "id, reference, status, shipper_name, consignee_name, dispatcher_name, driver_name, truck_number, trailer_number, pickup_date, delivery_date",
            { head: false }
          );

        // Status filtering (server-side)
        if (activeTab === "in_transit") {
          q = q.in("status", ["in_transit", "dispatched", "in transit"]);
        } else if (activeTab === "delivered") {
          q = q.eq("status", "delivered");
        } else if (activeTab === "problem") {
          q = q.in("status", ["problem", "issue", "hold", "exception"]);
        }

        // Order newest first if you have timestamps; fallback by id
        q = q.order("delivery_date", { ascending: false, nullsFirst: false }).order("id", { ascending: false });

        const { data, error: err } = await q;
        if (err) throw err;

        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (cancelled) return;
        console.error("[Loads] fetch error:", e);
        setError(e?.message || "Failed to load loads");
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-zinc-200 bg-white/70 p-2 dark:border-zinc-800 dark:bg-zinc-900/70">
            <LayoutList className="h-5 w-5 text-zinc-700 dark:text-zinc-200" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Loads
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              View and filter current and historical loads (RLS-safe).
            </p>
          </div>
        </div>

        <div className="flex w-full items-center gap-2 md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              className="w-full rounded-xl border border-zinc-200 bg-white/70 py-2 pl-9 pr-3 text-sm outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-50"
              placeholder="Search reference, shipper, consignee, dispatcher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            onClick={() => setQuery("")}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
            title="Clear search"
          >
            <Filter className="h-4 w-4" />
            Filters
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                active
                  ? "border-zinc-300 bg-white text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  : "border-zinc-200 bg-white/60 text-zinc-600 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
        {loading ? (
          <span className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
            <RefreshCcw className="h-4 w-4 animate-spin" />
            Loading…
          </span>
        ) : null}
      </div>

      {/* Error banner */}
      {error ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="text-sm font-medium">Some data may be unavailable.</div>
          <div className="text-xs opacity-80">{String(error)}</div>
        </div>
      ) : null}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/70">
        <div className="grid grid-cols-12 border-b border-zinc-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="col-span-2">Reference</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Shipper</div>
          <div className="col-span-2">Consignee</div>
          <div className="col-span-2">Dispatcher</div>
          <div className="col-span-2 text-right">Pickup ▸ Delivery</div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
            Fetching loads…
          </div>
        ) : pageRows.length === 0 ? (
          <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
            No loads found for this filter. If you expect results, check RLS and your role permissions.
          </div>
        ) : (
          pageRows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-12 border-t border-zinc-100 px-4 py-3 text-sm hover:bg-white dark:border-zinc-800/70 dark:hover:bg-zinc-900"
            >
              <div className="col-span-2 font-medium text-zinc-900 dark:text-zinc-50">
                {r.reference || `#${r.id}`}
              </div>
              <div className="col-span-2">
                <StatusPill status={r.status} />
              </div>
              <div className="col-span-2 text-zinc-700 dark:text-zinc-300">
                {r.shipper_name || "—"}
              </div>
              <div className="col-span-2 text-zinc-700 dark:text-zinc-300">
                {r.consignee_name || "—"}
              </div>
              <div className="col-span-2 text-zinc-700 dark:text-zinc-300">
                {r.dispatcher_name || "—"}
              </div>
              <div className="col-span-2 text-right text-zinc-600 dark:text-zinc-400">
                {fmtDate(r.pickup_date)} ▸ {fmtDate(r.delivery_date)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
        <span>
          Page {page} of {pageCount} • {filtered.length} result{filtered.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white/70 px-2 py-1 hover:bg-white disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:bg-zinc-900"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white/70 px-2 py-1 hover:bg-white disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:bg-zinc-900"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtDate(val) {
  if (!val) return "—";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function StatusPill({ status }) {
  const s = String(status || "").toLowerCase();
  let tone =
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700";
  let label = status || "Unknown";

  if (["in_transit", "in transit", "dispatched"].includes(s)) {
    tone =
      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800/60";
    label = "In Transit";
  } else if (s === "delivered") {
    tone =
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800/60";
    label = "Delivered";
  } else if (["problem", "issue", "hold", "exception"].includes(s)) {
    tone =
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800/60";
    label = "Problem";
  }

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tone
      )}
    >
      {label}
    </span>
  );
}
