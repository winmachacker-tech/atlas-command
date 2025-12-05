// supabase/functions/stripe-info/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Fetch everything we need to understand the setup
    const [products, prices, subscriptions, customers] = await Promise.all([
      stripe.products.list({ limit: 100, active: true }),
      stripe.prices.list({ limit: 100, active: true }),
      stripe.subscriptions.list({ limit: 100 }),
      stripe.customers.list({ limit: 100 }),
    ]);

    // Calculate MRR from active subscriptions
    let mrr = 0;
    for (const sub of subscriptions.data) {
      if (sub.status === "active" || sub.status === "trialing") {
        for (const item of sub.items.data) {
          const amount = item.price.unit_amount || 0;
          const interval = item.price.recurring?.interval;
          if (interval === "month") {
            mrr += amount;
          } else if (interval === "year") {
            mrr += Math.round(amount / 12);
          }
        }
      }
    }

    const summary = {
      products: products.data.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        active: p.active,
      })),
      prices: prices.data.map((p) => ({
        id: p.id,
        product: p.product,
        unit_amount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval,
        nickname: p.nickname,
      })),
      subscriptions: {
        total: subscriptions.data.length,
        active: subscriptions.data.filter((s) => s.status === "active").length,
        trialing: subscriptions.data.filter((s) => s.status === "trialing").length,
        canceled: subscriptions.data.filter((s) => s.status === "canceled").length,
        byStatus: subscriptions.data.reduce((acc, s) => {
          acc[s.status] = (acc[s.status] || 0) + 1;
          return acc;
        }, {}),
      },
      customers: {
        total: customers.data.length,
      },
      mrr_cents: mrr,
      mrr_dollars: (mrr / 100).toFixed(2),
      arr_dollars: ((mrr * 12) / 100).toFixed(2),
    };

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[stripe-info] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});