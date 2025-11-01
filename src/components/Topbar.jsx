// src/components/Topbar.jsx
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  Menu,
  Bell,
  Sun,
  Moon,
  Plus,
  UserCircle2,
} from "lucide-react";
import AddLoadModal from "./AddLoadModal"; // optional modal (safe to comment if not ready)

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function Topbar({ onOpenSidebar = () => {} }) {
  const loc = useLocation();
  const [theme, setTheme] = useState(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );
  const [showAddLoad, setShowAddLoad] = useState(false);

  // Map paths to pretty titles
  const titles = {
    "/dashboard": "Dashboard Overview",
    "/loads": "Active Loads",
    "/activity": "Activity Feed",
    "/settings": "System Settings",
    "/users": "Users & Roles",
  };
  const currentTitle = titles[loc.pathname] || "Atlas Command";

  /** Theme toggle handler */
  const toggleTheme = () => {
    if (theme === "dark") {
      document.documentElement.classList.remove("dark");
      setTheme("light");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.add("dark");
      setTheme("dark");
      localStorage.setItem("theme", "dark");
    }
  };

  /** Keep theme in sync with localStorage */
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved) {
      document.documentElement.classList.toggle("dark", saved === "dark");
      setTheme(saved);
    }
  }, []);

  const onLoadsPage = loc.pathname.startsWith("/loads");

  return (
    <>
      <header
        className={cx(
          "flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800",
          "bg-white/70 backdrop-blur dark:bg-neutral-950/60",
          "px-4 sm:px-6 py-3 sticky top-0 z-30"
        )}
      >
        {/* Left side */}
        <div className="flex items-center gap-3">
          {/* Mobile sidebar toggle */}
          <button
            onClick={onOpenSidebar}
            className="sm:hidden inline-flex items-center justify-center rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Open sidebar"
          >
            <Menu size={18} />
          </button>

          {/* Page title */}
          <h1 className="text-lg sm:text-xl font-semibold tracking-tight">
            {currentTitle}
          </h1>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Add Load button only on Loads page */}
          {onLoadsPage && (
            <>
              <button
                onClick={() => setShowAddLoad(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-black text-white px-3 py-2 text-sm font-medium hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
                title="Add new load"
              >
                <Plus size={16} /> Add Load
              </button>
            </>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Notifications */}
          <button
            className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Notifications"
          >
            <Bell size={18} />
          </button>

          {/* User profile */}
          <button
            className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Profile"
          >
            <UserCircle2 size={20} />
          </button>
        </div>
      </header>

      {/* Optional modal (safe to remove if not built yet) */}
      {showAddLoad && (
        <AddLoadModal open={showAddLoad} onClose={() => setShowAddLoad(false)} />
      )}
    </>
  );
}
