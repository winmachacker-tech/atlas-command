// src/pages/Invoice.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, FileDown, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  try {
    return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
  } catch {
    return `$${Number(n).toFixed(2)}`;
  }
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

export default function Invoice() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [load, setLoad] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    async function fetchLoad() {
      try {
        setLoading(true);
        setError("");
        // pull everything we might want to show on an invoice
        const { data, error } = await supabase
          .from("loads")
          .select(
            `
            id, reference, shipper, origin, destination, status, rate,
            pickup_at, delivery_at, created_at, equipment_type, notes
          `
          )
          .eq("id", id)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setError("Invoice not found or you don’t have access.");
          setLoad(null);
        } else if (isMounted) {
          setLoad(data);
        }
      } catch (e) {
        setError(e?.message || "Failed to load invoice.");
        setLoad(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    fetchLoad();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const invoiceNumber = useMemo(() => {
    if (!load?.id) return "—";
    // simple readable invoice id; tweak as needed
    return `INV-${String(load.id).slice(0, 8).toUpperCase()}`;
  }, [load?.id]);

  // Basic PDF print (browser print) for now. If you already have a PDF generator we can wire it here.
  function handleDownloadPDF() {
    window.print();
  }

  return (
    <div className="min-h-screen p-6 text-gray-200">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-6 mb-6 border-b border-gray-800 bg-[#0f131a]/80 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
        <div className="mx-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
            <h1 className="text-2xl font-semibold">Invoice</h1>
          </div>

          <button
            onClick={handleDownloadPDF}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 bg-indigo-600 hover:bg-indigo-700"
            title="Download / Print"
          >
            <FileDown className="h-4 w-4" />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="h-40 grid place-items-center text-gray-400">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="animate-spin h-4 w-4" />
            <span>Loading invoice…</span>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-amber-600/40 bg-amber-500/10 p-4 text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5" />
            <div>
              <div className="font-medium mb-1">Problem loading invoice</div>
              <div className="opacity-90">{error}</div>
            </div>
          </div>
        </div>
      ) : !load ? (
        <div className="text-gray-400">No data.</div>
      ) : (
        <div className="mx-auto max-w-4xl bg-[#171c26] border border-gray-700 rounded-2xl overflow-hidden print:bg-white print:text-black print:border-0">
          {/* Printable area */}
          <div className="p-6 md:p-10 print:p-0">
            {/* Top Row: Branding + Invoice meta */}
            <div className="flex flex-wrap items-start justify-between gap-6 mb-10">
              <div>
                <div className="text-3xl font-bold tracking-wide">Atlas Command</div>
                <div className="text-sm text-gray-400">Freight Operations & Billing</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold">{invoiceNumber}</div>
                <div className="text-sm text-gray-400">Created: {fmtDate(load.created_at)}</div>
                <div className="text-sm text-gray-400">Status: {String(load.status || "").replaceAll("_", " ")}</div>
              </div>
            </div>

            {/* Bill To / Shipment Info */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="rounded-xl border border-gray-700 p-4">
                <div className="text-sm text-gray-400 mb-1">Bill To</div>
                <div className="text-base font-medium">{load.shipper || "—"}</div>
                {/* Add your address on file here if needed */}
              </div>

              <div className="rounded-xl border border-gray-700 p-4">
                <div className="text-sm text-gray-400 mb-1">Equipment</div>
                <div className="text-base font-medium">{load.equipment_type || "—"}</div>
              </div>
            </div>

            {/* Lane / Dates */}
            <div className="rounded-xl border border-gray-700 p-4 mb-8">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-400 mb-1">Origin → Destination</div>
                  <div className="text-base font-medium">
                    {load.origin || "—"} <span className="text-gray-500">→</span> {load.destination || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400 mb-1">PU / DEL</div>
                  <div className="text-base font-medium">
                    PU: {fmtDate(load.pickup_at)} <span className="text-gray-500">•</span> DEL: {fmtDate(load.delivery_at)}
                  </div>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="rounded-xl border border-gray-700 overflow-hidden mb-8">
              <table className="w-full text-sm">
                <thead className="bg-gray-800 text-gray-300">
                  <tr>
                    <th className="text-left p-3">Description</th>
                    <th className="text-right p-3 w-40">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-700">
                    <td className="p-3">
                      Linehaul — {load.reference || "No Reference"} ({load.origin} → {load.destination})
                    </td>
                    <td className="p-3 text-right">{fmtMoney(load.rate)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 bg-gray-900/40">
                    <td className="p-3 font-semibold">Total</td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(load.rate)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Notes */}
            {load.notes ? (
              <div className="rounded-xl border border-gray-700 p-4 mb-8">
                <div className="text-sm text-gray-400 mb-1">Notes</div>
                <div className="whitespace-pre-wrap text-sm">{load.notes}</div>
              </div>
            ) : null}

            {/* Footer */}
            <div className="text-xs text-gray-500">
              Thank you for your business. Please remit payment per your standard terms.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
