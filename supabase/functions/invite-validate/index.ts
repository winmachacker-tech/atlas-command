// FILE: supabase/functions/invite-validate/index.ts
//
// Purpose:
// - Validate public invite codes like "ATLAS-BETA-2025" for Atlas Command.
// - Return the org_id that owns the code so the frontend can complete signup.
//
// Behavior:
// - Accepts POST with JSON body: { code: "ATLAS-BETA-2025" } or { invite_code: "..." }.
// - Looks up the code in public.invite_codes using the service-role key.
// - Enforces:
//     • is_active = true
//     • expires_at is null OR in the future
//     • used_count < max_uses
// - Returns a simple JSON object with org_id and details if valid.
//
// SECURITY:
// - Uses SUPABASE_SERVICE_ROLE_KEY server-side ONLY.
// - Does not expose secrets to the browser.
// - Does NOT modify any RLS policies or auth checks.
//
// REQUIRED ENV VARS (Supabase Function secrets):
//   SUPABASE_URL              = https://<your-project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = service-role key (never expose to client)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// Inline CORS headers so we don't depend on any shared file.
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper to build JSON responses with CORS
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[invite-validate] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.",
  );
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed. Use POST." },
      { status: 405 },
    );
  }

  try {
    const rawBody = await req.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object") {
      return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
    }

    // Support both { code } and { invite_code }
    const rawCode =
      (rawBody as { code?: unknown }).code ??
      (rawBody as { invite_code?: unknown }).invite_code;

    if (typeof rawCode !== "string" || rawCode.trim().length === 0) {
      return jsonResponse(
        { error: "Missing or invalid 'code' field." },
        { status: 400 },
      );
    }

    // Normalize: trim + upper-case to be a bit forgiving
    const code = rawCode.trim().toUpperCase();
    const now = new Date();

    console.log("[invite-validate] Validating code:", code);

    const { data, error } = await supabaseAdmin
      .from("invite_codes")
      .select(
        "id, code, org_id, description, max_uses, used_count, is_active, expires_at",
      )
      .eq("code", code)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[invite-validate] DB error:", error);
      return jsonResponse(
        { error: "Database error while checking invite code." },
        { status: 500 },
      );
    }

    if (!data) {
      // No such active code
      return jsonResponse({ error: "Invalid invite code." }, { status: 404 });
    }

    // Check expiry
    if (data.expires_at) {
      const expiresAt = new Date(data.expires_at);
      if (expiresAt.getTime() <= now.getTime()) {
        return jsonResponse(
          { error: "Invite code has expired." },
          { status: 410 },
        );
      }
    }

    // Check usage limit (enforced in app logic, not DB constraint)
    if (
      typeof data.max_uses === "number" &&
      typeof data.used_count === "number" &&
      data.used_count >= data.max_uses
    ) {
      return jsonResponse(
        { error: "Invite code has reached its usage limit." },
        { status: 409 },
      );
    }

    const remainingUses =
      typeof data.max_uses === "number" &&
      typeof data.used_count === "number"
        ? Math.max(data.max_uses - data.used_count, 0)
        : null;

    // SUCCESS: return only what the frontend needs
    return jsonResponse(
      {
        success: true,
        code: data.code,
        org_id: data.org_id,
        description: data.description,
        max_uses: data.max_uses,
        used_count: data.used_count,
        remaining_uses: remainingUses,
        expires_at: data.expires_at,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[invite-validate] Unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected error while validating invite code." },
      { status: 500 },
    );
  }
});
