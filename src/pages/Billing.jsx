// src/pages/Billing.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Search,
  Calendar,
  X,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  DollarSign,
  FileCheck2,
  ShieldCheck,
  UserRound,
  ClipboardList,
  Download,
} from "lucide-react";

/* ------------------------------ Config ------------------------------ */
const PAGE_SIZE = 20;
const READY_STATUS = "READY_FOR_BILLING";

/* ------------------------------ Helpers ----------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}
function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

/* ============================== Page ================================= */
export default function BillingPage() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);

  // filters
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [requirePOD, setRequirePOD] = useState(true);
  const [showInvoiced, setShowInvoiced] = useState(false);

  // state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [banner, setBanner] = useState(null);

  // selection
  const [selected, setSelected] = useState(new Set());
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // modal (draft invoice)
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftRow, setDraftRow] = useState(null);
  const [form, setForm] = useState({
    invoice_number: "",
    billed_amount: "",
    assigned_biller: "",
    notes: "",
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / PAGE_SIZE)),
    [count]
  );

  useEffect(() => {
    setPage(1);
  }, [q, dateFrom, dateTo, requirePOD, showInvoiced]);

  useEffect(() => {
    fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, dateFrom, dateTo, requirePOD, showInvoiced]);

  /* ------------------------------ Data ------------------------------ */
  async function fetchPage(pageNumber) {
    setLoading(true);
    setErr(null);
    const from = (pageNumber - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    try {
      // Build base filter: billing queue or show invoiced
      let query = supabase
        .from("loads")
        .select(
          [
            "id",
            "reference",
            "shipper",
            "delivery_date",
            "status",
            "pod_url",
            "notes",
            // optional billing fields
            "billing_ready",
            "billing_marked_at",
            "billed_amount",
            "assigned_biller",
            "invoice_number",
            "invoiced_at",
          ].join(","),
          { count: "exact" }
        );

      if (showInvoiced) {
        // show any with invoice_number or invoiced_at set
        query = query.or("invoice_number.not.is.null,invoiced_at.not.is.null");
      } else {
        // show items “ready to bill”
        query = query.or(
          [`status.eq.${READY_STATUS}`, `billing_ready.is.true`].join(",")
        );
      }

      if (q.trim()) {
        const like = `%${q.trim()}%`;
        query = query.or(
          [
            `reference.ilike.${like}`,
            `shipper.ilike.${like}`,
          ].join(",")
        );
      }
      if (dateFrom) query = query.gte("delivery_date", dateFrom);
      if (dateTo) query = query.lte("delivery_date", dateTo);
      if (requirePOD) query = query.not("pod_url", "is", null);

      query = query.order("delivery_date", { ascending: false }).range(from, to);

      const { data, error, count: total } = await query;
      if (error) throw error;

      setRows(data ?? []);
      setCount(total ?? 0);
      setSelected(new Set()); // clear selection when list refreshes
    } catch (e) {
      console.error("[Billing] fetch error:", e);
      setErr(e.message ?? "Failed to load billing queue.");
    } finally {
      setLoading(false);
    }
  }

  /* ------------------------------ UI Actions ------------------------------ */
  function clearFilters() {
    setQ("");
    setDateFrom("");
    setDateTo("");
    setRequirePOD(true);
    setShowInvoiced(false);
  }

  function toggleRow(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  function openDraft(row) {
    setDraftRow(row);
    setForm({
      invoice_number: row.invoice_number || "",
      billed_amount: row.billed_amount ?? "",
      assigned_biller: row.assigned_biller || "",
      notes: row.notes || "",
    });
    setDraftOpen(true);
  }

  async function saveDraftInvoice() {
    if (!draftRow) return;
    setLoading(true);
    setErr(null);
    setBanner(null);
    try {
      const update = {
        invoice_number: form.invoice_number || null,
        billed_amount:
          form.billed_amount === "" ? null : Number(form.billed_amount),
        assigned_biller: form.assigned_biller || null,
        notes: form.notes || null,
      };

      let res = await supabase
        .from("loads")
        .update(update)
        .eq("id", draftRow.id)
        .select()
        .single();

      if (res.error) throw res.error;

      setBanner("Draft invoice saved.");
      setDraftOpen(false);
      setDraftRow(null);
      await fetchPage(page);
    } catch (e) {
      console.error("[Billing] saveDraft error:", e);
      setErr(e.message || "Unable to save draft invoice.");
    } finally {
      setLoading(false);
    }
  }

  async function markInvoiced(rowIds) {
    if (!rowIds?.length) return;
    setLoading(true);
    setErr(null);
    setBanner(null);
    try {
      // Guard: ensure POD & invoice_number exist for each
      const missing = rows
        .filter((r) => rowIds.includes(r.id))
        .filter((r) => !r.pod_url || !r.invoice_number);
      if (missing.length) {
        setErr(
          `Cannot mark as invoiced: ${missing.length} row(s) missing POD and/or invoice number.`
        );
        setLoading(false);
        return;
      }

      // Preferred: set invoiced_at and status to INVOICED; keep audit
      const updates = {
        invoiced_at: new Date().toISOString(),
        status: "INVOICED",
      };

      const { error } = await supabase
        .from("loads")
        .update(updates)
        .in("id", rowIds);

      if (error) throw error;

      setBanner(`Marked ${rowIds.length} load(s) as Invoiced.`);
      await fetchPage(page);
    } catch (e) {
      console.error("[Billing] markInvoiced error:", e);
      setErr(e.message || "Unable to mark as invoiced.");
    } finally {
      setLoading(false);
    }
  }

  async function revertToReview(rowId) {
    setLoading(true);
    setErr(null);
    setBanner(null);
    try {
      // Revert either billing_ready/status
      let res = await supabase
        .from("loads")
        .update({
          billing_ready: false,
          status: "DELIVERED",
        })
        .eq("id", rowId);

      if (res.error) throw res.error;

      setBanner("Returned to Delivered review.");
      await fetchPage(page);
    } catch (e) {
      console.error("[Billing] revert error:", e);
      setErr(e.message || "Unable to revert this load.");
    } finally {
      setLoading(false);
    }
  }

  function exportCSV(rowsToExport) {
    const header = [
      "Reference",
      "Shipper",
      "Delivered",
      "POD URL",
      "Amount",
      "Status",
      "Assigned Biller",
      "Invoice #",
      "Invoiced At",
      "Notes",
    ];
    const lines = [
      header.join(","),
      ...rowsToExport.map((r) =>
        [
          r.reference ?? "",
          r.shipper ?? "",
          fmtDate(r.delivery_date),
          r.pod_url ?? "",
          r.billed_amount ?? "",
          r.status ?? "",
          r.assigned_biller ?? "",
          r.invoice_number ?? "",
          fmtDateTime(r.invoiced_at),
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
    a.download = `billing_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const showingFrom = Math.min(count, (page - 1) * PAGE_SIZE + 1);
  const showingTo = Math.min(count, page * PAGE_SIZE);

  /* ------------------------------ Render ------------------------------ */
  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Billing Control Tower</h1>
          <p className="text-sm opacity-70">
            Queue of loads ready to invoice. Draft, assign, batch-mark invoiced, and export.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchPage(page)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
            title="Refresh"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClipboardList className="h-4 w-4" />
            )}
            <span className="text-sm">Refresh</span>
          </button>
          <button
            onClick={() =>
              exportCSV(rows.filter((r) => selected.has(r.id)))
            }
            disabled={selected.size === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5 disabled:opacity-40"
            title="Export selected"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm">Export Selected</span>
          </button>
          <button
            onClick={() => markInvoiced(Array.from(selected))}
            disabled={selected.size === 0 || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
            title="Mark selected as invoiced"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">Mark Invoiced</span>
          </button>
        </div>
      </div>

      {/* Banner & errors */}
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
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/5 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference or shipper…"
            className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none placeholder:opacity-60"
          />
        </div>

        <div className="relative">
          <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
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
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none"
          />
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-60">
            To
          </div>
        </div>

        <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={requirePOD}
            onChange={(e) => setRequirePOD(e.target.checked)}
          />
          Require POD
        </label>

        <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={showInvoiced}
            onChange={(e) => setShowInvoiced(e.target.checked)}
          />
          Show Invoiced
        </label>

        <button
          onClick={clearFilters}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
        >
          <X className="h-4 w-4" /> Clear
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-white/10">
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left">
                <Th>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                  />
                </Th>
                <Th>Reference</Th>
                <Th>Shipper</Th>
                <Th>Delivered</Th>
                <Th>POD</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
                <Th>Invoice #</Th>
                <Th>Invoiced At</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} className="p-6 text-center opacity-70">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading…
                    </span>
                  </td>
                </tr>
              )}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-6 text-center opacity-70">
                    No rows.
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((r) => {
                  const isReady =
                    r.status === READY_STATUS || r.billing_ready === true;
                  const canInvoice =
                    !!r.pod_url && !!r.invoice_number && isReady;

                  return (
                    <tr
                      key={r.id}
                      className="border-t border-white/10 hover:bg-white/5"
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleRow(r.id)}
                        />
                      </Td>
                      <Td className="font-medium">{r.reference ?? "—"}</Td>
                      <Td>{r.shipper ?? "—"}</Td>
                      <Td>{fmtDate(r.delivery_date)}</Td>
                      <Td>
                        {r.pod_url ? (
                          <a
                            href={r.pod_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/5"
                            title="Open POD"
                          >
                            <FileCheck2 className="h-4 w-4" />
                            View POD <ExternalLink className="h-3 w-3 opacity-70" />
                          </a>
                        ) : (
                          <span className="text-xs opacity-60">No POD</span>
                        )}
                      </Td>
                      <Td>
                        {typeof r.billed_amount === "number"
                          ? `$${r.billed_amount.toFixed(2)}`
                          : "—"}
                      </Td>
                      <Td>
                        <span className="rounded-md border border-white/10 px-2 py-1 text-xs">
                          {r.status ?? "—"}
                        </span>
                      </Td>
                      <Td>{r.assigned_biller ?? "—"}</Td>
                      <Td>{r.invoice_number ?? "—"}</Td>
                      <Td>{fmtDateTime(r.invoiced_at)}</Td>
                      <Td className="min-w-[280px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => openDraft(r)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                            title="Create/Update draft invoice"
                          >
                            <DollarSign className="h-4 w-4" />
                            Draft Invoice
                          </button>

                          <button
                            onClick={() => markInvoiced([r.id])}
                            disabled={!canInvoice || !!r.invoiced_at}
                            className={cx(
                              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                              canInvoice && !r.invoiced_at
                                ? "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                                : "border-white/10 opacity-40"
                            )}
                            title={
                              canInvoice
                                ? "Mark as invoiced"
                                : "Requires POD and Invoice #"
                            }
                          >
                            <ShieldCheck className="h-4 w-4" />
                            Mark Invoiced
                          </button>

                          <button
                            onClick={() => revertToReview(r.id)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                            title="Send back to Delivered review"
                          >
                            <UserRound className="h-4 w-4" />
                            Revert
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Footer / Pagination */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 p-3 sm:flex-row">
          <div className="text-xs opacity-70">
            Showing {count === 0 ? 0 : showingFrom}–{showingTo} of {count}
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

      {/* Draft Invoice Modal */}
      {draftOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[var(--bg-surface,#171c26)] p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="text-sm opacity-70">Draft Invoice for</div>
                <div className="text-lg font-semibold">
                  {draftRow?.reference ?? "—"} • {draftRow?.shipper ?? "—"}
                </div>
                <div className="text-xs opacity-60">
                  Delivered {fmtDate(draftRow?.delivery_date)}
                </div>
              </div>
              <button
                onClick={() => setDraftOpen(false)}
                className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/5"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <div className="mb-1 opacity-70">Invoice #</div>
                <input
                  value={form.invoice_number}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, invoice_number: e.target.value }))
                  }
                  placeholder="e.g. INV-10234"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 outline-none"
                />
              </label>

              <label className="text-sm">
                <div className="mb-1 opacity-70">Amount</div>
                <input
                  type="number"
                  step="0.01"
                  value={form.billed_amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, billed_amount: e.target.value }))
                  }
                  placeholder="e.g. 1450.00"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 outline-none"
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <div className="mb-1 opacity-70">Assigned Biller</div>
                <input
                  value={form.assigned_biller}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, assigned_biller: e.target.value }))
                  }
                  placeholder="email or name"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 outline-none"
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <div className="mb-1 opacity-70">Notes (internal)</div>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Add any billing notes…"
                  className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setDraftOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={saveDraftInvoice}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm hover:bg-emerald-500/20"
              >
                <DollarSign className="h-4 w-4" />
                Save Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------ Cells ------------------------------ */
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
