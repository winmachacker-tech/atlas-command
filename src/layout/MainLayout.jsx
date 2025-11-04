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
  User as UserIcon,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import { getProfile } from "../lib/userSettings";
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
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", userId)
      .maybeSingle();
    if (error) return false;
    return Boolean(data?.is_admin);
  } catch {
    return false;
  }
}

/* ------------------------------- MainLayout ------------------------------- */
export default function MainLayout() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(""); // ✅ new
  const [isAdmin, setIsAdmin] = useState(false);

  // Initial load of session + profile
  useEffect(() => {
    let isMounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user ?? null;
      if (!isMounted) return;

      const userEmail = user?.email ?? "";
      setEmail(userEmail);

      try {
        const prof = await getProfile(); // pulls metadata incl. avatar_path -> signed URL
        if (!isMounted) return;
        const name =
          prof?.fullName?.trim() ||
          (userEmail ? userEmail.split("@")[0] : "") ||
          "";
        setDisplayName(name);
        if (prof?.avatar_url) setAvatarUrl(prof.avatar_url);
      } catch {
        if (!isMounted) return;
        const fallback = userEmail ? userEmail.split("@")[0] : "";
        setDisplayName(fallback);
      }

      if (user?.id) {
        const admin = await fetchIsAdmin(user.id);
        if (isMounted) setIsAdmin(admin);
      } else {
        setIsAdmin(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // 🔔 Live updates from ProfileSettings (name + avatar)
  useEffect(() => {
    const handler = (e) => {
      const full = e?.detail?.fullName?.trim() || "";
      const mail = e?.detail?.email || "";
      const nextName =
        full || (typeof mail === "string" && mail.includes("@") ? mail.split("@")[0] : "");
      if (nextName) setDisplayName(nextName);

      if (typeof e?.detail?.avatar_url === "string") {
        setAvatarUrl(e.detail.avatar_url);
      }
    };
    window.addEventListener("profile:updated", handler);
    return () => window.removeEventListener("profile:updated", handler);
  }, []);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const mainNav = useMemo(
    () => [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/loads", label: "Loads", icon: Boxes },
      { to: "/in-transit", label: "In Transit", icon: Truck },
      { to: "/delivered", label: "Delivered", icon: CheckCircle2 },
      { to: "/problem-board", label: "Problem Board", icon: TriangleAlert },
      { to: "/activity", label: "Activity", icon: ActivityIcon },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
    []
  );

  return (
    <>
      <GlobalThemeFix />

      <div
        className={cx(
          "flex h-screen",
          "bg-white dark:bg-zinc-950",
          "text-zinc-900 dark:text-zinc-100",
          "bg-[var(--bg-base)] text-[var(--text-base)]"
        )}
      >
        {/* ------------------------------- Sidebar ------------------------------- */}
        <aside
          className={cx(
            "hidden md:flex md:w-80 lg:w-80 xl:w-80 flex-col",
            "border-r border-zinc-200 dark:border-zinc-800",
            "bg-white dark:bg-zinc-900",
            "bg-[var(--bg-surface)]"
          )}
        >
          {/* Brand + user chip */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="h-5 w-5 text-[var(--accent-600)]" />
              <h1 className="font-semibold text-lg flex items-center gap-1 min-w-0">
                <span className="truncate">Atlas Command</span>
                {displayName ? (
                  <span className="text-sm text-zinc-500 dark:text-zinc-400 font-normal truncate max-w-[140px]">
                    {" "}
                    | {displayName}
                  </span>
                ) : null}
              </h1>
            </div>

            <div className="shrink-0 w-8 h-8 rounded-xl bg-zinc-800/40 border border-zinc-700/50 overflow-hidden grid place-items-center">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="User avatar"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <UserIcon className="w-4 h-4 text-zinc-400" />
              )}
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {mainNav.map((item) => (
              <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
            ))}
            {isAdmin && (
              <>
                <div className="mt-6 px-3 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Admin
                </div>
                <NavItem to="/users" icon={UsersIcon} label="User Management" />
              </>
            )}
          </nav>

          {/* Footer */}
          <div className="mt-auto border-t border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-zinc-600 dark:text-zinc-400" title={email}>
                {email}
              </span>
              <ThemeSwitcher />
            </div>

            <button
              onClick={handleSignOut}
              className={cx(
                "w-full inline-flex items-center justify-center gap-2",
                "rounded-xl px-3 py-2 text-sm",
                "bg-[var(--accent-600)] hover:bg-[var(--accent-700)] text-white",
                "transition-colors"
              )}
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        {/* ------------------------------ Main area ------------------------------ */}
        <main className="flex-1 min-w-0">
          {/* Top bar for small screens */}
          <div
            className={cx(
              "md:hidden flex items-center justify-between px-4 py-3",
              "border-b border-zinc-200 dark:border-zinc-800",
              "bg-white dark:bg-zinc-900",
              "bg-[var(--bg-surface)]"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="h-5 w-5 text-[var(--accent-600)]" />
              <span className="font-semibold flex items-center gap-1 min-w-0">
                <span className="truncate">Atlas Command</span>
                {displayName ? (
                  <span className="text-sm text-zinc-500 dark:text-zinc-400 font-normal truncate max-w-[120px]">
                    {" "}
                    | {displayName}
                  </span>
                ) : null}
              </span>
            </div>

            <div className="shrink-0 w-8 h-8 rounded-xl bg-zinc-800/40 border border-zinc-700/50 overflow-hidden grid place-items-center">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="User avatar"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <UserIcon className="w-4 h-4 text-zinc-400" />
              )}
            </div>
          </div>

          <DiagnosticsOverlay />

          <div
            className={cx(
              "h-[calc(100vh-0px)] overflow-auto",
              "bg-white dark:bg-zinc-950",
              "bg-[var(--bg-base)]"
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}

/* -------------------------------- Nav Item -------------------------------- */
function NavItem({ to, icon: Icon, label }) {
  const active = useActive(to);
  return (
    <NavLink
      to={to}
      className={cx(
        "flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-sm",
        "transition-colors border border-transparent",
        active
          ? "bg-zinc-50 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
      )}
      end={to === "/"}
    >
      <Icon className={cx("h-4 w-4", active ? "text-[var(--accent-600)]" : "text-zinc-500 dark:text-zinc-400")} />
      <span>{label}</span>
    </NavLink>
  );
}
