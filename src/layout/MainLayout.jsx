// src/layout/MainLayout.jsx
import { Suspense, useCallback } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Home,
  Truck,
  Send,
  CheckCircle2,
  DollarSign,
  UserRound,
  ClipboardList,
  Settings as SettingsIcon,
  Menu,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import ThemeMenu from "../components/ThemeMenu.jsx";
import { supabase } from "../lib/supabase";

/**
 * Utility: cx() to join classNames conditionally
 */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/**
 * Sidebar link component to keep styles consistent
 */
function SideLink({ to, icon: Icon, children, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 px-3 py-2 rounded-xl transition",
          isActive
            ? "bg-[var(--bg-active)] text-[var(--text-base)]"
            : "text-[var(--text-muted)] hover:bg-white/5"
        )
      }
    >
      <Icon className="h-5 w-5" />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

export default function MainLayout() {
  const navigate = useNavigate();

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      // Non-blocking: keep UX smooth even if signOut throws
      console.error("[MainLayout] signOut error:", err);
    } finally {
      navigate("/login");
    }
  }, [navigate]);

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-base)]">
      {/* ======= App Shell ======= */}
      <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
        {/* ======= Sidebar ======= */}
        <aside className="hidden md:block border-r border-white/10 min-h-dvh">
          <div className="flex h-full flex-col">
            {/* Brand / Title */}
            <div className="flex items-center gap-2 px-4 py-4 border-b border-white/10">
              <ShieldCheck className="h-5 w-5 opacity-80" />
              <div className="flex flex-col leading-tight">
                <span className="font-semibold">Atlas Command</span>
                <span className="text-xs text-[var(--text-muted)]">
                  Operations Console
                </span>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex flex-col gap-1 px-2 py-3">
              <SideLink to="/" end icon={Home}>
                Dashboard
              </SideLink>
              <SideLink to="/loads" icon={Truck}>
                Loads
              </SideLink>
              <SideLink to="/in-transit" icon={Send}>
                In Transit
              </SideLink>
              <SideLink to="/delivered" icon={CheckCircle2}>
                Delivered
              </SideLink>
              <SideLink to="/billing" icon={DollarSign}>
                Billing
              </SideLink>
              <SideLink to="/drivers" icon={UserRound}>
                Drivers
              </SideLink>
              <SideLink to="/trucks" icon={ClipboardList}>
                Trucks
              </SideLink>
              <SideLink to="/settings" icon={SettingsIcon}>
                Settings
              </SideLink>

              {/* Theme menu restored */}
              <div className="border-t border-white/10 my-3" />
              <div className="flex items-center justify-between px-2">
                <span className="text-sm text-[var(--text-muted)]">Theme</span>
                <ThemeMenu />
              </div>
            </nav>

            {/* Sidebar footer */}
            <div className="mt-auto p-3 border-t border-white/10">
              <button
                onClick={signOut}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* ======= Main Area ======= */}
        <main className="min-h-dvh">
          {/* Top bar (mobile + desktop) */}
          <header className="sticky top-0 z-30 border-b border-white/10 backdrop-blur bg-[color-mix(in_oklab,var(--bg-base),transparent_12%)]">
            <div className="flex h-14 items-center justify-between px-3 md:px-5">
              {/* Left side: mobile menu (non-functional placeholder) + title */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="md:hidden inline-flex items-center justify-center rounded-lg p-2 hover:bg-white/5"
                  aria-label="Open Menu"
                  title="Open Menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 opacity-80 md:hidden" />
                  <span className="font-semibold">Atlas Command</span>
                </div>
              </div>

              {/* Right side: quick theme + sign out */}
              <div className="flex items-center gap-2">
                {/* Optional quick ThemeMenu in header for convenience */}
                <div className="md:hidden">
                  <ThemeMenu />
                </div>
                <button
                  onClick={signOut}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </div>
            </div>
          </header>

          {/* Routed content */}
          <section className="p-3 md:p-6">
            <Suspense
              fallback={
                <div className="grid place-items-center py-20 text-[var(--text-muted)]">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 animate-pulse" />
                    <span>Loading…</span>
                  </div>
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </section>
        </main>
      </div>
    </div>
  );
}
