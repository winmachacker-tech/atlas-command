// src/pages/AdminAudit.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  RefreshCw,
  User,
  Truck,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
} from "lucide-react";

/**
 * AdminAudit â€” with search, filters, pagination, and a JSON detail modal.
 * Client-side filtering for simplicity (50 x 2 rows fetched).
 */
export default function AdminAudit() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // UI state
  const [q, setQ] = useState("");
  const [type, setType] = useState("ALL"); // ALL | Load | Driver
  const [action, setAction] = useState("ALL"); // ALL | INSERT | UPDATE | DELETE
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [detail, setDetail] = useState(null); // record shown in modal

  async function fetchAudit() {
    setLoading(true);
    setErrorMsg("");
    setPage(1);

    try {
      const { data: loads, error: e1 } = await supabase
        .from("loads_audit")
        .select("id, load_id, action, changed_at, changed_by, new_data, old_data")
        .order("changed_at", { ascending: false })
        .limit(50);

      const { data: drivers, error: e2 } = await supabase
        .from("drivers_audit")
        .select("id, driver_id, action, changed_at, changed_by, new_data, old_data")
        .order("changed_at", { ascending: false })
        .limit(50);

      if (e1 || e2) throw e1 || e2;

      const merged = [
        ...(loads || []).map((r) => ({ ...r, type: "Load" })),
        ...(drivers || []).map((r) => ({ ...r, type: "Driver" })),
      ].sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));

      setRecords(merged);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Failed to load audit data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAudit();
  }, []);

  // Filtered + searched + paginated
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return records.filter((r) => {
      if (type !== "ALL" && r.type !== type) return false;
      if (action !== "ALL" && r.action !== action) return false;
      if (!needle) return true;

      const hay =
        JSON.stringify(r.new_data || r.old_data || {}).toLowerCase() +
        " " +
        (r.changed_by || "") +
        " " +
        r.type +
        " " +
        r.action;
      return hay.includes(needle);
    });
  }, [records, q, type, action]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageData = filtered.slice((page - 1) * pageSize, page * pageSize);

  function IconFor({ t }) {
    return t === "Load" ? <Truck size={16} /> : <User size={16} />;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin Audit</h1>
        <button
          onClick={fetchAudit}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black text-white hover:bg-black/80 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search details, user, actionâ€¦"
            className="bg-transparent outline-none"
          />
        </div>

        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
        >
          <option value="ALL">All Types</option>
          <option value="Load">Load</option>
          <option value="Driver">Driver</option>
        </select>

        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
        >
          <option value="ALL">All Actions</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>

        <div className="ml-auto text-sm text-neutral-500">
          {filtered.length} result{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 text-neutral-500">
          <Loader2 className="animate-spin h-5 w-5" />
          Loading audit records...
        </div>
      ) : errorMsg ? (
        <div className="text-red-600">{errorMsg}</div>
      ) : filtered.length === 0 ? (
        <div className="text-neutral-500">No audit events match your filters.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-100 dark:bg-neutral-900">
                <tr className="text-left">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Changed By</th>
                  <th className="px-3 py-2">Changed At</th>
                  <th className="px-3 py-2">Details</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pageData.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-neutral-200 dark:border-neutral-800"
                  >
                    <td className="px-3 py-2 flex items-center gap-2">
                      <IconFor t={r.type} />
                      {r.type}
                    </td>
                    <td className="px-3 py-2">{r.action}</td>
                    <td className="px-3 py-2">{r.changed_by || "â€”"}</td>
                    <td className="px-3 py-2">
                      {new Date(r.changed_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <pre className="max-w-xs truncate text-xs text-neutral-500">
                        {JSON.stringify(r.new_data || r.old_data || {}, null, 0)}
                      </pre>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setDetail(r)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        title="View full JSON"
                      >
                        <Eye size={14} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-end gap-2 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800 disabled:opacity-50"
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <span className="px-2">
              Page {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800 disabled:opacity-50"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDetail(null)}
          />
          <div className="relative z-10 w-full max-w-3xl rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">
                {detail.type} â€¢ {detail.action} â€¢{" "}
                {new Date(detail.changed_at).toLocaleString()}
              </div>
              <button
                onClick={() => setDetail(null)}
                className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900"
                aria-label="Close"
              >
                <X />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                <div className="font-medium mb-2">New Data</div>
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(detail.new_data || {}, null, 2)}
                </pre>
              </div>
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                <div className="font-medium mb-2">Old Data</div>
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(detail.old_data || {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

