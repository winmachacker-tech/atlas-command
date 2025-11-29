// FILE: supabase/functions/stripe-create-checkout-session/index.ts
//
// Purpose:
// - Create a Stripe Checkout Session for the CURRENT ORG only.
// - Supports plan = "basic" | "growth" (maps to STRIPE_PRICE_ID_BASIC / STRIPE_PRICE_ID_GROWTH).
// - Attaches metadata.org_id so stripe-webhook can resolve the org and update billing.
//
// Security:
// - Uses STRIPE_SECRET_KEY ONLY inside this Edge Function.
// - Uses SUPABASE_ANON_KEY only to validate the JWT and read the current user.
// - Does NOT use the service role key.
// - Derives org_id from the authenticated user (auth.getUser), NOT from the request body.
//
// Required environment variables (Edge Function secrets):
//   SUPABASE_URL              = https://<project>.supabase.co
//   SUPABASE_ANON_KEY         = anon key
//   STRIPE_SECRET_KEY         = sk_test_... or sk_live_...
//   STRIPE_PRICE_ID_BASIC     = price_... (Atlas Basic plan)
//   STRIPE_PRICE_ID_GROWTH    = price_... (Atlas Growth plan)
//   ATLAS_APP_URL             = https://app.atlascommand.app  (fallbacks to http://localhost:5173)
//
// Notes:
// - This function does NOT write to the database. It just creates the Checkout Session.
// - stripe-webhook is responsible for updating public.orgs and public.org_features
//   once Stripe sends checkout.session.completed / subscription events.

import Stripe from "npm:stripe@^16.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

// Helper: standard CORS headers so the frontend can call this too.
function buildCorsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // --- Read and validate env vars ---
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_PRICE_ID_BASIC = Deno.env.get("STRIPE_PRICE_ID_BASIC");
  const STRIPE_PRICE_ID_GROWTH = Deno.env.get("STRIPE_PRICE_ID_GROWTH");
  const ATLAS_APP_URL =
    Deno.env.get("ATLAS_APP_URL") ?? "http://localhost:5173";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({
        error: "Supabase not configured on server",
        details: "SUPABASE_URL or SUPABASE_ANON_KEY is missing",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  if (!STRIPE_SECRET_KEY) {
    return new Response(
      JSON.stringify({
        error: "Stripe not configured",
        details: "STRIPE_SECRET_KEY is missing",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  if (!STRIPE_PRICE_ID_BASIC || !STRIPE_PRICE_ID_GROWTH) {
    return new Response(
      JSON.stringify({
        error: "Stripe price IDs not configured",
        details:
          "STRIPE_PRICE_ID_BASIC and STRIPE_PRICE_ID_GROWTH must be set",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // --- Auth: get current user from Supabase using the JWT from Authorization header ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(
      JSON.stringify({
        error: "Missing or invalid Authorization header",
      }),
      {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new Response(
      JSON.stringify({
        error: "Unable to fetch user from Supabase",
        details: userError?.message ?? "No user found for this token",
      }),
      {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const appMeta: any = user.app_metadata ?? {};
  const userMeta: any = user.user_metadata ?? {};

  const orgId: string | undefined =
    userMeta.org_id ?? appMeta.org_id ?? appMeta.orgId;

  if (!orgId) {
    return new Response(
      JSON.stringify({
        error: "No org_id found on user",
        details:
          "Expected org_id in user.user_metadata.org_id or user.app_metadata.org_id",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // --- Parse request body (plan selection) ---
  let body: any;
  try {
    body = await req.json();
  } catch (_err) {
    return new Response(
      JSON.stringify({
        error: "Invalid JSON body",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const plan = (body?.plan as string | undefined)?.toLowerCase() ?? "basic";

  let priceId: string;
  switch (plan) {
    case "basic":
      priceId = STRIPE_PRICE_ID_BASIC;
      break;
    case "growth":
      priceId = STRIPE_PRICE_ID_GROWTH;
      break;
    default:
      return new Response(
        JSON.stringify({
          error: "Unsupported plan",
          details: `Plan must be "basic" or "growth", received: ${plan}`,
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
  }

  // --- Initialize Stripe ---
  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });

  const customerEmail =
    (user.email as string | undefined) ??
    (userMeta.email as string | undefined) ??
    undefined;
  const customerName =
    (userMeta.fullName as string | undefined) ??
    (userMeta.full_name as string | undefined) ??
    undefined;

  try {
    // We let Stripe create a new Customer automatically.
    // We just pass org_id into metadata; stripe-webhook will map customer/subscription -> org.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Use line_items with a single price
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${ATLAS_APP_URL}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ATLAS_APP_URL}/billing?status=cancelled`,
      metadata: {
        org_id: orgId,
        plan,
      },
      subscription_data: {
        metadata: {
          org_id: orgId,
          plan,
        },
      },
      customer_email: customerEmail,
      // Allow promotion codes / invoice settings later if needed
    });

    if (!session.url) {
      return new Response(
        JSON.stringify({
          error: "Stripe session created but no URL returned",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err: any) {
    console.error("[stripe-create-checkout-session] Error creating session", {
      message: err?.message,
      type: err?.type,
      code: err?.code,
    });

    return new Response(
      JSON.stringify({
        error: "Failed to create Stripe Checkout Session",
        details: err?.message ?? String(err),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
