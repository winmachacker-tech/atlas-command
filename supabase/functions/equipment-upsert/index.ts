// supabase/functions/equipment-upsert/index.ts
// Upserts equipment types, but ONLY for signed-in admins.
// No custom "admin token" needed in the client.
//
// AuthZ flow:
// 1) We read the end-user's JWT from the Authorization header (supabase-js sends it automatically).
// 2) We fetch the user + their profile and ensure they are admin.
// 3) If admin, we perform the upsert using a SERVICE-ROLE client (bypasses RLS for this write).
//
// Pre-reqs (common in Supabase functions):
// - ENV: SUPABASE_URL, SUPABASE_ANON_KEY (usually auto-set)
// - ENV: SUPABASE_SERVICE_ROLE_KEY (add in Functions → Secrets)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Payload = {
  code: string;
  label: string;
  description?: string | null;
  has_temp_control?: boolean;
  is_open_deck?: boolean;
  is_power_only?: boolean;
  default_length_feet?: number | null;
  allowed_lengths_feet?: number[]; // e.g., [28,48,53]
  max_weight_lbs?: number | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRucGVzbm9od2J3cG1ha3Z5enBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MTgwODQsImV4cCI6MjA3NzA5NDA4NH0.d9WuqBacdSfHtG2O1mWEXlAjq516m-Fjw_eaPvNr9w0")!;
const SERVICE_ROLE_KEY = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRucGVzbm9od2J3cG1ha3Z5enBuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTUxODA4NCwiZXhwIjoyMDc3MDk0MDg0fQ.uucqKGYzYV5_Xjo-amxVVnzwEPf4ZiSBw9WMBO7Jzt8")!;

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Use POST" }, 405);
    }

    // 1) Auth: get end-user via their JWT (Authorization header)
    const authHeader = req.headers.get("Authorization") ?? "";
    const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await authedClient.auth.getUser();

    if (userErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // 2) Check admin in your profiles table (adjust table/column names if needed)
    // Expecting a row like: profiles(id uuid pk references auth.users, role text or is_admin bool)
    const { data: profile, error: profErr } = await authedClient
      .from("profiles")
      .select("id, role, is_admin")
      .eq("id", user.id)
      .single();

    if (profErr || !profile) {
      return json({ error: "Profile not found" }, 403);
    }

    const isAdmin =
      profile.is_admin === true ||
      (typeof profile.role === "string" &&
        ["admin", "superadmin"].includes(profile.role.toLowerCase()));

    if (!isAdmin) {
      return json({ error: "Forbidden (admin only)" }, 403);
    }

    // 3) Validate payload
    const body = (await req.json()) as Payload;
    if (!body?.code || !body?.label) {
      return json({ error: "code and label are required" }, 400);
    }

    // 4) Use SERVICE-ROLE client for the privileged write
    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Normalize fields
    const upsertRow = {
      code: body.code.trim().toUpperCase(),
      label: body.label.trim(),
      description: body.description ?? null,
      has_temp_control: !!body.has_temp_control,
      is_open_deck: !!body.is_open_deck,
      is_power_only: !!body.is_power_only,
      default_length_feet:
        body.default_length_feet === null || body.default_length_feet === undefined
          ? null
          : Number(body.default_length_feet),
      allowed_lengths_feet: Array.isArray(body.allowed_lengths_feet)
        ? body.allowed_lengths_feet.map((n) => Number(n)).filter((n) => !Number.isNaN(n))
        : [],
      max_weight_lbs:
        body.max_weight_lbs === null || body.max_weight_lbs === undefined
          ? null
          : Number(body.max_weight_lbs),
    };

    // 5) Upsert
    const { data, error } = await serviceClient
      .from("equipment_types")
      .upsert(upsertRow, { onConflict: "code" })
      .select()
      .single();

    if (error) {
      return json({ error: error.message || "Upsert failed" }, 400);
    }

    return json({ ok: true, data }, 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
