// src/pages/Delivered.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import RunAutoTrainButton from "../components/RunAutoTrainButton.jsx";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  RefreshCcw,
  Download,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Upload,
  ExternalLink,
  FileCheck2,
  Receipt,
} from "lucide-react";

const PAGE_SIZE = 20;
const POD_BUCKET = "pods";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fmtDate(d) {
  if (!d) return "â€”";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

export default function DeliveredPage() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);

  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [banner, setBanner] = useState(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / PAGE_SIZE)),
    [count]
  );

  // file inputs per row
  const fileInputs = useRef({}); // id -> input element

  useEffect(() => {
    fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, dateFrom, dateTo]);

  async function fetchPage(pageNumber) {
    setLoading(true);
    setErr(null);

    const from = (pageNumber - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    try {
      let query = supabase
        .from("loads")
        .select(
          "id, reference, status, shipper, origin, destination, pickup_date, delivery_date, notes, pod_url, pod_uploaded_at, billing_ready, billing_marked_at",
          { count: "exact" }
        )
        .eq("status", "DELIVERED");

      if (q.trim()) {
        const like = `%${q.trim()}%`;
        query = query.or(
          [
            `reference.ilike.${like}`,
            `shipper.ilike.${like}`,
            `origin.ilike.${like}`,
            `destination.ilike.${like}`,
          ].join(",")
        );
      }
      if (dateFrom) query = query.gte("delivery_date", dateFrom);
      if (dateTo) query = query.lte("delivery_date", dateTo);

      query = query.order("delivery_date", { ascending: false }).range(from, to);

      const { data, error, count: total } = await query;
      if (error) throw error;
      setRows(data ?? []);
      setCount(total ?? 0);
    } catch (e) {
      console.error("[Delivered] fetch error:", e);
      setErr(e.message ?? "Failed to load delivered loads.");
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setQ("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  function onExportCSV() {
    const header = [
      "Reference",
      "Shipper",
      "Origin",
      "Destination",
      "Pickup Date",
      "Delivery Date",
      "Status",
      "POD URL",
      "Notes",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.reference ?? "",
          r.shipper ?? "",
          r.origin ?? "",
          r.destination ?? "",
          fmtDate(r.pickup_date),
          fmtDate(r.delivery_date),
          r.status ?? "",
          r.pod_url ?? "",
          (r.notes ?? "").replace(/(\r\n|\n|\r)/g, " ").replace(/"/g, '""'),
        ]
          .map((v) => `"${String(v)}"`)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivered_loads_page_${page}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleChooseFile(rowId) {
    const input = fileInputs.current[rowId];
    if (input) input.click();
  }

  async function handleFileChange(row) {
    const input = fileInputs.current[row.id];
    if (!input || !input.files?.length) return;

    const file = input.files[0];
    input.value = ""; // reset so same file can be re-chosen later

    setBanner(null);
    setLoading(true);
    try {
      // Path: reference/timestamp_filename (fallback to id if no reference)
      const safeRef = (row.reference || row.id || "load")
        .toString()
        .replace(/[^a-zA-Z0-9-_]/g, "_");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `${safeRef}/${ts}_${file.name}`;

      // Upload
      const { error: upErr } = await supabase.storage
        .from(POD_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      // Public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from(POD_BUCKET).getPublicUrl(path);

      // Save URL to row
      // Prefer pod_url + pod_uploaded_at; fall back is an explicit error if column is missing.
      const update = {
        pod_url: publicUrl,
        pod_uploaded_at: new Date().toISOString(),
      };

      let updateRes = await supabase
        .from("loads")
        .update(update)
        .eq("id", row.id)
        .select()
        .single();

      if (updateRes.error) {
        // Try a very conservative fallback: store in notes (append)
        if (
          /column .*pod_url.* does not exist/i.test(updateRes.error.message) ||
          /pod_uploaded_at/.test(updateRes.error.message)
        ) {
          const appended =
            (row.notes ? row.notes + "\n" : "") + `POD: ${publicUrl}`;
          updateRes = await supabase
            .from("loads")
            .update({ notes: appended })
            .eq("id", row.id)
            .select()
            .single();

          if (updateRes.error) throw updateRes.error;

          setBanner(
            "POD uploaded. Column 'pod_url' not found, so the link was appended to Notes."
          );
        } else {
          throw updateRes.error;
        }
      } else {
        setBanner("POD uploaded successfully.");
      }

      // Refresh current page
      await fetchPage(page);
    } catch (e) {
      console.error("[Delivered] POD upload error:", e);
      setErr(
        e?.message ||
          "Upload failed. Check bucket permissions (public) and RLS policies."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkBilling(row) {
    setBanner(null);
    setLoading(true);
    try {
      // Preferred: set billing_ready + billing_marked_at
      let res = await supabase
        .from("loads")
        .update({
          billing_ready: true,
          billing_marked_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (res.error) {
        // Fallback: set status
        const res2 = await supabase
          .from("loads")
          .update({ status: "READY_FOR_BILLING" })
          .eq("id", row.id);

        if (res2.error) throw res2.error;

        setBanner(
          "Marked for billing by setting status to READY_FOR_BILLING (billing_* columns not found)."
        );
      } else {
        setBanner("Marked as Ready for Billing.");
      }

      await fetchPage(page);
    } catch (e) {
      console.error("[Delivered] billing mark error:", e);
      setErr(
        e?.message ||
          "Could not mark for billing. Ensure RLS allows update on this row."
      );
    } finally {
      setLoading(false);
    }
  }

  const showingFrom = Math.min(count, (page - 1) * PAGE_SIZE + 1);
  const showingTo = Math.min(count, page * PAGE_SIZE);

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Delivered Loads</h1>
          <p className="text-sm opacity-70">
            Upload PODs and mark loads ready for billing.
          </p>
        </div>

        {/* Right side: actions + auto-train */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchPage(page)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
              title="Refresh"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              <span className="text-sm">Refresh</span>
            </button>
            <button
              onClick={onExportCSV}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
              title="Export CSV (current page)"
            >
              <Download className="h-4 w-4" />
              <span className="text-sm">Export CSV</span>
            </button>
          </div>

          {/* AI auto-train button */}
          <RunAutoTrainButton />
        </div>
      </div>

      {/* Banner */}
      {banner && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {banner}
        </div>
      )}
      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {String(err)}
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/5 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search ref, shipper, origin, destinationâ€¦"
            className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none placeholder:opacity-60"
          />
        </div>

        <div className="relative">
          <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none"
          />
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-60">
            From
          </div>
        </div>

        <div className="relative">
          <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none"
          />
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-60">
            To
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clearFilters}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
            title="Clear all filters"
          >
            <X className="h-4 w-4" />
            <span className="text-sm">Clear</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-white/10">
        <div className="overflow-auto">
          <table className="min-w-[1080px] w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left">
                <Th>Reference</Th>
                <Th>Shipper</Th>
                <Th>Origin</Th>
                <Th>Destination</Th>
                <Th>Pickup</Th>
                <Th>Delivered</Th>
                <Th>Status</Th>
                <Th>POD</Th>
                <Th>Billing</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} className="p-6 text-center opacity-70">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading delivered loadsâ€¦
                    </span>
                  </td>
                </tr>
              )}

              {!loading && !err && rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-6 text-center opacity-70">
                    No delivered loads match your filters.
                  </td>
                </tr>
              )}

              {!loading &&
                !err &&
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-white/10 hover:bg-white/5"
                  >
                    <Td className="font-medium">{r.reference ?? "â€”"}</Td>
                    <Td>{r.shipper ?? "â€”"}</Td>
                    <Td className="whitespace-pre-wrap">
                      {r.origin ?? "â€”"}
                    </Td>
                    <Td className="whitespace-pre-wrap">
                      {r.destination ?? "â€”"}
                    </Td>
                    <Td>{fmtDate(r.pickup_date)}</Td>
                    <Td>{fmtDate(r.delivery_date)}</Td>
                    <Td>
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                        {r.status ?? "DELIVERED"}
                      </span>
                    </Td>

                    {/* POD cell */}
                    <Td className="min-w-[220px]">
                      <div className="flex items-center gap-2">
                        {r.pod_url ? (
                          <>
                            <a
                              href={r.pod_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/5"
                              title="Open POD"
                            >
                              <FileCheck2 className="h-4 w-4" />
                              View POD
                              <ExternalLink className="h-3 w-3 opacity-70" />
                            </a>
                            <button
                              onClick={() => handleChooseFile(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/5"
                              title="Re-upload POD"
                            >
                              <Upload className="h-4 w-4" />
                              Replace
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleChooseFile(r.id)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
                            title="Upload POD"
                          >
                            <Upload className="h-4 w-4" />
                            <span className="text-xs">Upload POD</span>
                          </button>
                        )}

                        {/* Hidden input per row */}
                        <input
                          ref={(el) => (fileInputs.current[r.id] = el)}
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={() => handleFileChange(r)}
                        />
                      </div>
                      {r.pod_uploaded_at && (
                        <div className="mt-1 text-[11px] opacity-60">
                          Uploaded {new Date(r.pod_uploaded_at).toLocaleString()}
                        </div>
                      )}
                    </Td>

                    {/* Billing cell */}
                    <Td className="min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <button
                          disabled={!r.pod_url || loading}
                          onClick={() => handleMarkBilling(r)}
                          className={cx(
                            "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-40",
                            "border-white/10"
                          )}
                          title={
                            r.pod_url
                              ? "Mark this load as ready for billing"
                              : "Upload a POD to enable billing"
                          }
                        >
                          <Receipt className="h-4 w-4" />
                          {r.billing_ready || r.status === "READY_FOR_BILLING"
                            ? "Ready for Billing"
                            : "Send to Billing"}
                        </button>
                      </div>
                      {(r.billing_marked_at || r.status === "READY_FOR_BILLING") && (
                        <div className="mt-1 text-[11px] opacity-60">
                          {r.billing_marked_at
                            ? `Marked ${new Date(
                                r.billing_marked_at
                              ).toLocaleString()}`
                            : "Status set to READY_FOR_BILLING"}
                        </div>
                      )}
                    </Td>

                    <Td className="max-w-[24rem] truncate">{r.notes ?? "â€”"}</Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Footer / Pagination */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 p-3 sm:flex-row">
          <div className="text-xs opacity-70">
            Showing {count === 0 ? 0 : showingFrom}â€“{showingTo} of {count}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <div className="min-w-[6ch] text-center text-sm">
              {page} / {totalPages}
            </div>
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Th({ children }) {
  return (
    <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide opacity-70">
      {children}
    </th>
  );
}

function Td({ children, className }) {
  return <td className={cx("px-4 py-3 align-top", className)}>{children}</td>;
}
