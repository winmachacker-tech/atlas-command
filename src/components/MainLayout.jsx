// src/layout/MainLayout.jsx
import { Outlet, NavLink } from "react-router-dom";

export default function MainLayout() {
  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-slate-100">
      <div className="relative flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden md:block w-64 shrink-0 border-r border-zinc-200/60 dark:border-neutral-800">
          <div className="p-4 font-semibold text-lg">Atlas Command</div>
          <nav className="px-3 py-2 space-y-1">
            <Item to="/dashboard" label="Dashboard" />
            <Item to="/loads" label="Loads" />
            <Item to="/activity" label="Activity" />
            <Item to="/settings" label="Settings" />
          </nav>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function Item({ to, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "block rounded-lg px-3 py-2 text-sm",
          isActive
            ? "bg-zinc-200/70 dark:bg-neutral-800 font-semibold"
            : "hover:bg-zinc-100 dark:hover:bg-neutral-900",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

function Topbar() {
  return (
    <div className="sticky top-0 z-10 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-zinc-200/60 dark:border-neutral-800">
      <div className="h-14 flex items-center justify-between px-4">
        <div className="font-medium">Command Center</div>
        <div className="text-xs text-zinc-500">v0.1 • Dev</div>
      </div>
    </div>
  );
}
// Ready for the next step?
