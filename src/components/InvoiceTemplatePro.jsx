// src/components/InvoiceTemplatePro.jsx
import React from "react";

/**
 * Drop-in, professional invoice template.
 * - Tailwind-only styling (no extra deps)
 * - Print/PDF friendly (use browser Print to save as PDF)
 * - Dynamic watermark for Status (DRAFT/PAID/CANCELLED)
 * - Accepts your existing invoice/load fields via `invoice` prop
 *
 * Example usage:
 *   <InvoiceTemplatePro
 *     invoice={{
 *       company: {
 *         name: "Atlas Command",
 *         email: "mtishkun@hotmail.com",
 *         phone: "(916) 555-1212",
 *         address1: "123 Logistics Way",
 *         address2: "Sacramento, CA 95814",
 *       },
 *       invoiceNumber: "INV-INVOICETEST",
 *       status: "DRAFT",
 *       createdAt: "2025-04-11T18:09:33Z",
 *       billTo: { name: "TESTINVOICE" },
 *       load: {
 *         reference: "INVOICE TEST",
 *         deliveredAt: null,              // or ISO string
 *         originCity: "SAC",
 *         originState: null,
 *         destinationCity: "PENRYN",
 *         destinationState: null,
 *         dispatcherName: null,
 *         driverName: null,
 *         poNumber: null,
 *         proNumber: null,
 *       },
 *       charges: [
 *         { label: "Linehaul", amount: 752.26 },
 *       ],
 *       notes: "Reference: INVOICE TEST",
 *       podUrl: "#", // link to attached POD if available
 *     }}
 *   />
 */

function currency(n) {
  if (n == null || isNaN(n)) return "$0.00";
  const v = Number(n);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(); // respects user locale
}

function Watermark({ status }) {
  if (!status) return null;
  const normalized = String(status).toUpperCase();
  const text =
    normalized === "PAID"
      ? "PAID"
      : normalized === "CANCELLED"
      ? "CANCELLED"
      : normalized === "AT_RISK"
      ? "AT RISK"
      : normalized === "PROBLEM"
      ? "PROBLEM"
      : normalized; // DRAFT, etc.

  const colorClass =
    normalized === "PAID"
      ? "text-emerald-500/20"
      : normalized === "CANCELLED"
      ? "text-rose-500/20"
      : normalized === "AT_RISK" || normalized === "PROBLEM"
      ? "text-amber-500/20"
      : "text-slate-500/20";

  return (
    <div className="pointer-events-none select-none print:hidden">
      <div
        className={`fixed inset-0 grid place-items-center ${colorClass}`}
        style={{ zIndex: 0 }}
        aria-hidden
      >
        <div className="font-extrabold tracking-widest [font-size:16vmin] rotate-[-18deg]">
          {text}
        </div>
      </div>
    </div>
  );
}

function AtlasLogo({ name = "Atlas Command" }) {
  // Lightweight inline logo so you don't need an asset right now.
  return (
    <div className="flex items-center gap-2">
      <div className="h-10 w-10 rounded-xl bg-indigo-600 grid place-items-center text-white font-bold">
        🛰️
      </div>
      <div className="font-semibold text-xl">{name}</div>
    </div>
  );
}

export default function InvoiceTemplatePro({ invoice }) {
  const {
    company = {},
    invoiceNumber,
    status = "DRAFT",
    createdAt,
    billTo = {},
    load = {},
    charges = [],
    notes,
    podUrl,
  } = invoice || {};

  const amountDue = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white print:text-black">
      {/* Page container */}
      <div className="mx-auto max-w-4xl p-6 sm:p-10 relative">
        {/* Watermark (hidden on print for a clean PDF) */}
        <Watermark status={status} />

        {/* Header */}
        <header className="relative z-10">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <AtlasLogo name={company.name || "Atlas Command"} />
              <div className="mt-2 text-sm text-slate-600">
                {company.address1 && <div>{company.address1}</div>}
                {company.address2 && <div>{company.address2}</div>}
                {(company.email || company.phone) && (
                  <div className="mt-1">
                    {company.email && <span>{company.email}</span>}
                    {company.email && company.phone && <span className="mx-2">•</span>}
                    {company.phone && <span>{company.phone}</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 w-64">
              <div className="rounded-xl border border-slate-200">
                <div className="bg-slate-50 rounded-t-xl px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Invoice
                  </div>
                  <div className="font-semibold text-slate-900">
                    {invoiceNumber || "—"}
                  </div>
                </div>
                <div className="px-4 py-3 text-sm">
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Status</span>
                    <span className="font-medium">{status || "—"}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Created</span>
                    <span className="font-medium">{fmtDateTime(createdAt)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Amount Due</span>
                    <span className="font-semibold">{currency(amountDue)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bill To */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Bill To
              </div>
              <div className="mt-1 font-medium">
                {billTo.name || billTo.company || "—"}
              </div>
              {billTo.address1 && (
                <div className="text-sm text-slate-600">{billTo.address1}</div>
              )}
              {billTo.address2 && (
                <div className="text-sm text-slate-600">{billTo.address2}</div>
              )}
            </div>
          </div>
        </header>

        {/* Divider */}
        <div className="my-6 h-px bg-slate-200" />

        {/* Load Details + Charges */}
        <main className="relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Load Details Card */}
            <section className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Load Details
                </div>
              </div>
              <div className="px-4 py-3 text-sm">
                <Row label="Reference" value={load.reference} />
                <Row label="Delivered" value={fmtDateTime(load.deliveredAt)} />
                <Row
                  label="Origin"
                  value={
                    load.originCity
                      ? `${load.originCity}${load.originState ? ", " + load.originState : ""}`
                      : "—"
                  }
                />
                <Row
                  label="Destination"
                  value={
                    load.destinationCity
                      ? `${load.destinationCity}${
                          load.destinationState ? ", " + load.destinationState : ""
                        }`
                      : "—"
                  }
                />
                <Row label="Dispatcher" value={load.dispatcherName || "—"} />
                <Row label="Driver" value={load.driverName || "—"} />
                <Row
                  label="PO / PRO"
                  value={`${load.poNumber || "—"}  •  ${load.proNumber || "—"}`}
                />
              </div>
            </section>

            {/* Charges Card */}
            <section className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Charges
                </div>
                <div className="text-xs text-slate-500">
                  USD
                </div>
              </div>

              {/* Charges table */}
              <div className="px-4 py-2">
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="grid grid-cols-12 bg-white text-sm font-medium">
                    <div className="col-span-8 px-3 py-2 border-b border-slate-200">
                      Description
                    </div>
                    <div className="col-span-4 px-3 py-2 text-right border-b border-slate-200">
                      Amount
                    </div>
                  </div>

                  {charges.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-slate-500">No charges added.</div>
                  ) : (
                    charges.map((c, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-12 text-sm border-b border-slate-100 last:border-b-0"
                      >
                        <div className="col-span-8 px-3 py-2">{c.label || "Charge"}</div>
                        <div className="col-span-4 px-3 py-2 text-right">
                          {currency(c.amount)}
                        </div>
                      </div>
                    ))
                  )}

                  {/* Total */}
                  <div className="grid grid-cols-12 bg-slate-50 text-sm">
                    <div className="col-span-8 px-3 py-2 font-semibold">Amount Due</div>
                    <div className="col-span-4 px-3 py-2 text-right font-semibold">
                      {currency(amountDue)}
                    </div>
                  </div>
                </div>

                {/* POD link */}
                {podUrl && (
                  <div className="mt-3">
                    <a
                      href={podUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline"
                    >
                      Attached POD
                    </a>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Notes */}
          {notes ? (
            <section className="mt-8">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Notes
              </div>
              <div className="mt-2 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                {notes}
              </div>
            </section>
          ) : null}
        </main>

        {/* Footer */}
        <footer className="mt-10 text-xs text-slate-500">
          <div>Thank you for your business.</div>
          <div className="mt-1">
            Make checks payable to {company.name || "Atlas Command"}.
          </div>
        </footer>

        {/* Actions (hidden when printing) */}
        <div className="mt-6 print:hidden">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-slate-100 last:border-b-0">
      <div className="text-slate-500">{label}</div>
      <div className="font-medium text-right">{value || "—"}</div>
    </div>
  );
}
