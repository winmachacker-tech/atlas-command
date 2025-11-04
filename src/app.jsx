// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SessionContextProvider } from "@supabase/auth-helpers-react";
import { supabase } from "./lib/supabase";

import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import AuthGuard from "./components/AuthGuard.jsx";

/* ---------------------------- Page Imports ---------------------------- */
import Dashboard from "./pages/Dashboard.jsx";
import Loads from "./pages/Loads.jsx";
import InTransit from "./pages/InTransit.jsx";
import Delivered from "./pages/Delivered.jsx";
import ProblemBoard from "./pages/ProblemBoard.jsx";
import Activity from "./pages/Activity.jsx";
import Settings from "./pages/Settings.jsx";
import Users from "./pages/Users.jsx";

/* ------------------------------- App ---------------------------------- */
export default function App() {
  return (
    <SessionContextProvider supabaseClient={supabase}>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            {/* Redirect root */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* Auth-protected app frame */}
            <Route
              element={
                <AuthGuard>
                  <MainLayout />
                </AuthGuard>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/loads" element={<Loads />} />
              <Route path="/in-transit" element={<InTransit />} />
              <Route path="/delivered" element={<Delivered />} />
              <Route path="/problem-board" element={<ProblemBoard />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/users" element={<Users />} />
            </Route>

            {/* 404 fallback */}
            <Route
              path="*"
              element={
                <div className="p-6">
                  <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Page not found
                  </h1>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    The page you’re looking for doesn’t exist.
                  </p>
                </div>
              }
            />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </SessionContextProvider>
  );
}
