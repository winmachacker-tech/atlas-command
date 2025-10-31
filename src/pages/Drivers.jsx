import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, RefreshCw, Users, Loader2, AlertTriangle } from "lucide-react";
import AddDriverModal from "../components/AddDriverModal";

function cx(...a) { return a.filter(Boolean).join(" "); }

export default function Drivers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { fetchDrivers(); }, []);

  async function fetchDrivers() {
    setLoading(true);
    setErr("");
    try {
      // RLS-scoped view
      const { data, error } = await supabase
        .from("v_drivers_active")
        .select("*")
        .order("last_name", { ascending: true });
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setErr(e.message || "Failed to load drivers");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="h-6 w-6" />
          Drivers
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchDrivers}
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900 border-neutral-200 dark:border-neutral-800"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-black text-white px-3 py-2 hover:bg-black/90"
            title="Add Driver"
          >
            <Plus className="h-4 w-4" /> Add Driver
          </button>
        </div>
      </div>

      {/* Status / errors */}
      {err ? (
        <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {err}
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500">
              <tr>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>CDL #</Th>
                <Th>Class</Th>
                <Th>CDL Exp.</Th>
                <Th>Med Exp.</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center">
                    <span className="inline-flex items-center gap-2 text-neutral-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading drivers…
                    </span>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-neutral-500">
                    No drivers yet. Click <b>Add Driver</b> to create your first one.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <Td>
                      <div className="font-medium">
                        {r.last_name}, {r.first_name}
                      </div>
                      <div className="text-xs text-neutral-500">{r.email || "—"}</div>
                    </Td>
                    <Td>{r.phone || "—"}</Td>
                    <Td className="font-mono">{r.license_number}</Td>
                    <Td>{r.license_class || "—"}</Td>
                    <Td>{fmtDate(r.license_expiry)}</Td>
                    <Td>{fmtDate(r.med_card_expiry)}</Td>
                    <Td>
                      <span
                        className={cx(
                          "px-2 py-1 rounded-md text-xs",
                          r.status === "ACTIVE" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
                          r.status === "INACTIVE" && "bg-neutral-100 text-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-200",
                          r.status === "SUSPENDED" && "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                        )}
                      >
                        {r.status}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <AddDriverModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => {
          setShowAdd(false);
          fetchDrivers();
        }}
      />
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left font-medium px-4 py-3">{children}</th>;
}
function Td({ children }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}
function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return "—"; }
}
