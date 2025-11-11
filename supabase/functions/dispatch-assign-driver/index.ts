// supabase/functions/dispatch-assign-driver/index.ts
// Natural-language friendly assignment API.
// Resolves loads by UUID or human identifiers (load_number, reference, etc.).
// Resolves drivers by UUID, full_name, name, driver_code, employee_code, or first_name+last_name.
// Handles duplicates by preferring ACTIVE + most recently updated.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ------------------------------ Config ------------------------------ */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://atlas-command-iota.vercel.app",
]);

/* ------------------------------ Utils ------------------------------- */
function corsHeaders(origin: string | null): Headers {
  const h = new Headers();
  if (origin && ALLOWED_ORIGINS.has(origin)) h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  h.set("Access-Control-Max-Age", "86400");
  h.set("Content-Type", "application/json; charset=utf-8");
  return h;
}
function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}
const isUUID = (s?: string | null) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type RowBase = { updated_at?: string | null; created_at?: string | null };
function pickLatest<T extends RowBase>(rows: T[]): T {
  return rows
    .slice()
    .sort((a, b) => {
      const au = a.updated_at ? Date.parse(a.updated_at) : -1;
      const bu = b.updated_at ? Date.parse(b.updated_at) : -1;
      if (bu !== au) return bu - au;
      const ac = a.created_at ? Date.parse(a.created_at) : -1;
      const bc = b.created_at ? Date.parse(b.created_at) : -1;
      return bc - ac;
    })[0];
}

/* ---------------------------- Load resolve --------------------------- */
async function resolveLoadId(args: { id?: string | null; number?: string | null }) {
  const { id, number } = args;
  if (isUUID(id)) return id!;
  const terms: string[] = [];
  if (number?.trim()) terms.push(number.trim());
  if (id?.trim() && !isUUID(id)) terms.push(id.trim());
  if (!terms.length) throw new Error("Missing required field: load_id or load_number");

  // Add/adjust to match your schema if needed
  const cols = ["load_number", "number", "reference", "ref", "external_id", "shipment_number"];

  for (const term of terms) {
    // exact
    for (const col of cols) {
      try {
        const { data, error } = await admin
          .from("loads")
          .select(`id, ${col}, updated_at, created_at`)
          .eq(col, term)
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) {
          if ((error as any).message?.includes(`column "${col}"`)) continue;
          throw error;
        }
        if (data?.length) return pickLatest(data).id;
      } catch (e) {
        if ((e as any).message?.includes("does not exist")) continue;
        throw new Error(`Error searching loads: ${(e as any).message || e}`);
      }
    }
    // ilike
    for (const col of cols) {
      try {
        const { data, error } = await admin
          .from("loads")
          .select(`id, ${col}, updated_at, created_at`)
          .ilike(col, term)
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) {
          if ((error as any).message?.includes(`column "${col}"`)) continue;
          throw error;
        }
        if (data?.length) return pickLatest(data).id;
      } catch (e) {
        if ((e as any).message?.includes("does not exist")) continue;
        throw new Error(`Error searching loads: ${(e as any).message || e}`);
      }
    }
  }

  throw new Error(`Could not resolve load. Provide a valid load_number or the load_id (UUID).`);
}

/* --------------------------- Driver resolve -------------------------- */
function pickBestDriver(rows: Array<{ id: string; status?: string | null } & RowBase>) {
  return rows
    .map((r) => ({
      r,
      score:
        (r.status === "ACTIVE" ? 1e9 : 0) +
        (r.updated_at ? Date.parse(r.updated_at) : 0) +
        (r.created_at ? Date.parse(r.created_at) / 10 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0].r;
}

async function resolveDriverId(args: { id?: string | null; name?: string | null }) {
  const { id, name } = args;
  if (!id && !name) return null; // allow unassign
  if (isUUID(id)) return id!;
  const term = (name ?? "").trim();
  if (!term) return null;

  const cols = ["full_name", "name", "driver_code", "employee_code"];

  // exact across text columns
  for (const col of cols) {
    try {
      const { data, error } = await admin
        .from("drivers")
        .select(`id, ${col}, status, updated_at, created_at`)
        .eq(col, term)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        if ((error as any).message?.includes(`column "${col}"`)) continue;
        throw error;
      }
      if (data?.length) return pickBestDriver(data).id;
    } catch (e) {
      if ((e as any).message?.includes("does not exist")) continue;
      throw new Error(`Error searching drivers: ${(e as any).message || e}`);
    }
  }

  // ilike across text columns
  for (const col of cols) {
    try {
      const { data, error } = await admin
        .from("drivers")
        .select(`id, ${col}, status, updated_at, created_at`)
        .ilike(col, `%${term}%`)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        if ((error as any).message?.includes(`column "${col}"`)) continue;
        throw error;
      }
      if (data?.length) return pickBestDriver(data).id;
    } catch (e) {
      if ((e as any).message?.includes("does not exist")) continue;
      throw new Error(`Error searching drivers: ${(e as any).message || e}`);
    }
  }

  // Support "First Last" from separate columns if present
  const parts = term.split(/\s+/).filter(Boolean);
  if (parts.length >= 1) {
    const first = parts[0];
    const last = parts.slice(1).join(" ");

    if (last) {
      // exact first+last
      try {
        const { data, error } = await admin
          .from("drivers")
          .select("id, status, updated_at, created_at, first_name, last_name")
          .eq("first_name", first)
          .eq("last_name", last)
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(10);
        if (!error && data?.length) return pickBestDriver(data).id;
      } catch {}
      // ilike first+last
      try {
        const { data, error } = await admin
          .from("drivers")
          .select("id, status, updated_at, created_at, first_name, last_name")
          .ilike("first_name", `%${first}%`)
          .ilike("last_name", `%${last}%`)
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(10);
        if (!error && data?.length) return pickBestDriver(data).id;
      } catch {}
    }

    // single token → match either first_name or last_name
    try {
      const { data, error } = await admin
        .from("drivers")
        .select("id, status, updated_at, created_at, first_name, last_name")
        .or(`first_name.ilike.%${first}%,last_name.ilike.%${first}%`)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      if (!error && data?.length) return pickBestDriver(data).id;
    } catch {}
  }

  throw new Error(`Could not resolve driver by "${term}". Provide a clearer name/code or driver_id (UUID).`);
}

/* --------------------------- Core operation -------------------------- */
async function assignDriver({ load_id, driver_id }: { load_id: string; driver_id: string | null }) {
  const { data: updated, error } = await admin
    .from("loads")
    .update({ driver_id, updated_at: new Date().toISOString() })
    .eq("id", load_id)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update load: ${error.message}`);

  if (driver_id) {
    const { error: drvErr } = await admin
      .from("drivers")
      .update({ status: "ASSIGNED", updated_at: new Date().toISOString() })
      .eq("id", driver_id);
    if (drvErr) throw new Error(`Failed to update driver: ${drvErr.message}`);
  }

  return { load: updated };
}

/* ------------------------------- Server ------------------------------ */
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST")   return json(405, { error: "Method Not Allowed. Use POST." }, origin);

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json(415, { error: "Unsupported Media Type. Send JSON." }, origin);
    }

    const body = await req.json();

    const load_id = await resolveLoadId({
      id: body?.load_id ?? null,
      number: body?.load_number ?? null,
    });

    const driver_id = await resolveDriverId({
      id: body?.driver_id ?? null,
      name: body?.driver_name ?? body?.driver ?? null,
    });

    const result = await assignDriver({ load_id, driver_id });
    return json(200, { ok: true, ...result }, origin);
  } catch (err) {
    console.error("dispatch-assign-driver error:", err);
    return json(400, { error: String((err as any)?.message ?? err) }, origin);
  }
});
