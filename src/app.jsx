// src/app.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import MainLayout from "./layout/MainLayout.jsx";
import AuthGuard from "./components/AuthGuard.jsx";

/* Pages */
import Dashboard from "./pages/Dashboard.jsx";
import Loads from "./pages/Loads.jsx";
import InTransit from "./pages/InTransit.jsx";
import Delivered from "./pages/Delivered.jsx";
import Billing from "./pages/Billing.jsx"; // ✅ Billing
import Activity from "./pages/Activity.jsx";
import Users from "./pages/Users.jsx";
import Settings from "./pages/Settings.jsx";

/**
 * Router only. No providers or theme changes here.
 * Adds a TOP-LEVEL /billing route (outside layout) so it always resolves,
 * and also keeps the nested one under MainLayout for consistency.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ Bulletproof: direct /billing route */}
        <Route path="/billing" element={<Billing />} />

        {/* App routes under layout/auth */}
        <Route
          element={
            <AuthGuard>
              <MainLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="/loads" element={<Loads />} />
          <Route path="/in-transit" element={<InTransit />} />
          <Route path="/delivered" element={<Delivered />} />
          {/* ✅ Keep nested too (either will work) */}
          <Route path="/billing" element={<Billing />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
