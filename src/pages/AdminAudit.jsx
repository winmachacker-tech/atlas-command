import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, RefreshCw, Search } from "lucide-react";

const PAGE_SIZE = 25;

export default function AdminAudit() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [action, setAction] = useState(""); // '', INSERT, UPDATE, DELETE, SOFT_DELETE

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, action]);

  async function fetchAudit() {
    try {
      setLoading(true);
      setErrorMsg("");

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("loads_audit")
        .select("id, load_id, action, changed_at, changed_by, old_data, new_data", {
          count: "exact",
        })
        .order("changed_at", { ascending: false })
        .range(from, to);

      if (action) query = query.eq("action", action);

      const { data, error } = await query;
      if (error) throw error;

      setRows(data || []);
    } catch (e) {
      setErrorMsg(e.message || "Failed to load audit log.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase().trim();
    return rows.filter((r) => {
      const ref =
        (r.new_data?.reference || r.old_data?.reference || "").toLowerCase();
      const cust =
        (r.new_data?.customer || r.old_data?.customer || "").toLowerCase();
      const brk =
        (r.new_data?.broker || r.old_data?.broker || "").toLowerCase();
      return (
        ref.includes(needle) ||
        cust.includes(needle) ||
        brk.includes(needle) ||
        String(r.load_id).toLowerCase().includes(needle)
      );
    });
  }, [rows, q]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by Reference, Customer, Broker, or Load ID…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
          />
        </div>

        <select
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
          className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
        >
          <option value="">All Actions</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
          <option value="SOFT_DELETE">SOFT_DELETE</option>
        </select>

        <button
          onClick={fetchAudit}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="p-6 flex items-center gap-2">
          <Loader2 className="animate-spin" />
          <span>Loading audit log…</span>
        </div>
      ) : errorMsg ? (
        <div className="p-6 text-red-600 dark:text-red-400">{errorMsg}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Broker</th>
                <th className="py-2 pr-4">Load ID</th>
                <th className="py-2 pr-4">Changed By</th>
                <th className="py-2 pr-4">Diff</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const ref = r.new_data?.reference || r.old_data?.reference || "-";
                const cust = r.new_data?.customer || r.old_data?.customer || "-";
                const brk = r.new_data?.broker || r.old_data?.broker || "-";
                const when = r.changed_at
                  ? new Date(r.changed_at).toLocaleString()
                  : "-";
                return (
                  <tr
                    key={r.id}
                    className="border-b border-neutral-100 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
                  >
                    <td className="py-2 pr-4 whitespace-nowrap">{when}</td>
                    <td className="py-2 pr-4 font-medium">{r.action}</td>
                    <td className="py-2 pr-4">{ref}</td>
                    <td className="py-2 pr-4">{cust}</td>
                    <td className="py-2 pr-4">{brk}</td>
                    <td className="py-2 pr-4">{r.load_id}</td>
                    <td className="py-2 pr-4">{r.changed_by || "-"}</td>
                    <td className="py-2 pr-4">
                      <Details oldData={r.old_data} newData={r.new_data} />
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-neutral-500">
                    No audit entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 disabled:opacity-50"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <div className="px-2">Page {page}</div>
            <button
              className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800"
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Details({ oldData, newData }) {
  const [open, setOpen] = useState(false);

  // quick diff summary (show changed keys)
  const summary = useMemo(() => {
    if (!oldData && !newData) return "—";
    const oldKeys = Object.keys(oldData || {});
    const newKeys = Object.keys(newData || {});
    const keys = Array.from(new Set([...oldKeys, ...newKeys]));
    const changed = keys.filter((k) => (oldData || {})[k] !== (newData || {})[k]);
    if (!changed.length) return "no field changes";
    return `${changed.length} field(s): ${changed.slice(0, 4).join(", ")}${
      changed.length > 4 ? "…" : ""
    }`;
  }, [oldData, newData]);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs"
      >
        {open ? "Hide" : "View"} ({summary})
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          <JsonCard title="Old" data={oldData} />
          <JsonCard title="New" data={newData} />
        </div>
      )}
    </div>
  );
}

function JsonCard({ title, data }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-2 bg-neutral-50 dark:bg-neutral-900/40 text-xs overflow-auto max-h-64">
      <div className="font-medium mb-1">{title}</div>
      <pre className="whitespace-pre-wrap break-words">
        {JSON.stringify(data || {}, null, 2)}
      </pre>
    </div>
  );
}
