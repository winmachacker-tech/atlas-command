// FILE: src/pages/BillingPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Search,
  Calendar,
  X,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  ExternalLink,
  DollarSign,
  ShieldCheck,
} from "lucide-react";

/* ------------------------------ Config ------------------------------ */
const PAGE_SIZE = 20;

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

const money = (n) => Number(Number(n || 0).toFixed(2));
const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(money(n));

/**
 * Normalized billing row shape:
 * {
 *   kind: "READY" | "INVOICED" | "PAID",
 *   loadId,
 *   invoiceId?,
 *   orgId?,
 *   reference,
 *   shipper,
 *   deliveredAt,
 *   podUrl,
 *   hasPod,
 *   amount,
 *   invoiceNumber?,
 *   invoiceStatus?,
 *   issuedAt?,
 *   paidAt?
 * }
 */

/* ============================== Page ================================= */
export default function BillingPage() {
  const nav = useNavigate();

  // Tab state: READY | INVOICED | PAID | HISTORY
  const [activeTab, setActiveTab] = useState("READY");

  // Data
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);

  // Filters
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [requirePOD, setRequirePOD] = useState(true);

  // State
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [banner, setBanner] = useState(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / PAGE_SIZE)),
    [count]
  );

  const isReadyTab = activeTab === "READY";
  const isPaidTab = activeTab === "PAID";
  const isHistoryTab = activeTab === "HISTORY";
  const showPaidColumn = isPaidTab || isHistoryTab;

  const colSpan = isReadyTab ? 7 : showPaidColumn ? 10 : 9;

  // Reset page when filters or tab change
  useEffect(() => {
    setPage(1);
  }, [activeTab, q, dateFrom, dateTo, requirePOD]);

  useEffect(() => {
    fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeTab, q, dateFrom, dateTo, requirePOD]);

  /* ------------------------------ Data Fetch ------------------------------ */
  async function fetchPage(pageNumber) {
    setLoading(true);
    setErr(null);
    setBanner(null);

    const from = (pageNumber - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    try {
      if (activeTab === "READY") {
        /**
         * READY TAB
         *
         * Loads that:
         * - status = 'DELIVERED'
         * - ready_for_billing = true
         * - have NO invoice rows yet
         * - If "Require POD" checked:
         *     hasPod = loads.pod_url IS NOT NULL
         *              OR at least one load_docs row with doc_type = 'POD'
         */
        let loadsQuery = supabase
          .from("loads")
          .select(
            `
            id,
            org_id,
            reference,
            shipper,
            delivery_date,
            status,
            pod_url,
            rate,
            load_invoices(id)
          `,
            { count: "exact" }
          )
          .eq("ready_for_billing", true)
          .eq("status", "DELIVERED"); // tighten to delivered only

        if (dateFrom) loadsQuery = loadsQuery.gte("delivery_date", dateFrom);
        if (dateTo) loadsQuery = loadsQuery.lte("delivery_date", dateTo);

        loadsQuery = loadsQuery
          .order("delivery_date", { ascending: false })
          .range(from, to);

        const {
          data: loadsData,
          error: loadsError,
          count: total,
        } = await loadsQuery;
        if (loadsError) throw loadsError;

        // Filter out loads that already have an invoice row
        const readyLoads = (loadsData || []).filter(
          (l) => !l.load_invoices || l.load_invoices.length === 0
        );

        // Build map of load_id -> hasPodDoc by querying load_docs separately
        let podsByLoadId = {};
        const loadIds = readyLoads.map((l) => l.id).filter(Boolean);

        if (loadIds.length > 0) {
          try {
            const { data: docsData, error: docsError } = await supabase
              .from("load_docs")
              .select("load_id, doc_type")
              .in("load_id", loadIds);

            if (docsError) {
              console.warn(
                "[Billing] load_docs lookup failed, falling back to pod_url only:",
                docsError
              );
            } else {
              podsByLoadId = (docsData || []).reduce((acc, doc) => {
                if (doc.doc_type === "POD") {
                  acc[doc.load_id] = true;
                }
                return acc;
              }, {});
            }
          } catch (docsCatchError) {
            console.warn(
              "[Billing] load_docs secondary query error:",
              docsCatchError
            );
          }
        }

        // Enrich with hasPod flag (pod_url OR load_docs with doc_type = 'POD')
        const enriched = readyLoads.map((l) => {
          const hasPodDoc = !!podsByLoadId[l.id];
          const hasPod = !!l.pod_url || hasPodDoc;
          return { ...l, hasPod };
        });

        // Apply Require POD toggle (client-side) using hasPod
        const afterPodFilter = requirePOD
          ? enriched.filter((l) => l.hasPod)
          : enriched;

        // Client-side search by reference/shipper
        const filtered = applySearchFilterToReady(afterPodFilter, q);

        const normalized = filtered.map((l) => ({
          kind: "READY",
          loadId: l.id,
          invoiceId: null,
          orgId: l.org_id,
          reference: l.reference || "—",
          shipper: l.shipper || "—",
          deliveredAt: l.delivery_date,
          podUrl: l.pod_url || null,
          hasPod: !!l.hasPod,
          amount: l.rate || 0,
          invoiceNumber: null,
          invoiceStatus: null,
          issuedAt: null,
          paidAt: null,
        }));

        setRows(normalized);
        // Count is approximate with client-side filters; good enough for MVP
        setCount(total ?? normalized.length);
      } else {
        /**
         * INVOICED / PAID / HISTORY TABS
         *
         * We pivot around real invoice rows in load_invoices.
         *
         * INVOICED  → status = 'ISSUED'
         * PAID      → status = 'PAID'
         * HISTORY   → status IN ('ISSUED', 'PAID')
         */
        let query = supabase
          .from("load_invoices")
          .select(
            `
            id,
            org_id,
            invoice_number,
            status,
            amount,
            issued_at,
            paid_at,
            notes,
            load:loads (
              id,
              reference,
              shipper,
              delivery_date,
              pod_url,
              status,
              rate
            )
          `,
            { count: "exact" }
          );

        if (activeTab === "INVOICED") {
          query = query.eq("status", "ISSUED");
        } else if (activeTab === "PAID") {
          query = query.eq("status", "PAID");
        } else if (activeTab === "HISTORY") {
          query = query.in("status", ["ISSUED", "PAID"]);
        }

        // Basic date filter on load delivery date
        if (dateFrom) query = query.gte("load.delivery_date", dateFrom);
        if (dateTo) query = query.lte("load.delivery_date", dateTo);
        if (requirePOD) query = query.not("load.pod_url", "is", null);

        query = query.order("issued_at", { ascending: false }).range(from, to);

        const { data, error, count: total } = await query;
        if (error) throw error;

        const normalized = (data || []).map((inv) => ({
          kind: inv.status === "PAID" ? "PAID" : "INVOICED",
          loadId: inv.load?.id || null,
          invoiceId: inv.id,
          orgId: inv.org_id,
          reference: inv.load?.reference || "—",
          shipper: inv.load?.shipper || "—",
          deliveredAt: inv.load?.delivery_date || null,
          podUrl: inv.load?.pod_url || null,
          hasPod: !!inv.load?.pod_url,
          amount: inv.amount || inv.load?.rate || 0,
          invoiceNumber: inv.invoice_number || "—",
          invoiceStatus: inv.status,
          issuedAt: inv.issued_at,
          paidAt: inv.paid_at,
        }));

        const filtered = applySearchFilterToInvoices(normalized, q);
        setRows(filtered);
        setCount(total ?? filtered.length);
      }
    } catch (e) {
      console.error("[Billing] fetch error:", e);
      setErr(e.message ?? "Failed to load billing data.");
    } finally {
      setLoading(false);
    }
  }

  function applySearchFilterToReady(loads, qStr) {
    if (!qStr.trim()) return loads;
    const needle = qStr.trim().toLowerCase();
    return loads.filter((l) => {
      const ref = (l.reference || "").toLowerCase();
      const shipper = (l.shipper || "").toLowerCase();
      return ref.includes(needle) || shipper.includes(needle);
    });
  }

  function applySearchFilterToInvoices(invRows, qStr) {
    if (!qStr.trim()) return invRows;
    const needle = qStr.trim().toLowerCase();
    return invRows.filter((r) => {
      const ref = (r.reference || "").toLowerCase();
      const shipper = (r.shipper || "").toLowerCase();
      const invNum = (r.invoiceNumber || "").toLowerCase();
      return (
        ref.includes(needle) ||
        shipper.includes(needle) ||
        invNum.includes(needle)
      );
    });
  }

  /* ------------------------------ Actions ------------------------------ */

  function clearFilters() {
    setQ("");
    setDateFrom("");
    setDateTo("");
    setRequirePOD(true);
  }

  function goToLoad(loadId) {
    if (!loadId) return;
    nav(`/loads/${loadId}`);
  }

  function goToInvoice(invoiceId) {
    if (!invoiceId) return;
    nav(`/invoices/${invoiceId}`);
  }

  // Create an invoice for a READY load
  async function createInvoice(row) {
    if (!row || !row.loadId || !row.orgId) return;

    setLoading(true);
    setErr(null);
    setBanner(null);

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const invoiceNumber = `INV-${now.getTime()}`;

      // 0) Lookup the load to get customer_id (RLS-safe)
      const {
        data: loadRecord,
        error: loadError,
      } = await supabase
        .from("loads")
        .select("id, org_id, customer_id")
        .eq("id", row.loadId)
        .single();

      if (loadError) {
        console.error("[Billing] createInvoice load lookup error:", loadError);
        throw loadError;
      }

      // 1) Default snapshot values
      let customerSnapshot = {
        customer_name: null,
        customer_payment_terms: null,
        customer_credit_limit: null,
      };

      // 2) If the load is linked to a customer, snapshot their billing fields
      if (loadRecord?.customer_id) {
        const {
          data: customer,
          error: customerError,
        } = await supabase
          .from("customers")
          .select("id, company_name, payment_terms, credit_limit")
          .eq("id", loadRecord.customer_id)
          .single();

        if (customerError) {
          console.warn(
            "[Billing] createInvoice customer lookup error (continuing without snapshot):",
            customerError
          );
        } else if (customer) {
          customerSnapshot = {
            customer_name: customer.company_name || null,
            customer_payment_terms: customer.payment_terms || null,
            customer_credit_limit: customer.credit_limit ?? null,
          };
        }
      }

      // 3) Create the invoice row with customer snapshot fields
      const {
        data: invoice,
        error: invoiceError,
      } = await supabase
        .from("load_invoices")
        .insert({
          org_id: row.orgId, // RLS-safe: must match current_org_id()
          load_id: row.loadId,
          invoice_number: invoiceNumber,
          status: "ISSUED",
          amount: row.amount || 0, // initial total = linehaul
          currency: "USD",
          issued_at: nowIso,
          notes: "",
          customer_name: customerSnapshot.customer_name,
          customer_payment_terms: customerSnapshot.customer_payment_terms,
          customer_credit_limit: customerSnapshot.customer_credit_limit,
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // 4) Seed default Linehaul line item using the rate
      const lineAmount = row.amount || 0;
      const description = `Linehaul – Load ${row.reference || row.loadId}`;

      const { error: itemError } = await supabase
        .from("load_invoice_items")
        .insert({
          org_id: row.orgId,
          invoice_id: invoice.id,
          description,
          qty: 1,
          rate: lineAmount,
          amount: lineAmount,
          kind: "LINEHAUL",
          sort_order: 1,
        });

      if (itemError) {
        console.error("[Billing] seed Linehaul item error:", itemError);
        throw itemError;
      }

      setBanner(
        `Invoice ${
          invoice.invoice_number || invoice.id.slice(0, 8)
        } created for load ${row.reference}.`
      );
      await fetchPage(page);
    } catch (e) {
      console.error("[Billing] createInvoice error:", e);
      setErr(e.message || "Unable to create invoice for this load.");
    } finally {
      setLoading(false);
    }
  }

  // Mark an existing invoice as PAID
  async function markInvoicePaid(row) {
    if (!row || !row.invoiceId) return;

    setLoading(true);
    setErr(null);
    setBanner(null);

    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("load_invoices")
        .update({
          status: "PAID",
          paid_at: now,
        })
        .eq("id", row.invoiceId);

      if (error) throw error;

      setBanner(
        `Invoice ${
          row.invoiceNumber || row.invoiceId.slice(0, 8)
        } marked as PAID.`
      );
      await fetchPage(page);
    } catch (e) {
      console.error("[Billing] markInvoicePaid error:", e);
      setErr(e.message || "Unable to mark invoice as paid.");
    } finally {
      setLoading(false);
    }
  }

  const showingFrom = Math.min(count, (page - 1) * PAGE_SIZE + 1);
  const showingTo = Math.min(count, page * PAGE_SIZE);

  /* ------------------------------ Render ------------------------------ */
  return (
    <section className="flex h-full min-h-screen flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold">Billing Control Tower</h1>
          <p className="text-sm opacity-70">
            Move delivered loads from Ready for Billing → Invoiced → Paid.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fetchPage(page)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
            title="Refresh"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-sm">Refresh</span>
              </span>
            )}
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

      {/* Tabs */}
      <div className="flex gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
        <TabButton
          label="Ready"
          countLabel="Loads ready for billing"
          active={activeTab === "READY"}
          onClick={() => setActiveTab("READY")}
        />
        <TabButton
          label="Invoiced"
          countLabel="Issued / outstanding invoices"
          active={activeTab === "INVOICED"}
          onClick={() => setActiveTab("INVOICED")}
        />
        <TabButton
          label="Paid"
          countLabel="Paid invoices"
          active={activeTab === "PAID"}
        />
        <TabButton
          label="History"
          countLabel="All invoiced loads"
          active={activeTab === "HISTORY"}
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg.white/5 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              activeTab === "READY"
                ? "Search reference or shipper…"
                : "Search reference, shipper, or invoice #…"
            }
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
          />{" "}
          Require POD
        </label>

        <button
          onClick={clearFilters}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
        >
          <X className="h-4 w-4" /> Clear
        </button>
      </div>

      {/* Table container */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-white/10">
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-white/5">
              <tr className="text-left">
                <Th>Reference</Th>
                <Th>Shipper</Th>
                <Th>Delivered</Th>
                <Th>POD</Th>
                <Th>Amount</Th>
                <Th>{isReadyTab ? "Billing State" : "Invoice #"}</Th>
                {!isReadyTab && <Th>Status</Th>}
                {!isReadyTab && <Th>Issued</Th>}
                {showPaidColumn && <Th>Paid</Th>}
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={colSpan} className="p-6 text-center opacity-70">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </span>
                  </td>
                </tr>
              )}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="p-6 text-center opacity-70">
                    No records found.
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((r) => (
                  <tr
                    key={`${r.kind}-${r.loadId}-${r.invoiceId || "none"}`}
                    className="border-t border-white/10 hover:bg-white/5"
                  >
                    <Td className="font-medium">
                      <button
                        onClick={() => goToLoad(r.loadId)}
                        className="inline-flex items-center gap-1 text-sm text-sky-300 hover:underline"
                      >
                        {r.reference}
                        <ExternalLink className="h-3 w-3 opacity-70" />
                      </button>
                    </Td>
                    <Td>{r.shipper}</Td>
                    <Td>{fmtDate(r.deliveredAt)}</Td>
                    <Td>
                      {r.podUrl ? (
                        <a
                          href={r.podUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg.white/5"
                          title="Open POD"
                        >
                          <FileCheck2 className="h-4 w-4" /> View POD
                          <ExternalLink className="h-3 w-3 opacity-70" />
                        </a>
                      ) : r.hasPod ? (
                        <span className="inline-flex items-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100">
                          <FileCheck2 className="mr-1 h-3 w-3" />
                          POD on file
                        </span>
                      ) : (
                        <span className="text-xs opacity-60">No POD</span>
                      )}
                    </Td>
                    <Td>{fmtUSD(r.amount)}</Td>

                    {/* Billing state / invoice number */}
                    <Td>
                      {r.kind === "READY" ? (
                        <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                          Ready for Billing
                        </span>
                      ) : (
                        <span className="text-xs font-medium">
                          {r.invoiceNumber || "—"}
                        </span>
                      )}
                    </Td>

                    {/* Invoice status / dates */}
                    {!isReadyTab && (
                      <Td>
                        <span
                          className={cx(
                            "rounded-md px-2 py-1 text-xs",
                            r.invoiceStatus === "PAID"
                              ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                              : "border border-sky-500/40 bg-sky-500/10 text-sky-100"
                          )}
                        >
                          {r.invoiceStatus}
                        </span>
                      </Td>
                    )}
                    {!isReadyTab && <Td>{fmtDateTime(r.issuedAt)}</Td>}
                    {showPaidColumn && <Td>{fmtDateTime(r.paidAt)}</Td>}

                    {/* Actions */}
                    <Td className="min-w-[260px]">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.kind === "READY" && (
                          <button
                            onClick={() => createInvoice(r)}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40"
                            disabled={loading || !r.hasPod}
                            title={
                              r.hasPod
                                ? "Create invoice for this load"
                                : "Requires POD (file or doc) before invoicing"
                            }
                          >
                            <DollarSign className="h-4 w-4" />
                            Create Invoice
                          </button>
                        )}

                        {r.kind === "INVOICED" && (
                          <button
                            onClick={() => markInvoicePaid(r)}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40"
                            disabled={loading}
                            title="Mark invoice as paid"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            Mark Paid
                          </button>
                        )}

                        {r.invoiceId && (
                          <button
                            onClick={() => goToInvoice(r.invoiceId)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                            title="View invoice"
                          >
                            <ExternalLink className="h-4 w-4" />
                            View Invoice
                          </button>
                        )}

                        <button
                          onClick={() => goToLoad(r.loadId)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                          title="Open load details"
                        >
                          <ExternalLink className="h-4 w-4" />
                          View Load
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
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
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <div className="min-w-[6ch] text-center text-sm">
              {page} / {totalPages}
            </div>
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Small components ------------------------------ */

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

function TabButton({ label, active, onClick, countLabel }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex-1 rounded-lg px-3 py-2 text-left text-xs sm:text-sm",
        active
          ? "bg-white/10 text-white shadow-sm"
          : "text-white/70 hover:bg-white/5"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        {active && (
          <span className="hidden text-[10px] uppercase tracking-wide text-emerald-300 sm:inline">
            Active
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] opacity-70">{countLabel}</div>
    </button>
  );
}
