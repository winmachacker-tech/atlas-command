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
import LoadingScreen from "./components/LoadingScreen.jsx";

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
const Users        = lazy(() => import("./pages/Users.jsx"));
const Login        = lazy(() => import("./pages/Login.jsx"));
const SetPassword  = lazy(() => import("./pages/SetPassword.jsx"));
const AuthCallback = lazy(() => import("./pages/AuthCallback.jsx"));
const NotFound     = lazy(() => import("./pages/NotFound.jsx"));

/* ------------------------------- Scroll Helper ---------------------------- */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/* ----------------------------- Env Debug Logs ----------------------------- */
function PingSupabaseEnv() {
  useEffect(() => {
    console.log("🔍 SUPABASE_URL =", import.meta.env.VITE_SUPABASE_URL);
    console.log("🔍 FUNCTIONS_URL =", import.meta.env.VITE_SUPABASE_FUNCTIONS_URL);
    console.log("🔍 ANON_KEY detected =", !!import.meta.env.VITE_SUPABASE_ANON_KEY);
  }, []);
  return null;
}

/* ---------------------------------- App ----------------------------------- */
function AppRoutes() {
  return (
    <Suspense fallback={<LoadingScreen label="Loading Atlas Command…" />}>
      <ScrollToTop />
      <PingSupabaseEnv />

      <Routes>
        {/* Public / auth routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/auth/*" element={<AuthCallback />} />

        {/* Protected app routes */}
        <Route
          path="/"
          element={
            <AuthGuard>
              <MainLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="dashboard" element={<Navigate to="/" replace />} />

          <Route path="loads" element={<Loads />} />
          <Route path="in-transit" element={<InTransit />} />
          <Route path="delivered" element={<Delivered />} />
          <Route path="problems" element={<ProblemBoard />} />
          <Route path="activity" element={<Activity />} />
          <Route path="users" element={<Users />} />
          <Route path="settings" element={<Settings />} />
          <Route path="trucks" element={<Trucks />} />
          <Route path="drivers" element={<Drivers />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

/* -------------------------------- Bootstrap ------------------------------- */
ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SettingsProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </BrowserRouter>
    </SettingsProvider>
  </StrictMode>
);
