// FILE: src/pages/InvoiceDetails.jsx
//
// Purpose:
// - Show a single invoice + its load context.
// - Let you edit line items (linehaul + accessorials).
// - Persist line items into public.load_invoice_items (qty/rate/amount).
// - Respect org_id via RLS (org_id comes from the invoice row).
//
// Assumes DB schema:
// - load_invoices(id, org_id, load_id, invoice_number, status, amount, currency,
//                 issued_at, due_at, paid_at, terms, notes,
//                 customer_name, customer_payment_terms, customer_credit_limit)
// - load_invoice_items(id, org_id, invoice_id, description, kind, qty, rate,
//                      amount, sort_order, created_at, updated_at)
// - Trigger keeps amount = qty * rate

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  Loader2,
  Download,
  Printer,
  DollarSign,
  Plus,
  Trash2,
  ClipboardList,
  FileText,
} from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const money = (n) => Number(Number(n || 0).toFixed(2));
const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(money(n));

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

// Available item kinds for the dropdown
const ITEM_KINDS = [
  { value: "LINEHAUL", label: "Linehaul" },
  { value: "FSC", label: "Fuel Surcharge" },
  { value: "DETENTION", label: "Detention" },
  { value: "LAYOVER", label: "Layover" },
  { value: "LUMPER", label: "Lumper" },
  { value: "TONU", label: "TONU" },
  { value: "OTHER", label: "Other" },
];

export default function InvoiceDetails() {
  const { invoiceId } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [savingLines, setSavingLines] = useState(false);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);

  const [invoice, setInvoice] = useState(null);
  const [load, setLoad] = useState(null);
  const [items, setItems] = useState([]);

  // Fetch invoice + load + line items
  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        setBanner(null);

        // 1) Invoice + load
        const { data: inv, error: invErr } = await supabase
          .from("load_invoices")
          .select(
            `
            id,
            org_id,
            load_id,
            invoice_number,
            status,
            amount,
            currency,
            issued_at,
            due_at,
            paid_at,
            terms,
            notes,
            customer_name,
            customer_payment_terms,
            customer_credit_limit,
            load:loads (
              id,
              reference,
              shipper,
              delivery_date,
              rate,
              pod_url
            )
          `
          )
          .eq("id", invoiceId)
          .single();

        if (invErr) throw invErr;
        if (!isMounted) return;

        setInvoice(inv);
        setLoad(inv.load || null);

        // 2) Line items
        const { data: lineRows, error: lineErr } = await supabase
          .from("load_invoice_items")
          .select(
            `
            id,
            org_id,
            invoice_id,
            description,
            kind,
            qty,
            rate,
            amount,
            sort_order,
            created_at
          `
          )
          .eq("invoice_id", invoiceId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });

        if (lineErr) throw lineErr;
        if (!isMounted) return;

        let normalized = (lineRows || []).map((r) => ({
          id: r.id,
          org_id: r.org_id,
          invoice_id: r.invoice_id,
          description: r.description || "",
          kind: r.kind || "LINEHAUL",
          qty: Number(r.qty ?? 1),
          rate: Number(r.rate ?? 0),
          amount: Number(r.amount ?? 0),
          sort_order: r.sort_order ?? 10,
        }));

        // If there are no items yet, seed a default Linehaul row
        if (!normalized.length) {
          const baseRate = Number(inv.amount || inv.load?.rate || 0);
          normalized = [
            {
              id: null,
              org_id: inv.org_id,
              invoice_id: inv.id,
              description: inv.load?.reference
                ? `${inv.load.reference} – Linehaul`
                : "Linehaul",
              kind: "LINEHAUL",
              qty: 1,
              rate: baseRate,
              amount: baseRate,
              sort_order: 10,
            },
          ];
        }

        setItems(normalized);
      } catch (e) {
        console.error("[InvoiceDetails] fetch error:", e);
        if (isMounted) {
          setError(e.message || "Failed to load invoice.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [invoiceId]);

  // Derived totals: subtotal (sum of item amounts)
  const subtotal = useMemo(
    () => items.reduce((sum, r) => sum + money(r.qty) * money(r.rate), 0),
    [items]
  );

  // --------------------- Line item edits ---------------------

  function updateItem(index, patch) {
    setItems((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;

      const merged = {
        ...current,
        ...patch,
      };

      // Live recompute amount client-side (DB trigger also enforces)
      const qtyNum =
        "qty" in patch ? Number(patch.qty || 0) : Number(current.qty || 0);
      const rateNum =
        "rate" in patch ? Number(patch.rate || 0) : Number(current.rate || 0);
      merged.amount = money(qtyNum * rateNum);

      next[index] = merged;
      return next;
    });
  }

  function addLine(kind = "OTHER") {
    if (!invoice) return;
    setItems((prev) => [
      ...prev,
      {
        id: null,
        org_id: invoice.org_id,
        invoice_id: invoice.id,
        description: "",
        kind,
        qty: 1,
        rate: 0,
        amount: 0,
        sort_order: (prev[prev.length - 1]?.sort_order || 10) + 10,
      },
    ]);
  }

  function deleteLine(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // --------------------- Persist line items ---------------------

  async function handleSaveLineItems() {
    if (!invoice) return;

    setSavingLines(true);
    setError(null);
    setBanner(null);

    try {
      // Basic validation: at least one line with value
      const cleaned = items
        .map((r, idx) => ({
          ...r,
          description: (r.description || "").trim() || "Charge",
          kind: r.kind || "OTHER",
          qty: Number(r.qty || 0),
          rate: Number(r.rate || 0),
          sort_order: r.sort_order ?? (idx + 1) * 10,
        }))
        .filter((r) => r.qty !== 0 || r.rate !== 0);

      if (!cleaned.length) {
        throw new Error("You must have at least one non-zero line item.");
      }

      // 1) Delete existing items for this invoice (org-scoped by RLS)
      const { error: delErr } = await supabase
        .from("load_invoice_items")
        .delete()
        .eq("invoice_id", invoice.id);

      if (delErr) throw delErr;

      // 2) Insert fresh rows
      const insertPayload = cleaned.map((r) => ({
        org_id: invoice.org_id,
        invoice_id: invoice.id,
        description: r.description,
        kind: r.kind,
        qty: r.qty,
        rate: r.rate,
        amount: r.amount, // trigger will also set amount = qty * rate
        sort_order: r.sort_order,
      }));

      const { data: inserted, error: insErr } = await supabase
        .from("load_invoice_items")
        .insert(insertPayload)
        .select(
          `
          id,
          org_id,
          invoice_id,
          description,
          kind,
          qty,
          rate,
          amount,
          sort_order,
          created_at
        `
        );

      if (insErr) throw insErr;

      const normalized = (inserted || []).map((r) => ({
        id: r.id,
        org_id: r.org_id,
        invoice_id: r.invoice_id,
        description: r.description || "",
        kind: r.kind || "LINEHAUL",
        qty: Number(r.qty ?? 1),
        rate: Number(r.rate ?? 0),
        amount: Number(r.amount ?? 0),
        sort_order: r.sort_order ?? 10,
      }));

      setItems(normalized);

      // 3) Update invoice header amount to sum of line items
      const newTotal = normalized.reduce(
        (sum, r) => sum + money(r.amount),
        0
      );
      const { data: invUpdate, error: invErr } = await supabase
        .from("load_invoices")
        .update({
          amount: newTotal,
        })
        .eq("id", invoice.id)
        .select()
        .single();

      if (invErr) throw invErr;

      setInvoice(invUpdate);
      setBanner("Invoice line items saved.");
    } catch (e) {
      console.error("[InvoiceDetails] save line items error:", e);
      setError(e.message || "Failed to save invoice line items.");
    } finally {
      setSavingLines(false);
    }
  }

  // --------------------- Download (very simple HTML) ---------------------

  function handleDownload() {
    if (!invoice) return;

    const total = items.reduce((sum, r) => sum + money(r.amount), 0);
    const shipper = load?.shipper || "";

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${invoice.invoice_number || ""}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
    h1 { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 13px; }
    th { background: #f5f5f5; text-align: left; }
    tfoot td { font-weight: bold; }
  </style>
</head>
<body>
  <h1>Invoice ${invoice.invoice_number || ""}</h1>
  <p>Status: ${invoice.status}</p>
  <p>Issued: ${fmtDate(invoice.issued_at)}</p>
  <p>Load: ${load?.reference || ""} – ${shipper}</p>
  <p>Delivered: ${fmtDate(load?.delivery_date)}</p>
  <table>
    <thead>
      <tr>
        <th>Type</th>
        <th>Description</th>
        <th>Qty</th>
        <th>Rate</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${items
        .map(
          (r) => `
          <tr>
            <td>${r.kind}</td>
            <td>${r.description || ""}</td>
            <td>${r.qty}</td>
            <td>${fmtUSD(r.rate)}</td>
            <td>${fmtUSD(r.amount)}</td>
          </tr>
        `
        )
        .join("")}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right;">Total</td>
        <td>${fmtUSD(total)}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`.trim();

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${invoice.invoice_number || invoice.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --------------------- Render ---------------------

  if (loading && !invoice) {
    return (
      <section className="flex h-full min-h-screen items-center justify-center">
        <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading invoice…
        </div>
      </section>
    );
  }

  if (error && !invoice) {
    return (
      <section className="flex h-full min-h-screen flex-col items-center justify-center gap-4">
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-100">
          {String(error)}
        </p>
        <button
          onClick={() => nav(-1)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </section>
    );
  }

  const totalFromItems = subtotal;
  const invoiceTotal = invoice?.amount ?? totalFromItems;

  // Snapshot customer billing info (safe fallbacks)
  const customerName = invoice?.customer_name || "—";
  const customerTerms = invoice?.customer_payment_terms || "Not set";
  const customerCreditLimit =
    invoice?.customer_credit_limit != null
      ? fmtUSD(invoice.customer_credit_limit)
      : "Not set";

  return (
    <section className="flex h-full min-h-screen flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={() => nav(-1)}
            className="inline-flex items-center justify-center rounded-full border border-white/10 p-2 hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold">
              Invoice {invoice?.invoice_number || ""}
            </h1>
            <p className="text-xs opacity-70">
              Load {load?.reference || "—"} •{" "}
              {load?.shipper || "Unknown shipper"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cx(
              "inline-flex items-center rounded-full px-3 py-1 text-xs",
              invoice?.status === "PAID"
                ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : invoice?.status === "ISSUED"
                ? "border border-sky-500/40 bg-sky-500/10 text-sky-100"
                : "border border-amber-500/40 bg-amber-500/10 text-amber-100"
            )}
          >
            <ClipboardList className="mr-1 h-3 w-3" />
            {invoice?.status}
          </span>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>

          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        </div>
      </div>

      {/* Banner + errors */}
      {banner && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          {banner}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {String(error)}
        </div>
      )}

      {/* Top summary cards */}
      <div className="grid gap-4 lg:grid-cols-[2fr,1.5fr]">
        {/* Invoice summary */}
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide opacity-60">
                Invoice Total
              </div>
              <div className="text-2xl font-semibold">
                {fmtUSD(invoiceTotal || 0)}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              <div className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                <span>From line items</span>
              </div>
              <div className="mt-1 text-[11px] opacity-80">
                Subtotal: {fmtUSD(totalFromItems)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <div className="opacity-60">Invoice #</div>
              <div className="font-mono text-sm">
                {invoice?.invoice_number || "—"}
              </div>
            </div>
            <div>
              <div className="opacity-60">Issued</div>
              <div className="text-sm">{fmtDate(invoice?.issued_at)}</div>
            </div>
            <div>
              <div className="opacity-60">Paid</div>
              <div className="text-sm">{fmtDate(invoice?.paid_at)}</div>
            </div>
          </div>
        </div>

        {/* Customer + Load summary */}
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          {/* Bill To / Customer */}
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 opacity-70" />
            <div className="text-xs uppercase tracking-wide opacity-60">
              Bill To
            </div>
          </div>
          <div className="mt-2 text-sm font-medium">{customerName}</div>
          <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <div className="opacity-60">Payment Terms</div>
              <div className="opacity-80">{customerTerms}</div>
            </div>
            <div>
              <div className="opacity-60">Credit Limit</div>
              <div className="opacity-80">{customerCreditLimit}</div>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 h-px w-full bg-white/10" />

          {/* Load summary */}
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 opacity-70" />
            <div className="text-xs uppercase tracking-wide opacity-60">
              Load
            </div>
          </div>
          <div className="mt-2 text-sm font-medium">
            {load?.reference || "—"}
          </div>
          <div className="mt-1 text-xs opacity-70">
            {load?.shipper || "Unknown shipper"}
          </div>

          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <div className="opacity-60">Delivered</div>
              <div className="opacity-80">
                {fmtDate(load?.delivery_date)}
              </div>
            </div>
            <div>
              <div className="opacity-60">Linehaul Rate</div>
              <div className="font-mono">{fmtUSD(load?.rate || 0)}</div>
            </div>
            <div>
              <div className="opacity-60">POD</div>
              <div className="opacity-80">
                {load?.pod_url ? "On file" : "Not uploaded"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Line items editor */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 opacity-70" />
            <span className="text-sm font-medium">Invoice Line Items</span>
            <span className="text-xs opacity-60">
              Linehaul + FSC, detention, layover, etc.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => addLine("OTHER")}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5"
            >
              <Plus className="h-3 w-3" />
              Add Charge
            </button>
            <button
              onClick={handleSaveLineItems}
              disabled={savingLines}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              {savingLines ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <DollarSign className="h-3 w-3" />
              )}
              Save Items
            </button>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="min-w-full text-xs">
            <thead className="bg-white/5">
              <tr className="text-left">
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <tr
                  key={row.id || `tmp-${idx}`}
                  className="border-t border-white/10"
                >
                  {/* Type */}
                  <td className="px-3 py-2 align-middle">
                    <select
                      value={row.kind}
                      onChange={(e) =>
                        updateItem(idx, { kind: e.target.value })
                      }
                      className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs outline-none"
                    >
                      {ITEM_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Description */}
                  <td className="px-3 py-2 align-middle">
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) =>
                        updateItem(idx, { description: e.target.value })
                      }
                      className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs outline-none"
                      placeholder="Description"
                    />
                  </td>

                  {/* Qty */}
                  <td className="px-3 py-2 align-middle text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={row.qty}
                      onChange={(e) =>
                        updateItem(idx, { qty: Number(e.target.value) })
                      }
                      className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-right text-xs outline-none"
                    />
                  </td>

                  {/* Rate */}
                  <td className="px-3 py-2 align-middle text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={row.rate}
                      onChange={(e) =>
                        updateItem(idx, { rate: Number(e.target.value) })
                      }
                      className="w-24 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-right text-xs outline-none"
                    />
                  </td>

                  {/* Amount */}
                  <td className="px-3 py-2 align-middle text-right font-mono">
                    {fmtUSD(row.amount ?? row.qty * row.rate)}
                  </td>

                  {/* Delete */}
                  <td className="px-3 py-2 align-middle text-right">
                    <button
                      onClick={() => deleteLine(idx)}
                      className="inline-flex items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 p-1 text-red-100 hover:bg-red-500/20"
                      title="Remove line"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}

              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-4 text-center text-xs opacity-70"
                  >
                    No line items. Add a Linehaul and any accessorials here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals footer */}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-4 text-sm">
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-3">
              <span className="text-xs opacity-60">Subtotal</span>
              <span className="font-mono text-sm">
                {fmtUSD(totalFromItems)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs opacity-60">Invoice Total</span>
              <span className="font-mono text-base font-semibold">
                {fmtUSD(invoiceTotal || totalFromItems)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
