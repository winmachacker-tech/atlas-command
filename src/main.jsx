// src/main.jsx
import React, { StrictMode, Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import "./index.css";
import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { SettingsProvider } from "./context/SettingsProvider.jsx";
import AuthGuard from "./components/AuthGuard.jsx";

/* ---------------------------- Lazy-loaded pages --------------------------- */
const Dashboard     = lazy(() => import("./pages/Dashboard.jsx"));
const Loads         = lazy(() => import("./pages/Loads.jsx"));
const InTransit     = lazy(() => import("./pages/InTransit.jsx"));
const Delivered     = lazy(() => import("./pages/Delivered.jsx"));
const ProblemBoard  = lazy(() => import("./pages/ProblemBoard.jsx"));
const Activity      = lazy(() => import("./pages/Activity.jsx"));
const Settings      = lazy(() => import("./pages/Settings.jsx"));
const Trucks        = lazy(() => import("./pages/Trucks.jsx"));
const Drivers       = lazy(() => import("./pages/Drivers.jsx"));
const Users         = lazy(() => import("./pages/Users.jsx"));
const Login         = lazy(() => import("./pages/Login.jsx"));
const SetPassword   = lazy(() => import("./pages/SetPassword.jsx"));
const AuthCallback  = lazy(() => import("./pages/AuthCallback.jsx"));
const Onboarding    = lazy(() => import("./pages/Onboarding.jsx"));
const NotFound      = lazy(() => import("./pages/NotFound.jsx"));

/* ------------------------------- Utilities -------------------------------- */
function ScrollToTop() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    try { window.scrollTo({ top: 0, behavior: "instant" }); } catch { window.scrollTo(0, 0); }
  }, [pathname]);
  return null;
}

/**
 * HashAuthBridge
 * If Supabase drops us on "/#access_token=..." (implicit flow),
 * immediately forward that hash to "/auth/callback".
 */
function HashAuthBridge() {
  React.useEffect(() => {
    const { pathname, hash } = window.location;
    if (
      pathname === "/" &&
      hash &&
      /access_token|refresh_token|type=recovery|code=/i.test(hash)
    ) {
      // preserve the entire hash when forwarding
      window.location.replace(`/auth/callback${hash}`);
    }
  }, []);
  return null;
}

/* --------------------------------- App ------------------------------------ */
function AppRoutes() {
  return (
    <BrowserRouter basename="/">
      <HashAuthBridge />
      <ScrollToTop />
      <ErrorBoundary>
        <Routes>
          {/* ------------------------ Public / Auth routes ------------------------ */}
          <Route path="/login" element={<Suspense fallback={null}><Login /></Suspense>} />
          <Route path="/set-password" element={<Suspense fallback={null}><SetPassword /></Suspense>} />
          <Route path="/auth/callback" element={<Suspense fallback={null}><AuthCallback /></Suspense>} />

          {/* ---------------- Onboarding (must be authenticated) ----------------- */}
          <Route
            path="/onboarding"
            element={
              <AuthGuard>
                <Suspense fallback={null}><Onboarding /></Suspense>
              </AuthGuard>
            }
          />

          {/* -------------------------- Protected app ---------------------------- */}
          <Route
            path="/"
            element={
              <AuthGuard>
                <MainLayout />
              </AuthGuard>
            }
          >
            <Route index element={<Suspense fallback={null}><Dashboard /></Suspense>} />
            <Route path="loads" element={<Suspense fallback={null}><Loads /></Suspense>} />
            <Route path="in-transit" element={<Suspense fallback={null}><InTransit /></Suspense>} />
            <Route path="delivered" element={<Suspense fallback={null}><Delivered /></Suspense>} />
            <Route path="problem-board" element={<Suspense fallback={null}><ProblemBoard /></Suspense>} />
            <Route path="activity" element={<Suspense fallback={null}><Activity /></Suspense>} />
            <Route path="settings" element={<Suspense fallback={null}><Settings /></Suspense>} />
            <Route path="trucks" element={<Suspense fallback={null}><Trucks /></Suspense>} />
            <Route path="drivers" element={<Suspense fallback={null}><Drivers /></Suspense>} />
            {/* Users at BOTH /users and /admin/users */}
            <Route path="users" element={<Suspense fallback={null}><Users /></Suspense>} />
            <Route path="admin/users" element={<Suspense fallback={null}><Users /></Suspense>} />
          </Route>

          {/* ------------------------------- 404 --------------------------------- */}
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Suspense fallback={null}><NotFound /></Suspense>} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

/* --------------------------------- Mount ---------------------------------- */
ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SettingsProvider>
      <AppRoutes />
    </SettingsProvider>
  </StrictMode>
);
