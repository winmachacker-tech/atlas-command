// FILE: supabase/functions/search-drivers-hos-aware/index.ts
// Purpose:
//   HOS-aware driver search for Dipsy (and other Atlas services).
//   - RLS-safe: uses anon key + caller's JWT (no service role).
//   - Only sees drivers the caller is allowed to see.
//   - Filters on ACTIVE status + minimum drive remaining.
//   - Returns a compact driver list + human-friendly explanation strings.
//
// This is SIMULATION/ASSISTANT logic – it does NOT read from real ELDs.
// It only uses the HOS fields on the drivers table that Atlas maintains.

import { serve } from "https://deno.land/std@0.214.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Format minutes -> "Xh Ym" */
function formatMinutesToHm(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "0h";
  const total = Math.max(0, Math.floor(min));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  if (hours <= 0 && minutes <= 0) return "0h";
  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    }

    // 🔐 Require Authorization header (caller’s JWT from Supabase Auth)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing Authorization header" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Create RLS-respecting client (anon key + caller's JWT)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // 🔐 Validate user & derive org via team_members (or user_orgs if you prefer)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[search-drivers-hos-aware] auth error:", userError);
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      origin_city?: string;
      origin_state?: string;
      pickup_time?: string;
      min_drive_remaining_min?: number;
      max_distance_miles?: number;
    };

    const origin_city = (body.origin_city || "").trim() || null;
    const origin_state = (body.origin_state || "").trim() || null;
    const pickup_time = (body.pickup_time || "").trim() || null;
    const minDriveRemainingMin =
      typeof body.min_drive_remaining_min === "number"
        ? body.min_drive_remaining_min
        : 0; // default: show all ACTIVE with any drive remaining

    // Optional: you can later wire in distance logic with Motive/Samsara.
    const maxDistanceMiles =
      typeof body.max_distance_miles === "number"
        ? body.max_distance_miles
        : null;

    console.log("[search-drivers-hos-aware] Request body:", body);

    // For context (not required, RLS already isolates by org):
    const { data: member, error: memberErr } = await supabase
      .from("team_members")
      .select("org_id, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (memberErr) {
      console.error(
        "[search-drivers-hos-aware] team_members lookup error:",
        memberErr
      );
    }

    const orgId = member?.org_id ?? null;

    // === Core HOS-aware driver query ===
    // RLS ensures we only see drivers for this org/user.
    let query = supabase
      .from("drivers")
      .select(
        `
        id,
        first_name,
        last_name,
        phone,
        status,
        hos_status,
        hos_drive_remaining_min,
        hos_shift_remaining_min,
        hos_cycle_remaining_min,
        hos_drive_today_min,
        hos_on_duty_today_min
      `
      )
      .eq("status", "ACTIVE")
      .gte("hos_drive_remaining_min", minDriveRemainingMin)
      .order("hos_drive_remaining_min", { ascending: false });

    const { data: drivers, error: driversErr } = await query;

    if (driversErr) {
      console.error(
        "[search-drivers-hos-aware] drivers query error:",
        driversErr
      );
      throw driversErr;
    }

    const count = drivers?.length ?? 0;

    const enrichedDrivers = (drivers || []).map((d) => {
      const drive = formatMinutesToHm(d.hos_drive_remaining_min);
      const shift = formatMinutesToHm(d.hos_shift_remaining_min);
      const cycle = formatMinutesToHm(d.hos_cycle_remaining_min);

      const explanation = `${
        [d.first_name, d.last_name].filter(Boolean).join(" ") || "This driver"
      } has ${drive} drive and ${shift} shift remaining (cycle: ${cycle}).`;

      return {
        id: d.id,
        first_name: d.first_name,
        last_name: d.last_name,
        phone: d.phone,
        status: d.status,
        hos_status: d.hos_status,
        hos_drive_remaining_min: d.hos_drive_remaining_min,
        hos_shift_remaining_min: d.hos_shift_remaining_min,
        hos_cycle_remaining_min: d.hos_cycle_remaining_min,
        hos_drive_today_min: d.hos_drive_today_min,
        hos_on_duty_today_min: d.hos_on_duty_today_min,
        explanation,
      };
    });

    const responseBody = {
      ok: true,
      org_id: orgId,
      criteria: {
        origin_city,
        origin_state,
        pickup_time,
        min_drive_remaining_min: minDriveRemainingMin,
        max_distance_miles: maxDistanceMiles,
      },
      count,
      drivers: enrichedDrivers,
    };

    console.log("[search-drivers-hos-aware] result:", {
      org_id: orgId,
      count,
      minDriveRemainingMin,
    });

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[search-drivers-hos-aware] fatal error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: (err as Error).message ?? "Unknown error",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
