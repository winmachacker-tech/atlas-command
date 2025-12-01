// FILE: supabase/functions/dipsy-board-view/index.ts
// Purpose:
// - Provide a single, RLS-safe snapshot of the ops board for Dipsy + UI.
// - Returns loads + drivers for the caller's org, plus a summary object.
// - Includes active assignment history:
//     • For each load: active_assignment (from load_driver_assignments where unassigned_at IS NULL)
//     • For each driver: active_assignment + active_load (if any)
// - STEP 3: Driver truth alignment
//     • Compute driver_truth_status based on driver.status + active assignments
//     • driver_truth_status can be: AVAILABLE, ON_LOAD, SHOULD_BE_FREE, SHOULD_BE_ON_LOAD, UNKNOWN
//     • Summary includes truth-based driver counts.
//
// Security:
// - Uses SUPABASE_ANON_KEY plus the caller's Authorization: Bearer <access_token>.
// - All queries are protected by RLS; org_id is resolved via current_org_id().
// - No service-role key is used.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("[dipsy-board-view] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Scope = "dispatcher" | "active_only" | "all";

interface LoadRow {
  id: string;
  org_id: string;
  status: string | null;
  pod_status: string | null;
  assigned_driver_id: string | null;
  driver_name: string | null;
  pickup_at: string | null;
  delivery_at: string | null;
  reference?: string | null;
  [key: string]: unknown;
}

interface DriverRow {
  id: string;
  org_id: string;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  code?: string | null;
  [key: string]: unknown;
}

interface AssignmentRow {
  id: string;
  org_id: string;
  load_id: string;
  driver_id: string;
  assigned_at: string;
  unassigned_at: string | null;
  reason?: string | null;
  [key: string]: unknown;
}

type DriverTruthStatus =
  | "AVAILABLE"
  | "ON_LOAD"
  | "SHOULD_BE_FREE"
  | "SHOULD_BE_ON_LOAD"
  | "UNKNOWN";

interface BoardSummary {
  totals: {
    loads: number;
    drivers: number;
  };
  loads_by_status: Record<string, number>;
  loads_by_pod_status: Record<string, number>;
  delivered_without_pod: number;
  problem_loads: number;
  at_risk_loads: number;
  // Original counts based on drivers.status (kept for backward compatibility)
  drivers_available: number;
  drivers_assigned: number;
  // New truth-based driver counts
  drivers_truth_available: number;
  drivers_truth_on_load: number;
  drivers_truth_should_be_free: number;
  drivers_truth_should_be_on_load: number;
  drivers_truth_unknown: number;
}

function isActiveLoad(load: LoadRow): boolean {
  const status = (load.status ?? "").toUpperCase();
  const inactive = ["CANCELLED", "CANCELED", "CLOSED", "ARCHIVED", "DELETED"];
  if (!status) return true; // be permissive if unknown
  return !inactive.includes(status);
}

/**
 * Compute a "truth status" for a driver based on:
 * - driver.status (what the driver row claims)
 * - presence of an active assignment / load (what history says)
 *
 * Truth rules:
 * - No active assignment:
 *     • status AVAILABLE/OFF_DUTY/empty → AVAILABLE
 *     • status ON_LOAD/DISPATCHED/IN_TRANSIT → SHOULD_BE_FREE (board says busy but assignments say no)
 * - Active assignment present:
 *     • status ON_LOAD/DISPATCHED/IN_TRANSIT → ON_LOAD
 *     • status AVAILABLE/OFF_DUTY/empty → SHOULD_BE_ON_LOAD (board says free but assignments say busy)
 * - Anything else → UNKNOWN
 */
function computeDriverTruthStatus(
  driver: DriverRow,
  activeAssignment: AssignmentRow | null,
): DriverTruthStatus {
  const rawStatus = (driver.status ?? "").toUpperCase();

  const freeStatuses = ["AVAILABLE", "OFF_DUTY", "", "IDLE"];
  const onLoadStatuses = ["ON_LOAD", "DISPATCHED", "IN_TRANSIT"];

  if (!activeAssignment) {
    // No active assignment rows for this driver
    if (freeStatuses.includes(rawStatus)) {
      return "AVAILABLE";
    }
    if (onLoadStatuses.includes(rawStatus)) {
      return "SHOULD_BE_FREE";
    }
    // Anything else with no assignment
    return "UNKNOWN";
  }

  // There IS an active assignment
  if (onLoadStatuses.includes(rawStatus)) {
    return "ON_LOAD";
  }

  if (freeStatuses.includes(rawStatus)) {
    return "SHOULD_BE_ON_LOAD";
  }

  return "UNKNOWN";
}

function buildSummary(loads: any[], drivers: any[]): BoardSummary {
  const loads_by_status: Record<string, number> = {};
  const loads_by_pod_status: Record<string, number> = {};
  let delivered_without_pod = 0;
  let problem_loads = 0;
  let at_risk_loads = 0;

  // Old-style driver counts (status-based)
  let drivers_available = 0;
  let drivers_assigned = 0;

  // Truth-based driver counts
  let drivers_truth_available = 0;
  let drivers_truth_on_load = 0;
  let drivers_truth_should_be_free = 0;
  let drivers_truth_should_be_on_load = 0;
  let drivers_truth_unknown = 0;

  for (const load of loads) {
    const s = (load.status ?? "UNKNOWN").toUpperCase();
    const pod = (load.pod_status ?? "NONE").toUpperCase();
    loads_by_status[s] = (loads_by_status[s] ?? 0) + 1;
    loads_by_pod_status[pod] = (loads_by_pod_status[pod] ?? 0) + 1;

    if (s === "DELIVERED" && pod !== "RECEIVED") {
      delivered_without_pod++;
    }
    if (s === "PROBLEM" || s === "FAILED" || s === "CANCELLED") {
      problem_loads++;
    }
    if (s === "AT_RISK" || s === "LATE" || s === "DELAYED") {
      at_risk_loads++;
    }
  }

  for (const driver of drivers) {
    const ds = (driver.status ?? "").toUpperCase();
    if (ds === "AVAILABLE") drivers_available++;
    if (ds === "ON_LOAD" || ds === "DISPATCHED" || ds === "IN_TRANSIT") {
      drivers_assigned++;
    }

    const truth: DriverTruthStatus = driver.driver_truth_status ?? "UNKNOWN";
    if (truth === "AVAILABLE") drivers_truth_available++;
    else if (truth === "ON_LOAD") drivers_truth_on_load++;
    else if (truth === "SHOULD_BE_FREE") drivers_truth_should_be_free++;
    else if (truth === "SHOULD_BE_ON_LOAD") drivers_truth_should_be_on_load++;
    else drivers_truth_unknown++;
  }

  return {
    totals: {
      loads: loads.length,
      drivers: drivers.length,
    },
    loads_by_status,
    loads_by_pod_status,
    delivered_without_pod,
    problem_loads,
    at_risk_loads,
    drivers_available,
    drivers_assigned,
    drivers_truth_available,
    drivers_truth_on_load,
    drivers_truth_should_be_free,
    drivers_truth_should_be_on_load,
    drivers_truth_unknown,
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const url = new URL(req.url);
    let scope: Scope = "dispatcher";

    // Allow scope from query (?scope=dispatcher|active_only|all)
    const queryScope = url.searchParams.get("scope");
    if (
      queryScope === "dispatcher" ||
      queryScope === "active_only" ||
      queryScope === "all"
    ) {
      scope = queryScope;
    } else if (req.method === "POST") {
      // Also allow scope from JSON body
      try {
        const body = await req.json().catch(() => null);
        if (
          body &&
          (body.scope === "dispatcher" ||
            body.scope === "active_only" ||
            body.scope === "all")
        ) {
          scope = body.scope;
        }
      } catch {
        // ignore body parse errors
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // 1) Get the user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[dipsy-board-view] auth.getUser error:", userError);
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 2) Resolve org_id via current_org_id()
    const { data: orgId, error: orgError } = await supabase.rpc(
      "current_org_id",
    );
    if (orgError || !orgId) {
      console.error("[dipsy-board-view] current_org_id error:", orgError);
      return new Response(
        JSON.stringify({ ok: false, error: "Unable to resolve org" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3) Fetch raw loads/drivers for this org (RLS enforced)
    const { data: allLoads, error: loadsError } = await supabase
      .from("loads")
      .select("*")
      .eq("org_id", orgId);

    if (loadsError) {
      console.error("[dipsy-board-view] loads query error:", loadsError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to fetch loads" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: allDrivers, error: driversError } = await supabase
      .from("drivers")
      .select("*")
      .eq("org_id", orgId);

    if (driversError) {
      console.error("[dipsy-board-view] drivers query error:", driversError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to fetch drivers" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const loadsRaw = (allLoads ?? []) as LoadRow[];
    const driversRaw = (allDrivers ?? []) as DriverRow[];

    // 4) Fetch ACTIVE assignment rows (unassigned_at IS NULL) for this org
    const { data: activeAssignmentsData, error: assignmentsError } =
      await supabase
        .from("load_driver_assignments")
        .select("*")
        .eq("org_id", orgId)
        .is("unassigned_at", null);

    if (assignmentsError) {
      console.error(
        "[dipsy-board-view] load_driver_assignments query error:",
        assignmentsError,
      );
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Failed to fetch load_driver_assignments",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const activeAssignments = (activeAssignmentsData ?? []) as AssignmentRow[];

    // Build maps:
    //    - load_id → latest active assignment
    //    - driver_id → latest active assignment
    const activeAssignmentByLoadId = new Map<string, AssignmentRow>();
    const activeAssignmentByDriverId = new Map<string, AssignmentRow>();

    for (const row of activeAssignments) {
      const existingLoad = activeAssignmentByLoadId.get(row.load_id);
      if (!existingLoad || row.assigned_at > existingLoad.assigned_at) {
        activeAssignmentByLoadId.set(row.load_id, row);
      }

      const existingDriver = activeAssignmentByDriverId.get(row.driver_id);
      if (!existingDriver || row.assigned_at > existingDriver.assigned_at) {
        activeAssignmentByDriverId.set(row.driver_id, row);
      }
    }

    // Map of load_id → load
    const loadById = new Map<string, LoadRow>();
    for (const l of loadsRaw) {
      loadById.set(l.id, l);
    }

    // 5) Filter loads based on scope (drivers always full)
    let loadsScoped: LoadRow[];
    if (scope === "all") {
      loadsScoped = loadsRaw;
    } else {
      // "dispatcher" and "active_only" → focus on active loads
      loadsScoped = loadsRaw.filter(isActiveLoad);
    }

    // 6) Enrich loads with active_assignment
    const enrichedLoads = loadsScoped.map((load) => {
      const activeAssignment = activeAssignmentByLoadId.get(load.id) ?? null;
      return {
        ...load,
        active_assignment: activeAssignment,
      };
    });

    // 7) Enrich drivers with active_assignment + active_load + driver_truth_status
    const enrichedDrivers = driversRaw.map((driver) => {
      const activeAssignment =
        activeAssignmentByDriverId.get(driver.id) ?? null;
      const activeLoad =
        activeAssignment && loadById.has(activeAssignment.load_id)
          ? loadById.get(activeAssignment.load_id)
          : null;

      const driver_truth_status = computeDriverTruthStatus(
        driver,
        activeAssignment,
      );

      return {
        ...driver,
        active_assignment: activeAssignment,
        active_load: activeLoad,
        driver_truth_status,
      };
    });

    // 8) Build summary using the scoped loads + enriched drivers
    const summary = buildSummary(enrichedLoads, enrichedDrivers);

    // 9) Lightweight logging for observability
    console.log(
      "[dipsy-board-view] snapshot",
      JSON.stringify({
        org_id: orgId,
        scope,
        total_loads_all: loadsRaw.length,
        total_loads_scope: enrichedLoads.length,
        total_drivers: enrichedDrivers.length,
        active_assignments: activeAssignments.length,
        drivers_truth: {
          available: summary.drivers_truth_available,
          on_load: summary.drivers_truth_on_load,
          should_be_free: summary.drivers_truth_should_be_free,
          should_be_on_load: summary.drivers_truth_should_be_on_load,
          unknown: summary.drivers_truth_unknown,
        },
      }),
    );

    const responseBody = {
      ok: true,
      org_id: orgId,
      scope,
      summary,
      loads: enrichedLoads,
      drivers: enrichedDrivers,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[dipsy-board-view] unexpected error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Unexpected error in dipsy-board-view" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
