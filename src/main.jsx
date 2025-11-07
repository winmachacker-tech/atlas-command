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
const LoadDetails    = lazy(() => import("./pages/LoadDetails.jsx"));
const InTransit      = lazy(() => import("./pages/InTransit.jsx"));
const Delivered      = lazy(() => import("./pages/Delivered.jsx"));
const Activity       = lazy(() => import("./pages/Activity.jsx"));
const Settings       = lazy(() => import("./pages/Settings.jsx"));
const Trucks         = lazy(() => import("./pages/Trucks.jsx"));
const TruckProfile   = lazy(() => import("./pages/TruckProfile.jsx"));
const Drivers        = lazy(() => import("./pages/Drivers.jsx"));
const DriverDetail   = lazy(() => import("./pages/DriverDetail.jsx"));
const Billing        = lazy(() => import("./pages/Billing.jsx"));
const TeamManagement = lazy(() => import("./pages/TeamManagement.jsx"));
const Profile        = lazy(() => import("./pages/Profile.jsx"));
const Appearance     = lazy(() => import("./pages/Appearance.jsx"));
const Integrations   = lazy(() => import("./pages/Integrations.jsx"));
const Security       = lazy(() => import("./pages/Security.jsx"));
const Notifications  = lazy(() => import("./pages/Notifications.jsx").catch(() => ({ default: () => <div className="p-6">Notifications page coming soon</div> })));
const Login          = lazy(() => import("./pages/Login.jsx"));
const Signup         = lazy(() => import("./pages/Signup.jsx"));

// ✅ NEW: Add Dispatch AI page
const DispatchAI     = lazy(() => import("./pages/DispatchAI.jsx").catch(() => ({ default: () => <div className="p-6">Dispatch AI (Lab) - Coming soon</div> })));

function AppRoutes() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SettingsProvider>
          <ErrorBoundary>
            <Suspense fallback={null}>
              <Routes>
                {/* PUBLIC ROUTES - No Auth Required */}
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />

                {/* PROTECTED ROUTES - Auth Required */}
                <Route path="/" element={<AuthGuard><MainLayout /></AuthGuard>}>
                  {/* Home */}
                  <Route index element={<Dashboard />} />

                  {/* Ops */}
                  <Route path="loads" element={<Loads />} />
                  <Route path="loads/:id" element={<LoadDetails />} />
                  <Route path="in-transit" element={<InTransit />} />
                  <Route path="delivered" element={<Delivered />} />
                  <Route path="drivers" element={<Drivers />} />
                  <Route path="drivers/:id" element={<DriverDetail />} />
                  <Route path="trucks" element={<Trucks />} />
                  <Route path="trucks/:id" element={<TruckProfile />} />

                  {/* Accounting */}
                  <Route path="billing" element={<Billing />} />

                  {/* ✅ NEW: AI Tools */}
                  <Route path="dispatch-ai" element={<DispatchAI />} />

                  {/* Settings & Admin - Each has its own route */}
                  <Route path="profile" element={<Profile />} />
                  <Route path="settings/appearance" element={<Appearance />} />
                  <Route path="settings/notifications" element={<Notifications />} />
                  <Route path="settings/integrations" element={<Integrations />} />
                  <Route path="settings/security" element={<Security />} />
                  <Route path="teammanagement" element={<TeamManagement />} />
                  
                  {/* Legacy settings route - redirect to profile */}
                  <Route path="settings" element={<Navigate to="/profile" replace />} />
                  <Route path="settings/*" element={<Navigate to="/profile" replace />} />

                  {/* Misc */}
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>
);