// src/main.jsx
import "./styles/dark-bridge.css";
import React, { StrictMode, Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";


/* Shell / providers / guards */
import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { SettingsProvider } from "./context/SettingsProvider.jsx";
import AuthGuard from "./components/AuthGuard.jsx";

/* Theme */
import { ThemeProvider } from "./context/ThemeProvider.jsx";

/* Lazy pages */
const Dashboard      = lazy(() => import("./pages/Dashboard.jsx"));
const Loads          = lazy(() => import("./pages/Loads.jsx"));
const InTransit      = lazy(() => import("./pages/InTransit.jsx"));
const Delivered      = lazy(() => import("./pages/Delivered.jsx"));
const Activity       = lazy(() => import("./pages/Activity.jsx"));
const Settings       = lazy(() => import("./pages/Settings.jsx"));
const Trucks         = lazy(() => import("./pages/Trucks.jsx"));
const Drivers        = lazy(() => import("./pages/Drivers.jsx"));
const Users          = lazy(() => import("./pages/Users.jsx"));
const Login          = lazy(() => import("./pages/Login.jsx"));
const Signup         = lazy(() => import("./pages/Signup.jsx"));
const AuthCallback   = lazy(() => import("./pages/AuthCallback.jsx"));
const SetPassword    = lazy(() => import("./pages/SetPassword.jsx"));
const Billing        = lazy(() => import("./pages/Billing.jsx"));
const InvoiceDraft   = lazy(() => import("./pages/InvoiceDraft.jsx"));
const TeamManagement = lazy(() => import("./pages/TeamManagement.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));

/* Settings nested layout */
import SettingsLayout from "./components/settings/SettingsLayout";

/**
 * NOTE:
 * We intentionally avoid importing "./pages/settings/ProfileSettings"
 * (the file was removed during cleanup). This inline stub preserves the
 * existing route structure without breaking builds.
 */
const ProfileSettings = function ProfileSettingsStub() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="text-sm opacity-70 mt-1">
        Settings subpages were removed. This is a placeholder to keep routes stable.
      </p>
    </div>
  );
};

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
        {/* PUBLIC */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/profile" element={<AuthGuard><Profile /></AuthGuard>} />

        {/* PROTECTED */}
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
          <Route path="activity" element={<ErrorBoundary><Activity /></ErrorBoundary>} />
          <Route path="trucks" element={<ErrorBoundary><Trucks /></ErrorBoundary>} />
          <Route path="drivers" element={<ErrorBoundary><Drivers /></ErrorBoundary>} />
          <Route path="users" element={<ErrorBoundary><Users /></ErrorBoundary>} />

          {/* ✅ TEAM MANAGEMENT */}
          <Route path="teammanagement" element={<ErrorBoundary><TeamManagement /></ErrorBoundary>} />

          {/* Settings (nested) */}
          <Route
            path="settings"
            element={
              <ErrorBoundary>
                <SettingsLayout />
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
