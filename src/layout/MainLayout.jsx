import { useEffect, useMemo, useState, useRef } from "react";
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
} from "lucide-react";
import { supabase } from "../lib/supabase";
import GlobalThemeFix from "../GlobalThemeFix.jsx";
import ThemeSwitcher from "../components/ThemeSwitcher.jsx";
import DiagnosticsOverlay from "../components/DiagnosticsOverlay.jsx";

/* ------------------------------- Utilities -------------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/** PURE (no hooks inside). */
function isActivePath(location, path) {
  const exact = location.pathname === path;
  const starts = location.pathname.startsWith(path + "/");
  return exact || starts;
}

/* ------------------------------ Data helpers ------------------------------ */
/** Keep the hook order identical on every render. No conditional hooks above. */
async function fetchIsAdmin(userId) {
  if (!userId) return false;

  // If your users table uses `id` = auth.uid(), query by id.
  // If you truly have `auth_user_id`, change the .eq('id', ...) to .eq('auth_user_id', ...)
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[MainLayout] fetchIsAdmin error:", error);
    return false;
  }
  return (data?.role || "").toUpperCase() === "ADMIN";
}

/* --------------------------------- View ----------------------------------- */
export default function MainLayout() {
  // 1) Stable hook order block — nothing conditional above/between hooks
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(null);

  const [bootDone, setBootDone] = useState(false);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // 2) Auth/session bootstrap — never conditionally run useEffect
  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const currentUser = sessionData?.session?.user ?? null;
        if (!active) return;

        setUser(currentUser);

        const admin = await fetchIsAdmin(currentUser?.id || null);
        if (!active) return;

        setIsAdmin(admin);
      } catch (err) {
        console.warn("[MainLayout] init error:", err);
      } finally {
        if (active) setBootDone(true);
      }
    }

    init();

    const { data: authSub } = supabase.auth.onAuthStateChange((_evt, s) => {
      const u = s?.user ?? null;
      setUser(u);
      fetchIsAdmin(u?.id || null).then(setIsAdmin);
    });

    return () => {
      active = false;
      authSub?.subscription?.unsubscribe?.();
    };
  }, []);

  // 3) Computed nav — keep structure stable; use hidden flags instead of push/pop
  const navItems = useMemo(() => {
    return [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, hidden: false },
      { to: "/loads", label: "Loads", icon: Boxes, hidden: false },
      { to: "/in-transit", label: "In Transit", icon: Truck, hidden: false },
      { to: "/delivered", label: "Delivered", icon: CheckCircle2, hidden: false },
      { to: "/issues", label: "Issues", icon: TriangleAlert, hidden: false },
      { to: "/activity", label: "Activity", icon: ActivityIcon, hidden: false },
      { to: "/users", label: "Users", icon: UsersIcon, hidden: !isAdmin },
      { to: "/settings", label: "Settings", icon: SettingsIcon, hidden: false },
    ];
  }, [isAdmin]);

  // 4) Actions
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/onboarding");
  };

  // 5) Boot screen — render can be conditional; hook order above stays fixed
  if (!bootDone) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[var(--bg-base)] text-[var(--text-base)]">
        <div className="flex items-center gap-3 opacity-80">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-sm">Preparing Atlas Command…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-base)]">
      <GlobalThemeFix />
      <DiagnosticsOverlay />

      <div className="flex">
        {/* Sidebar */}
        <aside
          ref={navRef}
          className="w-[260px] shrink-0 border-r border-white/10 bg-[var(--bg-surface)]/60 backdrop-blur-md"
        >
          <div className="px-4 py-4 border-b border-white/10">
            <div className="text-lg font-semibold">🛰️ Atlas Command</div>
            <div className="text-xs text-[var(--text-muted)]">
              {user?.email ?? "—"}
            </div>
          </div>

          <nav className="px-2 py-3 space-y-1">
            {navItems
              .filter((n) => !n.hidden)
              .map(({ to, label, icon: Icon }) => {
                const active = isActivePath(location, to); // ✅ pure, no hooks
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={cx(
                      "flex items-center gap-3 rounded-xl px-3 py-2 transition",
                      active
                        ? "bg-white/10 text-white"
                        : "text-[var(--text-muted)] hover:text-white hover:bg-white/5"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-sm">{label}</span>
                  </NavLink>
                );
              })}
          </nav>

          <div className="mt-auto p-3">
            <ThemeSwitcher />
            <button
              onClick={signOut}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-[var(--text-muted)] hover:text-white hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-h-dvh flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
