// FILE: supabase/functions/sales-import-list/index.ts
//
// Purpose:
//   Bulk-import carrier prospects from a list (e.g. your Highway/Atlas campaign CSV)
//   into public.sales_prospects for the CURRENT ORG only.
//
//   This function now supports TWO modes:
//
//   1) JSON rows mode (what you already had):
//      POST body:
//        {
//          "rows": [
//            {
//              "Id": 567898,
//              "Legal Name": "UNIVERSITY TRANSPORTATION INC",
//              "Physical Address": "1811 HWY 31 SOUTH ALABASTER AL 35007",
//              "State": "AL",
//              "DOT Number": 2544514,
//              "MC Number": 885639,
//              "Dispatch Phone": "(614) 492-1144",
//              "Dispatch Email": "dirwin@unitransinc.com",
//              "Observed Lane Certainty": "High",
//              "Preferred Lane Certainty": "Medium",
//              "HQ Lane Certainty": "Low",
//              "Reported Power Units": 25,
//              "No. of Insights": 0,
//              "Insights": null
//            },
//            ...
//          ],
//          "list_tag": "highway_atlas_campaign_2025_11"
//        }
//
//   2) CSV upload mode (for your UI button):
//      POST body:
//        {
//          "csv": "<raw CSV text, including header row>",
//          "filename": "Highway Carriers For Atlas Campaign - Sheet1.csv",
//          "list_tag": "highway_atlas_campaign_2025_11"   // optional
//        }
//
// Security:
//   - Uses SUPABASE_SERVICE_ROLE_KEY ONLY here (never in browser).
//   - Requires a valid user JWT in the Authorization header ("Bearer <token>").
//   - Resolves org_id from public.team_members where status = 'active'.
//   - Inserts rows with that org_id and source_system = 'IMPORT_LIST'.
//   - RLS on public.sales_prospects remains in place.
//
// Env required (Edge Function secrets):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//
// Notes:
//   - We map your CSV columns to sales_prospects columns as follows:
//       • "Legal Name"            → legal_name
//       • "DOT Number"            → dot_number
//       • "MC Number"             → mc_number
//       • "Dispatch Phone"        → phone
//       • "Dispatch Email"        → email
//       • "Physical Address"      → address_line1
//       • "State"                 → state
//       • "Reported Power Units"  → power_units
//       • Entire row JSON         → source_payload
//       • Fixed values:
//           source_system = 'IMPORT_LIST'
//           country      = 'US'
//           sales_status = 'NEW' (default in table)
//           tags         = ['imported_list', <list_tag?>]
//
//   - We do batched inserts (up to 200 rows per batch) for ~1200 carriers.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
// Deno CSV parser so we handle commas/quotes safely (especially in "Insights").
import { parse } from "https://deno.land/std@0.224.0/csv/mod.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ImportCarrierRow = {
  Id?: number | string;
  "Legal Name"?: string;
  "Physical Address"?: string;
  State?: string;
  "DOT Number"?: number | string;
  "MC Number"?: number | string;
  "Dispatch Phone"?: string;
  "Dispatch Email"?: string;
  "Observed Lane Certainty"?: string;
  "Preferred Lane Certainty"?: string;
  "HQ Lane Certainty"?: string;
  "Reported Power Units"?: number | string;
  "No. of Insights"?: number | string;
  Insights?: string | null;
  // Allow unknown extra keys too
  [key: string]: unknown;
};

type JsonRowsBody = {
  rows?: ImportCarrierRow[];
  list_tag?: string;
};

type CsvBody = {
  csv?: string;
  filename?: string;
  list_tag?: string;
};

type RequestBody = JsonRowsBody & CsvBody;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// Helper: safe int parsing for DOT / MC / Power units
function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : parseInt(String(value).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// Helper: very light slug for list_tag based on filename
function filenameToTag(filename: string | undefined | null): string | null {
  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, ""); // drop extension
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || null;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        ok: false,
        error: "Supabase environment not configured",
        missing: {
          has_SUPABASE_URL: !!supabaseUrl,
          has_SUPABASE_SERVICE_ROLE_KEY: !!serviceRoleKey,
        },
      },
      500,
    );
  }

  // We still expect a user JWT in the Authorization header so we can
  // figure out which org_id to import into.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!jwt) {
    return jsonResponse(
      { ok: false, error: "Missing Authorization header (Bearer <token>)" },
      401,
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch (_err) {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const hasCsv = typeof body.csv === "string" && body.csv.trim().length > 0;
  const hasRowsArray = Array.isArray(body.rows) && body.rows.length > 0;

  if (!hasCsv && !hasRowsArray) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Body must include either a non-empty 'csv' string or a non-empty 'rows' array.",
      },
      400,
    );
  }

  // Create Supabase client with service role, but still pass user JWT
  // so auth.getUser() and org resolution work.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });

  // 1) Get the current user
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData?.user) {
    return jsonResponse(
      {
        ok: false,
        error: "Unable to resolve authenticated user.",
        details: authError?.message ?? null,
      },
      401,
    );
  }

  const userId = authData.user.id;

  // 2) Resolve org_id from public.team_members (status = 'active')
  const { data: teamMember, error: teamError } = await supabase
    .from("team_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (teamError || !teamMember?.org_id) {
    return jsonResponse(
      {
        ok: false,
        error: "Unable to resolve org_id for this user.",
        details: teamError?.message ?? null,
      },
      403,
    );
  }

  const orgId = teamMember.org_id as string;

  // -------------------------------------------------------------------------
  // Build ImportCarrierRow[] from either CSV or JSON rows
  // -------------------------------------------------------------------------

  let importRows: ImportCarrierRow[] = [];
  let requestedRowCount = 0;

  if (hasCsv) {
    const csvText = body.csv!.trim();
    requestedRowCount = csvText.split("\n").length - 1; // rough count

    try {
      // parse() will return an array of objects when header row is present.
      const parsed = parse(csvText, {
        skipFirstRow: false,
        header: true,
      }) as ImportCarrierRow[] | Record<string, unknown>[] | unknown[];

      if (Array.isArray(parsed)) {
        importRows = parsed.map((r) => r as ImportCarrierRow);
      } else {
        importRows = [];
      }
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to parse CSV.",
          details: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
  } else if (hasRowsArray) {
    importRows = (body.rows ?? []) as ImportCarrierRow[];
    requestedRowCount = importRows.length;
  }

  if (!Array.isArray(importRows) || importRows.length === 0) {
    return jsonResponse(
      { ok: false, error: "No valid rows to import after parsing input." },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // Map rows -> sales_prospects insert payloads
  // -------------------------------------------------------------------------

  const now = new Date().toISOString();
  const baseTags = ["imported_list"];
  const derivedTagFromFilename = filenameToTag(body.filename ?? null);
  const listTag =
    (body.list_tag?.trim() || "") || derivedTagFromFilename || null;
  const tags = listTag ? [...baseTags, listTag] : baseTags;

  const records = importRows
    .map((r): Record<string, unknown> | null => {
      const legalName = (r["Legal Name"] ?? "").toString().trim();
      if (!legalName) {
        // Skip rows without a legal name
        return null;
      }

      const dotNumber = toIntOrNull(r["DOT Number"]);
      const mcNumber = toIntOrNull(r["MC Number"]);
      const reportedPowerUnits = toIntOrNull(r["Reported Power Units"]);

      const phone = (r["Dispatch Phone"] ?? "").toString().trim();
      const email = (r["Dispatch Email"] ?? "").toString().trim();
      const state = (r.State ?? "").toString().trim();
      const physicalAddress = (r["Physical Address"] ?? "").toString().trim();

      const rowPayload: Record<string, unknown> = { ...r };

      return {
        org_id: orgId,
        created_at: now,
        updated_at: now,
        legal_name: legalName,
        dba_name: null,
        dot_number: dotNumber,
        mc_number: mcNumber,
        phone: phone || null,
        email: email || null,
        website: null,
        address_line1: physicalAddress || null,
        address_line2: null,
        city: null, // we don't parse city separately from Physical Address (could be added later)
        state: state || null,
        postal_code: null,
        country: "US",
        operation_type: null,
        carrier_operation: null,
        cargo_types: null,
        power_units: reportedPowerUnits,
        drivers: null,
        usdot_status: null,
        mcs150_mileage: null,
        mcs150_mileage_year: null,
        safety_rating: null,
        inspections: null,
        crashes: null,
        source_payload: rowPayload,
        source_system: "IMPORT_LIST",
        sales_status: "NEW", // keep your default sales status
        tags,
      };
    })
    .filter((r): r is Record<string, unknown> => r !== null);

  if (records.length === 0) {
    return jsonResponse(
      { ok: false, error: "No valid rows to import (missing Legal Name)." },
      400,
    );
  }

  // 3) Insert in batches to avoid payload/row limits
  const BATCH_SIZE = 200;
  let inserted = 0;
  const errors: unknown[] = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error: insertError } = await supabase
      .from("sales_prospects")
      .insert(batch); // no onConflict for now to avoid guessing your unique index

    if (insertError) {
      errors.push({
        batch_start: i,
        batch_size: batch.length,
        message: insertError.message,
        details: insertError.details ?? null,
      });
    } else {
      inserted += batch.length;
    }
  }

  return jsonResponse(
    {
      ok: errors.length === 0,
      status: "ok",
      org_id: orgId,
      mode: hasCsv ? "csv" : "json_rows",
      requested_rows: requestedRowCount,
      imported_rows: records.length,
      inserted_rows: inserted,
      skipped_rows: requestedRowCount - records.length,
      errors,
    },
    errors.length ? 207 /* Multi-Status-ish */ : 200,
  );
});
