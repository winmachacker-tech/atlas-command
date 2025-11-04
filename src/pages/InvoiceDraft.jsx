// src/pages/InvoiceDraft.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2, Download, FileText, ChevronLeft, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";

/* ----------------------------- helpers ----------------------------- */
const money = (n) => Number(Number(n || 0).toFixed(2));
const fmtUSD = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(money(n));
const todayISO = () => new Date().toISOString().slice(0, 10);
const field = (obj, path, fallback = "") => {
  try { return path.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), obj) ?? fallback; }
  catch { return fallback; }
};
const useQuery = () => {
  const { search } = useLocation();
  return new URLSearchParams(search);
};

/* ----------------------- defaults from load ------------------------ */
function defaultLineItemsFromLoad(load) {
  const base = Number(load?.rate) || Number(load?.linehaul) || 0;
  const fuel = Number(load?.fuel_surcharge) || 0;
  const items = [];
  if (base > 0) items.push({ id: crypto.randomUUID(), description: "Line Haul", quantity: 1, rate: base });
  if (fuel > 0) items.push({ id: crypto.randomUUID(), description: "Fuel Surcharge", quantity: 1, rate: fuel });
  const accessorials = Array.isArray(load?.accessorials)
    ? load.accessorials.filter(Boolean).map((a) => ({
        id: crypto.randomUUID(),
        description: a?.description || a?.type || "Accessorial",
        quantity: a?.quantity ? Number(a.quantity) : 1,
        rate: a?.amount ? Number(a.amount) : Number(a?.rate) || 0,
      }))
    : [];
  return [...items, ...accessorials];
}

/* ------------------------------- PDF -------------------------------- */
async function getInvoicePDFBlob({ invoice, load, org, userProfile }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 x 792
  const margin = 40, pageW = 612, rightX = pageW - margin;
  let y = margin;
  const t = (s, x, yy, opt) => doc.text(String(s ?? ""), x, yy, opt);

  // Header
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  t(org?.name || userProfile?.company_name || "Your Company", margin, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); y += 16;
  if (org?.address1) t(org.address1, margin, y), y += 14;
  if (org?.address2) t(org.address2, margin, y), y += 14;
  if (org?.phone)    t(`Phone: ${org.phone}`, margin, y), y += 14;
  if (org?.email)    t(`Email: ${org.email}`, margin, y), y += 14;
  if (userProfile?.full_name) t(`Prepared by: ${userProfile.full_name}`, margin, y), y += 14;

  // Invoice meta
  y = margin;
  doc.setFont("helvetica", "bold"); doc.setFontSize(24);
  t("INVOICE", rightX, y, { align: "right" });
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  y += 24; t(`Invoice #: ${invoice.number}`, rightX, y, { align: "right" });
  y += 14; t(`Date: ${invoice.date}`, rightX, y, { align: "right" });
  y += 14; t(`Due: ${invoice.due_date}`, rightX, y, { align: "right" });

  // Bill To / Ship To
  y += 24;
  doc.setFont("helvetica", "bold");
  t("Bill To", margin, y);
  t("Ship To", 300, y);
  y += 14; doc.setFont("helvetica", "normal");

  const bill = [
    field(load, "bill_to.name") || field(load, "consignee.name") || "—",
    field(load, "bill_to.address"),
    [field(load, "bill_to.city"), field(load, "bill_to.state"), field(load, "bill_to.zip")].filter(Boolean).join(", "),
  ].filter(Boolean);
  const ship = [
    field(load, "shipper.name") || "—",
    field(load, "origin.address"),
    [field(load, "origin.city"), field(load, "origin.state"), field(load, "origin.zip")].filter(Boolean).join(", "),
  ].filter(Boolean);

  let yL = y, yR = y;
  bill.forEach((line) => (t(line, margin, yL), (yL += 14)));
  ship.forEach((line) => (t(line, 300, yR), (yR += 14)));
  y = Math.max(yL, yR) + 16;

  // Load Details band
  doc.setDrawColor(220); doc.setFillColor(245);
  doc.rect(margin, y, pageW - margin * 2, 92, "F");
  doc.setFont("helvetica", "bold"); t("Load Details", margin + 12, y + 18);
  doc.setFont("helvetica", "normal");
  let yy = y + 34;
  [
    `Load #: ${field(load, "reference", "—")}   PO: ${field(load, "po_number", "—")}   PRO: ${field(load, "pro_number", "—")}`,
    `PU: ${field(load, "pickup_date", "—")}  @ ${[field(load, "origin.city"), field(load, "origin.state")].filter(Boolean).join(", ")}`,
    `DEL: ${field(load, "delivery_date", "—")}  @ ${[field(load, "destination.city"), field(load, "destination.state")].filter(Boolean).join(", ")}`,
    `Equipment: ${field(load, "equipment_type", "—")}   Weight: ${field(load, "weight", "—")}   Miles: ${field(load, "miles", "—")}`,
    `Dispatcher: ${field(load, "dispatcher_name", "—")}   Driver: ${field(load, "driver_name", "—")}   Truck: ${field(load, "truck_number", "—")}   Trailer: ${field(load, "trailer_number", "—")}`,
  ].forEach((line) => (t(line, margin + 12, yy), (yy += 14)));
  y += 92 + 16;

  // Items table
  const headers = ["Description", "Qty", "Rate", "Amount"];
  const widths = [300, 60, 90, 90];
  const startX = margin;

  doc.setFont("helvetica", "bold");
  headers.forEach((h, i) => {
    const x = startX + widths.slice(0, i).reduce((a, b) => a + b, 0);
    t(h, x, y);
  });
  y += 10; doc.setDrawColor(200); doc.line(margin, y, pageW - margin, y); y += 14; doc.setFont("helvetica", "normal");

  let sub = 0;
  invoice.items.forEach((it) => {
    const amt = money((Number(it.quantity) || 0) * (Number(it.rate) || 0));
    sub += amt;
    const cols = [String(it.description || ""), String(it.quantity || 0), fmtUSD(it.rate || 0), fmtUSD(amt)];
    cols.forEach((c, i) => {
      const x = startX + widths.slice(0, i).reduce((a, b) => a + b, 0);
      t(c, i >= 2 ? x + widths[i] : x, y, { align: i >= 2 ? "right" : "left" });
    });
    y += 18;
  });

  y += 6; doc.line(margin, y, pageW - margin, y); y += 16;
  const tax = money(invoice.tax || 0);
  const discount = money(invoice.discount || 0);
  const total = money(sub + tax - discount);

  const rightBlockX = pageW - margin - 200;
  const row = (label, value) => { t(label, rightBlockX, y); t(fmtUSD(value), rightX, y, { align: "right" }); y += 16; };
  doc.setFont("helvetica", "bold"); row("Subtotal", sub);
  doc.setFont("helvetica", "normal"); row("Tax", tax); row("Discounts", discount);
  doc.setFont("helvetica", "bold"); row("Total", total);

  y += 10; doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const note = invoice.notes?.trim();
  if (note) {
    t("Notes:", margin, y); y += 12;
    doc.splitTextToSize(note, pageW - margin * 2).forEach((line) => (t(line, margin, y), (y += 12)));
  }

  doc.setFontSize(9); doc.setTextColor(120);
  t(org?.footer || "Thank you for your business.", margin, 792 - margin);

  // Return a Blob (so we can upload to Storage) AND download client-side if needed
  const blob = doc.output("blob");
  return { blob, filename: `Invoice_${invoice.number || field(load, "reference", "draft")}.pdf` };
}

async function downloadPDFLocal(params) {
  const { blob, filename } = await getInvoicePDFBlob(params);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  return { blob, filename };
}

/* --------------------------------- page ----------------------------------- */
export default function InvoiceDraft() {
  const { loadId: loadIdParam } = useParams();
  const query = useQuery();
  const navigate = useNavigate();
  const loadId = loadIdParam || query.get("id") || "";

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [load, setLoad] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  // Optional org overrides (fallback to user company/name)
  const [org] = useState({
    name: "",
    address1: "",
    address2: "",
    phone: "",
    email: "",
    footer: "Remit to: ACH preferred • Net 15",
  });

  const [invoice, setInvoice] = useState(() => ({
    number: "",
    date: todayISO(),
    due_date: todayISO(),
    items: [],
    tax: 0,
    discount: 0,
    notes: "",
  }));

  const subtotal = useMemo(
    () => invoice.items.reduce((a, it) => a + money((Number(it.quantity) || 0) * (Number(it.rate) || 0)), 0),
    [invoice.items]
  );
  const total = useMemo(() => money(subtotal + money(invoice.tax) - money(invoice.discount)), [subtotal, invoice.tax, invoice.discount]);

  // Fetch user profile (name, company)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("users")
          .select("id, full_name, company_name, email")
          .eq("id", user.id)
          .single();
        if (alive) setUserProfile(data || null);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  // Fetch load + prefill
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true); setError("");
        if (!loadId) throw new Error("No load id provided.");
        const { data, error: err } = await supabase.from("loads").select("*").eq("id", loadId).single();
        if (err) throw err;
        if (!active) return;
        setLoad(data);

        const generatedNumber = data?.reference ? `INV-${String(data.reference).replace(/\s+/g, "")}` : `INV-${loadId}`;
        const defaultItems = defaultLineItemsFromLoad(data);
        setInvoice((prev) => ({
          ...prev,
          number: prev.number || generatedNumber,
          date: todayISO(),
          due_date: todayISO(),
          notes: prev.notes || [
            data?.po_number ? `PO: ${data.po_number}` : null,
            data?.reference ? `Reference: ${data.reference}` : null,
            data?.dispatcher_name ? `Dispatcher: ${data.dispatcher_name}` : null,
            data?.driver_name ? `Driver: ${data.driver_name}` : null,
          ].filter(Boolean).join(" • "),
          items: prev.items?.length ? prev.items : defaultItems,
        }));
      } catch (e) {
        setError(e.message || "Failed to load data");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadId]);

  const updateItem = (id, patch) =>
    setInvoice((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  const addItem = () =>
    setInvoice((s) => ({ ...s, items: [...s.items, { id: crypto.randomUUID(), description: "", quantity: 1, rate: 0 }] }));
  const removeItem = (id) => setInvoice((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));

  const handleDownloadPDF = async () => {
    try {
      await downloadPDFLocal({
        invoice,
        load,
        org: { ...org, name: org.name || userProfile?.company_name || "Your Company", email: org.email || userProfile?.email || "" },
        userProfile,
      });
    } catch (e) {
      alert("PDF generation failed: " + (e?.message || e));
    }
  };

  // NEW: Finalize = generate PDF, upload to Storage, create invoices row, update load status
  const handleFinalizeAndSend = async () => {
    if (!load) return;
    setBusy(true);
    try {
      // 1) generate PDF blob
      const { blob, filename } = await getInvoicePDFBlob({
        invoice,
        load,
        org: { ...org, name: org.name || userProfile?.company_name || "Your Company", email: org.email || userProfile?.email || "" },
        userProfile,
      });

      // 2) upload to Supabase Storage (bucket: invoices)
      const path = `${invoice.number || `INV-${load.id}`}.pdf`;
      const { data: up, error: upErr } = await supabase.storage.from("invoices").upload(path, blob, {
        cacheControl: "3600",
        upsert: true,
        contentType: "application/pdf",
      });
      if (upErr) throw upErr;

      // 3) get a public URL (or generate a signed URL if your bucket is private)
      let pdf_url = "";
      const { data: pub } = supabase.storage.from("invoices").getPublicUrl(path);
      pdf_url = pub?.publicUrl || "";

      // 4) insert invoice row
      const payload = {
        load_id: load.id,
        number: invoice.number,
        subtotal,
        tax: money(invoice.tax),
        discount: money(invoice.discount),
        total,
        pdf_url,
        created_by: userProfile?.id || null,
      };
      const { error: insErr } = await supabase.from("invoices").insert(payload);
      if (insErr) throw insErr;

      // 5) move load to BILLING or INVOICED
      const nextStatus = "INVOICED"; // or "BILLING" if you prefer a review step
      const { error: updErr } = await supabase.from("loads").update({ status: nextStatus }).eq("id", load.id);
      if (updErr) throw updErr;

      // 6) (optional) also download locally for the billing packet
      await downloadPDFLocal({
        invoice,
        load,
        org: { ...org, name: org.name || userProfile?.company_name || "Your Company", email: org.email || userProfile?.email || "" },
        userProfile,
      });

      alert("Invoice finalized, PDF uploaded, and load moved to INVOICED.");
      // Navigate back to Billing or Delivered as you prefer:
      // navigate("/billing");
    } catch (e) {
      alert("Finalize failed: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // Optional auto-download: /invoices/new/:loadId?autopdf=1
  useEffect(() => {
    const auto = query.get("autopdf");
    if (auto && auto !== "0" && load && invoice.items.length) {
      handleDownloadPDF();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, load, invoice.items.length, userProfile]);

  if (loading) {
    return (
      <div className="p-6 text-[var(--text-base)]">
        <div className="flex items-center gap-2 opacity-80">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading draft invoice…</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-[var(--text-base)]">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 hover:bg-white/5"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200">
          <div className="font-semibold">Couldn’t load the load</div>
          <div className="text-sm opacity-90 mt-1">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 text-[var(--text-base)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Billing</div>
          <h1 className="text-2xl font-semibold mt-1">Draft Invoice</h1>
          <div className="text-sm opacity-80 mt-1">
            From load <span className="font-mono">{field(load, "reference", loadId)}</span>
          </div>
          {userProfile?.company_name && (
            <div className="text-xs mt-1 text-[var(--text-muted)]">
              Company: <span className="font-medium">{userProfile.company_name}</span> • User: {userProfile.full_name || "—"}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadPDF}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 hover:bg-white/5"
            title="Download PDF"
            aria-label="Download PDF"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>
          <button
            onClick={handleFinalizeAndSend}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2 hover:bg-emerald-500/10 disabled:opacity-60"
            title="Finalize & Send to Billing"
            aria-label="Finalize & Send to Billing"
          >
            <CheckCircle2 className="h-4 w-4" />
            Finalize & Send to Billing
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-[var(--bg-surface)]">
        <div className="p-5 border-b border-white/10 flex items-center gap-2">
          <FileText className="h-4 w-4 opacity-70" />
          <div className="font-medium">Invoice Details</div>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-[var(--text-muted)]">Invoice #</label>
            <input
              value={invoice.number}
              onChange={(e) => setInvoice((s) => ({ ...s, number: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
              placeholder="INV-0001"
            />
          </div>
          <div>
            <label className="text-sm text-[var(--text-muted)]">Date</label>
            <input
              type="date"
              value={invoice.date}
              onChange={(e) => setInvoice((s) => ({ ...s, date: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
            />
          </div>
          <div>
            <label className="text-sm text-[var(--text-muted)]">Due Date</label>
            <input
              type="date"
              value={invoice.due_date}
              onChange={(e) => setInvoice((s) => ({ ...s, due_date: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
            />
          </div>
        </div>

        {/* items table */}
        <div className="px-5">
          <div className="mt-2 rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium w-24">Qty</th>
                  <th className="px-3 py-2 font-medium w-40">Rate</th>
                  <th className="px-3 py-2 font-medium w-40">Amount</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((it) => {
                  const amount = money((Number(it.quantity) || 0) * (Number(it.rate) || 0));
                  return (
                    <tr key={it.id} className="border-t border-white/10">
                      <td className="px-3 py-2">
                        <input
                          value={it.description}
                          onChange={(e) => updateItem(it.id, { description: e.target.value })}
                          className="w-full rounded-lg bg-transparent border border-white/10 px-2 py-1 outline-none focus:border-white/20"
                          placeholder="Line item description"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={it.quantity}
                          onChange={(e) => updateItem(it.id, { quantity: Number(e.target.value) })}
                          className="w-full rounded-lg bg-transparent border border-white/10 px-2 py-1 outline-none focus:border-white/20"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="opacity-60">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={it.rate}
                            onChange={(e) => updateItem(it.id, { rate: Number(e.target.value) })}
                            className="w-full rounded-lg bg-transparent border border-white/10 px-2 py-1 outline-none focus:border-white/20"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 font-medium">{fmtUSD(amount)}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => removeItem(it.id)}
                          className="inline-flex items-center justify-center rounded-lg border border-white/10 p-2 hover:bg-white/5"
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="p-3 border-t border-white/10">
              <button
                onClick={addItem}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 hover:bg-white/5"
              >
                <Plus className="h-4 w-4" />
                Add line
              </button>
            </div>
          </div>
        </div>

        {/* totals + notes */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="text-sm text-[var(--text-muted)]">Notes</label>
            <textarea
              rows={4}
              value={invoice.notes}
              onChange={(e) => setInvoice((s) => ({ ...s, notes: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
              placeholder="Payment terms, special instructions, etc."
            />
          </div>
          <div className="md:col-span-1">
            <div className="rounded-xl border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm opacity-80">Subtotal</span>
                <span className="font-medium">{fmtUSD(subtotal)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <label className="text-sm opacity-80">Tax</label>
                <div className="flex items-center gap-2">
                  <span className="opacity-60">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={invoice.tax}
                    onChange={(e) => setInvoice((s) => ({ ...s, tax: Number(e.target.value) }))}
                    className="w-28 rounded-lg bg-transparent border border-white/10 px-2 py-1 text-right outline-none focus:border-white/20"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <label className="text-sm opacity-80">Discount</label>
                <div className="flex items-center gap-2">
                  <span className="opacity-60">-$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={invoice.discount}
                    onChange={(e) => setInvoice((s) => ({ ...s, discount: Number(e.target.value) }))}
                    className="w-28 rounded-lg bg-transparent border border-white/10 px-2 py-1 text-right outline-none focus:border-white/20"
                  />
                </div>
              </div>
              <div className="mt-4 border-t border-white/10 pt-3 flex items-center justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-semibold">{fmtUSD(total)}</span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <button
                  onClick={handleDownloadPDF}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 hover:bg-white/5"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </button>
                <button
                  onClick={handleFinalizeAndSend}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 px-3 py-2 hover:bg-emerald-500/10 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Finalize & Send to Billing
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Read-only load summary */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-sm uppercase tracking-wider text-[var(--text-muted)] mb-2">Customer</div>
          <div className="font-medium">{field(load, "bill_to.name") || field(load, "consignee.name") || "—"}</div>
          <div className="text-sm opacity-80">{field(load, "bill_to.address")}</div>
          <div className="text-sm opacity-80">
            {[field(load, "bill_to.city"), field(load, "bill_to.state"), field(load, "bill_to.zip")].filter(Boolean).join(", ")}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-sm uppercase tracking-wider text-[var(--text-muted)] mb-2">Pickup</div>
          <div className="font-medium">{field(load, "origin.city")} {field(load, "origin.state")}</div>
          <div className="text-sm opacity-80">{field(load, "pickup_date")}</div>
          <div className="text-xs opacity-60">{field(load, "origin.address")}</div>
        </div>
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-sm uppercase tracking-wider text-[var(--text-muted)] mb-2">Delivery</div>
          <div className="font-medium">{field(load, "destination.city")} {field(load, "destination.state")}</div>
          <div className="text-sm opacity-80">{field(load, "delivery_date")}</div>
          <div className="text-xs opacity-60">{field(load, "destination.address")}</div>
        </div>
      </div>
    </div>
  );
}
