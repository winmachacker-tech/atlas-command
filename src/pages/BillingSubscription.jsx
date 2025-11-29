// FILE: src/pages/BillingSubscription.jsx
//
// Purpose:
// - Atlas Command subscription page (separate from Billing Control Tower).
// - Lets a logged-in user start their Stripe subscription for Atlas Command.
// - Calls the Supabase Edge Function: "billing-create-checkout-session".
// - The Edge Function talks to Stripe securely on the server.
//
// Security:
// - Uses the standard Supabase client from ../lib/supabase (no secret keys).
// - Relies on Supabase Auth session + RLS to identify user/org.
// - Never exposes Stripe secret key or other sensitive config in the browser.

import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function BillingSubscription() {
  const navigate = useNavigate();
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const handleStartSubscription = useCallback(async () => {
    setErrorMessage("");
    setInfoMessage("");
    setIsCreatingSession(true);

    try {
      // Call the Supabase Edge Function that creates a Stripe Checkout session.
      const { data, error } = await supabase.functions.invoke(
        "billing-create-checkout-session",
        {
          body: {
            // You can expand this later (e.g. "ANNUAL" plan, different tiers, etc.)
            billingInterval: "MONTHLY",
            // metadata: { plan_tier: "BETA" },
          },
        }
      );

      if (error) {
        console.error(
          "[BillingSubscription] Error from billing-create-checkout-session:",
          error
        );
        setErrorMessage(
          error.message ||
            "We couldn't start the checkout session. Please try again."
        );
        setIsCreatingSession(false);
        return;
      }

      if (!data || !data.checkoutUrl) {
        console.error(
          "[BillingSubscription] No checkoutUrl returned from function:",
          data
        );
        setErrorMessage(
          "Something went wrong starting checkout. Please contact support."
        );
        setIsCreatingSession(false);
        return;
      }

      setInfoMessage("Redirecting you to secure Stripe checkout...");

      // Redirect the user to the Stripe-hosted Checkout page.
      window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error("[BillingSubscription] Unexpected error:", err);
      setErrorMessage(
        "Unexpected error starting checkout. Please try again or contact support."
      );
      setIsCreatingSession(false);
    }
  }, []);

  const handleBackToDashboard = useCallback(() => {
    // Adjust this route if your "home" screen is different.
    navigate("/loads");
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Page wrapper */}
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8">
        {/* Header */}
        <header className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
              Atlas Subscription
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Start or manage your Atlas Command subscription. Checkout is
              handled securely by Stripe and linked to your current
              organization.
            </p>
          </div>

          <button
            type="button"
            onClick={handleBackToDashboard}
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-900/70"
          >
            Back to dashboard
          </button>
        </header>

        {/* Main content */}
        <main className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)]">
          {/* Primary card: Subscription action */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-950/40">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-50">
                  Atlas Command Subscription
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Unlock AI dispatch, sales automation, lane intelligence, and
                  more. One subscription per Atlas organization.
                </p>
              </div>

              <div className="text-right sm:text-right">
                <p className="text-sm font-semibold text-slate-200">
                  $1,500{" "}
                  <span className="text-xs font-normal text-slate-400">
                    /month
                  </span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Billed monthly. Cancel anytime.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleStartSubscription}
                disabled={isCreatingSession}
                className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  isCreatingSession
                    ? "cursor-not-allowed bg-emerald-700/70 text-emerald-100"
                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                }`}
              >
                {isCreatingSession
                  ? "Starting secure checkout..."
                  : "Start subscription"}
              </button>

              <p className="text-[11px] leading-relaxed text-slate-500">
                You&apos;ll be taken to a Stripe-hosted checkout page. Your card
                details stay with Stripe and never touch Atlas Command servers.
              </p>
            </div>

            {/* Messages */}
            {infoMessage && (
              <div className="mt-4 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                {infoMessage}
              </div>
            )}

            {errorMessage && (
              <div className="mt-4 rounded-lg border border-rose-700/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                {errorMessage}
              </div>
            )}
          </section>

          {/* Side card: info + safety */}
          <aside className="flex flex-col gap-4">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
              <h3 className="text-sm font-semibold text-slate-100">
                How your subscription works
              </h3>
              <ul className="mt-2 space-y-2 text-xs text-slate-400">
                <li>
                  • Stripe handles all payments using their PCI-compliant
                  infrastructure.
                </li>
                <li>
                  • The subscription is linked to your current Atlas
                  organization via secure metadata.
                </li>
                <li>
                  • We only sync non-sensitive billing status back into Atlas
                  (no card or full payment details stored).
                </li>
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
              <h3 className="text-sm font-semibold text-slate-100">
                Security note
              </h3>
              <p className="mt-2">
                Atlas Command never sees your card number. We use Stripe as our
                payment processor and only receive safe, high-level information
                like whether your subscription is active.
              </p>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}

export default BillingSubscription;
