// src/main.jsx
import React, { StrictMode, Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

/* Shell / providers / guards */
import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { SettingsProvider } from "./context/SettingsProvider.jsx";
import AuthGuard from "./components/AuthGuard.jsx";
import InvoiceDraft from "./pages/InvoiceDraft.jsx";
/* Theme */
import { ThemeProvider } from "./context/ThemeProvider.jsx";

/* Lazy pages */
const Dashboard    = lazy(() => import("./pages/Dashboard.jsx"));
const Loads        = lazy(() => import("./pages/Loads.jsx"));
const InTransit    = lazy(() => import("./pages/InTransit.jsx"));
const Delivered    = lazy(() => import("./pages/Delivered.jsx"));
const ProblemBoard = lazy(() => import("./pages/ProblemBoard.jsx"));
const Activity     = lazy(() => import("./pages/Activity.jsx"));
const Settings     = lazy(() => import("./pages/Settings.jsx"));
const Trucks       = lazy(() => import("./pages/Trucks.jsx"));
const Drivers      = lazy(() => import("./pages/Drivers.jsx"));
const Users        = lazy(() => import("./pages/Users.jsx"));
const Login        = lazy(() => import("./pages/Login.jsx"));
const AuthCallback = lazy(() => import("./pages/AuthCallback.jsx"));
const SetPassword  = lazy(() => import("./pages/SetPassword.jsx"));
const Billing      = lazy(() => import("./pages/Billing.jsx"));

/* Settings nested layout */
import SettingsLayout from "./components/settings/SettingsLayout";
const ProfileSettings = lazy(() => import("./pages/settings/ProfileSettings"));

/* Fallback */
const Loader = () => (
  <div className="min-h-screen grid place-items-center bg-[#0f1419] text-white">
    <div className="flex items-center gap-3">
      <span className="inline-block w-3 h-3 rounded-full animate-pulse" />
      <span className="inline-block w-3 h-3 rounded-full animate-pulse" />
      <span className="inline-block w-3 h-3 rounded-full animate-pulse" />
      <p className="ml-3 text-sm text-gray-400">Loading…</p>
    </div>
  </div>
);

function AppRoutes() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/set-password" element={<SetPassword />} />

        {/* App */}
        <Route
          path="/"
          element={
            <AuthGuard>
              <MainLayout />
            </AuthGuard>
          }
        >
          {/* Dashboard (default) */}
          <Route
            index
            element={
              <ErrorBoundary>
                <Dashboard />
              </ErrorBoundary>
            }
          />

          {/* Primary sections */}
          <Route path="loads" element={<ErrorBoundary><Loads /></ErrorBoundary>} />
          <Route path="invoices/new/:loadId" element={<ErrorBoundary><InvoiceDraft /></ErrorBoundary>} />
          <Route path="in-transit" element={<ErrorBoundary><InTransit /></ErrorBoundary>} />
          <Route path="delivered" element={<ErrorBoundary><Delivered /></ErrorBoundary>} />
          <Route path="billing" element={<ErrorBoundary><Billing /></ErrorBoundary>} />
          <Route path="problems" element={<ErrorBoundary><ProblemBoard /></ErrorBoundary>} />
          <Route path="activity" element={<ErrorBoundary><Activity /></ErrorBoundary>} />
          <Route path="trucks" element={<ErrorBoundary><Trucks /></ErrorBoundary>} />
          <Route path="drivers" element={<ErrorBoundary><Drivers /></ErrorBoundary>} />
          <Route path="users" element={<ErrorBoundary><Users /></ErrorBoundary>} />

          {/* Settings (nested) */}
          <Route
            path="settings"
            element={
              <ErrorBoundary>
                <AuthGuard>
                  <SettingsLayout />
                </AuthGuard>
              </ErrorBoundary>
            }
          >
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ErrorBoundary><ProfileSettings /></ErrorBoundary>} />
          </Route>

          {/* Optional legacy settings route */}
          <Route path="settings-legacy" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
        </Route>

        {/* 404 -> Dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SettingsProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ThemeProvider>
    </SettingsProvider>
  </StrictMode>
);
