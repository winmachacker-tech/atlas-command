// src/pages/Billing.jsx
import { useEffect, useMemo, useState } from "react";
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
  FileDown,
} from "lucide-react";
import DraftInvoiceModal from "../components/billing/DraftInvoiceModal.jsx";

/* ------------------------------ Config ------------------------------ */
const PAGE_SIZE = 20;
const READY_STATUS = "READY_FOR_BILLING";

/* ------------------------------ Helpers ----------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return String(d); }
}
function fmtDateTime(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
}
const money = (n) => Number(Number(n || 0).toFixed(2));
const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    money(n)
  );

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

  // Draft modal
  const [isDraftOpen, setIsDraftOpen] = useState(false);
  const [selectedLoad, setSelectedLoad] = useState(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / PAGE_SIZE)),
    [count]
  );

  useEffect(() => { setPage(1); }, [q, dateFrom, dateTo, requirePOD, showInvoiced]);
  useEffect(() => { fetchPage(page); /* eslint-disable-next-line */ }, [page, q, dateFrom, dateTo, requirePOD, showInvoiced]);

  /* ------------------------------ Data ------------------------------ */
  async function fetchPage(pageNumber) {
    setLoading(true);
    setErr(null);
    setBanner(null);
    const from = (pageNumber - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    try {
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
            // billing fields on loads (if you still track here)
            "billing_ready",
            "billing_marked_at",
            "billed_amount",
            "assigned_biller",
            "invoice_number",
            "invoiced_at",
            // fields helpful for PDF
            "rate",
            "po_number",
            "pro_number",
            "dispatcher_name",
            "driver_name",
            "origin",
            "destination",
          ].join(","),
          { count: "exact" }
        );

      if (showInvoiced) {
        query = query.or("invoice_number.not.is.null,invoiced_at.not.is.null");
      } else {
        // 👇 PostgREST likes explicit eq.true for bool filters
        query = query.or([`status.eq.${READY_STATUS}`, `billing_ready.eq.true`].join(","));
      }

      if (q.trim()) {
        const like = `%${q.trim()}%`;
        query = query.or([`reference.ilike.${like}`, `shipper.ilike.${like}`].join(","));
      }
      if (dateFrom) query = query.gte("delivery_date", dateFrom);
      if (dateTo) query = query.lte("delivery_date", dateTo);
      if (requirePOD) query = query.not("pod_url", "is", null);

      query = query.order("delivery_date", { ascending: false }).range(from, to);

      const { data, error, count: total } = await query;
      if (error) throw error;

      setRows(data ?? []);
      setCount(total ?? 0);
      setSelected(new Set());
    } catch (e) {
      console.error("[Billing] fetch error:", e);
      setErr(e.message ?? "Failed to load billing queue.");
    } finally {
      setLoading(false);
    }
  }

  /* ------------------------------ PDF generation ------------------------------ */
  async function generatePDFForRow(loadRow) {
    try {
      setBanner(null);
      setErr(null);
      setLoading(true);

      console.log("[PDF] Starting PDF generation for load:", loadRow.id);

      // 1) Get or create invoice for this load
      let { data: inv, error: invErr } = await supabase
        .from("invoices")
        .select("*")
        .eq("load_id", loadRow.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      console.log("[PDF] Invoice query result:", { inv, invErr });

      // If no invoice exists, create a basic one
      if (!inv) {
        console.log("[PDF] No invoice found, creating new one...");
        const { data: authData } = await supabase.auth.getUser();
        const newInvoice = {
          load_id: loadRow.id,
          number: `INV-${Date.now()}`,
          status: "DRAFT",
          amount: loadRow.billed_amount || loadRow.rate || 0,
          total: loadRow.billed_amount || loadRow.rate || 0,
          created_by: authData?.user?.id,
          notes: loadRow.notes || "",
        };
        
        const { data: created, error: createErr } = await supabase
          .from("invoices")
          .insert(newInvoice)
          .select()
          .single();
        
        console.log("[PDF] Invoice creation result:", { created, createErr });
        
        if (createErr) {
          setErr(`Failed to create invoice: ${createErr.message}`);
          setLoading(false);
          return;
        }
        
        inv = created;
      }

      if (!inv) {
        setErr("Unable to get or create invoice for this load.");
        setLoading(false);
        return;
      }

      console.log("[PDF] Using invoice:", inv);

      // 2) Get current user for header
      const { data: authData } = await supabase.auth.getUser();
      const meEmail = authData?.user?.email || "";
      let companyName = "";
      try {
        const { data: meRow } = await supabase
          .from("users")
          .select("company_name")
          .eq("id", authData?.user?.id || "")
          .maybeSingle();
        companyName = meRow?.company_name || "Atlas Command";
      } catch {
        companyName = "Atlas Command";
      }

      console.log("[PDF] Building professional PDF document...");
      
      // 3) Build Professional PDF with modern styling
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      let y = margin;

      // Header gradient background (solid blue - professional look)
      doc.setFillColor(30, 64, 175); // Professional blue
      doc.rect(0, 0, pageWidth, 140, 'F');

      // Company name in header
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(32);
      doc.text(companyName, margin, y + 30);
      
      // Email in header
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(meEmail, margin, y + 52);
      
      // "INVOICE" title
      doc.setFontSize(28);
      doc.setFont("helvetica", "bold");
      doc.text("INVOICE", margin, y + 90);
      
      // Reset text color for body
      doc.setTextColor(0, 0, 0);
      y = 160;

      // Invoice meta box (light gray background)
      doc.setFillColor(249, 250, 251);
      doc.setDrawColor(229, 231, 235);
      doc.roundedRect(margin, y, pageWidth - 2 * margin, 90, 4, 4, 'FD');
      
      // Invoice metadata - three columns
      const col1X = margin + 20;
      const col2X = margin + 220;
      const col3X = margin + 400;
      
      y += 25;
      
      // Column 1: Invoice Number
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(107, 114, 128);
      doc.text("INVOICE NUMBER", col1X, y);
      
      y += 18;
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(17, 24, 39);
      doc.text(inv.number, col1X, y);
      
      // Column 2: Status
      y -= 18;
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(107, 114, 128);
      doc.text("STATUS", col2X, y);
      
      y += 18;
      // Status badge
      const statusText = inv.status;
      const statusWidth = doc.getTextWidth(statusText) + 16;
      doc.setFillColor(16, 185, 129);
      doc.roundedRect(col2X, y - 12, statusWidth, 20, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(statusText, col2X + 8, y + 2);
      
      // Column 3: Invoice Date
      y -= 18;
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(107, 114, 128);
      doc.text("INVOICE DATE", col3X, y);
      
      y += 18;
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(17, 24, 39);
      const formattedDate = new Date(inv.created_at).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
      doc.text(formattedDate, col3X, y);
      
      y += 35;

      // Bill To section
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 58, 138);
      doc.text("Bill To", margin, y);
      y += 5;
      
      // Underline
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(2);
      doc.line(margin, y, pageWidth - margin, y);
      y += 20;
      
      doc.setFillColor(249, 250, 251);
      doc.roundedRect(margin, y, pageWidth - 2 * margin, 30, 4, 4, 'F');
      doc.setFontSize(13);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(17, 24, 39);
      doc.text(loadRow.shipper || "Customer", margin + 15, y + 20);
      
      y += 50;

      // Load Details section
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 58, 138);
      doc.text("Load Details", margin, y);
      y += 5;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, y, pageWidth - margin, y);
      y += 20;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(107, 114, 128);
      
      const detailLabels = [
        "Reference Number:",
        "Origin:",
        "Destination:",
        "Delivery Status:",
      ];
      
      const detailValues = [
        loadRow.reference || "—",
        loadRow.origin || "—",
        loadRow.destination || "—",
        "Delivered",
      ];
      
      const leftCol = margin;
      const rightCol = margin + 280;
      
      for (let i = 0; i < 4; i++) {
        const col = i < 2 ? leftCol : rightCol;
        const idx = i < 2 ? i : i - 2;
        const yPos = y + (i < 2 ? idx * 20 : idx * 20);
        
        doc.setFont("helvetica", "bold");
        doc.setTextColor(107, 114, 128);
        doc.text(detailLabels[i], col, yPos);
        
        doc.setFont("helvetica", "normal");
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(11);
        doc.text(detailValues[i], col + 105, yPos);
        doc.setFontSize(10);
      }
      
      y += 50;
      
      // Additional details
      const moreDetails = [
        ["Dispatcher:", loadRow.dispatcher_name || "Not Assigned"],
        ["Driver:", loadRow.driver_name || "Not Assigned"],
        ["PO Number:", loadRow.po_number || "Not Provided"],
        ["PRO Number:", loadRow.pro_number || "Not Provided"],
      ];
      
      for (let i = 0; i < moreDetails.length; i++) {
        const col = i < 2 ? leftCol : rightCol;
        const idx = i < 2 ? i : i - 2;
        const yPos = y + idx * 20;
        
        doc.setFont("helvetica", "bold");
        doc.setTextColor(107, 114, 128);
        doc.setFontSize(10);
        doc.text(moreDetails[i][0], col, yPos);
        
        doc.setFont("helvetica", "normal");
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(11);
        doc.text(moreDetails[i][1], col + 105, yPos);
      }
      
      y += 60;

      // Charges section
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 58, 138);
      doc.text("Charges", margin, y);
      y += 5;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, y, pageWidth - margin, y);
      y += 20;
      
      // Charges box
      doc.setFillColor(249, 250, 251);
      doc.roundedRect(margin, y, pageWidth - 2 * margin, 35, 4, 4, 'F');
      
      const rate = Number(loadRow.rate || 0);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(55, 65, 81);
      doc.text("Linehaul", margin + 15, y + 22);
      
      doc.setFont("helvetica", "bold");
      doc.setTextColor(17, 24, 39);
      doc.setFontSize(13);
      doc.text(fmtUSD(rate), pageWidth - margin - 15, y + 22, { align: "right" });
      
      y += 50;

      // Total section (professional blue box)
      doc.setFillColor(30, 64, 175); // Professional blue
      doc.roundedRect(margin, y, pageWidth - 2 * margin, 40, 4, 4, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("Amount Due", margin + 15, y + 25);
      
      doc.setFontSize(24);
      doc.text(fmtUSD(inv.amount || inv.total || rate), pageWidth - margin - 15, y + 27, { align: "right" });
      
      y += 60;

      // POD link
      if (loadRow.pod_url) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(59, 130, 246);
        doc.textWithLink("📎 View Attached POD", margin, y, { url: loadRow.pod_url });
        y += 20;
      }

      // Notes section
      if (inv.notes) {
        y += 10;
        doc.setFillColor(255, 251, 235);
        doc.setDrawColor(245, 158, 11);
        const notesHeight = Math.max(40, Math.ceil(inv.notes.length / 80) * 15 + 20);
        doc.roundedRect(margin, y, pageWidth - 2 * margin, notesHeight, 4, 4, 'FD');
        
        y += 15;
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(146, 64, 14);
        doc.text("Notes", margin + 15, y);
        
        y += 15;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(120, 53, 15);
        doc.setFontSize(10);
        const noteLines = doc.splitTextToSize(inv.notes, pageWidth - 2 * margin - 30);
        doc.text(noteLines, margin + 15, y);
        y += noteLines.length * 12 + 10;
      }

      // Footer
      const footerY = pageHeight - 50;
      doc.setFillColor(249, 250, 251);
      doc.rect(0, footerY - 10, pageWidth, 60, 'F');
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(107, 114, 128);
      doc.text("Thank you for your business!", pageWidth / 2, footerY + 5, { align: "center" });
      doc.setFontSize(9);
      doc.text(`For questions about this invoice, please contact ${meEmail}`, pageWidth / 2, footerY + 20, { align: "center" });

      console.log("[PDF] PDF document built successfully");

      // 4) Upload to Supabase Storage
      const pdfBlob = doc.output("blob");
      const fileName = `invoice_${inv.number}_${loadRow.reference || loadRow.id}_${Date.now()}.pdf`;
      const filePath = `invoices/${fileName}`;
      
      console.log("[PDF] Uploading to Supabase Storage:", filePath);
      
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from("documents") // Make sure this bucket exists!
        .upload(filePath, pdfBlob, {
          contentType: "application/pdf",
          upsert: false
        });

      if (uploadError) {
        console.error("[PDF] Upload error:", uploadError);
        // Still download locally if upload fails
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setErr(`PDF downloaded locally, but failed to upload to storage: ${uploadError.message}`);
        setLoading(false);
        return;
      }

      console.log("[PDF] Upload successful:", uploadData);

      // 5) Get public URL
      const { data: urlData } = supabase
        .storage
        .from("documents")
        .getPublicUrl(filePath);

      const pdfUrl = urlData.publicUrl;
      console.log("[PDF] Public URL:", pdfUrl);

      // 6) Update invoice with PDF URL and status
      const { error: updErr } = await supabase
        .from("invoices")
        .update({ 
          status: "FINAL",
          pdf_url: pdfUrl
        })
        .eq("id", inv.id);
      
      console.log("[PDF] Database update result:", { error: updErr });
      
      if (updErr) {
        console.warn("[PDF] DB update failed:", updErr.message);
      }

      // 7) Also download locally for immediate access
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log("[PDF] ✅ PDF generation complete!");
      setBanner(`Invoice PDF generated, uploaded to storage, and downloaded to your computer.`);
      await fetchPage(page);
    } catch (e) {
      console.error("[Billing] generatePDF error:", e);
      setErr(e?.message || "Failed to generate PDF.");
    } finally {
      setLoading(false);
    }
  }

  /* ------------------------------ UI Actions ------------------------------ */
  function clearFilters() {
    setQ(""); setDateFrom(""); setDateTo(""); setRequirePOD(true); setShowInvoiced(false);
  }
  function toggleRow(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }
  function openDraft(row) { setSelectedLoad(row); setIsDraftOpen(true); }

  async function markInvoiced(rowIds) {
    if (!rowIds?.length) return;
    setLoading(true); setErr(null); setBanner(null);
    try {
      const missing = rows.filter((r) => rowIds.includes(r.id)).filter((r) => !r.pod_url || !r.invoice_number);
      if (missing.length) {
        setErr(`Cannot mark as invoiced: ${missing.length} row(s) missing POD and/or invoice number.`);
        setLoading(false);
        return;
      }
      const updates = { invoiced_at: new Date().toISOString(), status: "INVOICED" };
      const { error } = await supabase.from("loads").update(updates).in("id", rowIds);
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
    setLoading(true); setErr(null); setBanner(null);
    try {
      const { error } = await supabase
        .from("loads")
        .update({ billing_ready: false, status: "DELIVERED" })
        .eq("id", rowId);
      if (error) throw error;
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
      "Reference","Shipper","Delivered","POD URL","Amount","Status","Assigned Biller","Invoice #","Invoiced At","Notes","Invoice PDF",
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
          r.invoice_pdf_url ?? "",
        ].map((v) => `"${String(v)}"`).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `billing_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
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
          <p className="text-sm opacity-70">Queue of loads ready to invoice. Draft, generate PDF, mark invoiced, and export.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchPage(page)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5" title="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
            <span className="text-sm">Refresh</span>
          </button>
          <button
            onClick={() => exportCSV(rows.filter((r) => selected.has(r.id)))}
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
      {banner && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{banner}</div>}
      {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{String(err)}</div>}

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/5 p-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference or shipper…" className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none placeholder:opacity-60" />
        </div>

        <div className="relative">
          <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none" />
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-60">From</div>
        </div>

        <div className="relative">
          <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-lg border border-white/10 bg-transparent px-9 py-2 outline-none" />
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-60">To</div>
        </div>

        <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
          <input type="checkbox" checked={requirePOD} onChange={(e) => setRequirePOD(e.target.checked)} /> Require POD
        </label>

        <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
          <input type="checkbox" checked={showInvoiced} onChange={(e) => setShowInvoiced(e.target.checked)} /> Show Invoiced
        </label>

        <button onClick={clearFilters} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
          <X className="h-4 w-4" /> Clear
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-white/10">
        <div className="overflow-auto">
          <table className="min-w-[1200px] w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left">
                <Th><input type="checkbox" checked={allChecked} onChange={toggleAll} /></Th>
                <Th>Reference</Th>
                <Th>Shipper</Th>
                <Th>Delivered</Th>
                <Th>POD</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
                <Th>Invoice #</Th>
                <Th>Invoice PDF</Th>
                <Th>Invoiced At</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="p-6 text-center opacity-70">
                    <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
                  </td>
                </tr>
              )}

              {!loading && rows.length === 0 && (
                <tr><td colSpan={12} className="p-6 text-center opacity-70">No rows.</td></tr>
              )}

              {!loading && rows.map((r) => {
                const isReady = r.status === READY_STATUS || r.billing_ready === true;
                const canInvoice = !!r.pod_url && !!r.invoice_number && isReady;

                return (
                  <tr key={r.id} className="border-t border-white/10 hover:bg-white/5">
                    <Td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} /></Td>
                    <Td className="font-medium">{r.reference ?? "—"}</Td>
                    <Td>{r.shipper ?? "—"}</Td>
                    <Td>{fmtDate(r.delivery_date)}</Td>
                    <Td>
                      {r.pod_url ? (
                        <a href={r.pod_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/5" title="Open POD">
                          <FileCheck2 className="h-4 w-4" /> View POD <ExternalLink className="h-3 w-3 opacity-70" />
                        </a>
                      ) : (<span className="text-xs opacity-60">No POD</span>)}
                    </Td>
                    <Td>{typeof r.billed_amount === "number" ? fmtUSD(r.billed_amount) : "—"}</Td>
                    <Td><span className="rounded-md border border-white/10 px-2 py-1 text-xs">{r.status ?? "—"}</span></Td>
                    <Td>{r.assigned_biller ?? "—"}</Td>
                    <Td>{r.invoice_number ?? "—"}</Td>
                    <Td>
                      {r.invoice_pdf_url ? (
                        <a href={r.invoice_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/5">
                          Open PDF <ExternalLink className="h-3 w-3 opacity-70" />
                        </a>
                      ) : (
                        <span className="text-xs opacity-60">—</span>
                      )}
                    </Td>
                    <Td>{fmtDateTime(r.invoiced_at)}</Td>
                    <Td className="min-w-[360px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openDraft(r)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                          title="Create/Update draft invoice"
                        >
                          <DollarSign className="h-4 w-4" /> Draft Invoice
                        </button>

                        <button
                          onClick={() => generatePDFForRow(r)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                          title="Generate & attach PDF"
                        >
                          <FileDown className="h-4 w-4" /> Generate PDF
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
                          title={canInvoice ? "Mark as invoiced" : "Requires POD and Invoice #"}
                        >
                          <ShieldCheck className="h-4 w-4" /> Mark Invoiced
                        </button>

                        <button
                          onClick={() => revertToReview(r.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                          title="Send back to Delivered review"
                        >
                          <UserRound className="h-4 w-4" /> Revert
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
          <div className="text-xs opacity-70">Showing {count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(count, page * PAGE_SIZE)} of {count}</div>
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <div className="min-w-[6ch] text-center text-sm">{page} / {totalPages}</div>
            <button className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Draft Invoice Modal */}
      <DraftInvoiceModal
        open={isDraftOpen}
        onClose={() => setIsDraftOpen(false)}
        load={selectedLoad}
        onSaved={async () => {
          setIsDraftOpen(false);
          setSelectedLoad(null);
          await fetchPage(page);
        }}
      />
    </section>
  );
}

/* ------------------------------ Cells ------------------------------ */
function Th({ children }) {
  return <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide opacity-70">{children}</th>;
}
function Td({ children, className }) {
  return <td className={cx("px-4 py-3 align-top", className)}>{children}</td>;
}