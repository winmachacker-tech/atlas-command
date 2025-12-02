// FILE: supabase/functions/dipsy-load-history/index.ts
// Purpose:
// - RLS-safe Edge Function to fetch load history events from load_history_view
//   for the current user's org.
// - This is a "Dipsy tool" endpoint: your UI, Dipsy voice bridge, or future
//   dipsy-text tools can call it to answer:
//     "What's the full history on load LD-2025-XXXX?"
//
// Security:
// - Uses SUPABASE_URL + SUPABASE_ANON_KEY.
// - Requires Authorization: Bearer <access_token> header from the caller.
// - Org context is derived via user_orgs and RLS is enforced by Postgres.
// - Does NOT use service_role, does NOT bypass RLS, does NOT touch existing policies.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

type LoadHistoryRequest = {
  load_number?: string | null;
  reference?: string | null;
  limit?: number | null;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type LoadHistoryEvent = {
  event_id: string;
  org_id: string;
  load_id: string;
  load_number: string | null;
  load_reference: string | null;
  origin: string | null;
  destination: string | null;
  customer: string | null;
  broker: string | null;
  current_status: string | null;
  event_type: string;
  event_at: string;
  from_status: string | null;
  to_status: string | null;
  from_driver_name: string | null;
  to_driver_name: string | null;
  metadata: JsonValue;
  created_by: string | null;
  logged_at: string;
};

type LoadHistoryResponse =
  | {
      ok: true;
      org_id: string;
      load_number: string | null;
      reference: string | null;
      events: LoadHistoryEvent[];
    }
  | {
      ok: false;
      error: string;
      details?: JsonValue;
    };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[dipsy-load-history] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars",
  );
}

serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") {
      return jsonResponse(
        { ok: false, error: "Method not allowed" },
        405,
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    const authTokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const accessToken = authTokenMatch ? authTokenMatch[1] : null;

    if (!accessToken) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing or invalid Authorization header. Expected Bearer token.",
        },
        401,
      );
    }

    const body = (await req.json().catch(() => ({}))) as LoadHistoryRequest;

    const load_number =
      typeof body.load_number === "string" && body.load_number.trim().length > 0
        ? body.load_number.trim()
        : null;

    const reference =
      typeof body.reference === "string" && body.reference.trim().length > 0
        ? body.reference.trim()
        : null;

    const limit =
      typeof body.limit === "number" && body.limit > 0 && body.limit <= 500
        ? body.limit
        : 100;

    if (!load_number && !reference) {
      return jsonResponse(
        {
          ok: false,
          error: "You must provide either load_number or reference.",
        },
        400,
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    // 1) Resolve user and org_id via user_orgs (standard Atlas pattern)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[dipsy-load-history] getUser error:", userError);
      return jsonResponse(
        {
          ok: false,
          error: "Unable to resolve user from access token.",
          details: userError ? userError.message : undefined,
        },
        401,
      );
    }

    const { data: orgRow, error: orgError } = await supabase
      .from("user_orgs")
      .select("org_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (orgError || !orgRow?.org_id) {
      console.error("[dipsy-load-history] user_orgs error:", orgError);
      return jsonResponse(
        {
          ok: false,
          error: "Unable to determine org for current user.",
          details: orgError ? orgError.message : undefined,
        },
        403,
      );
    }

    const org_id = orgRow.org_id as string;

    // 2) Query load_history_view for this org + load_number or reference
    let query = supabase
      .from("load_history_view")
      .select(
        `
        event_id,
        org_id,
        load_id,
        load_number,
        load_reference,
        origin,
        destination,
        customer,
        broker,
        current_status,
        event_type,
        event_at,
        from_status,
        to_status,
        from_driver_name,
        to_driver_name,
        metadata,
        created_by,
        logged_at
      `,
      )
      .eq("org_id", org_id)
      .order("event_at", { ascending: true }) // chronological within a load
      .limit(limit);

    if (load_number) {
      query = query.eq("load_number", load_number);
    }
    if (reference) {
      query = query.eq("load_reference", reference);
    }

    const { data: events, error: historyError } = await query;

    if (historyError) {
      console.error(
        "[dipsy-load-history] load_history_view query error:",
        historyError,
      );
      return jsonResponse(
        {
          ok: false,
          error: "Failed to query load history.",
          details: historyError.message,
        },
        500,
      );
    }

    const safeEvents = (events || []) as unknown as LoadHistoryEvent[];

    const resp: LoadHistoryResponse = {
      ok: true,
      org_id,
      load_number,
      reference,
      events: safeEvents,
    };

    return jsonResponse(resp, 200);
  } catch (e) {
    console.error("[dipsy-load-history] Uncaught error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Unexpected error in dipsy-load-history.",
        details: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});

function jsonResponse(body: LoadHistoryResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}
