// src/layout/MainLayout.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Truck,
  Send,
  CheckCircle2,
  DollarSign,
  UserRound,
  ClipboardList,
  Menu,
  ShieldCheck,
  LogOut,
  ChevronDown,
  FolderKanban,
  Palette,
  Bell,
  Plug,
  Shield,
  CreditCard,
} from "lucide-react";
import ThemeMenu from "../components/ThemeMenu.jsx";
import { supabase } from "../lib/supabase";

/* -------------------------- tiny class joiner -------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/* ------------------------- Reusable side link -------------------------- */
function SideLink({ to, icon: Icon, children, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 px-3 py-2 rounded-xl transition",
          isActive
            ? "bg-[var(--bg-active)] text-[var(--text-base)]"
            : "text-[var(--text-muted)] hover:text-[var(--text-base)] hover:bg-[var(--bg-hover)]"
        )
      }
      onClick={onClick}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

/* --------------------- Collapsible group container --------------------- */
function SideGroup({ id, title, icon: Icon, children, defaultOpen }) {
  const STORAGE_KEY = "atlas.sidebar.open";
  const [open, setOpen] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return stored[id] ?? !!defaultOpen;
    } catch {
      return !!defaultOpen;
    }
  });

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      stored[id] = open;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {}
  }, [id, open]);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cx(
          "w-full flex items-center justify-between px-3 py-2 rounded-xl",
          "text-[var(--text-muted)] hover:text-[var(--text-base)] hover:bg-[var(--bg-hover)]",
          "transition"
        )}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon className="h-4 w-4" />}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <ChevronDown
          className={cx(
            "h-4 w-4 transition-transform",
            open ? "rotate-180" : "rotate-0"
          )}
        />
      </button>

      <div
        className={cx(
          "grid overflow-hidden transition-all",
          open ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="min-h-0">
          <div className="ml-2 pl-2 border-l border-[var(--border-subtle)] space-y-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Avatar dropdown (NEW) ------------------------ */
function AvatarMenu({ onSignOut }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const user = data?.user ?? null;

      // Prefer auth user_metadata.avatar_url; silently fallback
      const metaUrl =
        user?.user_metadata?.avatar_url ||
        user?.user_metadata?.avatar ||
        "";

      setAvatarUrl(metaUrl || "");
      setEmail(user?.email || "");
    })();

    function handleDoc(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    function handleEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleDoc);
    document.addEventListener("keydown", handleEsc);
    return () => {
      active = false;
      document.removeEventListener("mousedown", handleDoc);
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);

  const initials = email
    ? email.replace(/@.*/, "").slice(0, 2).toUpperCase()
    : "U";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[var(--bg-hover)] transition"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* Avatar circle */}
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Profile"
            className="h-8 w-8 rounded-full object-cover border border-[var(--border-subtle)]"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-8 w-8 rounded-full grid place-items-center text-xs font-semibold bg-[var(--bg-hover)] border border-[var(--border-subtle)]">
            {initials}
          </div>
        )}
        <ChevronDown className={cx("h-4 w-4", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-lg overflow-hidden z-40"
        >
          <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
            {email || "Signed in"}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              nav("/profile");
            }}
            className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition"
            role="menuitem"
          >
            Profile &amp; Account
          </button>
          <button
            onClick={() => {
              setOpen(false);
              nav("/settings/appearance");
            }}
            className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition"
            role="menuitem"
          >
            Appearance
          </button>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          <button
            onClick={onSignOut}
            className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition flex items-center gap-2 text-red-400"
            role="menuitem"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Layout -------------------------------- */
export default function MainLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Auto-open groups if a child route is active
  const activeGroupByPath = useMemo(() => {
    if (pathname.startsWith("/billing")) return "accounting";
    if (
      ["/", "/loads", "/in-transit", "/delivered", "/drivers", "/trucks"].some(
        (p) => (p === "/" ? pathname === "/" : pathname.startsWith(p))
      )
    )
      return "operations";
    if (
      [
        "/settings",
        "/profile",
        "/settings/appearance",
        "/settings/notifications",
        "/settings/integrations",
        "/settings/security",
        "/teammanagement",
      ].some((p) => pathname.startsWith(p))
    )
      return "admin";
    return null;
  }, [pathname]);

  useEffect(() => {
    const key = "atlas.sidebar.open";
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (activeGroupByPath && !stored[activeGroupByPath]) {
        stored[activeGroupByPath] = true;
        localStorage.setItem(key, JSON.stringify(stored));
      }
    } catch {}
  }, [activeGroupByPath]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
    } catch (e) {
      console.error("Sign out error:", e);
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-base)]">
      <div className="grid grid-cols-[260px,1fr] md:grid-cols-[260px,1fr]">
        {/* Sidebar */}
        <aside className="hidden md:block h-screen sticky top-0 border-r border-[var(--border)] bg-[var(--bg-panel)]">
          <div className="h-full flex flex-col p-3">
            {/* Brand / Header */}
            <div className="flex items-center justify-between px-2 py-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-5 w-5 text-emerald-400" />
                <span className="font-semibold tracking-wide">Atlas Command</span>
              </div>
            </div>

            {/* Groups */}
            <nav className="mt-2 space-y-1 overflow-y-auto">
              {/* Operations */}
              <SideGroup
                id="operations"
                title="Operations"
                icon={ShieldCheck}
                defaultOpen={activeGroupByPath === "operations"}
              >
                <SideLink to="/" end icon={Home}>
                  Dashboard
                </SideLink>
                <SideLink to="/loads" icon={ClipboardList}>
                  Loads
                </SideLink>
                <SideLink to="/in-transit" icon={Send}>
                  In Transit
                </SideLink>
                <SideLink to="/delivered" icon={CheckCircle2}>
                  Delivered
                </SideLink>
                <SideLink to="/drivers" icon={UserRound}>
                  Drivers
                </SideLink>
                <SideLink to="/trucks" icon={Truck}>
                  Trucks
                </SideLink>
              </SideGroup>

              {/* Accounting */}
              <SideGroup
                id="accounting"
                title="Accounting"
                icon={DollarSign}
                defaultOpen={activeGroupByPath === "accounting"}
              >
                {/* Settings → Billing moved here */}
                <SideLink to="/billing" icon={CreditCard}>
                  Billing
                </SideLink>
              </SideGroup>

              {/* Admin */}
              <SideGroup
                id="admin"
                title="Admin"
                icon={Shield}
                defaultOpen={activeGroupByPath === "admin"}
              >
                {/* Settings items moved here */}
                <SideLink to="/profile" icon={UserRound}>
                  Profile &amp; Account
                </SideLink>

                <SideLink to="/settings/appearance" icon={Palette}>
                  Appearance
                </SideLink>
                <SideLink to="/settings/notifications" icon={Bell}>
                  Notifications
                </SideLink>
                <SideLink to="/settings/integrations" icon={Plug}>
                  Integrations
                </SideLink>
                <SideLink to="/settings/security" icon={Shield}>
                  Security
                </SideLink>

                {/* TM2 → Team Management (already updated path) */}
                <SideLink to="/teammanagement" icon={UserRound}>
                  Team Management
                </SideLink>
              </SideGroup>
            </nav>

            {/* Footer actions */}
            <div className="mt-auto pt-3 space-y-2">
              <div className="px-2">
                <ThemeMenu />
              </div>
              <button
                onClick={signOut}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-base)] hover:bg-[var(--bg-hover)] transition"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-h-screen">
          {/* Mobile top bar */}
          <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-panel)]/80 backdrop-blur">
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => {
                  // Optional: hook up a mobile drawer in the future
                }}
                className="p-2 rounded-lg hover:bg-[var(--bg-hover)]"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="font-semibold">Atlas Command</span>
              <div className="flex items-center gap-2">
                <ThemeMenu />
              </div>
            </div>
          </div>

          {/* Desktop top bar (NEW: avatar only, minimal) */}
          <div className="hidden md:block sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-panel)]/80 backdrop-blur">
            <div className="flex items-center justify-end px-6 py-3">
              <AvatarMenu onSignOut={signOut} />
            </div>
          </div>

          {/* Routed content */}
          <div className="p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
