// FILE: supabase/functions/hos-sim-randomize/index.ts
// Purpose: Randomize simulated HOS data for drivers in the caller's org.
// - RLS-safe: uses anon key + caller's JWT, never service role.
// - For demo ONLY. Does NOT touch real ELD/telematics data.

import { serve } from "https://deno.land/std@0.214.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    }

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

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // 🔐 Validate user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[hos-sim-randomize] auth error:", userError);
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

    console.log("[hos-sim-randomize] User:", user.id);

    // 1) Get total drivers the caller can see (RLS-scoped).
    const { count: totalDrivers, error: totalErr } = await supabase
      .from("drivers")
      .select("id", { count: "exact", head: true });

    if (totalErr) {
      console.error("[hos-sim-randomize] total drivers error:", totalErr);
      throw totalErr;
    }

    // 2) Fetch drivers we will actually randomize.
    //    Here we pick ACTIVE drivers, but RLS still controls org isolation.
    const { data: drivers, error: driversErr } = await supabase
      .from("drivers")
      .select("id, first_name, last_name, status")
      .eq("status", "ACTIVE");

    if (driversErr) {
      console.error("[hos-sim-randomize] list ACTIVE drivers error:", driversErr);
      throw driversErr;
    }

    const simulatableDrivers = drivers ?? [];
    const simulatableCount = simulatableDrivers.length;
    console.log(
      "[hos-sim-randomize] totalDrivers:",
      totalDrivers,
      "simulatable (ACTIVE):",
      simulatableCount
    );

    if (simulatableCount === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          scenario: "random_fleet_mix",
          total_drivers: totalDrivers ?? 0,
          simulatable_drivers: 0,
          updated: 0,
          note: "No ACTIVE drivers available to randomize.",
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const now = new Date().toISOString();
    let updated = 0;

    // 3) Randomize HOS per driver with individual updates
    //    (N is typically small, so this is fine for demo.)
    await Promise.all(
      simulatableDrivers.map(async (driver) => {
        const hosStatusOptions = [
          "DRIVING",
          "ON_DUTY",
          "OFF_DUTY",
          "SLEEPER_BERTH",
          "RESTING",
        ] as const;
        const hosStatus = pickOne(hosStatusOptions);

        // Rough ranges (minutes)
        // - Max driving window: 11h = 660m
        // - Daily on-duty window: 14h = 840m
        // - 70h / 8-day cycle: 4200m
        let driveRemainingMin: number;
        let shiftRemainingMin: number;
        let cycleRemainingMin: number;
        let driveTodayMin: number;
        let onDutyTodayMin: number;

        switch (hosStatus) {
          case "DRIVING": {
            driveRemainingMin = randInt(30, 480); // 0.5–8h left
            shiftRemainingMin = driveRemainingMin + randInt(60, 240); // 1–4h margin
            driveTodayMin = 660 - driveRemainingMin; // up to 11h
            onDutyTodayMin = driveTodayMin + randInt(60, 240);
            cycleRemainingMin = randInt(600, 3600); // 10–60h left in cycle
            break;
          }
          case "ON_DUTY": {
            driveRemainingMin = randInt(120, 660); // 2–11h
            shiftRemainingMin = randInt(120, 840);
            driveTodayMin = randInt(0, 300); // 0–5h driven
            onDutyTodayMin = driveTodayMin + randInt(60, 360);
            cycleRemainingMin = randInt(900, 4200);
            break;
          }
          case "SLEEPER_BERTH": {
            driveRemainingMin = randInt(240, 660); // 4–11h after sleep
            shiftRemainingMin = randInt(300, 840); // 5–14h
            driveTodayMin = randInt(0, 240);
            onDutyTodayMin = driveTodayMin + randInt(30, 180);
            cycleRemainingMin = randInt(1200, 4200);
            break;
          }
          case "RESTING":
          case "OFF_DUTY":
          default: {
            // Mostly fresh
            driveRemainingMin = randInt(480, 660); // 8–11h
            shiftRemainingMin = randInt(600, 840); // 10–14h
            driveTodayMin = randInt(0, 120);
            onDutyTodayMin = driveTodayMin + randInt(0, 120);
            cycleRemainingMin = randInt(1800, 4200); // 30–70h
            break;
          }
        }

        // Clamp any weird negatives just in case
        driveRemainingMin = Math.max(0, Math.min(660, driveRemainingMin));
        shiftRemainingMin = Math.max(0, Math.min(840, shiftRemainingMin));
        driveTodayMin = Math.max(0, Math.min(660, driveTodayMin));
        onDutyTodayMin = Math.max(0, Math.min(840, onDutyTodayMin));
        cycleRemainingMin = Math.max(0, Math.min(4200, cycleRemainingMin));

        const { error: updateErr } = await supabase
          .from("drivers")
          .update({
            hos_status: hosStatus,
            hos_drive_remaining_min: driveRemainingMin,
            hos_shift_remaining_min: shiftRemainingMin,
            hos_cycle_remaining_min: cycleRemainingMin,
            hos_drive_today_min: driveTodayMin,
            hos_on_duty_today_min: onDutyTodayMin,
            hos_last_synced_at: now,
          })
          .eq("id", driver.id);

        if (updateErr) {
          console.error(
            "[hos-sim-randomize] update error for driver",
            driver.id,
            updateErr
          );
          return;
        }

        updated += 1;
      })
    );

    const responseBody = {
      ok: true,
      scenario: "random_fleet_mix",
      total_drivers: totalDrivers ?? 0,
      simulatable_drivers: simulatableCount,
      updated,
    };

    console.log("[hos-sim-randomize] done:", responseBody);

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[hos-sim-randomize] fatal error:", err);
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
