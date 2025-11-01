import React, { StrictMode, Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

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
const Users        = lazy(() => import("./pages/Users.jsx"));       // ✅ new Users page

/* ----------------------------- Auth / Utility ----------------------------- */
const AuthCallback = lazy(() => import("./pages/AuthCallback.jsx"));
const Onboarding   = lazy(() => import("./pages/Onboarding.jsx"));
const NotFound     = lazy(() => import("./pages/NotFound.jsx")); // optional

/* ------------------------------ Root App ---------------------------------- */
function App() {
  return (
    <StrictMode>
      <SettingsProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="grid place-items-center min-h-screen text-sm opacity-70">
                  Loading interface…
                </div>
              }
            >
              <Routes>
                {/* -------------------- Public Auth Routes -------------------- */}
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/onboarding" element={<Onboarding />} />

                {/* -------------------- Main Application -------------------- */}
                <Route path="/" element={<MainLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="loads" element={<Loads />} />
                  <Route path="in-transit" element={<InTransit />} />
                  <Route path="delivered" element={<Delivered />} />
                  <Route path="problem-board" element={<ProblemBoard />} />
                  <Route path="activity" element={<Activity />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="trucks" element={<Trucks />} />
                  <Route path="drivers" element={<Drivers />} />
                  <Route path="users" element={<Users />} /> {/* ✅ Users route inside MainLayout */}
                </Route>

                {/* ------------------------ Catch-all ------------------------ */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </SettingsProvider>
    </StrictMode>
  );
}

/* ------------------------------ Mount App -------------------------------- */
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
