// supabase/functions/admin-reset-password/index.ts
// Secure password reset via Admin API (service role key required).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_TASKS_TOKEN = Deno.env.get("ADMIN_TASKS_TOKEN")!; // set a strong random string

const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Payload =
  | { user_id: string; new_password: string }
  | { email: string; new_password: string };

function json(
  body: unknown,
  init: number | ResponseInit = 200,
): Response {
  const status = typeof init === "number" ? init : init.status ?? 200;
  const headers = new Headers(
    typeof init === "number" ? {} : init.headers ?? {},
  );
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

serve(async (req) => {
  try {
    // ---- AuthN: simple bearer gate for your own backend/orchestrator ----
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    if (!token || token !== ADMIN_TASKS_TOKEN) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const payload = (await req.json()) as Payload;

    // Resolve user ID (if email provided)
    let userId: string | null = null;

    if ("user_id" in payload && payload.user_id) {
      userId = payload.user_id;
    } else if ("email" in payload && payload.email) {
      // No direct "get by email" in Admin; iterate pages to find the user.
      // For small userbases this is fine; for larger, keep an indexed copy in public.users.
      let page = 1;
      const perPage = 1000;
      while (true) {
        const { data, error } = await sbAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (error) throw error;
        const match = data.users.find(
          (u) => u.email?.toLowerCase() === payload.email.toLowerCase(),
        );
        if (match) {
          userId = match.id;
          break;
        }
        if (data.users.length < perPage) break; // no more pages
        page++;
      }
      if (!userId) {
        return json({ error: "User not found for provided email" }, 404);
      }
    } else {
      return json(
        {
          error:
            "Invalid payload. Provide { user_id, new_password } or { email, new_password }.",
        },
        400,
      );
    }

    const newPassword =
      "new_password" in payload && payload.new_password?.trim();
    if (!newPassword || newPassword.length < 8) {
      return json(
        { error: "new_password must be at least 8 characters." },
        400,
      );
    }

    // ---- Perform reset ----
    const { data, error } = await sbAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (error) {
      return json({ error: error.message }, 400);
    }

    return json({
      ok: true,
      user_id: data.user?.id,
      email: data.user?.email ?? null,
      message: "Password updated.",
    });
  } catch (err) {
    console.error("admin-reset-password error:", err);
    const msg =
      err instanceof Error ? err.message : "Unexpected server error";
    return json({ error: msg }, 500);
  }
});
