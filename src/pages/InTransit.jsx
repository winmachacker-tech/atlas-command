// src/pages/InTransit.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock,
  Truck,
  MapPin,
  RefreshCcw,
  AlertCircle,
  Filter,
  X,
  Download,
  ChevronDown,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/* ------------------------------ Utilities ------------------------------ */
const IN_TRANSIT_STATUSES = [
  "IN_TRANSIT",
  "In Transit",
  "IN TRANSIT",
  "in transit",
  "In_Transit",
];

const LS_KEY = "intransit.filters.v1";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fromLocalInputValue(s) {
  if (!s) return null;
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}
function normalizeStatus(s) {
  if (!s) return "—";
  const up = String(s).toUpperCase();
  if (up === "IN_TRANSIT" || up === "IN TRANSIT") return "In Transit";
  return s;
}
function msToHuman(ms) {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  if (d > 0) return `${sign}${d}d ${h}h`;
  if (h > 0) return `${sign}${h}h ${m}m`;
  return `${sign}${m}m`;
}
function agingForRow(now, pickup, delivery) {
  // Priority: if delivery exists and is in the past -> overdue;
  // else if delivery exists -> due in ...
  // else if pickup exists and is in the past -> picked up ... ago;
  // else if pickup exists -> PU in ...
  if (delivery) {
    const dms = +delivery - +now;
    if (dms < 0) return { kind: "del_overdue", label: `DEL overdue ${msToHuman(dms)}` };
    return { kind: "del_due", label: `DEL in ${msToHuman(dms)}` };
  }
  if (pickup) {
    const pms = +pickup - +now;
    if (pms < 0) return { kind: "pu_passed", label: `PU ${msToHuman(pms)} ago` };
    return { kind: "pu_due", label: `PU in ${msToHuman(pms)}` };
  }
  return { kind: "unknown", label: "—" };
}

/* ----------------------------- Sort Options ---------------------------- */
const SORTS = [
  { id: "PU_ASC", label: "Pickup — Soonest first" },
  { id: "DEL_ASC", label: "Delivery — Soonest first" },
  { id: "CREATED_DESC", label: "Recently created" },
];

/* ------------------------------- Component ------------------------------ */
export default function InTransit() {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState({ loading: true, error: null });

  // Filters/search (restored from localStorage on mount)
  const [q, setQ] = useState("");
  const [pickupFrom, setPickupFrom] = useState("");
  const [pickupTo, setPickupTo] = useState("");
  const [deliveryFrom, setDeliveryFrom] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");
  const [onlyMissingDates, setOnlyMissingDates] = useState(false);
  const [driverAssignedOnly, setDriverAssignedOnly] = useState(false);
  const [sortId, setSortId] = useState("PU_ASC");

  // restore filters once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        setQ(s.q ?? "");
        setPickupFrom(s.pickupFrom ?? "");
        setPickupTo(s.pickupTo ?? "");
        setDeliveryFrom(s.deliveryFrom ?? "");
        setDeliveryTo(s.deliveryTo ?? "");
        setOnlyMissingDates(!!s.onlyMissingDates);
        setDriverAssignedOnly(!!s.driverAssignedOnly);
        setSortId(s.sortId ?? "PU_ASC");
      }
    } catch {
      /* ignore */
    }
  }, []);

  // persist filters when they change
  useEffect(() => {
    const payload = {
      q,
      pickupFrom,
      pickupTo,
      deliveryFrom,
      deliveryTo,
      onlyMissingDates,
      driverAssignedOnly,
      sortId,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [q, pickupFrom, pickupTo, deliveryFrom, deliveryTo, onlyMissingDates, driverAssignedOnly, sortId]);

  async function fetchInTransit() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      let query = supabase
        .from("loads")
        .select(
          [
            "id",
            "reference",
            "origin",
            "destination",
            "status",
            "pickup_at",
            "delivery_at",
            "driver_name",
            "created_at",
          ].join(",")
        )
        .is("deleted_at", null)
        .in("status", IN_TRANSIT_STATUSES)
        .limit(500); // we'll sort client-side to support all sorts in one pass

      // Search across reference/origin/destination
      const trimmed = q.trim();
      if (trimmed.length > 0) {
        const like = `%${trimmed}%`;
        query = query.or(
          `reference.ilike.${like},origin.ilike.${like},destination.ilike.${like}`
        );
      }

      // Date range filters
      if (pickupFrom) query = query.gte("pickup_at", fromLocalInputValue(pickupFrom));
      if (pickupTo) query = query.lte("pickup_at", fromLocalInputValue(pickupTo));
      if (deliveryFrom) query = query.gte("delivery_at", fromLocalInputValue(deliveryFrom));
      if (deliveryTo) query = query.lte("delivery_at", fromLocalInputValue(deliveryTo));

      // Quick toggles
      if (onlyMissingDates) {
        query = query.or("pickup_at.is.null,delivery_at.is.null");
      }
      if (driverAssignedOnly) {
        query = query.not("driver_name", "is", null).neq("driver_name", "");
      }

      const { data, error } = await query;
      if (error) throw error;

      setRows(Array.isArray(data) ? data : []);
      setState({ loading: false, error: null });
    } catch (err) {
      console.error("[InTransit] fetch error:", err);
      setState({ loading: false, error: err });
    }
  }

  useEffect(() => {
    fetchInTransit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearFilters() {
    setQ("");
    setPickupFrom("");
    setPickupTo("");
    setDeliveryFrom("");
    setDeliveryTo("");
    setOnlyMissingDates(false);
    setDriverAssignedOnly(false);
    setSortId("PU_ASC");
    setTimeout(fetchInTransit, 0);
  }

  // Prepare display rows + client-side sort + aging
  const pretty = useMemo(() => {
    const now = new Date();
    const list = (rows || []).map((r) => {
      const pickup = r.pickup_at ? new Date(r.pickup_at) : null;
      const delivery = r.delivery_at ? new Date(r.delivery_at) : null;
      const age = agingForRow(now, pickup, delivery);
      return {
        id: r.id,
        reference: r.reference ?? "—",
        origin: r.origin ?? "—",
        destination: r.destination ?? "—",
        status: normalizeStatus(r.status),
        pickup_at: pickup,
        delivery_at: delivery,
        driver_name: r.driver_name ?? "",
        created_at: r.created_at ? new Date(r.created_at) : null,
        _aging: age,
      };
    });

    const sorted = [...list];
    if (sortId === "PU_ASC") {
      sorted.sort((a, b) => (a.pickup_at?.getTime() ?? Infinity) - (b.pickup_at?.getTime() ?? Infinity));
    } else if (sortId === "DEL_ASC") {
      sorted.sort((a, b) => (a.delivery_at?.getTime() ?? Infinity) - (b.delivery_at?.getTime() ?? Infinity));
    } else if (sortId === "CREATED_DESC") {
      sorted.sort((a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0));
    }
    return sorted;
  }, [rows, sortId]);

  function exportCSV() {
    const header = [
      "id",
      "reference",
      "origin",
      "destination",
      "status",
      "pickup_at",
      "delivery_at",
      "driver_name",
      "created_at",
      "aging",
    ];
    const lines = [header.join(",")];
    pretty.forEach((r) => {
      const row = [
        r.id,
        safeCSV(r.reference),
        safeCSV(r.origin),
        safeCSV(r.destination),
        safeCSV(r.status),
        r.pickup_at ? r.pickup_at.toISOString() : "",
        r.delivery_at ? r.delivery_at.toISOString() : "",
        safeCSV(r.driver_name || ""),
        r.created_at ? r.created_at.toISOString() : "",
        safeCSV(r._aging?.label || ""),
      ];
      lines.push(row.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `in-transit-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function safeCSV(v) {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
    }

  return (
    <div className="p-6 md:p-8">
      <header className="mb-4 md:mb-6 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
              In Transit
            </h1>
            <p className="text-sm text-[color:var(--text-muted,#94a3b8)]">
              Search, filter, sort, and export active loads on the road.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Sort */}
            <div className="relative">
              <select
                value={sortId}
                onChange={(e) => setSortId(e.target.value)}
                className="appearance-none pr-8 rounded-2xl px-3 py-2 text-sm border border-[color:var(--border-weak,#233046)] bg-transparent"
                title="Sort"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-70" />
            </div>

            <button
              onClick={exportCSV}
              className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm border border-[color:var(--border-weak,#233046)] hover:bg-[color:var(--bg-surface,#111827)]"
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
              Export
            </button>

            <button
              onClick={fetchInTransit}
              className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm border border-[color:var(--border-weak,#233046)] hover:bg-[color:var(--bg-surface,#111827)]"
              title="Apply filters / Refresh"
            >
              <RefreshCcw className="h-4 w-4" />
              Apply
            </button>
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm border border-[color:var(--border-weak,#233046)] hover:bg-[color:var(--bg-surface,#111827)]"
              title="Clear filters"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-[color:var(--border-weak,#233046)] p-3">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 opacity-70" />
            <span className="text-sm opacity-80">Filters</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Search */}
            <div className="lg:col-span-4">
              <label className="text-[11px] opacity-70">Search (Load #, City, State)</label>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. AC-1024, Stockton, CA, El Paso"
                className="mt-1 w-full rounded-xl bg-transparent border border-[color:var(--border-weak,#233046)] px-3 py-2 text-sm"
              />
            </div>

            {/* Pickup range */}
            <div className="lg:col-span-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[11px] opacity-70">
                  Pickup From
                  <input
                    type="datetime-local"
                    className="block mt-1 w-full rounded-xl bg-transparent border border-[color:var(--border-weak,#233046)] px-2 py-2 text-sm"
                    value={pickupFrom}
                    onChange={(e) => setPickupFrom(e.target.value)}
                  />
                </label>
                <label className="text-[11px] opacity-70">
                  Pickup To
                  <input
                    type="datetime-local"
                    className="block mt-1 w-full rounded-xl bg-transparent border border-[color:var(--border-weak,#233046)] px-2 py-2 text-sm"
                    value={pickupTo}
                    onChange={(e) => setPickupTo(e.target.value)}
                  />
                </label>
              </div>
            </div>

            {/* Delivery range */}
            <div className="lg:col-span-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[11px] opacity-70">
                  Delivery From
                  <input
                    type="datetime-local"
                    className="block mt-1 w-full rounded-xl bg-transparent border border-[color:var(--border-weak,#233046)] px-2 py-2 text-sm"
                    value={deliveryFrom}
                    onChange={(e) => setDeliveryFrom(e.target.value)}
                  />
                </label>
                <label className="text-[11px] opacity-70">
                  Delivery To
                  <input
                    type="datetime-local"
                    className="block mt-1 w-full rounded-xl bg-transparent border border-[color:var(--border-weak,#233046)] px-2 py-2 text-sm"
                    value={deliveryTo}
                    onChange={(e) => setDeliveryTo(e.target.value)}
                  />
                </label>
              </div>
            </div>

            {/* Quick toggles */}
            <div className="lg:col-span-12 flex flex-wrap gap-4 items-center mt-1">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-current"
                  checked={onlyMissingDates}
                  onChange={(e) => setOnlyMissingDates(e.target.checked)}
                />
                Only loads missing PU/DEL dates
              </label>

              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-current"
                  checked={driverAssignedOnly}
                  onChange={(e) => setDriverAssignedOnly(e.target.checked)}
                />
                Driver assigned only
              </label>
            </div>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {state.error && (
        <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5" />
            <div>
              <p className="font-medium">Failed to load In Transit loads</p>
              <p className="text-sm opacity-80 mt-0.5">
                {state.error?.message || "Unknown error."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {state.loading && (
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-2xl border border-[color:var(--border-weak,#233046)] bg-[color:var(--bg-surface,#0b1220)] animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!state.loading && pretty.length === 0 && (
        <div className="rounded-2xl border border-[color:var(--border-weak,#233046)] bg-[color:var(--bg-surface,#0b1220)] p-10 text-center">
          <Truck className="mx-auto mb-3 h-7 w-7 opacity-70" />
          <p className="font-medium">No loads match your filters.</p>
          <p className="text-sm opacity-80">
            Adjust the search or date ranges, then click <em>Apply</em>.
          </p>
        </div>
      )}

      {/* Table */}
      {!state.loading && pretty.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[color:var(--border-weak,#233046)]">
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 text-xs uppercase tracking-wider text-[color:var(--text-muted,#94a3b8)] bg-[color:var(--bg-surface,#0b1220)] border-b border-[color:var(--border-weak,#233046)]">
            <div className="col-span-3">Load</div>
            <div className="col-span-3">Route</div>
            <div className="col-span-2">Driver</div>
            <div className="col-span-2">Pickup</div>
            <div className="col-span-1">Delivery</div>
            <div className="col-span-1">Aging</div>
          </div>

          <ul className="divide-y divide-[color:var(--border-weak,#233046)]">
            {pretty.map((r) => (
              <li
                key={r.id}
                className="px-4 py-3 hover:bg-[color:var(--bg-surface,#0b1220)]/60 transition-colors"
              >
                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <div className="font-medium">
                      <Link
                        to={`/loads/${encodeURIComponent(r.id)}`}
                        className="hover:underline"
                      >
                        {r.reference}
                      </Link>
                    </div>
                    <div className="text-xs text-[color:var(--text-muted,#94a3b8)]">
                      {r.status}
                    </div>
                  </div>

                  <div className="col-span-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span className="truncate">{r.origin}</span>
                      <span className="opacity-60">→</span>
                      <span className="truncate">{r.destination}</span>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      <span className="truncate">
                        {r.driver_name || "Unassigned"}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span className="truncate">
                        {r.pickup_at ? r.pickup_at.toLocaleString() : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-1">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span className="truncate">
                        {r.delivery_at ? r.delivery_at.toLocaleString() : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-1">
                    <AgingPill kind={r._aging.kind} label={r._aging.label} />
                  </div>
                </div>

                {/* Mobile card */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{r.reference}</div>
                    <span className="text-xs rounded-full border px-2 py-0.5">
                      {r.status}
                    </span>
                  </div>
                  <div className="mt-2 text-sm">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {r.origin} → {r.destination}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Truck className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {r.driver_name || "Unassigned"}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          {r.pickup_at ? r.pickup_at.toLocaleString() : "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          {r.delivery_at ? r.delivery_at.toLocaleString() : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <AgingPill kind={r._aging.kind} label={r._aging.label} />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Subviews ------------------------------- */
function AgingPill({ kind, label }) {
  let cls =
    "inline-block text-xs px-2 py-1 rounded-full border";
  if (kind === "del_overdue") {
    cls += " border-red-500/40 bg-red-500/10 text-red-200";
  } else if (kind === "del_due") {
    cls += " border-amber-500/40 bg-amber-500/10 text-amber-200";
  } else if (kind === "pu_passed") {
    cls += " border-sky-500/40 bg-sky-500/10 text-sky-200";
  } else if (kind === "pu_due") {
    cls += " border-blue-500/40 bg-blue-500/10 text-blue-200";
  } else {
    cls += " border-[color:var(--border-weak,#233046)] text-[color:var(--text-muted,#94a3b8)]";
  }
  return <span className={cls}>{label}</span>;
}
