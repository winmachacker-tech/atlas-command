// FILE: supabase/functions/billing-create-checkout-session/index.ts
//
// Purpose:
// - Create a Stripe Checkout Session for upgrading an org's billing plan.
// - Uses the authenticated Supabase user to resolve org_id (via team_members).
// - Ensures there is a Stripe Customer for that org (creates one if missing).
// - Creates a subscription-mode Checkout Session for BASIC or GROWTH plans.
// - Attaches org_id in metadata so the stripe-webhook can map events back.
//
// SECURITY:
// - This Edge Function REQUIRES a valid Supabase JWT (verify_jwt = true by default).
// - It NEVER exposes Stripe secret keys or service-role keys to the browser.
// - It uses the Supabase user's JWT to identify the user, then uses the
//   service-role key ONLY on the backend to safely query orgs/team_members.
//
// REQUEST (from frontend):
//   POST /functions/v1/billing-create-checkout-session
//   Headers:
//     Authorization: Bearer <supabase JWT>
//   Body (JSON):
//     { "plan": "BASIC" }  or  { "plan": "GROWTH" }
//
// RESPONSE (JSON):
//   200 OK: { "url": "https://checkout.stripe.com/c/..." }
//   4xx/5xx: { "error": "message" }
//
// REQUIRED ENV VARS (Supabase Function secrets):
//   STRIPE_SECRET_KEY         = sk_test_... or sk_live_...
//   STRIPE_PRICE_ID_BASIC     = price_... (Stripe price for BASIC plan)
//   STRIPE_PRICE_ID_GROWTH    = price_... (Stripe price for GROWTH plan)
//   STRIPE_SUCCESS_URL        = https://app.atlas-command.../billing?status=success
//   STRIPE_CANCEL_URL         = https://app.atlas-command.../billing?status=cancel
//   SUPABASE_URL              = https://<project>.supabase.co
//   SUPABASE_ANON_KEY         = anon key
//   SUPABASE_SERVICE_ROLE_KEY = service role key (server-side only)

import Stripe from "npm:stripe@16.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.48.0";

type BillingPlan = "BASIC" | "GROWTH";

interface EnvConfig {
  stripeSecretKey: string;
  stripePriceIdBasic: string;
  stripePriceIdGrowth: string;
  stripeSuccessUrl: string;
  stripeCancelUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
}

function loadEnv(): EnvConfig {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const stripePriceIdBasic = Deno.env.get("STRIPE_PRICE_ID_BASIC") ?? "";
  const stripePriceIdGrowth = Deno.env.get("STRIPE_PRICE_ID_GROWTH") ?? "";
  const stripeSuccessUrl = Deno.env.get("STRIPE_SUCCESS_URL") ?? "";
  const stripeCancelUrl = Deno.env.get("STRIPE_CANCEL_URL") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (
    !stripeSecretKey ||
    !stripePriceIdBasic ||
    !stripePriceIdGrowth ||
    !stripeSuccessUrl ||
    !stripeCancelUrl ||
    !supabaseUrl ||
    !supabaseAnonKey ||
    !supabaseServiceRoleKey
  ) {
    console.error("[billing-create-checkout-session] Missing env vars", {
      hasStripeSecretKey: !!stripeSecretKey,
      hasPriceBasic: !!stripePriceIdBasic,
      hasPriceGrowth: !!stripePriceIdGrowth,
      hasSuccessUrl: !!stripeSuccessUrl,
      hasCancelUrl: !!stripeCancelUrl,
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseAnonKey: !!supabaseAnonKey,
      hasServiceRole: !!supabaseServiceRoleKey,
    });
    throw new Error("Missing required environment variables");
  }

  return {
    stripeSecretKey,
    stripePriceIdBasic,
    stripePriceIdGrowth,
    stripeSuccessUrl,
    stripeCancelUrl,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
  };
}

const env = loadEnv();

const stripe = new Stripe(env.stripeSecretKey, {
  apiVersion: "2024-06-20",
});

// Supabase client that uses the user's JWT (from Authorization header)
function createUserSupabaseClient(authHeader: string) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });
}

// Supabase admin client (service role) – server-only, never exposed to browser
const supabaseAdmin = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  { auth: { persistSession: false } },
);

interface RequestBody {
  plan?: BillingPlan;
}

// Helper: map plan -> Stripe price ID
function getPriceIdForPlan(plan: BillingPlan): string {
  switch (plan) {
    case "BASIC":
      return env.stripePriceIdBasic;
    case "GROWTH":
      return env.stripePriceIdGrowth;
  }
}

// Main handler
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1) Require Authorization header (Supabase JWT)
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    console.error(
      "[billing-create-checkout-session] Missing or invalid Authorization header",
    );
    return new Response(
      JSON.stringify({ error: "Not authenticated" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // 2) Parse body and validate plan
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const plan = body.plan;
  if (plan !== "BASIC" && plan !== "GROWTH") {
    return new Response(
      JSON.stringify({ error: "Invalid or missing plan" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // 3) Get the authenticated user via Supabase auth
  const supabaseUser = createUserSupabaseClient(authHeader);
  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user) {
    console.error(
      "[billing-create-checkout-session] auth.getUser error",
      userError,
    );
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // 4) Resolve org_id for this user via team_members (status = 'active')
  const { data: teamMember, error: teamError } = await supabaseAdmin
    .from("team_members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (teamError || !teamMember?.org_id) {
    console.error(
      "[billing-create-checkout-session] Could not resolve org_id for user",
      { userId: user.id, teamError },
    );
    return new Response(
      JSON.stringify({ error: "No active organization found for user" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const orgId = teamMember.org_id as string;

  // 5) Load org to get name + existing stripe_customer_id
  const { data: org, error: orgError } = await supabaseAdmin
    .from("orgs")
    .select("id, name, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError || !org) {
    console.error(
      "[billing-create-checkout-session] Org not found",
      { orgId, orgError },
    );
    return new Response(
      JSON.stringify({ error: "Organization not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  let stripeCustomerId = org.stripe_customer_id as string | null;

  // 6) If no Stripe Customer yet, create one and store on org
  if (!stripeCustomerId) {
    try {
      const customer = await stripe.customers.create({
        name: org.name ?? undefined,
        metadata: {
          org_id: org.id,
        },
      });
      stripeCustomerId = customer.id;

      const { error: updateOrgError } = await supabaseAdmin
        .from("orgs")
        .update({
          stripe_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", org.id);

      if (updateOrgError) {
        console.error(
          "[billing-create-checkout-session] Failed to save stripe_customer_id on org",
          { orgId: org.id, updateOrgError },
        );
      }
    } catch (err) {
      console.error(
        "[billing-create-checkout-session] Error creating Stripe customer",
        err,
      );
      return new Response(
        JSON.stringify({ error: "Failed to create Stripe customer" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // 7) Determine Stripe price ID for requested plan
  const priceId = getPriceIdForPlan(plan);

  // 8) Create Stripe Checkout Session (subscription mode)
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId ?? undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: env.stripeSuccessUrl,
      cancel_url: env.stripeCancelUrl,
      client_reference_id: orgId,
      metadata: {
        org_id: orgId,
        requested_plan: plan,
        requested_by_user_id: user.id,
      },
      subscription_data: {
        metadata: {
          org_id: orgId,
        },
      },
    });

    if (!session.url) {
      console.error(
        "[billing-create-checkout-session] Created session has no URL",
        { sessionId: session.id },
      );
      return new Response(
        JSON.stringify({ error: "Failed to create checkout session" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    console.log(
      "[billing-create-checkout-session] Created checkout session",
      {
        sessionId: session.id,
        orgId,
        plan,
      },
    );

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(
      "[billing-create-checkout-session] Error creating checkout session",
      err,
    );
    return new Response(
      JSON.stringify({ error: "Error creating checkout session" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
