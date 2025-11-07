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
  RefreshCw,
  Bot,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { trackLogout } from "../lib/activityTracker";
import AIQuickLauncher from "../components/AIQuickLauncher";

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

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl overflow-hidden z-50"
          style={{ backgroundColor: 'var(--bg-panel)' }}
        >
          <div className="px-3 py-2 text-xs text-[var(--text-muted)] bg-[var(--bg-surface)]">
            {email || "Signed in"}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              nav("/profile");
            }}
            className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition text-[var(--text-base)]"
            role="menuitem"
          >
            Profile &amp; Account
          </button>
          <button
            onClick={() => {
              setOpen(false);
              nav("/settings/appearance");
            }}
            className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition text-[var(--text-base)]"
            role="menuitem"
          >
            Appearance &amp; Theme
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

/* --------------------- Notification Bell (SOLID dropdown) --------------------- */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const nav = useNavigate();

  async function loadLatest(uid) {
    setLoading(true);
    const { data: rows } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(10);
    setItems(rows || []);
    setLoading(false);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id || null;
      if (!mounted || !uid) return;
      setUserId(uid);
      await loadLatest(uid);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("realtime:notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => setItems((prev) => [payload.new, ...prev].slice(0, 10))
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    function onDoc(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const unread = items.filter((i) => !i.read).length;

  async function markAllRead() {
    if (!userId) return;
    const ids = items.filter((i) => !i.read).map((i) => i.id);
    if (!ids.length) return;
    await supabase.from("notifications").update({ read: true }).in("id", ids).eq("user_id", userId);
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
  }

  async function handleItemClick(it) {
    if (userId && !it.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", it.id).eq("user_id", userId);
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, read: true } : x)));
    }
    if (it.link) nav(it.link);
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((s) => !s)}
        className="relative rounded-xl p-2 hover:bg-[var(--bg-hover)] transition"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] grid place-items-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cx(
            "absolute right-0 mt-2 w-[360px] max-w-[90vw] rounded-xl z-40 overflow-hidden",
            "bg-[var(--bg-panel)] border border-[var(--border)] shadow-2xl"
          )}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-sm font-medium">Notifications</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => userId && loadLatest(userId)}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-base)]"
                title="Refresh"
              >
                <RefreshCw className={cx("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </button>
              <button
                onClick={markAllRead}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-base)]"
              >
                Mark all as read
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-auto">
            {items.length === 0 ? (
              <div className="p-4 text-sm text-[var(--text-muted)]">
                No notifications yet.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className={cx(
                      "px-3 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition",
                      !it.read && "bg-[var(--bg-active)]/40"
                    )}
                    onClick={() => handleItemClick(it)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <Bell className="h-4 w-4 text-amber-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {it.title || "Notification"}
                        </div>
                        {it.message && (
                          <div className="text-xs text-[var(--text-muted)] truncate">
                            {it.message}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                          {new Date(it.created_at).toLocaleString()}
                        </div>
                      </div>
                      {!it.read && <span className="ml-auto mt-0.5 inline-block h-2 w-2 rounded-full bg-amber-500" />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-3 py-2 border-t border-[var(--border-subtle)] text-right">
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-base)]"
            >
              Close
            </button>
          </div>
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
      trackLogout().catch(err => console.error("Failed to track logout:", err));
      await supabase.auth.signOut();
    } finally {
      navigate("/login", { replace: true });
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

                <SideLink to="/teammanagement" icon={UserRound}>
                  Team Management
                </SideLink>
              </SideGroup>

              {/* AI Tools */}
              <SideGroup
                id="ai"
                title="AI Tools"
                icon={Bot}
                defaultOpen={true}
              >
                <SideLink to="/dispatch-ai" icon={Bot}>
                  Dispatch AI (Lab)
                </SideLink>
              </SideGroup>
            </nav>

            {/* Footer actions */}
            <div className="mt-auto pt-3 space-y-2">
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
                <NotificationBell />
              </div>
            </div>
          </div>

          {/* Desktop top bar */}
          <div className="hidden md:block sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-panel)] backdrop-blur-sm">
            <div className="flex items-center justify-end px-6 py-3 gap-2">
              <NotificationBell />
              <AvatarMenu onSignOut={signOut} />
            </div>
          </div>

          {/* Routed content */}
          <div className="p-4 md:p-6">
            <Outlet />
            <AIQuickLauncher />
          </div>
        </main>
      </div>
    </div>
  );
}