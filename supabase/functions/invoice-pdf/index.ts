// FILE: supabase/functions/invoice-pdf/index.ts
//
// Purpose:
// - Generate a PDF for a single invoice (RLS-safe).
// - Uses the caller's JWT via Authorization header (no service-role).
// - Fetches:
//     • load_invoices (invoice header + load relation)
//     • load_invoice_items (line items)
// - Builds a simple but clean PDF using pdf-lib and returns it.
//
// Input:
//   GET /invoice-pdf?invoice_id=<uuid>
//
// Auth:
//   Requires Authorization: Bearer <supabase JWT> header from the client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type InvoiceRow = {
  id: string;
  org_id: string;
  load_id: string;
  invoice_number: string | null;
  status: string;
  amount: number | null;
  currency: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  terms: string | null;
  notes: string | null;
  load: {
    id: string;
    reference: string | null;
    shipper: string | null;
    delivery_city: string | null;
    delivery_state: string | null;
    delivery_date: string | null;
    rate: number | null;
  } | null;
};

type LineItemRow = {
  id: string;
  org_id: string;
  invoice_id: string;
  description: string | null;
  kind: string | null;
  qty: number | null;
  rate: number | null;
  amount: number | null;
  sort_order: number | null;
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US");
  } catch {
    return String(d);
  }
}

function fmtMoney(n: number | null | undefined): string {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const invoiceId = url.searchParams.get("invoice_id");
    if (!invoiceId) {
      return new Response(
        JSON.stringify({ error: "Missing invoice_id query param" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // RLS-safe Supabase client (uses caller's JWT)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // 1) Fetch invoice + load
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
        load:loads (
          id,
          reference,
          shipper,
          delivery_city,
          delivery_state,
          delivery_date,
          rate
        )
      `
      )
      .eq("id", invoiceId)
      .single<InvoiceRow>();

    if (invErr || !inv) {
      console.error("[invoice-pdf] invoice fetch error:", invErr);
      return new Response(
        JSON.stringify({
          error: "Invoice not found or not accessible.",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 2) Fetch line items
    const { data: items, error: itemsErr } = await supabase
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
        sort_order
      `
      )
      .eq("invoice_id", inv.id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (itemsErr) {
      console.error("[invoice-pdf] items fetch error:", itemsErr);
      return new Response(
        JSON.stringify({
          error: "Failed to load invoice line items.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const lineItems: LineItemRow[] = items || [];

    // 3) Build PDF with pdf-lib
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;

    // Header
    page.drawText("ATLAS COMMAND", {
      x: 50,
      y,
      size: 16,
      font: fontBold,
      color: rgb(0.2, 0.9, 0.7),
    });

    y -= 24;

    const invNumber = inv.invoice_number || inv.id;
    page.drawText(`Invoice ${invNumber}`, {
      x: 50,
      y,
      size: 14,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    y -= 18;
    page.drawText(`Status: ${inv.status}`, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 14;
    page.drawText(`Issued: ${fmtDate(inv.issued_at)}`, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.9, 0.9, 0.9),
    });

    if (inv.due_at) {
      y -= 14;
      page.drawText(`Due: ${fmtDate(inv.due_at)}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0.9, 0.9, 0.9),
      });
    }

    // Right side: total
    const totalAmount =
      typeof inv.amount === "number"
        ? inv.amount
        : lineItems.reduce(
            (sum, r) => sum + Number(r.amount ?? 0),
            inv.load?.rate ?? 0
          );

    page.drawText("Total", {
      x: width - 200,
      y: height - 60,
      size: 10,
      font,
      color: rgb(0.8, 0.8, 0.8),
    });
    page.drawText(fmtMoney(totalAmount), {
      x: width - 200,
      y: height - 78,
      size: 18,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // Load info
    y -= 40;
    const loadRef = inv.load?.reference || "—";
    const shipper = inv.load?.shipper || "Unknown shipper";
    const destCity = inv.load?.delivery_city || "";
    const destState = inv.load?.delivery_state || "";
    const destStr = `${destCity}${destCity && destState ? ", " : ""}${destState}`;

    page.drawText("Load", {
      x: 50,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 14;
    page.drawText(`Reference: ${loadRef}`, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 14;
    page.drawText(`Shipper: ${shipper}`, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 14;
    page.drawText(`Destination: ${destStr || "—"}`, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 14;
    page.drawText(
      `Delivered: ${fmtDate(inv.load?.delivery_date || null)}`,
      {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0.9, 0.9, 0.9),
      }
    );

    // Line items table header
    y -= 30;
    page.drawText("Line Items", {
      x: 50,
      y,
      size: 11,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    y -= 18;

    const colX = {
      kind: 50,
      description: 110,
      qty: width - 210,
      rate: width - 150,
      amount: width - 90,
    };

    // Header row
    const headerY = y;
    page.drawText("Type", {
      x: colX.kind,
      y: headerY,
      size: 9,
      font: fontBold,
      color: rgb(0.9, 0.9, 0.9),
    });
    page.drawText("Description", {
      x: colX.description,
      y: headerY,
      size: 9,
      font: fontBold,
      color: rgb(0.9, 0.9, 0.9),
    });
    page.drawText("Qty", {
      x: colX.qty,
      y: headerY,
      size: 9,
      font: fontBold,
      color: rgb(0.9, 0.9, 0.9),
    });
    page.drawText("Rate", {
      x: colX.rate,
      y: headerY,
      size: 9,
      font: fontBold,
      color: rgb(0.9, 0.9, 0.9),
    });
    page.drawText("Amount", {
      x: colX.amount,
      y: headerY,
      size: 9,
      font: fontBold,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 12;

    const rowHeight = 14;

    (lineItems.length ? lineItems : []).forEach((item) => {
      if (y < 80) {
        // naive: no new pages for now; could be extended later
        return;
      }
      const qty = Number(item.qty ?? 0);
      const rate = Number(item.rate ?? 0);
      const amount =
        typeof item.amount === "number" ? item.amount : qty * rate;

      page.drawText(item.kind || "OTHER", {
        x: colX.kind,
        y,
        size: 9,
        font,
        color: rgb(0.9, 0.9, 0.9),
      });
      page.drawText(item.description || "", {
        x: colX.description,
        y,
        size: 9,
        font,
        color: rgb(0.9, 0.9, 0.9),
      });
      page.drawText(qty.toString(), {
        x: colX.qty,
        y,
        size: 9,
        font,
        color: rgb(0.9, 0.9, 0.9),
      });
      page.drawText(fmtMoney(rate), {
        x: colX.rate,
        y,
        size: 9,
        font,
        color: rgb(0.9, 0.9, 0.9),
      });
      page.drawText(fmtMoney(amount), {
        x: colX.amount,
        y,
        size: 9,
        font,
        color: rgb(0.9, 0.9, 0.9),
      });

      y -= rowHeight;
    });

    // Totals footer
    y -= 20;
    page.drawText("Total", {
      x: colX.rate,
      y,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText(fmtMoney(totalAmount), {
      x: colX.amount,
      y,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // Optional terms/notes
    if (inv.terms || inv.notes) {
      y -= 30;
      page.drawText("Notes", {
        x: 50,
        y,
        size: 10,
        font: fontBold,
        color: rgb(0.9, 0.9, 0.9),
      });
      y -= 14;
      const notes = [inv.terms, inv.notes].filter(Boolean).join("\n\n");
      page.drawText(notes, {
        x: 50,
        y,
        size: 9,
        font,
        color: rgb(0.85, 0.85, 0.85),
        maxWidth: width - 100,
        lineHeight: 11,
      });
    }

    const pdfBytes = await pdfDoc.save();

    const fileNameSafe = `invoice-${invNumber}.pdf`;

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileNameSafe}"`,
      },
    });
  } catch (e) {
    console.error("[invoice-pdf] unhandled error:", e);
    return new Response(
      JSON.stringify({
        error: "Internal error while generating invoice PDF.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
