// FILE: supabase/functions/sales-ingest-fmcsa/index.ts
//
// Version: Single-carrier ingest (Option B) – manual upsert
//
// Purpose:
//   Ingest ONE FMCSA-style carrier record into public.sales_prospects
//   for the *caller’s* org, with full org isolation.
//
//   - Validates the caller via Supabase Auth (JWT from Authorization header)
//   - Resolves org_id via team_members (using user_id + is_default)
//   - Accepts a JSON body: { record: FMCSARecord }
//   - Maps the record into public.sales_prospects
//   - Forces org_id to the verified org (cannot import into another org)
//   - MANUALLY upserts:
//       * SELECT existing prospect by (org_id, dot_number)
//       * If found -> UPDATE
//       * If not -> INSERT
//   - Never exposes secrets to the browser
//
// Security:
//   - Uses SUPABASE_SERVICE_ROLE_KEY only inside this function.
//   - Uses Supabase Auth to get the caller.
//   - Uses team_members to ensure the user has an org.
//   - Always sets org_id and created_by; RLS still protects reads in the UI.
//
// Environment variables (Supabase project):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//
// To deploy:
//   supabase functions deploy sales-ingest-fmcsa
//

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// VERY EXPLICIT CORS FOR SUPABASE
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[sales-ingest-fmcsa] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
}

type IncomingRecord = {
  dot_number?: string | number | null;
  mc_number?: string | number | null;
  legal_name?: string | null;
  dba_name?: string | null;

  phone?: string | null;
  email?: string | null;
  website?: string | null;

  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;

  operation_type?: string | null;
  carrier_operation?: string | null;
  cargo_types?: string[] | string | null;

  power_units?: number | string | null;
  drivers?: number | string | null;

  usdot_status?: string | null;
  mcs150_mileage?: number | string | null;
  mcs150_mileage_year?: number | string | null;
  safety_rating?: string | null;

  inspections?: unknown;
  crashes?: unknown;

  source_system?: string | null;
  source_payload?: unknown;

  [key: string]: unknown;
};

serve(async (req) => {
  // 1) CORS preflight – browser hits this first
  if (req.method === "OPTIONS") {
    // IMPORTANT: 204 MUST NOT HAVE A BODY
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
      },
    });
  }

  // 2) Only POST is allowed
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(
      {
        error:
          "Server misconfiguration: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.",
      },
      500
    );
  }

  // 3) Create admin client using service_role, but keep user's Authorization header
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization") ?? "",
      },
    },
  });

  // 4) Identify the caller
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("[sales-ingest-fmcsa] auth error:", authError);
    return jsonResponse(
      { error: "Unauthorized. No valid user found." },
      401
    );
  }

  // 5) Parse body and read "record"
  let body: { record?: IncomingRecord };
  try {
    body = await req.json();
  } catch (err) {
    console.error("[sales-ingest-fmcsa] invalid JSON body:", err);
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const record = body?.record;
  if (!record || typeof record !== "object") {
    return jsonResponse(
      {
        error: "Missing record.",
        details: "Body must include a 'record' object.",
      },
      400
    );
  }

  // 6) Resolve target org_id for this user (using team_members)
  const orgId = await resolveOrgIdForUser(supabase, user.id);
  if (!orgId) {
    return jsonResponse(
      {
        error: "No valid org_id for this user.",
        details:
          "Ensure the user has a row in team_members with this user_id.",
      },
      403
    );
  }

  // 7) Map incoming record to sales_prospects row
  const nowIso = new Date().toISOString();
  const row = mapToSalesProspectRow(orgId, user.id, nowIso, record);

  // 7.1) Business filter: only keep carriers with 5+ power units.
  // - If power_units is null/0/1-4 → skip ingest and return a "skipped" response.
  if (!row.power_units || row.power_units < 5) {
    return jsonResponse(
      {
        ok: false,
        skipped: true,
        reason: "Carrier has fewer than 5 power units",
        power_units: row.power_units,
      },
      200
    );
  }

  // 8) MANUAL UPSERT:
  //    - Try to find an existing row by (org_id, dot_number).
  //    - If found, UPDATE.
  //    - If not found, INSERT.
  try {
    let existingId: string | null = null;

    if (row.dot_number != null) {
      const { data: existing, error: existingError } = await supabase
        .from("sales_prospects")
        .select("id")
        .eq("org_id", orgId)
        .eq("dot_number", row.dot_number)
        .limit(1)
        .maybeSingle();

      if (existingError && existingError.code !== "PGRST116") {
        // PGRST116 = "No rows found" (fine)
        console.error(
          "[sales-ingest-fmcsa] error checking existing prospect:",
          existingError
        );
        return jsonResponse(
          {
            error: "Error checking existing prospect.",
            details: existingError.message,
          },
          500
        );
      }

      existingId = existing?.id ?? null;
    }

    let resultRow: any = null;
    let wasInserted = false;

    if (existingId) {
      // UPDATE existing row
      const { data: updated, error: updateError } = await supabase
        .from("sales_prospects")
        .update({
          ...row,
          updated_at: nowIso,
        })
        .eq("id", existingId)
        .select("id, dot_number, legal_name, created_at, updated_at")
        .single();

      if (updateError) {
        console.error("[sales-ingest-fmcsa] update error:", updateError);
        return jsonResponse(
          {
            error: "Error updating prospect.",
            details: updateError.message,
          },
          500
        );
      }

      resultRow = updated;
      wasInserted = false;
    } else {
      // INSERT new row
      const { data: inserted, error: insertError } = await supabase
        .from("sales_prospects")
        .insert(row)
        .select("id, dot_number, legal_name, created_at, updated_at")
        .single();

      if (insertError) {
        console.error("[sales-ingest-fmcsa] insert error:", insertError);
        return jsonResponse(
          {
            error: "Error inserting prospect.",
            details: insertError.message,
          },
          500
        );
      }

      resultRow = inserted;
      wasInserted = true;
    }

    return jsonResponse(
      {
        ok: true,
        org_id: orgId,
        prospect_id: resultRow?.id ?? null,
        dot_number: resultRow?.dot_number ?? null,
        legal_name: resultRow?.legal_name ?? null,
        was_inserted: wasInserted,
      },
      200
    );
  } catch (err) {
    console.error("[sales-ingest-fmcsa] unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error.", details: String(err) },
      500
    );
  }
});

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * Resolve which org_id to use for this user.
 *
 * team_members schema (for reference):
 *   - user_id
 *   - org_id
 *   - email
 *   - role
 *   - status
 *   - is_default
 *
 * Strategy:
 *   - Find rows where user_id = this user
 *   - Prefer is_default = true, otherwise take the oldest row
 */
async function resolveOrgIdForUser(
  supabase: any,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("team_members")
    .select("org_id, is_default, status")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[sales-ingest-fmcsa] error resolving org_id:", error);
    return null;
  }

  return data?.org_id ?? null;
}

/**
 * Convert an incoming FMCSA-style record into the shape expected by public.sales_prospects.
 */
function mapToSalesProspectRow(
  orgId: string,
  userId: string,
  nowIso: string,
  rec: IncomingRecord
) {
  const dotNumber = toBigIntOrNull(rec.dot_number);
  const mcNumber = toBigIntOrNull(rec.mc_number);

  const cargoTypesArray = toStringArray(rec.cargo_types);

  const powerUnits = toIntOrNull(rec.power_units);
  const drivers = toIntOrNull(rec.drivers);
  const mcs150Mileage = toBigIntOrNull(rec.mcs150_mileage);
  const mcs150Year = toIntOrNull(rec.mcs150_mileage_year);

  const legalName =
    (rec.legal_name ??
      (rec as any)["legalName"] ??
      (rec as any)["carrier_name"]) || "Unknown carrier";

  const sourceSystem =
    (typeof rec.source_system === "string" && rec.source_system.trim()) ||
    "FMCSA";

  return {
    org_id: orgId,

    created_at: nowIso,
    updated_at: nowIso,

    dot_number: dotNumber,
    mc_number: mcNumber,

    legal_name: legalName,
    dba_name: rec.dba_name ?? null,

    phone: safeText(rec.phone),
    email: safeText(rec.email),
    website: safeText(rec.website),

    address_line1: safeText(rec.address_line1),
    address_line2: safeText(rec.address_line2),
    city: safeText(rec.city),
    state: safeText(rec.state),
    postal_code: safeText(rec.postal_code),
    country: safeText(rec.country) || "US",

    operation_type: safeText(rec.operation_type),
    carrier_operation: safeText(rec.carrier_operation),
    cargo_types: cargoTypesArray,

    power_units: powerUnits,
    drivers: drivers,

    usdot_status: safeText(rec.usdot_status),
    mcs150_mileage: mcs150Mileage,
    mcs150_mileage_year: mcs150Year,
    safety_rating: safeText(rec.safety_rating),

    inspections: rec.inspections ?? null,
    crashes: rec.crashes ?? null,
    source_payload: rec.source_payload ?? rec,
    source_system: sourceSystem,

    // Internal sales fields
    sales_status: "NEW",
    tags: [],

    last_contacted_at: null,
    last_contact_method: null,
    last_contact_summary: null,

    created_by: userId,
    last_contacted_by: null,
    bounced: false,
    newsletter_opt_out: false,
  };
}

// ------------------ small parsing helpers ------------------

function toIntOrNull(value: unknown): number | null {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    Number.isNaN(Number(value))
  ) {
    return null;
  }
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

function toBigIntOrNull(value: unknown): number | null {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    Number.isNaN(Number(value))
  ) {
    return null;
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toStringArray(value: unknown): string[] | null {
  if (!value && value !== "") return null;

  if (Array.isArray(value)) {
    const cleaned = value
      .map((v) => safeText(v))
      .filter((v): v is string => !!v);
    return cleaned.length ? cleaned : null;
  }

  if (typeof value === "string") {
    const parts = value
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return parts.length ? parts : null;
  }

  return null;
}

function safeText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}
