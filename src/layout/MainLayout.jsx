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
  CreditCard,
  Settings as SettingsIcon,
  Users as UsersIcon,
  LogOut,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import ThemeSwitcher from "../components/ThemeSwitcher.jsx";
// If you use these, keep them. If not, you can safely delete the imports.
// import GlobalThemeFix from "../GlobalThemeFix.jsx";
// import DiagnosticsOverlay from "../components/DiagnosticsOverlay.jsx";

/* ------------------------------- Utilities -------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function useActive(path) {
  const location = useLocation();
  const exact = location.pathname === path;
  const starts = location.pathname.startsWith(path + "/");
  return exact || starts;
}

/* ------------------------------ Main Layout -------------------------------- */
export default function MainLayout() {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  // optional: derive current user/org if you want to show header info
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        // If you have a users table, fetch a small subset for the header badge
        const { data } = await supabase
          .from("users")
          .select("full_name, role")
          .eq("id", user.id)
          .maybeSingle?.() ?? { data: null };
        if (alive) setProfile(data);
      } catch {
        // noop
      }
    })();
    return () => (alive = false);
  }, []);

  const signOut = async () => {
    try {
      setSigningOut(true);
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const items = useMemo(
    () => [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/loads", label: "Loads", icon: Boxes },
      { to: "/in-transit", label: "In Transit", icon: Truck },
      // ✅ Restored Delivered link
      { to: "/delivered", label: "Delivered", icon: CheckCircle2 },
      { to: "/problems", label: "Issues", icon: TriangleAlert },
      { to: "/activity", label: "Activity", icon: ActivityIcon },
      { to: "/billing", label: "Billing", icon: CreditCard },
      { to: "/users", label: "Users", icon: UsersIcon },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
    []
  );

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-base)]">
      <div className="mx-auto flex">
        {/* ------------------------------ Sidebar ------------------------------ */}
        <aside
          className={cx(
            "hidden md:flex",
            "sticky top-0 h-dvh w-[260px] shrink-0 flex-col",
            "border-r border-white/10 bg-[var(--bg-surface)]/80 backdrop-blur"
          )}
        >
          <div className="p-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="grid place-items-center rounded-2xl border border-white/10 p-2">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-tight">Atlas Command</div>
                <div className="text-xs text-[var(--text-muted)]">Secure Ops Console</div>
              </div>
            </div>
            {/* Optional profile chip */}
            {profile && (
              <div className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs text-[var(--text-muted)]">
                {profile.full_name || "User"} • {profile.role || "member"}
              </div>
            )}
          </div>

          <nav className="mt-1 flex-1 overflow-y-auto px-3">
            <ul className="space-y-1">
              {items.map(({ to, label, icon: Icon, exact }) => {
                const active = useActive(to) || (exact && useActive("/") && to === "/");
                return (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={exact}
                      className={cx(
                        "group flex items-center gap-3 rounded-xl px-3 py-2",
                        "border border-transparent hover:bg-white/5",
                        active && "bg-white/5 border-emerald-500/40 ring-1 ring-emerald-500/20"
                      )}
                    >
                      <Icon className={cx("h-4 w-4", active ? "text-emerald-400" : "opacity-80")} />
                      <span className={cx("text-sm", active ? "text-emerald-200" : "")}>{label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 px-1">
              <ThemeSwitcher />
            </div>
          </nav>

          <div className="mt-auto p-4 pt-2">
            <button
              onClick={signOut}
              disabled={signingOut}
              className={cx(
                "inline-flex w-full items-center justify-center gap-2 rounded-xl",
                "border border-white/10 px-3 py-2 hover:bg-white/5",
                signingOut && "opacity-60 cursor-not-allowed"
              )}
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        {/* ------------------------------ Main Pane ---------------------------- */}
        <main className="min-h-dvh flex-1">
          {/* Optional: <GlobalThemeFix /> */}
          {/* Optional: <DiagnosticsOverlay /> */}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
