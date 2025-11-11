// src/pages/AIReview.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  RefreshCw,
  Filter,
  ArrowUpDown,
  ThumbsUp,
  ThumbsDown,
  Minus,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Download,
  Search,
  Eye,
  Trash2,
} from "lucide-react";

/* -------------------------- tiny class joiner -------------------------- */
function cx(...a) { return a.filter(Boolean).join(" "); }

/* ------------------------------ Defaults ------------------------------- */
const DEFAULT_RANGE_DAYS = 30;
const RATINGS = [
  { value: "up", label: "Thumbs Up", icon: ThumbsUp },
  { value: "down", label: "Thumbs Down", icon: ThumbsDown },
  { value: "neutral", label: "Neutral", icon: Minus },
];

/**
 * Uses the updatable VIEW: public.dispatch_feedback
 * Columns (nullable-safe): id, created_at, org_id, user_id, source, item_id,
 * load_id, load_number, driver_id, truck_id, trailer_id, equipment, trailer_type,
 * rating, comment, note, meta, reviewed, accepted, ai_version, intent
 */
export default function AIReview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Filters
  const [q, setQ] = useState("");
  const [rating, setRating] = useState("any"); // up | down | neutral | any
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false); // show all by default
  const [days, setDays] = useState(DEFAULT_RANGE_DAYS);
  const [source, setSource] = useState("any"); // any or exact source

  // Selection
  const [selected, setSelected] = useState(new Set());

  const sinceISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(days || DEFAULT_RANGE_DAYS));
    return d.toISOString();
  }, [days]);

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = useMemo(() => rows.length > 0 && rows.every((r) => selected.has(r.id)), [rows, selected]);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }, [allSelected, rows]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      let qry = supabase
        .from("dispatch_feedback") // <- VIEW, same endpoint you POST into
        .select("*")
        .gte("created_at", sinceISO)
        .order("created_at", { ascending: false });

      if (rating !== "any") qry = qry.eq("rating", rating);
      if (onlyUnreviewed) qry = qry.eq("reviewed", false);
      if (source !== "any") qry = qry.eq("source", source);

      const { data, error } = await qry;
      if (error) throw error;

      let data2 = data || [];
      if (q?.trim()) {
        const needle = q.trim().toLowerCase();
        data2 = data2.filter((r) => JSON.stringify(r || {}).toLowerCase().includes(needle));
      }
      setRows(data2);
    } catch (e) {
      setRows([]);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [sinceISO, rating, onlyUnreviewed, source, q]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Derive unique sources for filter dropdown (from current rows to avoid extra queries)
  const sources = useMemo(() => ["any", ...Array.from(new Set(rows.map((r) => r?.source).filter(Boolean)))], [rows]);

  const counts = useMemo(() => {
    const c = { up: 0, down: 0, neutral: 0, total: rows.length || 0 };
    for (const r of rows) {
      if (r?.rating === "up") c.up++;
      else if (r?.rating === "down") c.down++;
      else c.neutral++;
    }
    return c;
  }, [rows]);

  const markReviewed = useCallback(async (ids) => {
    if (!ids?.length) return;
    const { error } = await supabase.from("dispatch_feedback_events").update({ reviewed: true }).in("id", ids);
    if (error) { setErr(error.message || String(error)); return; }
    setSelected(new Set());
    fetchRows();
  }, [fetchRows]);

  const deleteSelected = useCallback(async (ids) => {
    if (!ids?.length) return;
    const { error } = await dispatch_feedback_events).delete().in("id", ids);
    if (error) { setErr(error.message || String(error)); return; }
    setSelected(new Set());
    fetchRows();
  }, [fetchRows]);

  const exportCSV = useCallback(() => {
    const header = [
      "id","created_at","source","item_id","load_id","load_number","driver_id","truck_id","trailer_id",
      "equipment","trailer_type","user_id","rating","comment","note","reviewed","accepted","ai_version","intent"
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const row = [
        r?.id || "",
        r?.created_at || "",
        safeCSV(r?.source),
        safeCSV(r?.item_id),
        r?.load_id || "",
        safeCSV(r?.load_number),
        r?.driver_id || "",
        r?.truck_id || "",
        r?.trailer_id || "",
        safeCSV(r?.equipment),
        safeCSV(r?.trailer_type),
        r?.user_id || "",
        r?.rating || "",
        safeCSV(r?.comment),
        safeCSV(r?.note),
        String(!!r?.reviewed),
        String(!!r?.accepted),
        safeCSV(r?.ai_version),
        safeCSV(r?.intent),
      ];
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-feedback_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">AI Review</h1>
          <p className="text-sm text-muted-foreground">Triage user feedback, label edge cases, and export data for training.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchRows} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
          </button>
          <button onClick={exportCSV} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </header>

      {/* Show errors prominently (e.g., RLS denial) */}
      {err && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="font-medium">Error:</span>
            <span className="truncate">{err}</span>
          </div>
        </div>
      )}

      {/* Top stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat title="Total in view" value={counts.total} icon={Eye} />
        <Stat title="ðŸ‘ Up" value={counts.up} icon={ThumbsUp} />
        <Stat title="ðŸ‘Ž Down" value={counts.down} icon={ThumbsDown} />
        <Stat title="âž– Neutral" value={counts.neutral} icon={Minus} />
      </section>

      {/* Filters */}
      <section className="rounded-xl border p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              <span className="text-sm">Days</span>
              <input type="number" min={1} max={180} className="input input-bordered w-24 px-2 py-1 rounded-md border"
                     value={days} onChange={(e) => setDays(e.target.value)} />
            </label>

            <label className="flex items-center gap-2">
              <span className="text-sm">Rating</span>
              <select className="px-2 py-1 rounded-md border" value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="any">Any</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
                <option value="neutral">Neutral</option>
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="text-sm">Source</span>
              <select className="px-2 py-1 rounded-md border" value={source} onChange={(e) => setSource(e.target.value)}>
                {sources.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </label>

            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={onlyUnreviewed} onChange={(e) => setOnlyUnreviewed(e.target.checked)} />
              <span className="text-sm">Only unreviewed</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-2.5 opacity-60" />
              <input className="pl-8 pr-3 py-2 rounded-md border w-72" placeholder="Search everything (client-side)"
                     value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button onClick={() => { setQ(""); setRating("any"); setSource("any"); setOnlyUnreviewed(false); setDays(DEFAULT_RANGE_DAYS); }}
                    className="px-3 py-2 rounded-md border hover:bg-muted">
              Reset
            </button>
          </div>
        </div>
      </section>

      {/* Bulk actions */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            <span className="text-sm">Select all</span>
          </label>

          <button onClick={() => markReviewed(Array.from(selected))}
                  disabled={!selected.size}
                  className={cx("inline-flex items-center gap-2 px-3 py-2 rounded-md border",
                                selected.size ? "hover:bg-muted" : "opacity-50 cursor-not-allowed")}>
            <CheckCircle2 className="w-4 h-4" /> Mark reviewed
          </button>

          <button onClick={() => deleteSelected(Array.from(selected))}
                  disabled={!selected.size}
                  className={cx("inline-flex items-center gap-2 px-3 py-2 rounded-md border",
                                selected.size ? "hover:bg-muted" : "opacity-50 cursor-not-allowed")}>
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>

        <div className="text-sm text-muted-foreground">
          {selected.size ? `${selected.size} selected` : `${rows.length} rows`}
        </div>
      </section>

      {/* Table */}
      <section className="overflow-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <Th> </Th>
              <Th>When</Th>
              <Th>Rating</Th>
              <Th>Source</Th>
              <Th>Item</Th>
              <Th>User</Th>
              <Th>Comment</Th>
              <Th>Intent</Th>
              <Th className="w-[30%]">Details (truncated)</Th>
              <Th>Reviewed</Th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">
                <Loader2 className="w-5 h-5 inline-block animate-spin mr-2" /> Loadingâ€¦
              </td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">
                No feedback found for these filters. Try turning off â€œOnly unreviewedâ€, expand the date range,
                or click a ðŸ‘/ðŸ‘Ž again to generate a fresh row.
              </td></tr>
            )}
            {!loading && rows.map((r) => {
              const Icon = r?.rating === "up" ? ThumbsUp : r?.rating === "down" ? ThumbsDown : Minus;
              const meta = r?.meta || {};
              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td className="p-3 whitespace-nowrap">{fmtWhen(r?.created_at)}</td>
                  <td className="p-3">
                    <span className={cx("inline-flex items-center gap-1 px-2 py-1 rounded-md border",
                                        r?.rating === "up" ? "border-emerald-400" :
                                        r?.rating === "down" ? "border-rose-400" : "border-slate-300")}>
                      <Icon className="w-3.5 h-3.5" /> {r?.rating || "neutral"}
                    </span>
                  </td>
                  <td className="p-3">{r?.source || "-"}</td>
                  <td className="p-3">{r?.item_id || r?.load_number || r?.load_id || "-"}</td>
                  <td className="p-3">{String(r?.user_id || "-")}</td>
                  <td className="p-3 max-w-[220px]"><div title={r?.comment || ""} className="line-clamp-2">{r?.comment || "-"}</div></td>
                  <td className="p-3">{meta?.intent || r?.intent || "-"}</td>
                  <td className="p-3">
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div className="line-clamp-2"><span className="font-medium text-foreground">Prompt:</span> {truncate(meta?.prompt, 240) || "-"}</div>
                      <div className="line-clamp-2"><span className="font-medium text-foreground">Response:</span> {truncate(meta?.response, 240) || "-"}</div>
                    </div>
                  </td>
                  <td className="p-3">
                    {r?.reviewed ? (
                      <span className="text-emerald-600">Yes</span>
                    ) : (
                      <button onClick={() => markReviewed([r.id])} className="text-indigo-600 hover:underline">Mark</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ----------------------------- Subcomponents ---------------------------- */
function Th({ children, className }) {
  return (
    <th className={cx("p-3 font-medium text-xs uppercase tracking-wide text-muted-foreground", className)}>
      <div className="inline-flex items-center gap-1">{children}<ArrowUpDown className="w-3.5 h-3.5 opacity-60" /></div>
    </th>
  );
}
function Stat({ title, value, icon: Icon }) {
  return (
    <div className="p-4 rounded-xl border bg-background">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{title}</p>
        <Icon className="w-4 h-4 opacity-70" />
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

/* -------------------------------- Utils -------------------------------- */
function truncate(str, n) { if (!str) return ""; return str.length <= n ? str : str.slice(0, n - 1) + "â€¦"; }
function safeCSV(v) { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return `"${s}"`; }
function fmtWhen(iso) { if (!iso) return "-"; const d = new Date(iso); return d.toLocaleString(); }

