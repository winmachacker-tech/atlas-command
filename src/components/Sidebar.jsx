// src/components/Sidebar.jsx
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  Activity,
  Settings as SettingsIcon,
  Shield,
  X,
  Menu,
} from "lucide-react";

/** Central menu config (add/remove here) */
export const SIDEBAR_ITEMS = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Loads", path: "/loads", icon: Boxes },
  { label: "Activity", path: "/activity", icon: Activity },
  { label: "Users & Roles", path: "/users", icon: Shield }, 
  { label: "Settings", path: "/settings", icon: SettingsIcon },
];

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/**
 * Props:
 * - collapsed: boolean
 * - setCollapsed: fn(boolean)
 * - mobileOpen: boolean
 * - setMobileOpen: fn(boolean)
 */
export default function Sidebar({
  collapsed = false,
  setCollapsed = () => {},
  mobileOpen = false,
  setMobileOpen = () => {},
}) {
  const loc = useLocation();

  const SidebarInner = (
    <div
      className={cx(
        "flex h-full flex-col border-r bg-white/70 backdrop-blur dark:bg-neutral-950/60",
        "border-neutral-200 dark:border-neutral-800"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="h-8 w-8 rounded-xl bg-black dark:bg-white" />
          {!collapsed && (
            <div className="truncate">
              <div className="text-sm font-semibold tracking-wide">
                Atlas Command
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                TMS Control
              </div>
            </div>
          )}
        </div>

        {/* Collapse / Close */}
        <div className="flex items-center gap-2">
          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="inline-flex sm:hidden rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>

          {/* Collapse toggle (desktop) */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden sm:inline-flex rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Toggle collapse"
          >
            <Menu size={18} />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="mt-1 flex-1 space-y-1 px-2">
        {SIDEBAR_ITEMS.map(({ label, path, icon: Icon }) => {
          const active = loc.pathname === path || loc.pathname.startsWith(path + "/");
          return (
            <NavLink
              key={path}
              to={path}
              className={cx(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                active
                  ? "bg-neutral-200/70 text-black dark:bg-neutral-800 text-white"
                  : "text-neutral-700 dark:text-neutral-200"
              )}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} className={cx(active ? "" : "opacity-80")} />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer (version / org) */}
      <div className={cx("mt-auto px-3 py-3 text-xs text-neutral-500 dark:text-neutral-400")}>
        {!collapsed ? (
          <div className="flex items-center justify-between">
            <span>v0.4 • Phoenix</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        ) : (
          <div className="text-center">v0.4</div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cx(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:hidden",
          mobileOpen ? "block" : "hidden"
        )}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar panel */}
      <aside
        className={cx(
          "fixed z-50 h-screen shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/60 backdrop-blur",
          "transition-all duration-200 ease-in-out",
          "sm:static", // becomes static in desktop flow
          collapsed ? "w-[72px]" : "w-64",
          mobileOpen ? "left-0 top-0 sm:translate-x-0" : "left-[-100%] top-0 sm:left-0"
        )}
      >
        {SidebarInner}
      </aside>
    </>
  );
}
