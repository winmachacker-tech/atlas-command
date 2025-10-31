import { useEffect, useMemo, useState } from "react";
import { listLoads } from "../lib/api";

const PAGE_SIZE = 25;
const STATUS = ["ALL","AVAILABLE","IN_TRANSIT","DELIVERED","CANCELLED","AT_RISK","PROBLEM"];

function cx(...a) { return a.filter(Boolean).join(" "); }
function useDebounced(value, ms=300){
  const [v, setV] = useState(value);
  useEffect(()=>{ const t=setTimeout(()=>setV(value), ms); return ()=>clearTimeout(t); },[value,ms]);
  return v;
}

export default function Loads(){
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);

  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = useMemo(()=>Math.max(1, Math.ceil(total / PAGE_SIZE)),[total]);

  async function fetchLoads(){
    setLoading(true); setErrorMsg("");
    try{
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { rows, count } = await listLoads({ q: dq, status, from, to });
      setRows(rows);
      setTotal(count);
    }catch(e){
      setErrorMsg(e.message || "Failed to load");
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{ setPage(1); }, [dq, status]);
  useEffect(()=>{ fetchLoads(); /* eslint-disable-next-line */ }, [dq, status, page]);

  useEffect(()=>{
    function onAdded(){ fetchLoads(); }
    window.addEventListener("loads:refresh", onAdded);
    return () => window.removeEventListener("loads:refresh", onAdded);
  }, []); // eslint-disable-line

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <input
          value={q}
          onChange={(e)=>setQ(e.target.value)}
          placeholder="Search reference, customer, broker, city…"
          className="w-full md:w-80 rounded-xl border px-3 py-2 bg-white dark:bg-neutral-950 dark:border-neutral-800"
        />
        <select
          value={status}
          onChange={(e)=>setStatus(e.target.value)}
          className="rounded-xl border px-3 py-2 bg-white dark:bg-neutral-950 dark:border-neutral-800"
        >
          {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={()=>fetchLoads()}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-neutral-900 dark:border-neutral-800"
            title="Refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table states */}
      {loading && <div className="rounded-2xl border dark:border-neutral-800 p-6 animate-pulse">Loading…</div>}
      {!loading && errorMsg && (
        <div className="rounded-2xl border border-red-300/40 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 p-6">
          <div className="font-medium text-red-700 dark:text-red-200">Error</div>
          <div className="text-sm opacity-80">{errorMsg}</div>
          <button onClick={()=>fetchLoads()} className="mt-3 rounded-xl border px-3 py-1 text-sm">Retry</button>
        </div>
      )}
      {!loading && !errorMsg && rows.length === 0 && (
        <div className="rounded-2xl border dark:border-neutral-800 p-6">
          <div className="font-medium">No loads found</div>
          <div className="text-sm opacity-70">Try clearing filters or adding data.</div>
        </div>
      )}

      {!loading && !errorMsg && rows.length > 0 && (
        <div className="rounded-2xl border dark:border-neutral-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-neutral-900">
              <tr>
                <Th>Reference</Th>
                <Th>Customer</Th>
                <Th>Broker</Th>
                <Th>Status</Th>
                <Th>Origin</Th>
                <Th>Destination</Th>
                <Th>ETA</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id} className="border-t dark:border-neutral-800 hover:bg-gray-50/50 dark:hover:bg-neutral-900/50">
                  <Td className="font-medium">{r.reference || "—"}</Td>
                  <Td>{r.customer || "—"}</Td>
                  <Td>{r.broker || "—"}</Td>
                  <Td>{r.status || "—"}</Td>
                  <Td>{fmtCity(r.origin_city, r.origin_state)}</Td>
                  <Td>{fmtCity(r.dest_city, r.dest_state)}</Td>
                  <Td>{fmtETA(r.eta)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-70">Page {page} of {totalPages} • {total} loads</div>
          <div className="flex items-center gap-2">
            <button
              onClick={()=>setPage(p=>Math.max(1,p-1))}
              disabled={page===1}
              className={cx("rounded-xl border px+3 py-1 text-sm", page===1 && "opacity-50 cursor-not-allowed")}
            >Prev</button>
            <button
              onClick={()=>setPage(p=>Math.min(totalPages,p+1))}
              disabled={page===totalPages}
              className={cx("rounded-xl border px-3 py-1 text-sm", page===totalPages && "opacity-50 cursor-not-allowed")}
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left p-3 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className="" }) {
  return <td className={cx("p-3 align-top whitespace-nowrap", className)}>{children}</td>;
}
function fmtCity(city, st) {
  const a = city || ""; const b = st ? (a ? `, ${st}` : st) : "";
  return a || b ? `${a}${b}` : "—";
}
function fmtETA(x) {
  if (!x) return "—";
  try { return new Date(x).toLocaleString(); } catch { return String(x); }
}
