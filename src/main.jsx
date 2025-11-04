import React, { StrictMode, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import "./index.css";
import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { SettingsProvider } from "./context/SettingsProvider.jsx";
import { ThemeProvider } from "./context/ThemeProvider.jsx";
import AuthGuard from "./components/AuthGuard.jsx";
import { supabase } from './lib/supabase.js';

/* ---------------------------- Direct imports (no lazy) -------------------- */
import Dashboard from "./pages/Dashboard.jsx";
import Loads from "./pages/Loads.jsx";
import InTransit from "./pages/InTransit.jsx";
import Delivered from "./pages/Delivered.jsx";
import ProblemBoard from "./pages/ProblemBoard.jsx";
import Activity from "./pages/Activity.jsx";
import Settings from "./pages/Settings.jsx";
import Trucks from "./pages/Trucks.jsx";
import Drivers from "./pages/Drivers.jsx";
import Users from "./pages/Users.jsx";
import Login from "./pages/Login.jsx";
import AuthCallback from "./pages/AuthCallback.jsx";
import SetPassword from "./pages/SetPassword.jsx";

/* ----------------------------- Auth Context ------------------------------- */
export const AuthContext = React.createContext({ session: null, loading: true });

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

/* ----------------------------- Render to DOM ------------------------------ */
ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <SettingsProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/set-password" element={<SetPassword />} />
                
                {/* Temporary onboarding placeholder */}
                <Route 
                  path="/onboarding" 
                  element={
                    <div className="p-6">
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900 dark:bg-amber-950">
                        <h2 className="text-lg font-semibold mb-2">Onboarding Required</h2>
                        <p className="text-sm mb-4">Your profile is missing a full_name.</p>
                        <p className="text-sm font-mono text-xs">
                          Run: UPDATE users SET full_name = 'Your Name' WHERE id = 'your-user-id';
                        </p>
                      </div>
                    </div>
                  } 
                />

                {/* Protected routes with MainLayout */}
                <Route element={<MainLayout />}>
                  <Route
                    path="/"
                    element={
                      <AuthGuard>
                        <Dashboard />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/loads"
                    element={
                      <AuthGuard>
                        <Loads />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/in-transit"
                    element={
                      <AuthGuard>
                        <InTransit />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/delivered"
                    element={
                      <AuthGuard>
                        <Delivered />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/problem-board"
                    element={
                      <AuthGuard>
                        <ProblemBoard />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/activity"
                    element={
                      <AuthGuard>
                        <Activity />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <AuthGuard>
                        <Settings />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/trucks"
                    element={
                      <AuthGuard>
                        <Trucks />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/drivers"
                    element={
                      <AuthGuard>
                        <Drivers />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/users"
                    element={
                      <AuthGuard>
                        <Users />
                      </AuthGuard>
                    }
                  />
                </Route>

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </SettingsProvider>
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>
);