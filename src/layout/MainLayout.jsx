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
  CreditCard,
  LogOut,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import GlobalThemeFix from "../GlobalThemeFix.jsx";
import ThemeSwitcher from "../components/ThemeSwitcher.jsx";
import DiagnosticsOverlay from "../components/DiagnosticsOverlay.jsx";

/* -------------------------------- Utilities ------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function pathActive(location, path) {
  const exact = location.pathname === path;
  const starts = location.pathname.startsWith(path + "/");
  return exact || starts;
}

/* ---------------------------------- API ----------------------------------- */
async function fetchIsAdmin(userId) {
  try {
    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (user?.app_metadata?.role === "admin") return true;

    if (!userId) return false;
    const { data, error } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", userId)
      .maybeSingle();

    if (error) return false;
    return !!data?.is_admin;
  } catch {
    return false;
  }
}

function getDisplayName(user) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    "User"
  );
}

/* --------------------------------- View ----------------------------------- */
export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [sessionUser, setSessionUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [bootDone, setBootDone] = useState(false);

  // Initial auth load + listener
  useEffect(() => {
    let mounted = true;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;
      setSessionUser(session?.user ?? null);

      if (!session?.user) {
        navigate("/login", { replace: true });
      } else {
        const admin = await fetchIsAdmin(session.user.id);
        if (!mounted) return;
        setIsAdmin(admin);
      }
      setBootDone(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSessionUser(session?.user ?? null);
        if (!session?.user) {
          navigate("/login", { replace: true });
        } else {
          const admin = await fetchIsAdmin(session.user.id);
          setIsAdmin(admin);
        }
      }
    );

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [navigate]);

  const displayName = useMemo(() => getDisplayName(sessionUser), [sessionUser]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  // Sidebar links (no hooks inside map)
  const nav = useMemo(() => {
    const items = [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/loads", label: "Loads", icon: Boxes },
      { to: "/in-transit", label: "In Transit", icon: Truck },
      { to: "/issues", label: "Issues", icon: TriangleAlert },
      { to: "/activity", label: "Activity", icon: ActivityIcon },
      { to: "/billing", label: "Billing", icon: CreditCard },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ];
    if (isAdmin) {
      items.splice(6, 0, { to: "/users", label: "Users", icon: UsersIcon });
    }
    return items;
  }, [isAdmin]);

  if (!bootDone) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[var(--bg-base)] text-[var(--text-base)]">
        <div className="flex items-center gap-3 opacity-80">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-sm">Loading Atlas Command…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="main-layout"
      className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-base)]"
    >
      <GlobalThemeFix />

      <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 py-4 md:py-6">
        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4 md:gap-6">
          {/* ------------------------------ Sidebar ------------------------------ */}
          <aside className="rounded-2xl border border-white/10 bg-[var(--bg-surface)]/90 backdrop-blur-sm">
            <div className="p-4 pb-2 flex items-center gap-3">
              <div className="h-8 w-8 grid place-items-center rounded-xl border border-white/10">
                <ShieldCheck className="h-4 w-4 opacity-80" />
              </div>
              <div className="leading-tight">
                <div className="font-semibold">Atlas Command</div>
                <div className="text-xs text-[var(--text-muted)]">
                  Secure Ops Console
                </div>
              </div>
            </div>

            <nav className="px-2 py-2">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = pathActive(location, item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={cx(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
                      active
                        ? "bg-white/10 border border-white/10"
                        : "hover:bg-white/5 border border-transparent"
                    )}
                  >
                    <Icon className="h-4 w-4 opacity-80" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            <div className="mt-4 px-4 pb-4 pt-2">
              <button
                onClick={signOut}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </button>
            </div>
          </aside>

          {/* ------------------------------ Main ------------------------------ */}
          <main className="rounded-2xl border border-white/10 bg-[var(--bg-surface)]/90 backdrop-blur-sm">
            {/* Header bar with title + name (left) and theme switcher (right) */}
            <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 md:px-6 py-3">
              <div className="min-w-0">
                <h1 className="text-lg md:text-xl font-semibold leading-tight truncate">
                  Atlas Command{" "}
                  <span className="opacity-70">| {displayName}</span>
                </h1>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {location.pathname}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ThemeSwitcher />
              </div>
            </header>

            {/* Routed page content */}
            <section className="p-4 md:p-6">
              <Outlet />
            </section>
          </main>
        </div>
      </div>

      {/* Non-intrusive diagnostics overlay */}
      <DiagnosticsOverlay />
    </div>
  );
}