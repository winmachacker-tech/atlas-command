// src/app.jsx
import { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// App shell
import MainLayout from "./layout/MainLayout.jsx";

// Pages
import Dashboard from "./pages/Dashboard.jsx";
import Loads from "./pages/Loads.jsx";
import InTransit from "./pages/InTransit.jsx";
import Delivered from "./pages/Delivered.jsx";
import Issues from "./pages/Issues.jsx";
import Users from "./pages/Users.jsx";
import Settings from "./pages/Settings.jsx";
import Onboarding from "./pages/Onboarding.jsx";

function Fallback() {
  return (
    <div className="min-h-dvh grid place-items-center text-[var(--text-base)] bg-[var(--bg-base)]">
      <div className="opacity-70 text-sm">Loading…</div>
    </div>
  );
}

// Tiny test page to prove routing hits exactly what we expect
function IssuesRoutingProbe() {
  return (
    <div className="min-h-dvh grid place-items-center text-[var(--text-base)] bg-[var(--bg-base)]">
      <div className="rounded-xl border border-white/10 bg-[var(--bg-surface)] p-6">
        <div className="text-xl font-semibold">Routing OK</div>
        <div className="text-sm opacity-70 mt-1">
          You reached <code>/__issues_test</code>. Now go to <code>/issues</code> — it should render <code>src/pages/Issues.jsx</code>.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Fallback />}>
        <Routes>
          {/* App shell */}
          <Route path="/" element={<MainLayout />}>
            {/* Default redirect */}
            <Route index element={<Navigate to="/dashboard" replace />} />

            {/* Core pages */}
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="loads" element={<Loads />} />
            <Route path="in-transit" element={<InTransit />} />
            <Route path="delivered" element={<Delivered />} />

            {/* ✅ Issues route (this must match the NavLink) */}
            <Route path="issues" element={<Issues />} />

            <Route path="users" element={<Users />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Public/onboarding (optional) */}
          <Route path="/onboarding" element={<Onboarding />} />

          {/* Temporary probe to verify routing works end-to-end */}
          <Route path="/__issues_test" element={<IssuesRoutingProbe />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
