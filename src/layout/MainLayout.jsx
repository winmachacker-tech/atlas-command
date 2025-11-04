// src/layout/MainLayout.jsx
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  LayoutDashboard,
  Boxes,
  Truck,
  CheckCircle2,
  TriangleAlert,
  Activity as ActivityIcon,
  Settings as SettingsIcon,
  Users as UsersIcon,
  LogOut,
  Receipt, // ✅ Added Billing icon
} from "lucide-react";

import { supabase } from "../lib/supabase";
import GlobalThemeFix from "../GlobalThemeFix.jsx";
import ThemeSwitcher from "../components/ThemeSwitcher.jsx";
import DiagnosticsOverlay from "../components/DiagnosticsOverlay.jsx";

/* -------------------------------- Utilities ------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function useActive(path) {
  const location = useLocation();
  const exact = location.pathname === path;
  const starts = location.pathname.startsWith(path + "/");
  return exact || starts;
}

/* ---------------------------------- API ----------------------------------- */
async function fetchIsAdmin(userId) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.role || "").toUpperCase() === "ADMIN";
  } catch (e) {
    console.warn("[MainLayout] fetchIsAdmin error:", e?.message || e);
    return false;
  }
}

/* --------------------------------- Layout --------------------------------- */
export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      if (data.session?.user?.id) {
        fetchIsAdmin(data.session.user.id).then((a) => mounted && setIsAdmin(a));
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess ?? null);
      if (sess?.user?.id) {
        fetchIsAdmin(sess.user.id).then(setIsAdmin);
      } else {
        setIsAdmin(false);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  async function signOut() {
    try {
      await supabase.auth.signOut();
      navigate("/login");
    } catch (e) {
      console.error("signOut error:", e);
    }
  }

  return (
    <div className="min-h-screen" data-brand-applied>
      <GlobalThemeFix />

      <div className="mx-auto grid min-h-screen w-full grid-cols-[260px_1fr] lg:grid-cols-[280px_1fr]">
        {/* --------------------------- Sidebar --------------------------- */}
        <aside className="hidden h-screen flex-col border-r border-white/10 bg-[var(--bg-surface,#171c26)] p-4 md:flex">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-indigo-400" />
              <div className="text-lg font-semibold">Atlas Command</div>
            </div>
            <ThemeSwitcher />
          </div>

          <nav className="mt-6 flex-1 space-y-1">
            <NavLink
              to="/"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
              end
            >
              <LayoutDashboard className="h-4 w-4 opacity-90" />
              <span>Dashboard</span>
            </NavLink>

            <NavLink
              to="/loads"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <Boxes className="h-4 w-4 opacity-90" />
              <span>Loads</span>
            </NavLink>

            <NavLink
              to="/in-transit"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <Truck className="h-4 w-4 opacity-90" />
              <span>In Transit</span>
            </NavLink>

            <NavLink
              to="/delivered"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <CheckCircle2 className="h-4 w-4 opacity-90" />
              <span>Delivered</span>
            </NavLink>

            {/* ✅ Added Billing link */}
            <NavLink
              to="/billing"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <Receipt className="h-4 w-4 opacity-90" />
              <span>Billing</span>
            </NavLink>

            <NavLink
              to="/problem-board"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <TriangleAlert className="h-4 w-4 opacity-90" />
              <span>Problem Board</span>
            </NavLink>

            <NavLink
              to="/activity"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <ActivityIcon className="h-4 w-4 opacity-90" />
              <span>Activity</span>
            </NavLink>

            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <SettingsIcon className="h-4 w-4 opacity-90" />
              <span>Settings</span>
            </NavLink>

            <div className="mt-6 text-xs font-semibold uppercase opacity-50">
              Admin
            </div>

            <NavLink
              to="/user-management"
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <UsersIcon className="h-4 w-4 opacity-90" />
              <span>User Management</span>
            </NavLink>
          </nav>

          <div className="mt-auto pt-4">
            <button
              onClick={signOut}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/80 hover:bg-white/5 hover:text-white"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </aside>

        {/* ---------------------------- Main ---------------------------- */}
        <main className="min-h-screen bg-[var(--bg-base,#0f131a)] p-4">
          <DiagnosticsOverlay />
          <div className="mx-auto max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
