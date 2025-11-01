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
const Users        = lazy(() => import("./pages/Users.jsx"));
const AdminAudit   = lazy(() => import("./pages/AdminAudit.jsx"));
const NotFound     = lazy(() => import("./pages/NotFound.jsx"));
const Login        = lazy(() => import("./pages/Login.jsx"));

/* ---------------------------- Scroll to Top ------------------------------- */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ErrorBoundary>
        <SettingsProvider>
          <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
            <Routes>
              {/* Public login route */}
              <Route path="/login" element={<Login />} />

              {/* Guarded app */}
              <Route element={<AuthGuard />}>
                <Route element={<MainLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="dashboard" element={<Dashboard />} />
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

                  {/* Legacy redirect */}
                  <Route path="home" element={<Navigate to="/dashboard" replace />} />

                  {/* In-layout 404 */}
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>

              {/* Global 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </SettingsProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
console.log("🔍 SUPABASE_URL =", import.meta.env.VITE_SUPABASE_URL);
console.log("🔍 FUNCTIONS_URL =", import.meta.env.VITE_FUNCTIONS_URL);

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>
);
