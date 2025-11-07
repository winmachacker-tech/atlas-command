// src/App.jsx
import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layout/MainLayout.jsx";
import AuthGuard from "./components/AuthGuard.jsx";

/** Lazy pages */
const Dashboard      = lazy(() => import("./pages/Dashboard.jsx"));
const Loads          = lazy(() => import("./pages/Loads.jsx"));
const InTransit      = lazy(() => import("./pages/InTransit.jsx"));
const Delivered      = lazy(() =>
  import("./pages/Delivered.jsx").catch(() => ({
    default: () => <div className="p-6">Delivered</div>,
  }))
);
const Billing        = lazy(() => import("./pages/Billing.jsx"));
const Drivers        = lazy(() =>
  import("./pages/Drivers.jsx").catch(() => ({
    default: () => <div className="p-6">Drivers</div>,
  }))
);
const Trucks         = lazy(() =>
  import("./pages/Trucks.jsx").catch(() => ({
    default: () => <div className="p-6">Trucks</div>,
  }))
);
const Settings       = lazy(() => import("./pages/Settings.jsx"));
const TeamManagement = lazy(() => import("./pages/TeamManagement.jsx"));
const Login          = lazy(() =>
  import("./pages/Login.jsx").catch(() => ({
    default: () => <div className="p-6">Login</div>,
  }))
);

/* ✅ NEW: Dispatch AI (Lab) page */
const DispatchAI     = lazy(() => import("./pages/DispatchAI.jsx"));

export default function App() {
  return (
    <Suspense fallback={<div className="p-6 text-sm">Loading…</div>}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />

        {/* Protected layout + routes */}
        <Route
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
          <Route path="billing" element={<Billing />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="trucks" element={<Trucks />} />

          {/* ✅ NEW: Dispatch AI route */}
          <Route path="dispatch-ai" element={<DispatchAI />} />

          {/* ✅ Settings lives as a nested route under the protected layout */}
          <Route path="settings" element={<Settings />} />

          {/* ✅ Team Management canonical route */}
          <Route path="teammanagement" element={<TeamManagement />} />

          {/* (Optional) Old settings paths → redirect */}
          <Route path="settings/team" element={<Navigate to="/teammanagement" replace />} />
          <Route path="settings/team-management" element={<Navigate to="/teammanagement" replace />} />
          <Route path="settings/teams" element={<Navigate to="/teammanagement" replace />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
