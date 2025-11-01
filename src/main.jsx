// src/main.jsx
import React, { StrictMode, Suspense, lazy, useEffect } from "react";
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

/* ---------------------------- Lazy-loaded pages --------------------------- */
const Dashboard    = lazy(() => import("./pages/Dashboard.jsx"));
const Loads        = lazy(() => import("./pages/Loads.jsx"));
const InTransit    = lazy(() => import("./pages/InTransit.jsx"));
const Delivered    = lazy(() => import("./pages/Delivered.jsx"));
const ProblemBoard = lazy(() => import("./pages/ProblemBoard.jsx"));
const Activity     = lazy(() => import("./pages/Activity.jsx"));
const Settings     = lazy(() => import("./pages/Settings.jsx"));
const Trucks       = lazy(() => import("./pages/Trucks.jsx"));
const Drivers      = lazy(() => import("./pages/Drivers.jsx"));
const AdminAudit   = lazy(() => import("./pages/AdminAudit.jsx"));
const NotFound     = lazy(() => import("./pages/NotFound.jsx"));
const Users        = lazy(() => import("./pages/Users.jsx")); // 👈 add this

/* ------------------------------- Utilities -------------------------------- */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    try { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }
    catch { window.scrollTo(0, 0); }
  }, [pathname]);
  return null;
}

function Fallback() {
  return (
    <div className="w-full min-h-[40vh] grid place-items-center">
      <div className="flex items-center gap-3 text-sm opacity-80">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
        </svg>
        <span>Loading…</span>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/loads" element={<Loads />} />
          <Route path="/in-transit" element={<InTransit />} />
          <Route path="/delivered" element={<Delivered />} />
          <Route path="/problems" element={<ProblemBoard />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/trucks" element={<Trucks />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
          <Route path="/users" element={<Users />} /> {/* 👈 add this */}
          <Route path="*" element={<NotFound />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/onboarding" element={<Onboarding />} />

        </Route>
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <ScrollToTop />
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </SettingsProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
