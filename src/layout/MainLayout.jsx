// src/layout/MainLayout.jsx
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import useRequirePasswordSetup from "../hooks/useRequirePasswordSetup";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sb:collapsed") || "false");
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Force invited users to set a password before using the app
  const { loading } = useRequirePasswordSetup();
  useEffect(() => {
    try {
      localStorage.setItem("sb:collapsed", JSON.stringify(collapsed));
    } catch {}
  }, [collapsed]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-slate-100">
      <div className="relative flex min-h-screen">
        {/* Sidebar */}
        <aside className="shrink-0">
          <Sidebar
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            mobileOpen={mobileOpen}
            setMobileOpen={setMobileOpen}
          />
        </aside>

        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          <Topbar
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            mobileOpen={mobileOpen}
            setMobileOpen={setMobileOpen}
          />

          <main className="p-4 md:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
