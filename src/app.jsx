// src/app.jsx
import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layout/MainLayout.jsx";
import AuthGuard from "./components/AuthGuard.jsx";

const Dashboard    = lazy(() => import("./pages/Dashboard.jsx"));
const Loads        = lazy(() => import("./pages/Loads.jsx"));
const InTransit    = lazy(() => import("./pages/InTransit.jsx"));
const Delivered    = lazy(() => import("./pages/Delivered.jsx"));
const Billing      = lazy(() => import("./pages/Billing.jsx"));
const Settings     = lazy(() => import("./pages/Settings.jsx"));

const Login        = lazy(() => import("./pages/Login.jsx"));
const Signup       = lazy(() => import("./pages/Signup.jsx"));
const AuthCallback = lazy(() => import("./pages/AuthCallback.jsx"));
const SetPassword  = lazy(() => import("./pages/SetPassword.jsx")); // if you have it

function Fallback() {
  return (
    <div className="min-h-screen grid place-items-center text-white/80">
      <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md px-6 py-4">
        Loading…
      </div>
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        {/* PUBLIC */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/set-password" element={<SetPassword />} />

        {/* PROTECTED */}
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
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* CATCH-ALL */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
