import "./styles/dark-bridge.css";
import React, {
  StrictMode,
  Suspense,
  lazy,
  useEffect,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import FaqTestPanel from "@/lib/dipsy/FaqTestPanel";
import { Analytics } from "@vercel/analytics/react";

/* Supabase */
import { supabase } from "./lib/supabase";

/* Feature flags */
import { loadOrgFeatures } from "./lib/features";

/* Shell / providers / guards */
import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { SettingsProvider } from "./context/SettingsProvider.jsx";
import AuthGuard from "./components/AuthGuard.jsx";
import OrgBootstrapGate from "./components/OrgBootstrapGate.jsx";
import { attachDipsyBoardTester } from "./debug/testDipsyBoardView";

/* Theme */
import { ThemeProvider } from "./context/ThemeProvider.jsx";

import { askDipsyQuestion } from "@/lib/dipsy/askDipsyQuestion";

// DEV ONLY: expose askDipsyQuestion in browser console
if (typeof window !== "undefined") {
  // @ts-ignore
  window.askDipsyQuestion = askDipsyQuestion;
}


/* Lazy pages */
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Loads = lazy(() => import("./pages/Loads.jsx"));
const LoadDrafts = lazy(() => import("./pages/LoadDrafts.jsx"));
const LoadDetails = lazy(() => import("./pages/LoadDetails.jsx"));
const InTransit = lazy(() => import("./pages/InTransit.jsx"));
const Delivered = lazy(() => import("./pages/Delivered.jsx"));
const Activity = lazy(() => import("./pages/Activity.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Trucks = lazy(() => import("./pages/Trucks.jsx"));
const TruckProfile = lazy(() => import("./pages/TruckProfile.jsx"));
const Drivers = lazy(() => import("./pages/Drivers.jsx"));
const DriverDetail = lazy(() => import("./pages/DriverDetail.jsx"));
const Billing = lazy(() => import("./pages/Billing.jsx"));
const TeamManagement = lazy(() => import("./pages/TeamManagement.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));
const Appearance = lazy(() => import("./pages/Appearance.jsx"));
const Integrations = lazy(() => import("./pages/Integrations.jsx"));
const Security = lazy(() => import("./pages/Security.jsx"));
const TrustCenter = lazy(() => import("./pages/TrustCenter.jsx"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy.jsx"));
const Notifications = lazy(() =>
  import("./pages/Notifications.jsx").catch(() => ({
    default: () => <div className="p-6">Notifications page coming soon</div>,
  }))
);
const NotificationsInbox = lazy(() => import("./pages/NotificationsInbox.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Signup = lazy(() => import("./pages/Signup.jsx"));
const Customers = lazy(() => import("./pages/Customers.jsx"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail.jsx"));
const Documents = lazy(() => import("./pages/Documents.jsx"));
const LaneTraining = lazy(() => import("./pages/LaneTraining.jsx"));
const Sales = lazy(() => import("./pages/Sales.jsx"));
const DipsyTrainingReview = lazy(() => import("./pages/DipsyTrainingReview.jsx"));
const Audit = lazy(() => import("./pages/Audit.jsx"));
const AiLaneIntelligence = lazy(() => import("./pages/AiLaneIntelligence.jsx"));
const CompleteAccount = lazy(() => import("./pages/CompleteAccount.jsx"));

/* WhatsApp Contacts */
const WhatsAppContacts = lazy(() => import("./pages/WhatsAppContacts.jsx"));

/* AI pages */
const DispatchAI = lazy(() =>
  import("./pages/DispatchAI.jsx").catch(() => ({
    default: () => <div className="p-6">Dispatch AI (Lab) - Coming soon</div>,
  }))
);
const AIRecommendations = lazy(() => import("./pages/AIRecommendations.jsx"));
const AIInsights = lazy(() =>
  import("./pages/AIInsights.jsx").catch(() => ({
    default: () => <div className="p-6">AI Insights</div>,
  }))
);
const AILabProof = lazy(() => import("./pages/AILabProof.jsx"));
const DriverLearning = lazy(() =>
  import("./pages/DriverLearning.jsx").catch(() => ({
    default: () => (
      <div className="p-6">Error loading Driver Learning page</div>
    ),
  }))
);
const DriverLearningTest = lazy(() =>
  import("./pages/DriverLearningTest.jsx")
);

/* Accounting – Driver Settlements */
const DriverSettlements = lazy(() =>
  import("./pages/DriverSettlements.jsx")
);

/* Platform Admin */
const SuperAdmin = lazy(() => import("./pages/SuperAdmin.jsx"));
const Financials = lazy(() => import("./pages/Financials.jsx"));
const DipsyQualityDashboard = lazy(() => import('./pages/DipsyQualityDashboard'));
/* Billing subscription page (Stripe checkout) */
const BillingSubscription = lazy(() =>
  import("./pages/BillingSubscription.jsx")
);

/* Motive OAuth callback page */
const MotiveOAuthCallback = lazy(() =>
  import("./pages/MotiveOAuthCallback.jsx")
);

/* Fleet Map – live Motive vehicles on map */
const FleetMap = lazy(() => import("./pages/FleetMap.jsx"));

/* Commander Board Debug – truth-aligned board snapshot */
const CommanderBoardDebug = lazy(() =>
  import("./pages/CommanderBoardDebug.jsx")
);

/* Invoice details (printable invoice) */
const InvoiceDetails = lazy(() =>
  import("./pages/InvoiceDetails.jsx")
);

/* ---------------------- LOGIN EVENT WIRING ---------------------- */
/**
 * Behavior:
 * 1) On app load, if there is already a valid session, log it once.
 * 2) On auth state changes that yield a session (SIGNED_IN, TOKEN_REFRESHED),
 *    log it once per access_token.
 *
 * We also ask Supabase what AAL the session has:
 *  - currentLevel === "aal2" ⇒ MFA used for this session
 */

// Track which access tokens we've already logged (in-memory)
const loggedTokens = new Set();

async function logLoginEventWithMfa(event, session) {
  try {
    if (typeof window === "undefined") return;

    if (!session) {
      console.warn("[main] logLoginEventWithMfa called with no session");
      return;
    }

    const accessToken = session.access_token;
    if (!accessToken) {
      console.warn("[main] Session has no access_token, skipping log");
      return;
    }

    // 🔧 FIX: Add to Set IMMEDIATELY (before async work) to prevent race condition
    // Both getSession() and onAuthStateChange fire nearly simultaneously on page load.
    // If we wait until after the fetch, both calls pass the .has() check.
    if (loggedTokens.has(accessToken)) {
      console.log(
        "[main] Already logged/logging event for this access_token, skipping:",
        event
      );
      return;
    }
    
    // Mark as "in progress" immediately to block concurrent calls
    loggedTokens.add(accessToken);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      console.warn(
        "[main] VITE_SUPABASE_URL not set; cannot call log-login-event."
      );
      return;
    }

    // Ask Supabase what MFA assurance level this session has
    const { data: aalData, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      console.warn(
        "[main] getAuthenticatorAssuranceLevel error:",
        aalError.message || aalError
      );
    }

    const currentLevel = aalData?.currentLevel ?? null;
    // Supabase sets currentLevel === "aal2" when TOTP/WebAuthn was used
    const mfa_used = currentLevel === "aal2";

    console.log("[main] Logging login event with MFA flag:", {
      event,
      currentLevel,
      mfa_used,
    });

    const endpoint = `${supabaseUrl}/functions/v1/log-login-event`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        event,
        currentLevel,
        mfa_used,
        // ip, user_agent, org_id, etc. are resolved server-side
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => null);
      console.warn(
        "[main] log-login-event returned non-200:",
        res.status,
        text
      );
      // Note: We keep the token in the Set even on failure to prevent retry storms.
      // If you want retries, you'd need a more sophisticated approach.
    }
  } catch (err) {
    console.error("[main] Failed to log login event:", err);
    // Note: Token stays in Set to prevent retry loops on persistent errors
  }
}

if (typeof window !== "undefined") {
  // 🔑 Preload org feature flags once we're in the browser
  loadOrgFeatures();

  // 1) On initial load, log the current session (if any)
  supabase.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        console.warn("[main] getSession error:", error.message);
        return;
      }
      if (data?.session) {
        console.log(
          "[main] Found existing session, logging login event (INITIAL_SESSION)."
        );
        logLoginEventWithMfa("INITIAL_SESSION", data.session);
      }
    })
    .catch((e) => {
      console.warn("[main] getSession threw:", e);
    });

  // 2) On auth state changes, log SIGNED_IN and TOKEN_REFRESHED events
  supabase.auth.onAuthStateChange((event, session) => {
    console.log(
      "[main] Auth state change:",
      event,
      "hasSession:",
      !!session
    );

    if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
      logLoginEventWithMfa(event, session);
    }
  });
}
/* --------------------------------------------------------------- */

/** MFA Gate – forces a TOTP code when the session *should* be aal2 */
function MfaGate({ children }) {
  const [ready, setReady] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [factorId, setFactorId] = useState(null);
  const [challengeId, setChallengeId] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        // If no session, nothing to do
        const { data: sessData } = await supabase.auth.getSession();
        if (!sessData?.session) {
          setReady(true);
          return;
        }

        // 1) Check AAL
        const { data, error } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) throw error;

        // User has a factor enrolled but hasn't verified it this session
        if (data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
          // 2) Pick a TOTP factor and create a challenge
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const totp = (factors?.totp || []).find(
            (f) => f.status === "verified"
          );
          if (!totp) {
            setReady(true);
            return;
          }

          const { data: challenge, error: chErr } =
            await supabase.auth.mfa.challenge({ factorId: totp.id });
          if (chErr) throw chErr;

          setFactorId(totp.id);
          setChallengeId(challenge.id);
          setNeedsMfa(true);
        }
      } catch (e) {
        console.error("[MfaGate] Error while checking AAL:", e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  async function handleVerify(e) {
    e.preventDefault();
    setError("");
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: code.trim(),
      });
      if (error) throw error;

      // Mark MFA as satisfied for this session
      setNeedsMfa(false);

      // Optionally log a specific "MFA challenge succeeded" event
      const { data: sessData } = await supabase.auth.getSession();
      if (sessData?.session) {
        await logLoginEventWithMfa(
          "MFA_CHALLENGE_SUCCEEDED",
          sessData.session
        );
      }
    } catch (e) {
      console.error("[MfaGate] verify failed", e);
      setError(e.message || "Invalid code. Try again.");
    }
  }

  if (!ready) return null; // wait until AAL check is done

  if (needsMfa) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <form
          onSubmit={handleVerify}
          className="rounded-2xl border border-white/10 bg-slate-900/90 p-6 w-full max-w-md space-y-4"
        >
          <h1 className="text-xl font-semibold text-white">
            Enter your 2FA code
          </h1>
          <p className="text-sm text-gray-400">
            Open your authenticator app and enter the 6-digit code for Atlas
            Command.
          </p>
          {/* 🔧 FIX: Changed border.white/20 → border-white/20 */}
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-white tracking-[0.3em]"
            placeholder="123456"
          />
          {error && (
            <p className="text-xs text-red-400 bg-red-950/40 rounded-md px-2 py-1">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 py-2 text-sm font-medium text-white"
          >
            Verify &amp; Continue
          </button>
        </form>
      </div>
    );
  }

  // ✅ Either no MFA enrolled, or it's already verified for this session
  return children;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SettingsProvider>
          <ErrorBoundary>
            <Suspense fallback={null}>
              <Routes>
                {/* PUBLIC ROUTES */}
                <Route path="/auth" element={<Navigate to="/login" replace />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />

                {/* ONBOARDING ROUTE */}
                <Route
                  path="/complete-account"
                  element={
                    <AuthGuard>
                      <CompleteAccount />
                    </AuthGuard>
                  }
                />

                {/* PROTECTED ROUTES */}
                <Route
                  path="/"
                  element={
                    <AuthGuard>
                      <OrgBootstrapGate>
                        <MainLayout />
                      </OrgBootstrapGate>
                    </AuthGuard>
                  }
                >
                  <Route index element={<Dashboard />} />

                  {/* Ops */}
                  <Route path="loads" element={<Loads />} />
                  <Route path="loads/:id" element={<LoadDetails />} />
                  <Route path="load-drafts" element={<LoadDrafts />} />
                  <Route path="in-transit" element={<InTransit />} />
                  <Route path="delivered" element={<Delivered />} />
                  <Route path="drivers" element={<Drivers />} />
                  <Route path="drivers/:id" element={<DriverDetail />} />
                  <Route path="trucks" element={<Trucks />} />
                  <Route path="trucks/:id" element={<TruckProfile />} />
                  <Route path="customers" element={<Customers />} />
                  <Route path="customers/:id" element={<CustomerDetail />} />
                  <Route path="documents" element={<Documents />} />
                  <Route path="lanetraining" element={<LaneTraining />} />
                  <Route path="LaneTraining/:id" element={<LaneTraining />} />
                  <Route path="sales" element={<Sales />} />

                  {/* Fleet Map */}
                  <Route path="fleet-map" element={<FleetMap />} />

                  {/* Commander Board Debug (truth-aligned board snapshot) */}
                  <Route
                    path="debug/board"
                    element={<CommanderBoardDebug />}
                  />

                  {/* Trust & Legal */}
                  <Route path="trust-center" element={<TrustCenter />} />
                  <Route path="privacy" element={<PrivacyPolicy />} />

                  {/* Learning */}
                  <Route path="learning" element={<DriverLearning />} />

                  {/* Accounting */}
                  <Route path="billing" element={<Billing />} />
                  <Route
                    path="billing/subscription"
                    element={<BillingSubscription />}
                  />
                  <Route
                    path="driver-settlements"
                    element={<DriverSettlements />}
                  />
                  <Route
                    path="invoices/:invoiceId"
                    element={<InvoiceDetails />}
                  />

                  {/* AI */}
                  <Route path="dispatch-ai" element={<DispatchAI />} />
                  <Route path="ai" element={<AIRecommendations />} />
                  <Route
                    path="ai-recommendations"
                    element={<AIRecommendations />}
                  />
                  <Route path="ai-insights" element={<AIInsights />} />
                  <Route path="ai-lab-proof" element={<AILabProof />} />
                  <Route path="audit" element={<Audit />} />
                  <Route path="ai/lanes" element={<AiLaneIntelligence />} />

                  {/* Admin */}
                  <Route path="/faq-test" element={<FaqTestPanel />} />
                  <Route
                    path="admin/driver-learning-test"
                    element={<DriverLearningTest />}
                  />
                  <Route path="super-admin" element={<SuperAdmin />} />
                  <Route path="financials" element={<Financials />} />
                  <Route
                  path="admin/dipsy-training-review"
                  element={<DipsyTrainingReview />}
                  />
                 <Route path="admin">
                 <Route path="driver-learning-test" element={<DriverLearningTest />} />
                 <Route path="dipsy-training-review" element={<DipsyTrainingReview />} />
                 <Route path="dipsy-quality" element={<DipsyQualityDashboard />} />  {/* ← Add */}
                 </Route>

                  {/* User settings */}
                  <Route path="profile" element={<Profile />} />
                  <Route
                    path="settings/appearance"
                    element={<Appearance />}
                  />
                  <Route
                    path="settings/notifications"
                    element={<Notifications />}
                  />
                  <Route
                    path="settings/integrations"
                    element={<Integrations />}
                  />
                  <Route path="settings/security" element={<Security />} />
                  <Route
                    path="settings/whatsapp"
                    element={<WhatsAppContacts />}
                  />
                  <Route path="teammanagement" element={<TeamManagement />} />

                  {/* Notifications Inbox */}
                  <Route path="notifications" element={<NotificationsInbox />} />

                  {/* Motive OAuth callback (protected) */}
                  <Route
                    path="integrations/motive/callback"
                    element={<MotiveOAuthCallback />}
                  />

                  {/* Redirect legacy settings */}
                  <Route
                    path="settings"
                    element={<Navigate to="/profile" replace />}
                  />

                  <Route path="activity" element={<Activity />} />

                  {/* Catch-all */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </SettingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

if (import.meta.env.DEV) {
  attachDipsyBoardTester();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <MfaGate>
      <AppRoutes />
    </MfaGate>
    <Analytics />
  </StrictMode>
);