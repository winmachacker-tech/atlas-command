// src/App.jsx
import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layout/MainLayout.jsx";
import AuthGuard from "./components/AuthGuard.jsx";

console.log("App routes version: ai-proof nested");

/** Regular imports for quick test/dev pages */
import DriverLearningTest from "./pages/DriverLearningTest.jsx";
import AIProof from "./pages/AIProof.jsx";

/** Lazy pages (unchanged) */
const Dashboard       = lazy(() => import("./pages/Dashboard.jsx"));
const Loads           = lazy(() => import("./pages/Loads.jsx"));
const InTransit       = lazy(() => import("./pages/InTransit.jsx"));
const Delivered       = lazy(() =>
  import("./pages/Delivered.jsx").catch(() => ({
    default: () => <div className="p-6">Delivered</div>,
  }))
);
const Billing         = lazy(() => import("./pages/Billing.jsx"));
const Drivers         = lazy(() =>
  import("./pages/Drivers.jsx").catch(() => ({
    default: () => <div className="p-6">Drivers</div>,
  }))
);
const Customers       = lazy(() =>
  import("./pages/Customers.jsx").catch(() => ({
    default: () => <div className="p-6">Customers</div>,
  }))
);
const Trucks          = lazy(() =>
  import("./pages/Trucks.jsx").catch(() => ({
    default: () => <div className="p-6">Trucks</div>,
  }))
);
const Settings        = lazy(() => import("./pages/Settings.jsx"));
const TeamManagement  = lazy(() => import("./pages/TeamManagement.jsx"));
const Login           = lazy(() =>
  import("./pages/Login.jsx").catch(() => ({
    default: () => <div className="p-6">Login</div>,
  }))
);

/* Dispatch AI (Lab) */
const DispatchAI      = lazy(() => import("./pages/DispatchAI.jsx"));

/* AI Recommendations page */
const AIRecommendations = lazy(() => import("./pages/AIRecommendations.jsx"));

/* Auth + Callback + onboarding */
const Auth            = lazy(() => import("./pages/Auth.jsx"));
const AuthCallback    = lazy(() => import("./pages/AuthCallback.jsx"));
const CompleteAccount = lazy(() => import("./pages/CompleteAccount.jsx"));
const ForgotPassword  = lazy(() => import("./pages/ForgotPassword.jsx"));
const SetPassword     = lazy(() => import("./pages/SetPassword.jsx"));

/* Driver Learning page */
const DriverLearning  = lazy(() =>
  import("./pages/DriverLearning.jsx").catch(() => ({
    default: () => <div className="p-6">Error loading Driver Learning page</div>,
  }))
);

/* (Optional) Insights page if you have it */
const AIInsights      = lazy(() =>
  import("./pages/AIInsights.jsx").catch(() => ({
    default: () => <div className="p-6">AI Insights</div>,
  }))
);

export default function App() {
  return (
    <Suspense fallback={<div className="p-6 text-sm">Loading…</div>}>
      <Routes>
        {/* ---------- Public routes ---------- */}
        <Route path="/login" element={<Navigate to="/auth" replace />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/complete-account" element={<CompleteAccount />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/dev/driver-learning-test" element={<DriverLearningTest />} />

        {/* ---------- DIAGNOSTIC: top-level ai-proof (no layout) ---------- */}
        {/* This proves the route is matched BEFORE MainLayout. If you hit this and still see Dashboard,
            something else is redirecting. Keep this temporarily while we verify. */}
        <Route
          path="/ai-proof"
          element={
            <AuthGuard loginPath="/auth">
              {/* Render AIProof directly without MainLayout */}
              <AIProof />
            </AuthGuard>
          }
        />

        {/* ---------- Protected routes under MainLayout ---------- */}
        <Route
          path="/"
          element={
            <AuthGuard loginPath="/auth">
              <MainLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Dashboard />} />

          {/* Ops */}
          <Route path="loads" element={<Loads />} />
          <Route path="in-transit" element={<InTransit />} />
          <Route path="delivered" element={<Delivered />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="customers" element={<Customers />} />
          <Route path="trucks" element={<Trucks />} />

          {/* Learning */}
          <Route path="learning" element={<DriverLearning />} />

          {/* AI settings */}
          <Route path="dispatch-ai" element={<DispatchAI />} />
          <Route path="ai" element={<Navigate to="/ai-recommendations" replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="teammanagement" element={<TeamManagement />} />
          <Route path="ai-insights" element={<AIInsights />} />

          {/* Admin segment */}
          <Route path="admin">
            <Route path="driver-learning-test" element={<DriverLearningTest />} />
          </Route>

          {/* Keep nested ai-proof as well (once verified, you can remove one of them) */}
          <Route path="ai-lab-proof" element={<AIProof />} />
        </Route>

        {/* Standalone protected page without MainLayout */}
        <Route
          path="/ai-recommendations"
          element={
            <AuthGuard loginPath="/auth">
              <AIRecommendations />
            </AuthGuard>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}