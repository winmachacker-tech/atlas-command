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
import AuthGuard from "./components/AuthGuard.jsx";

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
const Users        = lazy(() => import("./pages/Users.jsx"));   // your full page we just built
const AdminAudit   = lazy(() => import("./pages/AdminAudit.jsx").catch(() => ({ default: () => <div className="p-6">Admin Audit temporarily unavailable</div> })));
const Login        = lazy(() => import("./pages/Login.jsx"));
const AuthCallback = lazy(() => import("./pages/AuthCallback.jsx")); // just added
const SetPassword  = lazy(() => import("./pages/SetPassword.jsx"));  // just added
const NotFound     = lazy(() => import("./pages/NotFound.jsx").catch(() => ({ default: () => <div className="p-6">Not found</div> })));

/* ------------------------------ Helpers ---------------------------------- */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="p-6 text-sm text-zinc-400">Loading…</div>}>
        <Routes>
          {/* ---------- Public / semi-public routes (NO AuthGuard) ---------- */}
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/set-password" element={<SetPassword />} />

          {/* ----------------------- Protected app ------------------------- */}
          <Route
            path="/"
            element={
              <AuthGuard>
                <MainLayout />
              </AuthGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="loads" element={<Loads />} />
            <Route path="in-transit" element={<InTransit />} />
            <Route path="delivered" element={<Delivered />} />
            <Route path="problem-board" element={<ProblemBoard />} />
            <Route path="activity" element={<Activity />} />
            <Route path="settings" element={<Settings />} />
            <Route path="trucks" element={<Trucks />} />
            <Route path="drivers" element={<Drivers />} />
            <Route path="users" element={<Users />} />
            <Route path="admin/audit" element={<AdminAudit />} />
          </Route>

          {/* ------------------------ Fallbacks ---------------------------- */}
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  // (optional) small env logger to confirm vars at runtime
  useEffect(() => {
    try {
      console.log("🔍 SUPABASE_URL =", import.meta.env.VITE_SUPABASE_URL);
      console.log("🔍 ANON_KEY detected =", !!import.meta.env.VITE_SUPABASE_ANON_KEY);
    } catch {}
  }, []);

  return (
    <StrictMode>
      <SettingsProvider>
        <BrowserRouter>
          <ScrollToTop />
          <AppRoutes />
        </BrowserRouter>
      </SettingsProvider>
    </StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
