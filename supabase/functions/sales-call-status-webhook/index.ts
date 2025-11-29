// FILE: supabase/functions/stripe-webhook/index.ts
//
// Purpose:
// - Receive Stripe webhooks for Atlas billing.
// - Verify Stripe signatures using STRIPE_WEBHOOK_SECRET.
// - Resolve which org the subscription belongs to (via metadata.org_id or
//   orgs.stripe_customer_id).
// - Update org billing fields on public.orgs.
// - Upsert org-level feature toggles in public.org_features based on plan.
//
// SECURITY:
// - Uses SUPABASE_SERVICE_ROLE_KEY ONLY inside this Edge Function.
// - Never expose Stripe secret keys or service role keys to the browser.
// - All org + plan logic runs server-side; frontend only reads org_features.
//
// REQUIRED ENV VARS (set in Supabase Function secrets):
//   STRIPE_SECRET_KEY           = sk_test_... or sk_live_...
//   STRIPE_WEBHOOK_SECRET       = whsec_... (from Stripe webhook endpoint)
//   SUPABASE_URL                = https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = service role key
//   STRIPE_PRICE_ID_BASIC       = price_... (Atlas Basic plan)
//   STRIPE_PRICE_ID_GROWTH      = price_... (Atlas Growth plan)
//
//   (Optional but recommended):
//   STRIPE_PRICE_ID_FREE        = price_... (if you ever bill "free" tier via Stripe)

import Stripe from "npm:stripe@16.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.48.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BillingPlan = "FREE" | "BASIC" | "GROWTH";

interface EnvConfig {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  priceIdBasic: string | null;
  priceIdGrowth: string | null;
}

// ---------------------------------------------------------------------------
// Environment / Clients
// ---------------------------------------------------------------------------

function loadEnv(): EnvConfig {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    console.error("[stripe-webhook] Missing one or more required env vars.", {
      hasStripeSecretKey: !!stripeSecretKey,
      hasStripeWebhookSecret: !!stripeWebhookSecret,
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceRole: !!supabaseServiceRoleKey,
    });
    throw new Error("Missing required environment variables");
  }

  return {
    stripeSecretKey,
    stripeWebhookSecret,
    supabaseUrl,
    supabaseServiceRoleKey,
    priceIdBasic: Deno.env.get("STRIPE_PRICE_ID_BASIC") ?? null,
    priceIdGrowth: Deno.env.get("STRIPE_PRICE_ID_GROWTH") ?? null,
  };
}

const env = loadEnv();

const stripe = new Stripe(env.stripeSecretKey, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
  },
});

// ---------------------------------------------------------------------------
// Plan / Feature Mapping
// ---------------------------------------------------------------------------

// Map Stripe price IDs to internal plan codes.
function planFromPriceId(priceId: string | null): BillingPlan {
  if (!priceId) return "FREE";

  if (env.priceIdBasic && priceId === env.priceIdBasic) {
    return "BASIC";
  }
  if (env.priceIdGrowth && priceId === env.priceIdGrowth) {
    return "GROWTH";
  }

  // Default/fallback – treat as FREE but log for debugging.
  console.warn("[stripe-webhook] Unknown price_id, defaulting plan to FREE:", {
    priceId,
  });
  return "FREE";
}

// Define which features each plan unlocks.
const PLAN_FEATURES: Record<BillingPlan, string[]> = {
  FREE: [
    "core.loads",
    "core.drivers",
    "core.trucks",
    "ai.dipsy_basic",
  ],
  BASIC: [
    "core.loads",
    "core.drivers",
    "core.trucks",
    "core.settlements_basic",
    "ai.dipsy_basic",
    "ai.dipsy_voice_outbound",
    "sales.engine_basic",
  ],
  GROWTH: [
    "core.loads",
    "core.drivers",
    "core.trucks",
    "core.settlements_full",
    "ai.dipsy_basic",
    "ai.dipsy_voice_outbound",
    "ai.dipsy_voice_inbound",
    "sales.engine_full",
    "analytics.advanced",
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse a Stripe timestamp (seconds) into an ISO string or null.
 */
function parseStripeTimestampSeconds(
  seconds: number | null | undefined,
): string | null {
  if (!seconds || Number.isNaN(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Given a Stripe subscription object, extract the primary price_id.
 * We just take the first subscription item.
 */
function getPriceIdFromSubscription(
  subscription: Stripe.Subscription,
): string | null {
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;

  if (typeof price === "string") {
    return price;
  }

  return price.id ?? null;
}

/**
 * Resolve org_id from a Stripe subscription:
 *  - subscription.metadata.org_id (preferred)
 *  - orgs.stripe_customer_id (fallback)
 */
async function resolveOrgIdFromSubscription(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const metaOrgId = subscription.metadata?.org_id;
  if (metaOrgId) {
    return metaOrgId as string;
  }

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (!stripeCustomerId) {
    console.error("[stripe-webhook] subscription has no customer", {
      subscriptionId: subscription.id,
    });
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("orgs")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (error) {
    console.error("[stripe-webhook] Error looking up org by customer", {
      error,
      stripeCustomerId,
    });
    return null;
  }

  return data?.id ?? null;
}

/**
 * Resolve org_id from a Checkout Session:
 *  - session.metadata.org_id (preferred)
 *  - orgs.stripe_customer_id (fallback)
 */
async function resolveOrgIdFromSession(
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  const metaOrgId = session.metadata?.org_id;
  if (metaOrgId) {
    return metaOrgId as string;
  }

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;

  if (!stripeCustomerId) {
    console.error("[stripe-webhook] checkout.session has no customer", {
      sessionId: session.id,
    });
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("orgs")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (error) {
    console.error("[stripe-webhook] Error looking up org by customer (session)", {
      error,
      stripeCustomerId,
    });
    return null;
  }

  return data?.id ?? null;
}

/**
 * Turn on/off org_features based on the given plan.
 * - Enables all features defined for that plan.
 * - Disables any existing features for that org that are not in that plan's list.
 */
async function syncOrgFeaturesForPlan(
  orgId: string,
  plan: BillingPlan,
): Promise<void> {
  const featuresForPlan = PLAN_FEATURES[plan] ?? [];
  const enabledSet = new Set(featuresForPlan);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("org_features")
    .select("feature_key")
    .eq("org_id", orgId);

  if (existingError) {
    console.error("[stripe-webhook] Failed to load existing org_features", {
      orgId,
      existingError,
    });
  }

  const existingKeys = new Set(
    (existing ?? []).map((row: { feature_key: string }) => row.feature_key),
  );

  if (featuresForPlan.length > 0) {
    const rowsToUpsert = featuresForPlan.map((featureKey) => ({
      org_id: orgId,
      feature_key: featureKey,
      is_enabled: true,
      plan_source: plan,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabaseAdmin
      .from("org_features")
      .upsert(rowsToUpsert, {
        onConflict: "org_id,feature_key",
      });

    if (upsertError) {
      console.error("[stripe-webhook] Failed to upsert org_features", {
        orgId,
        plan,
        upsertError,
      });
    }
  }

  const toDisable: string[] = [];
  for (const key of existingKeys) {
    if (!enabledSet.has(key)) {
      toDisable.push(key);
    }
  }

  if (toDisable.length > 0) {
    const { error: disableError } = await supabaseAdmin
      .from("org_features")
      .update({
        is_enabled: false,
        plan_source: plan,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .in("feature_key", toDisable);

    if (disableError) {
      console.error("[stripe-webhook] Failed to disable org_features", {
        orgId,
        plan,
        toDisable,
        disableError,
      });
    }
  }

  console.log("[stripe-webhook] Synced org_features for plan", {
    orgId,
    plan,
    enabled: featuresForPlan,
    disabled: toDisable,
  });
}

/**
 * Update the org's billing fields based on a subscription + computed plan.
 */
async function upsertOrgBillingFromSubscription(
  subscription: Stripe.Subscription,
  plan: BillingPlan,
): Promise<void> {
  const orgId = await resolveOrgIdFromSubscription(subscription);
  if (!orgId) {
    console.error(
      "[stripe-webhook] Could not resolve org_id for subscription",
      { subscriptionId: subscription.id },
    );
    return;
  }

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  const billingPeriodEnd = parseStripeTimestampSeconds(
    subscription.current_period_end,
  );

  const { error: updateError } = await supabaseAdmin
    .from("orgs")
    .update({
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: subscription.id,
      billing_plan: plan,
      billing_status: subscription.status,
      billing_period_end: billingPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (updateError) {
    console.error("[stripe-webhook] Failed to update org billing info", {
      orgId,
      subscriptionId: subscription.id,
      updateError,
    });
    return;
  }

  console.log("[stripe-webhook] Updated org billing from subscription", {
    orgId,
    plan,
    subscriptionId: subscription.id,
    status: subscription.status,
  });

  await syncOrgFeaturesForPlan(orgId, plan);
}

/**
 * Handle subscription deleted: downgrade to FREE and clear subscription id.
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const orgId = await resolveOrgIdFromSubscription(subscription);
  if (!orgId) {
    console.error(
      "[stripe-webhook] Could not resolve org_id for deleted subscription",
      { subscriptionId: subscription.id },
    );
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from("orgs")
    .update({
      stripe_subscription_id: null,
      billing_plan: "FREE",
      billing_status: "canceled",
      billing_period_end: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (updateError) {
    console.error("[stripe-webhook] Failed to update org on subscription delete", {
      orgId,
      subscriptionId: subscription.id,
      updateError,
    });
    return;
  }

  console.log("[stripe-webhook] Subscription deleted, downgraded org to FREE", {
    orgId,
    subscriptionId: subscription.id,
  });

  await syncOrgFeaturesForPlan(orgId, "FREE");
}

/**
 * Handle checkout.session.completed:
 * - Link Stripe customer to org (if we know org_id).
 * - Do NOT change plan here; we rely on subscription.created/updated events.
 */
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const orgId = await resolveOrgIdFromSession(session);
  if (!orgId) {
    console.error(
      "[stripe-webhook] Could not resolve org_id for checkout.session.completed",
      { sessionId: session.id },
    );
    return;
  }

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;

  if (!stripeCustomerId) {
    console.error(
      "[stripe-webhook] checkout.session.completed has no customer",
      { sessionId: session.id },
    );
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from("orgs")
    .update({
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (updateError) {
    console.error(
      "[stripe-webhook] Failed to update org stripe_customer_id from session",
      { orgId, sessionId: session.id, updateError },
    );
  } else {
    console.log("[stripe-webhook] Linked Stripe customer to org from session", {
      orgId,
      sessionId: session.id,
      stripeCustomerId,
    });
  }
}

/**
 * Handle invoice.payment_failed:
 * - Mark billing_status = 'past_due' but DO NOT change billing_plan.
 */
async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) {
    console.error(
      "[stripe-webhook] invoice.payment_failed has no subscription",
      { invoiceId: invoice.id },
    );
    return;
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(
      subscriptionId as string,
    );
  } catch (err) {
    console.error(
      "[stripe-webhook] Failed to retrieve subscription for invoice.payment_failed",
      { invoiceId: invoice.id, subscriptionId, err },
    );
    return;
  }

  const orgId = await resolveOrgIdFromSubscription(subscription);
  if (!orgId) {
    console.error(
      "[stripe-webhook] Could not resolve org_id for invoice.payment_failed",
      { invoiceId: invoice.id, subscriptionId },
    );
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from("orgs")
    .update({
      billing_status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (updateError) {
    console.error(
      "[stripe-webhook] Failed to update org billing_status to past_due",
      { orgId, invoiceId: invoice.id, updateError },
    );
  } else {
    console.log("[stripe-webhook] Marked org billing_status as past_due", {
      orgId,
      invoiceId: invoice.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Main HTTP handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    console.error("[stripe-webhook] Missing stripe-signature header");
    return new Response("Bad Request", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    // IMPORTANT CHANGE: use async verification in Deno / Supabase edge runtime
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.stripeWebhookSecret,
    );
  } catch (err) {
    console.error(
      "[stripe-webhook] Signature verification failed:",
      err,
    );
    return new Response("Invalid signature", { status: 400 });
  }

  console.log("[stripe-webhook] Received event", {
    id: event.id,
    type: event.type,
  });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const priceId = getPriceIdFromSubscription(subscription);
        const plan = planFromPriceId(priceId);
        await upsertOrgBillingFromSubscription(subscription, plan);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }

      case "customer.subscription.trial_will_end":
      case "invoice.payment_succeeded":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed": {
        console.log("[stripe-webhook] Received informational event", {
          type: event.type,
        });
        break;
      }

      default: {
        console.log("[stripe-webhook] Ignoring unsupported event type", {
          type: event.type,
        });
      }
    }
  } catch (err) {
    console.error("[stripe-webhook] Error handling event", {
      type: event.type,
      err,
    });
    // Returning 200 so Stripe doesn't spam retries while we're debugging.
    return new Response("Webhook handler error", { status: 200 });
  }

  return new Response(
    JSON.stringify({ received: true }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
