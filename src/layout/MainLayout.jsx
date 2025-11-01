// src/layout/MainLayout.jsx
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
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

  useEffect(() => {
    try {
      localStorage.setItem("sb:collapsed", JSON.stringify(collapsed));
    } catch {}
  }, [collapsed]);

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-slate-100">
      <div className="relative flex min-h-screen">
        <Sidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
        />

        {/* Main content column */}
        <div className="flex min-h-screen flex-1 flex-col">
          <Topbar onOpenSidebar={() => setMobileOpen(true)} />
          <main className="p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
