// FILE: src/layout/MainLayout.jsx
// Purpose:
// - Main shell layout for Atlas Command.
// - Provides sidebar navigation, top header, notifications, avatar menu.
// - Hosts the Dipsy floating widget and AI quick launcher.
// - Adds a simple OrgSwitcher pill in the desktop header
//   so you can see which org you're managing.
//
// NOTE: This OrgSwitcher is READ-ONLY right now.
// It shows the current org name (from public.orgs with RLS).
// Later we can wire it to a secure RPC to actually switch orgs.

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";
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
  Sparkles,
  GraduationCap,
  Users,
  BarChart3,
  FileCheck,
  Crown,
  TrendingUp,
  Building2,
  MapPin,
  MessageSquare,
  Bug,
  AlertTriangle,
  FileText,
  CheckCircle,
  ExternalLink,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { trackLogout } from "../lib/activityTracker";
import AIQuickLauncher from "../components/AIQuickLauncher";
import { DipsyFloatingWidget } from "../components/DipsyFloating";
import { Analytics } from "@vercel/analytics/react";

/* ---------------------- Dipsy context (global) ---------------------- */
export const DipsyContext = createContext();

export function useDipsy() {
  const context = useContext(DipsyContext);
  if (!context) {
    throw new Error("useDipsy must be used within MainLayout");
  }
  return context;
}

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

/* ------------------------- Avatar dropdown ------------------------ */
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
        user?.user_metadata?.avatar_url || user?.user_metadata?.avatar || "";

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

/* --------------------- Dispatch Notification Bell --------------------- */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentOrgId, setCurrentOrgId] = useState(null);
  const wrapRef = useRef(null);
  const nav = useNavigate();

  // 🔒 SECURITY: Fetch current user's org_id for client-side filtering
  // This is critical because Supabase Realtime doesn't fully enforce RLS
  useEffect(() => {
    let cancelled = false;

    async function fetchOrgId() {
      try {
        // Query orgs table - RLS ensures we only get our own org(s)
        const { data, error } = await supabase
          .from("orgs")
          .select("id")
          .limit(1)
          .single();

        if (cancelled) return;

        if (!error && data?.id) {
          setCurrentOrgId(data.id);
        } else {
          console.warn("[NotificationBell] Could not fetch org_id:", error?.message);
        }
      } catch (err) {
        console.error("[NotificationBell] Failed to fetch org_id:", err);
      }
    }

    fetchOrgId();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch from dispatch_notifications
  async function loadLatest() {
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from("dispatch_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setItems(rows || []);
    } catch (err) {
      console.error("[NotificationBell] Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLatest();
  }, []);

  // Play notification sound
  function playNotificationSound() {
    try {
      const audio = new Audio("/notification.mp3");
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (e) {
      // Ignore
    }
  }

  // Real-time subscription with client-side org filtering
  useEffect(() => {
    // Don't subscribe until we have the org_id
    if (!currentOrgId) {
      return;
    }

    const channel = supabase
      .channel("realtime:dispatch_notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dispatch_notifications",
        },
        (payload) => {
          // 🔒 SECURITY: Client-side org filtering is REQUIRED
          // Supabase Realtime doesn't fully enforce RLS on broadcast events.
          // Without this check, users could see notifications from other orgs.
          if (payload.new.org_id !== currentOrgId) {
            console.warn(
              "[NotificationBell] Blocked cross-org notification:",
              payload.new.org_id,
              "!==",
              currentOrgId
            );
            return;
          }

          setItems((prev) => [payload.new, ...prev].slice(0, 10));

          // Play sound for critical notifications
          if (payload.new.severity === "critical") {
            playNotificationSound();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrgId]);

  // Close on outside click
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

  const unread = items.filter((i) => !i.read_at).length;

  // Mark all read
  async function markAllRead() {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (!ids.length) return;
    try {
      await supabase
        .from("dispatch_notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      setItems((prev) => prev.map((i) => ({ ...i, read_at: new Date().toISOString() })));
    } catch (err) {
      console.error("[NotificationBell] markAllRead error:", err);
    }
  }

  // Handle item click
  async function handleItemClick(it) {
    // Mark as read
    if (!it.read_at) {
      try {
        await supabase
          .from("dispatch_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", it.id);
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, read_at: new Date().toISOString() } : x))
        );
      } catch (err) {
        console.error("[NotificationBell] markRead error:", err);
      }
    }
    // Navigate to load if available
    if (it.load_id) {
      nav(`/loads/${it.load_id}`);
    }
    setOpen(false);
  }

  // Get icon for notification type
  function getIcon(type, severity) {
    if (severity === "critical" || type === "ISSUE") {
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
    if (type === "POD_RECEIVED") {
      return <FileText className="h-4 w-4 text-blue-500" />;
    }
    if (type === "LOAD_DELIVERED") {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    return <Truck className="h-4 w-4 text-[var(--text-muted)]" />;
  }

  // Format time ago
  function timeAgo(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
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
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cx(
            "absolute right-0 mt-2 w-[400px] max-w-[90vw] rounded-xl z-40 overflow-hidden",
            "bg-[var(--bg-panel)] border border-[var(--border)] shadow-2xl"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <span className="text-sm font-medium">Dispatch Notifications</span>
            <div className="flex items-center gap-3">
              <button
                onClick={loadLatest}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-base)]"
                title="Refresh"
              >
                <RefreshCw
                  className={cx("h-3.5 w-3.5", loading && "animate-spin")}
                />
              </button>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-base)]"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-[60vh] overflow-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-[var(--text-muted)]">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className={cx(
                      "px-3 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition",
                      !it.read_at && "bg-amber-500/5",
                      it.severity === "critical" && "border-l-4 border-l-red-500"
                    )}
                    onClick={() => handleItemClick(it)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {getIcon(it.type, it.severity)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cx(
                            "text-sm font-medium truncate",
                            it.read_at ? "text-[var(--text-muted)]" : "text-[var(--text-base)]"
                          )}>
                            {it.title || "Notification"}
                          </span>
                          {it.severity === "critical" && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-500/20 text-red-400">
                              Critical
                            </span>
                          )}
                          {it.severity === "warning" && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/20 text-amber-400">
                              Warning
                            </span>
                          )}
                        </div>
                        {it.message && (
                          <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                            {it.message}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-muted)]">
                          <span>{timeAgo(it.created_at)}</span>
                          {it.meta?.load_reference && (
                            <span className="px-1.5 py-0.5 bg-[var(--bg-surface)] rounded">
                              #{it.meta.load_reference}
                            </span>
                          )}
                        </div>
                      </div>
                      {!it.read_at && (
                        <span className="ml-auto mt-1 inline-block h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" />
                      )}
                      {it.load_id && (
                        <ExternalLink className="h-3.5 w-3.5 text-[var(--text-muted)] flex-shrink-0" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between">
            <button
              onClick={() => {
                nav("/notifications");
                setOpen(false);
              }}
              className="text-xs text-amber-500 hover:text-amber-400"
            >
              View all notifications
            </button>
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

/* --------------------- Org Switcher (read-only) --------------------- */
function OrgSwitcher() {
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("Current org");

  useEffect(() => {
    let cancelled = false;

    async function loadOrg() {
      try {
        const { data, error } = await supabase
          .from("orgs")
          .select("name")
          .limit(1)
          .single();

        if (cancelled) return;

        if (error) {
          console.error("[OrgSwitcher] error loading org:", error);
          setOrgName("Current org");
        } else {
          setOrgName(data?.name || "Current org");
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[OrgSwitcher] unexpected error:", e);
          setOrgName("Current org");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadOrg();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-base)] shadow-sm cursor-default"
      title="Org switching will live here. Right now this shows the current org only."
    >
      <Building2 className="h-4 w-4 text-emerald-500" />
      <span className="font-medium">
        {loading ? "Loading org…" : orgName || "Current org"}
      </span>
      <ChevronDown className="h-3 w-3 opacity-60" />
    </button>
  );
}

/* ---------------------- Mobile Sidebar Drawer ---------------------- */
function MobileSidebar({ isOpen, onClose, onSignOut, isSuperAdmin, activeGroupByPath }) {
  const nav = useNavigate();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside className="fixed inset-y-0 left-0 w-72 bg-[var(--bg-panel)] border-r border-[var(--border)] z-50 overflow-y-auto">
        <div className="h-full flex flex-col p-3">
          {/* Brand / Header */}
          <div className="flex items-center justify-between px-2 py-3">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-emerald-400" />
              <span className="font-semibold tracking-wide">Atlas Command</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--bg-hover)]"
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          {/* Navigation - same as desktop */}
          <nav className="mt-2 space-y-1 overflow-y-auto flex-1">
            {/* Operations */}
            <SideGroup
              id="operations"
              title="Operations"
              icon={ShieldCheck}
              defaultOpen={activeGroupByPath === "operations"}
            >
              <SideLink to="/" end icon={Home} onClick={onClose}>Dashboard</SideLink>
              <SideLink to="/loads" icon={ClipboardList} onClick={onClose}>Loads</SideLink>
              <SideLink to="/load-drafts" icon={FileCheck} onClick={onClose}>Load Drafts</SideLink>
              <SideLink to="/in-transit" icon={Send} onClick={onClose}>In Transit</SideLink>
              <SideLink to="/delivered" icon={CheckCircle2} onClick={onClose}>Delivered</SideLink>
              <SideLink to="/drivers" icon={UserRound} onClick={onClose}>Drivers</SideLink>
              <SideLink to="/customers" icon={Users} onClick={onClose}>Customers</SideLink>
              <SideLink to="/documents" icon={FileText} onClick={onClose}>Documents</SideLink>
              <SideLink to="/sales" icon={TrendingUp} onClick={onClose}>Sales</SideLink>
              <SideLink to="/learning" icon={GraduationCap} onClick={onClose}>Learning</SideLink>
              <SideLink to="/trucks" icon={Truck} onClick={onClose}>Trucks</SideLink>
              <SideLink to="/fleet-map" icon={MapPin} onClick={onClose}>Fleet Map</SideLink>
            </SideGroup>

            {/* Accounting */}
            <SideGroup
              id="accounting"
              title="Accounting"
              icon={DollarSign}
              defaultOpen={activeGroupByPath === "accounting"}
            >
              <SideLink to="/billing" icon={CreditCard} onClick={onClose}>Billing</SideLink>
              <SideLink to="/billing/subscription" icon={CreditCard} onClick={onClose}>Subscription</SideLink>
              <SideLink to="/driver-settlements" icon={DollarSign} onClick={onClose}>Driver settlements</SideLink>
            </SideGroup>

            {/* Admin */}
            <SideGroup
              id="admin"
              title="Admin"
              icon={Shield}
              defaultOpen={activeGroupByPath === "admin"}
            >
              <SideLink to="/profile" icon={UserRound} onClick={onClose}>Profile &amp; Account</SideLink>
              <SideLink to="/settings/appearance" icon={Palette} onClick={onClose}>Appearance</SideLink>
              <SideLink to="/notifications" icon={Bell} onClick={onClose}>Notifications</SideLink>
              <SideLink to="/settings/notifications" icon={Bell} onClick={onClose}>Notification Settings</SideLink>
              <SideLink to="/settings/integrations" icon={Plug} onClick={onClose}>Integrations</SideLink>
              <SideLink to="/settings/security" icon={Shield} onClick={onClose}>Security</SideLink>
              <SideLink to="/settings/whatsapp" icon={MessageSquare} onClick={onClose}>WhatsApp</SideLink>
              <SideLink to="/trust-center" icon={ShieldCheck} onClick={onClose}>Trust &amp; Security</SideLink>
              <SideLink to="/privacy" icon={ShieldCheck} onClick={onClose}>Privacy Policy</SideLink>
              <SideLink to="/teammanagement" icon={UserRound} onClick={onClose}>Team Management</SideLink>
              <SideLink to="/admin/driver-learning-test" icon={GraduationCap} onClick={onClose}>Driver Learning Test</SideLink>
              <SideLink to="/admin/dipsy-training-review" icon={Bot} onClick={onClose}>Dipsy Training Review</SideLink>
              {isSuperAdmin && (
                <>
                  <SideLink to="/super-admin" icon={Crown} onClick={onClose}>Platform Admin</SideLink>
                  <SideLink to="/financials" icon={TrendingUp} onClick={onClose}>Financials</SideLink>
                </>
              )}
            </SideGroup>

            {/* AI Tools */}
            <SideGroup
              id="ai"
              title="AI Tools"
              icon={Bot}
              defaultOpen={activeGroupByPath === "ai"}
            >
              <SideLink to="/ai" icon={Sparkles} onClick={onClose}>AI Recommendations</SideLink>
              <SideLink to="/ai/lanes" icon={BarChart3} onClick={onClose}>Lane Intelligence</SideLink>
              <SideLink to="/lanetraining" icon={GraduationCap} onClick={onClose}>Lane Training</SideLink>
              <SideLink to="/ai-lab-proof" icon={Sparkles} onClick={onClose}>AI Lab Proof</SideLink>
              <SideLink to="/ai-insights" icon={Sparkles} onClick={onClose}>AI Insights</SideLink>
            </SideGroup>

            {/* Debug */}
            <SideGroup
              id="debug"
              title="Debug"
              icon={Bug}
              defaultOpen={activeGroupByPath === "debug"}
            >
              <SideLink to="/debug/board" icon={Bug} onClick={onClose}>Commander Board Debug</SideLink>
              <SideLink to="/faq-test" icon={FileText} onClick={onClose}>FAQ Test Panel</SideLink>
            </SideGroup>
          </nav>

          {/* Footer */}
          <div className="mt-auto pt-3 space-y-2">
            <button
              onClick={() => {
                onClose();
                onSignOut();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-base)] hover:bg-[var(--bg-hover)] transition"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ------------------------------- Layout -------------------------------- */
export default function MainLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Mobile sidebar state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 👑 Super admin flag (for showing /super-admin in sidebar)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [checkedSuperAdmin, setCheckedSuperAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSuperAdmin() {
      try {
        const { data, error } = await supabase.rpc("rpc_is_super_admin");

        if (cancelled) return;

        if (error) {
          console.error("[MainLayout] rpc_is_super_admin error:", error);
          setIsSuperAdmin(false);
        } else {
          setIsSuperAdmin(!!data);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[MainLayout] rpc_is_super_admin exception:", err);
          setIsSuperAdmin(false);
        }
      } finally {
        if (!cancelled) {
          setCheckedSuperAdmin(true);
        }
      }
    }

    checkSuperAdmin();

    return () => {
      cancelled = true;
    };
  }, []);

  // Dipsy state management
  const [dipsyState, setDipsyState] = useState("idle");
  const [aiChatTrigger, setAiChatTrigger] = useState(0);

  // Auto-sleep after 2 minutes idle
  useEffect(() => {
    let sleepTimer;
    if (dipsyState === "idle") {
      sleepTimer = setTimeout(() => {
        setDipsyState("sleeping");
      }, 120000);
    }
    return () => {
      if (sleepTimer) clearTimeout(sleepTimer);
    };
  }, [dipsyState]);

  // Auto-open sidebar groups
  const activeGroupByPath = useMemo(() => {
    if (
      pathname.startsWith("/billing") ||
      pathname.startsWith("/driver-settlements")
    )
      return "accounting";
    if (
      [
        "/",
        "/loads",
        "/load-drafts",
        "/in-transit",
        "/delivered",
        "/drivers",
        "/trucks",
        "/customers",
        "/documents",
        "/sales",
      ].some((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p)))
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
        "/settings/whatsapp",
        "/teammanagement",
        "/admin/driver-learning-test",
        "/admin/dipsy-training-review",
        "/ai-proof",
        "/ai-lab-proof",
        "/customers",
        "/trust-center",
        "/super-admin",
        "/notifications",
      ].some((p) => pathname.startsWith(p))
    )
      return "admin";
    if (
      pathname.startsWith("/ai") ||
      pathname.startsWith("/ai-proof") ||
      pathname.startsWith("/ai-lab-proof")
    )
      return "ai";
    if (
      pathname.startsWith("/debug/board") ||
      pathname.startsWith("/faq-test")
    )
      return "debug";
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
      trackLogout().catch((err) =>
        console.error("Failed to track logout:", err)
      );
      await supabase.auth.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  // 🚚 Motive OAuth: start the OAuth flow
  const handleConnectMotive = useCallback(() => {
    try {
      if (typeof window === "undefined") return;

      const clientId = import.meta.env.VITE_MOTIVE_CLIENT_ID;
      if (!clientId) {
        console.error(
          "[MainLayout] VITE_MOTIVE_CLIENT_ID not set; cannot start Motive OAuth."
        );
        alert("Motive client ID is not configured (VITE_MOTIVE_CLIENT_ID).");
        return;
      }

      // 🔑 Allow explicit redirect via env, fallback to origin
      const redirectUriEnv = import.meta.env.VITE_MOTIVE_REDIRECT_URI;
      const redirectUri =
        redirectUriEnv ||
        `${window.location.origin}/integrations/motive/callback`;

      // 🔑 Scopes - can be overridden via env, or use sensible defaults for fleet management
      const scopeEnv = import.meta.env.VITE_MOTIVE_SCOPE;
      const scope =
        scopeEnv ||
        "companies.read users.read vehicles.read drivers.read hos_logs.read locations.read";

      console.log("[Motive OAuth] redirectUri =", redirectUri);
      console.log("[Motive OAuth] scope =", scope);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scope,
      });

      alert("Scope: " + scope);
      const authorizeUrl = `https://gomotive.com/oauth/authorize?${params.toString()}`;
      window.location.href = authorizeUrl;
    } catch (err) {
      console.error("[MainLayout] Failed to start Motive OAuth:", err);
    }
  }, []);

  // Dipsy context value
  const dipsyContextValue = useMemo(
    () => ({
      state: dipsyState,
      setState: setDipsyState,
      setThinking: () => setDipsyState("thinking"),
      setConfident: () => setDipsyState("confident-victory"),
      setLightbulb: () => setDipsyState("confident-lightbulb"),
      setCelebrating: () => setDipsyState("celebrating"),
      setLearning: () => setDipsyState("learning"),
      setIdle: () => setDipsyState("idle"),
      setSleeping: () => setDipsyState("sleeping"),
    }),
    [dipsyState]
  );

  return (
    <DipsyContext.Provider value={dipsyContextValue}>
      <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-base)]">
        <div className="grid grid-cols-[260px,1fr] md:grid-cols-[260px,1fr]">
          {/* Sidebar */}
          <aside className="hidden md:block h-screen sticky top-0 border-r border-[var(--border)] bg-[var(--bg-panel)]">
            <div className="h-full flex flex-col p-3">
              {/* Brand / Header */}
              <div className="flex items-center justify-between px-2 py-3">
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-5 w-5 text-emerald-400" />
                  <span className="font-semibold tracking-wide">
                    Atlas Command
                  </span>
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
                  <SideLink to="/load-drafts" icon={FileCheck}>
                    Load Drafts
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
                  <SideLink to="/customers" icon={Users}>
                    Customers
                  </SideLink>
                  <SideLink to="/documents" icon={FileText}>
                    Documents
                  </SideLink>
                  <SideLink to="/sales" icon={TrendingUp}>
                    Sales
                  </SideLink>
                  <SideLink to="/learning" icon={GraduationCap}>
                    Learning
                  </SideLink>
                  <SideLink to="/trucks" icon={Truck}>
                    Trucks
                  </SideLink>
                  <SideLink to="/fleet-map" icon={MapPin}>
                    Fleet Map
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
                  <SideLink to="/billing/subscription" icon={CreditCard}>
                    Subscription
                  </SideLink>
                  <SideLink to="/driver-settlements" icon={DollarSign}>
                    Driver settlements
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
                  <SideLink to="/notifications" icon={Bell}>
                    Notifications
                  </SideLink>
                  <SideLink to="/settings/notifications" icon={Bell}>
                    Notification Settings
                  </SideLink>
                  <SideLink to="/settings/integrations" icon={Plug}>
                    Integrations
                  </SideLink>
                  <SideLink to="/settings/security" icon={Shield}>
                    Security
                  </SideLink>
                  <SideLink to="/settings/whatsapp" icon={MessageSquare}>
                    WhatsApp
                  </SideLink>
                  <SideLink to="/trust-center" icon={ShieldCheck}>
                    Trust &amp; Security
                  </SideLink>
                  <SideLink to="/privacy" icon={ShieldCheck}>
                    Privacy Policy
                  </SideLink>
                  <SideLink to="/teammanagement" icon={UserRound}>
                    Team Management
                  </SideLink>
                  <SideLink
                    to="/admin/driver-learning-test"
                    icon={GraduationCap}
                  >
                    Driver Learning Test
                  </SideLink>
                  <SideLink to="/admin/dipsy-training-review" icon={Bot}>
                    Dipsy Training Review
                  </SideLink>
                  {checkedSuperAdmin && isSuperAdmin && (
                    <>
                      <SideLink to="/super-admin" icon={Crown}>
                        Platform Admin
                      </SideLink>
                      <SideLink to="/financials" icon={TrendingUp}>
                        Financials
                      </SideLink>
                    </>
                  )}
                </SideGroup>

                {/* AI Tools */}
                <SideGroup
                  id="ai"
                  title="AI Tools"
                  icon={Bot}
                  defaultOpen={activeGroupByPath === "ai"}
                >
                  <SideLink to="/ai" icon={Sparkles}>
                    AI Recommendations
                  </SideLink>
                  <SideLink to="/ai/lanes" icon={BarChart3}>
                    Lane Intelligence
                  </SideLink>
                  <SideLink to="/lanetraining" icon={GraduationCap}>
                    Lane Training
                  </SideLink>
                  <SideLink to="/ai-lab-proof" icon={Sparkles}>
                    AI Lab Proof
                  </SideLink>
                  <SideLink to="/ai-insights" icon={Sparkles}>
                    AI Insights
                  </SideLink>
                </SideGroup>

                {/* Debug group */}
                <SideGroup
                  id="debug"
                  title="Debug"
                  icon={Bug}
                  defaultOpen={activeGroupByPath === "debug"}
                >
                  <SideLink to="/debug/board" icon={Bug}>
                    Commander Board Debug
                  </SideLink>
                  <SideLink to="/faq-test" icon={FileText}>
                    FAQ Test Panel
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
                  onClick={() => setMobileMenuOpen(true)}
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

            {/* Mobile sidebar drawer */}
            <MobileSidebar
              isOpen={mobileMenuOpen}
              onClose={() => setMobileMenuOpen(false)}
              onSignOut={signOut}
              isSuperAdmin={checkedSuperAdmin && isSuperAdmin}
              activeGroupByPath={activeGroupByPath}
            />

            {/* Desktop top bar */}
            <div className="hidden md:block sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-panel)] backdrop-blur-sm">
              <div className="flex items-center justify-between px-6 py-3 gap-4">
                {/* Left: brand + org pill + Motive */}
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-[var(--text-muted)]">
                    Atlas Command
                  </span>
                  <OrgSwitcher />
                  <button
                    type="button"
                    onClick={handleConnectMotive}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-muted)] hover:text-[var(--text-base)] hover:border-emerald-500/60 hover:bg-emerald-500/10 transition-colors"
                    title="Connect your Motive account to Atlas Command"
                  >
                    <Plug className="h-4 w-4" />
                    <span className="hidden sm:inline">Connect Motive</span>
                    <span className="sm:hidden">Motive</span>
                  </button>
                </div>

                {/* Right: notifications + avatar */}
                <div className="flex items-center gap-2">
                  <NotificationBell />
                  <AvatarMenu onSignOut={signOut} />
                </div>
              </div>
            </div>

            {/* Routed content */}
            <div className="p-4 md:p-6">
              <Outlet />

              <AIQuickLauncher openTrigger={aiChatTrigger} />

              <DipsyFloatingWidget
                initialState={dipsyState}
                defaultPosition={{
                  x:
                    typeof window !== "undefined"
                      ? window.innerWidth - 250
                      : 100,
                  y: 100,
                }}
                onAskDipsy={() => {
                  if (dipsyState === "sleeping") {
                    setDipsyState("idle");
                    setTimeout(() => {
                      setDipsyState("confident-lightbulb");
                      setTimeout(() => setDipsyState("idle"), 1500);
                    }, 300);
                  } else {
                    setDipsyState("confident-lightbulb");
                    setTimeout(() => setDipsyState("idle"), 1500);
                  }
                  setAiChatTrigger((prev) => prev + 1);
                }}
              />
            </div>
          </main>
        </div>
      </div>
      <Analytics />
    </DipsyContext.Provider>
  );
}