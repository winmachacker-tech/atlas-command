// FILE: supabase/functions/admin-invite-user/index.ts
// PURPOSE:
// - Send a Supabase Auth "invite user" email using the service role key.
// - Only allow ORG OWNER / ORG ADMIN of the given org_id to send invites.
// - Expect body: { email, org_role, org_id }.
//
// FLOW:
//  1) Read the caller's JWT from Authorization header.
//  2) Get the current user (caller) from Supabase Auth.
//  3) Check team_members to make sure caller is owner/admin for org_id.
//  4) Call auth.admin.inviteUserByEmail(email, {...}) with org metadata.
//     - If user is brand new -> send invite, status: "invited".
//     - If user already exists -> DO NOT treat as error, status: "already_exists".
//  5) Return JSON with success or detailed error.
//
// SECURITY:
// - Uses SUPABASE_SERVICE_ROLE_KEY on the server only.
// - Verifies the caller is owner/admin in public.team_members.
// - Never exposes service key to the browser.
//
// CORS:
// - Allows requests from your frontends (localhost + Vercel) by
//   returning Access-Control-Allow-* headers and handling OPTIONS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// -------- CORS HEADERS --------
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables for admin-invite-user"
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Only allow POST for real work
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed", method: req.method }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Caller must be authenticated (JWT in Authorization header)
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer", "").trim();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization bearer token" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Client used to figure out who is calling (auth.getUser)
    const authClient = createClient(supabaseUrl, serviceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const {
      data: { user },
      error: userErr,
    } = await authClient.auth.getUser();

    if (userErr || !user) {
      return new Response(
        JSON.stringify({
          error: "Unable to fetch calling user",
          details: userErr?.message ?? null,
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Parse JSON body
    let body: unknown;
    try {
      body = await req.json();
    } catch (_) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const { email, org_role, org_id } = (body ?? {}) as {
      email?: string;
      org_role?: string;
      org_id?: string;
    };

    if (!email || !org_role || !org_id) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          missing: {
            email: !email,
            org_role: !org_role,
            org_id: !org_id,
          },
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

    // Use a service-role client for DB access (bypass RLS, we enforce checks manually)
    const adminClient = createClient(supabaseUrl, serviceKey);

    // 1) Check that the caller is owner/admin in this org
    const { data: callerMember, error: memberErr } = await adminClient
      .from("team_members")
      .select("role")
      .eq("org_id", org_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberErr) {
      return new Response(
        JSON.stringify({
          error: "Failed to check org membership for caller",
          details: memberErr.message,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!callerMember || !["owner", "admin"].includes(callerMember.role)) {
      return new Response(
        JSON.stringify({
          error: "Not authorized to invite users for this organization",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // 2) Actually send invite using Auth Admin
    const { data: inviteRes, error: inviteErr } =
      await adminClient.auth.admin.inviteUserByEmail(email, {
        data: {
          org_id,
          org_role,
          invited_by_user_id: user.id,
        },
      });

    // Handle "already registered" as a SUCCESSFUL outcome
    if (inviteErr) {
      const msg = (inviteErr.message || "").toLowerCase();

      const looksLikeAlreadyExists =
        msg.includes("already registered") ||
        msg.includes("already exists") ||
        msg.includes("email address is already registered");

      if (looksLikeAlreadyExists) {
        // User already has an account; from Atlas's POV this is fine.
        // The org membership was created by the RPC; we simply don't send another invite email.
        return new Response(
          JSON.stringify({
            success: true,
            status: "already_exists",
            email,
            org_role,
            org_id,
            warning: inviteErr.message,
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

      // Any other error is a real problem
      return new Response(
        JSON.stringify({
          error: "Failed to send invite email",
          details: inviteErr.message,
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

    // Normal invited flow
    return new Response(
      JSON.stringify({
        success: true,
        status: "invited",
        email,
        org_role,
        org_id,
        inviteRes,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("[admin-invite-user] Unhandled error", err);
    return new Response(
      JSON.stringify({
        error: "Unhandled error in admin-invite-user",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
