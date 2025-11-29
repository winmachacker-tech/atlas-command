// FILE: supabase/functions/sales-pull-fmcsa/index.ts
//
// Purpose:
//   Pull real carrier records from the FMCSA "Company Census File"
//   (Socrata dataset az4n-8mr2) and upsert them into public.sales_prospects
//   for the CURRENT ORG only.
//
// Security:
//   - Uses service_role key ONLY in this Edge Function (never in browser).
//   - Resolves org_id by looking up the authenticated user in public.team_members
//     where status = 'active'.
//   - Upserts rows scoped to that org_id only (relies on RLS + unique constraint).
//
// Env required (set as Edge Function secrets):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - SUPABASE_ANON_KEY
//   - FMCSA_API_BASE_URL   (e.g. https://data.transportation.gov/resource/az4n-8mr2.json)
//   - FMCSA_API_TOKEN      (Socrata App Token – used as X-App-Token)
//
// NOTE: The Socrata schema can change. The field mapping below is written
//       defensively and should be easy to tweak if column names differ.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders } from "../_shared/cors.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const FMCSA_API_BASE_URL = requireEnv("FMCSA_API_BASE_URL");
const FMCSA_API_TOKEN = requireEnv("FMCSA_API_TOKEN");

// Admin client – service role, no auth persistence
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// For decoding the JWT and getting the user
function createUserClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: { persistSession: false },
  });
}

type RawFmcsaRow = Record<string, unknown>;

type UpsertRow = {
  org_id: string;
  dot_number: string | null;
  mc_number: string | null;
  legal_name: string | null;
  dba_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  operation_type: string | null;
  carrier_operation: string | null;
  cargo_types: string[] | null;
  power_units: number | null;
  drivers: number | null;
  usdot_status: string | null;
  mcs150_mileage: number | null;
  mcs150_mileage_year: number | null;
  safety_rating: string | null;
  inspections: unknown;
  crashes: unknown;
  source_payload: RawFmcsaRow;
  source_system: string;
  sales_status: string | null;
  created_by: string | null;
  last_contacted_at: string | null;
  last_contact_method: string | null;
  last_contact_summary: string | null;
  last_contacted_by: string | null;
  // DB: NOT NULL, default '{}'
  tags: string[];
  notes: string | null;
  // DB: NOT NULL, default false
  bounced: boolean;
  newsletter_opt_out: boolean;
  // NEW: Atlas fit tier (A/B/C) – matches DB column public.sales_prospects.carrier_tier
  carrier_tier: string;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function parseCargoTypes(raw: unknown): string[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const cleaned = raw
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
    return cleaned.length ? cleaned : null;
  }
  const s = String(raw);
  const parts = s
    .split(/[;,]/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length ? parts : null;
}

async function resolveOrgForRequest(
  req: Request,
): Promise<{ orgId: string; userId: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  console.log("[FMCSA] Using URL:", FMCSA_API_BASE_URL);

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();

  if (userError || !userData?.user) {
    console.error("[sales-pull-fmcsa] auth.getUser error:", userError);
    throw new Response(JSON.stringify({ error: "Unauthorized: no valid user found" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = userData.user.id;

  const { data: teamMember, error: tmError } = await adminClient
    .from("team_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (tmError) {
    console.error("[sales-pull-fmcsa] team_members lookup error:", tmError);
    throw new Response(JSON.stringify({ error: "Failed to resolve org for user" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!teamMember?.org_id) {
    console.warn("[sales-pull-fmcsa] No active team_members row for user", userId);
    throw new Response(JSON.stringify({ error: "No active organization membership found" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return { orgId: teamMember.org_id as string, userId };
}

async function fetchFmcsaRows(limit: number): Promise<RawFmcsaRow[]> {
  const url = new URL(FMCSA_API_BASE_URL);

  // SODA-style query parameters
  url.searchParams.set("$limit", String(limit));
  url.searchParams.set("$order", "dot_number DESC");

  const headers: HeadersInit = {};
  if (FMCSA_API_TOKEN) {
    headers["X-App-Token"] = FMCSA_API_TOKEN;
  }

  const res = await fetch(url.toString(), { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[sales-pull-fmcsa] FMCSA fetch failed:", res.status, text);
    throw new Error(`FMCSA fetch failed: ${res.status}`);
  }

  const json = await res.json();
  if (!Array.isArray(json)) {
    console.error("[sales-pull-fmcsa] Unexpected FMCSA response shape:", json);
    throw new Error("Unexpected FMCSA response shape (expected array)");
  }

  return json as RawFmcsaRow[];
}

function mapRowToUpsert(row: RawFmcsaRow, orgId: string, userId: string): UpsertRow {
  // Try multiple plausible keys for each field to be robust against schema quirks.
  const dot =
    row["dot_number"] ??
    row["usdot_number"] ??
    row["usdot"] ??
    row["usdOTNumber"];

  const mc =
    row["mc_number"] ??
    row["docket_number"] ??
    row["mc_mx_ff_number"];

  const legalName =
    row["legal_name"] ??
    row["legalname"] ??
    row["company_legal_name"];

  const dbaName =
    row["dba_name"] ??
    row["doing_business_as_name"] ??
    row["dba"];

  const phone =
    row["phone"] ??
    row["telephone"] ??
    row["phone_number"];

  const email =
    row["email"] ??
    row["contact_email"];

  const address1 =
    row["mailing_address"] ??
    row["street_address"] ??
    row["principal_place_of_business_street_address"];

  const address2 =
    row["mailing_address_line_2"] ??
    row["street_address_2"];

  const city =
    row["city"] ??
    row["mailing_city"] ??
    row["principal_place_of_business_city"];

  const state =
    row["state"] ??
    row["mailing_state"] ??
    row["principal_place_of_business_state"];

  const postal =
    row["zip_code"] ??
    row["mailing_zip"] ??
    row["principal_place_of_business_zip_code"];

  const opType =
    row["operation_type"] ??
    row["carrier_operation"];

  const carrierOperation =
    row["carrier_operation"] ??
    row["carrier_operations"];

  const cargo =
    row["cargo_carried"] ??
    row["cargo_types"];

  const powerUnitsRaw =
    row["total_power_units"] ??
    row["power_units"];

  const drivers =
    row["total_drivers"] ??
    row["drivers"];

  const usdotStatus =
    row["usdot_status"] ??
    row["status"];

  const mcs150Mileage =
    row["mcs150_mileage"];

  const mcs150Year =
    row["mcs150_mileage_year"];

  const safetyRating =
    row["safety_rating"] ??
    row["safety_fitness_rating"];

  // Normalize power units once so we can both store it and derive the tier
  const powerUnits = toNumber(powerUnitsRaw);

  // Derive Atlas fit tier (A/B/C) from power_units
  //   A = 20+ power units
  //   B = 5–19 power units
  //   C = everything else / unknown
  let carrierTier = "C";
  if (powerUnits !== null) {
    if (powerUnits >= 20) carrierTier = "A";
    else if (powerUnits >= 5) carrierTier = "B";
    else carrierTier = "C";
  }

  return {
    org_id: orgId,
    dot_number: toStringOrNull(dot),
    mc_number: toStringOrNull(mc),
    legal_name: toStringOrNull(legalName),
    dba_name: toStringOrNull(dbaName),
    phone: toStringOrNull(phone),
    email: toStringOrNull(email),
    website: null,
    address_line1: toStringOrNull(address1),
    address_line2: toStringOrNull(address2),
    city: toStringOrNull(city),
    state: toStringOrNull(state),
    postal_code: toStringOrNull(postal),
    country: "US",
    operation_type: toStringOrNull(opType),
    carrier_operation: toStringOrNull(carrierOperation),
    cargo_types: parseCargoTypes(cargo),
    power_units: powerUnits,
    drivers: toNumber(drivers),
    usdot_status: toStringOrNull(usdotStatus),
    mcs150_mileage: toNumber(mcs150Mileage),
    mcs150_mileage_year: toNumber(mcs150Year),
    safety_rating: toStringOrNull(safetyRating),
    inspections: null,
    crashes: null,
    source_payload: row,
    source_system: "FMCSA",
    sales_status: "NEW",
    created_by: userId,
    last_contacted_at: null,
    last_contact_method: null,
    last_contact_summary: null,
    last_contacted_by: null,
    // IMPORTANT: never null, DB column is NOT NULL with default '{}'
    tags: [],
    notes: null,
    // IMPORTANT: never null, DB columns are NOT NULL with default false
    bounced: false,
    newsletter_opt_out: false,
    carrier_tier: carrierTier,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { orgId, userId } = await resolveOrgForRequest(req);

    // Allow optional { "limit": number } in the request body.
    // Default: 1000 rows, capped at 5000 to avoid silly values.
    let limit = 1000;
    try {
      const body = await req.json();
      const maybeLimit = body && typeof body.limit !== "undefined"
        ? Number(body.limit)
        : NaN;
      if (Number.isFinite(maybeLimit) && maybeLimit > 0 && maybeLimit <= 5000) {
        limit = maybeLimit;
      }
    } catch {
      // If there's no JSON body, or it can't be parsed,
      // just keep the default limit.
    }

    const rawRows = await fetchFmcsaRows(limit);
    const upsertRows: UpsertRow[] = rawRows
      .map((row) => mapRowToUpsert(row, orgId, userId))
      .filter((r) => {
        // Require DOT number
        if (r.dot_number === null) return false;
        // Require 5+ power units (skip null and 0–4)
        if (r.power_units === null || r.power_units < 5) return false;
        return true;
      });

    if (!upsertRows.length) {
      console.warn("[sales-pull-fmcsa] No rows to upsert after mapping/filtering.");
      return new Response(
        JSON.stringify({
          ok: true,
          org_id: orgId,
          total: rawRows.length,
          upserted: 0,
          inserted: 0,
          updated: 0,
          message: "No valid rows with DOT number and 5+ power units.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: upserted, error: upsertError } = await adminClient
      .from("sales_prospects")
      .upsert(upsertRows, {
        onConflict: "org_id,dot_number",
      })
      .select("id, dot_number");

    if (upsertError) {
      console.error("[sales-pull-fmcsa] upsert error:", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to upsert FMCSA records" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const upsertCount = upserted?.length ?? 0;

    const responseBody = {
      ok: true,
      org_id: orgId,
      total: rawRows.length,
      upserted: upsertCount,
      inserted: upsertCount, // we can't easily distinguish inserted vs updated with one query
      updated: 0,
    };

    console.log("[sales-pull-fmcsa] sync complete:", responseBody);

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // If it's already a Response (thrown in resolveOrgForRequest), just return it.
    if (err instanceof Response) {
      return err;
    }

    console.error("[sales-pull-fmcsa] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error", details: `${err}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
