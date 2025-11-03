// src/layout/MainLayout.jsx
import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  PackageSearch,
  Truck,
  Route,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Settings as SettingsIcon,
  Users,
  ShieldCheck,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function NavItem({ to, icon: Icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cx(
          "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
          "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/70",
          isActive && "bg-zinc-900/80 text-zinc-100"
        )
      }
    >
      <Icon className="size-4" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function Sidebar({ onNavigate }) {
  return (
    <aside
      className={cx(
        "hidden lg:flex",
        "h-full w-64 shrink-0 flex-col gap-4",
        "border-r border-zinc-800/80 bg-zinc-950/60 backdrop-blur"
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 pt-4">
        <div className="flex size-8 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60">
          <LayoutGrid className="size-4 text-emerald-400" />
        </div>
        <div className="text-sm font-semibold text-zinc-100">
          Atlas Command
        </div>
      </div>

      {/* Nav */}
      <nav className="mt-2 flex flex-1 flex-col gap-1 px-2 pb-4">
        <div className="px-2 pb-2 pt-3 text-xs uppercase tracking-wide text-zinc-500">
          Overview
        </div>
        <NavItem to="/dashboard" icon={LayoutGrid} label="Dashboard" onClick={onNavigate} />

        <div className="px-2 pb-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">
          Operations
        </div>
        <NavItem to="/loads" icon={PackageSearch} label="All Loads" onClick={onNavigate} />
        <NavItem to="/in-transit" icon={Route} label="In Transit" onClick={onNavigate} />
        <NavItem to="/delivered" icon={CheckCircle2} label="Delivered" onClick={onNavigate} />
        <NavItem to="/problem-board" icon={AlertTriangle} label="Problem Board" onClick={onNavigate} />
        <NavItem to="/trucks" icon={Truck} label="Trucks" onClick={onNavigate} />
        <NavItem to="/drivers" icon={Activity} label="Drivers" onClick={onNavigate} />

        <div className="px-2 pb-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">
          Admin
        </div>
        <NavItem to="/users" icon={Users} label="Users" onClick={onNavigate} />
        <NavItem to="/settings" icon={SettingsIcon} label="Settings" onClick={onNavigate} />
        <NavItem to="/admin/audit" icon={ShieldCheck} label="Admin Audit" onClick={onNavigate} />
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-800/80 p-3">
        <SmallProfile />
      </div>
    </aside>
  );
}

function MobileDrawer({ open, setOpen }) {
  const close = () => setOpen(false);
  return (
    <div
      className={cx(
        "lg:hidden",
        open ? "fixed inset-0 z-50" : "hidden"
      )}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={close}
      />
      <div className="absolute inset-y-0 left-0 w-72 border-r border-zinc-800 bg-zinc-950 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60">
              <LayoutGrid className="size-4 text-emerald-400" />
            </div>
            <div className="text-sm font-semibold text-zinc-100">
              Atlas Command
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-lg border border-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-900"
          >
            <X className="size-4" />
          </button>
        </div>
        <nav className="flex flex-col gap-1">
          <NavItem to="/dashboard" icon={LayoutGrid} label="Dashboard" onClick={close} />
          <div className="mt-3 text-xs uppercase tracking-wide text-zinc-500">Operations</div>
          <NavItem to="/loads" icon={PackageSearch} label="All Loads" onClick={close} />
          <NavItem to="/in-transit" icon={Route} label="In Transit" onClick={close} />
          <NavItem to="/delivered" icon={CheckCircle2} label="Delivered" onClick={close} />
          <NavItem to="/problem-board" icon={AlertTriangle} label="Problem Board" onClick={close} />
          <NavItem to="/trucks" icon={Truck} label="Trucks" onClick={close} />
          <NavItem to="/drivers" icon={Activity} label="Drivers" onClick={close} />

          <div className="mt-3 text-xs uppercase tracking-wide text-zinc-500">Admin</div>
          <NavItem to="/users" icon={Users} label="Users" onClick={close} />
          <NavItem to="/settings" icon={SettingsIcon} label="Settings" onClick={close} />
          <NavItem to="/admin/audit" icon={ShieldCheck} label="Admin Audit" onClick={close} />
        </nav>
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <SmallProfile />
        </div>
      </div>
    </div>
  );
}

function SmallProfile() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const e = data?.user?.email ?? "";
      setEmail(e);
    });
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-2">
      <div className="min-w-0">
        <div className="truncate text-xs text-zinc-400">{email || "Signed in"}</div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Admin</div>
      </div>
      <button
        onClick={signOut}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
      >
        <LogOut className="size-3.5" />
        Logout
      </button>
    </div>
  );
}

export default function MainLayout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);

  return (
    <div className="flex min-h-dvh w-full bg-zinc-950 text-zinc-100">
      {/* Desktop Sidebar */}
      <Sidebar onNavigate={() => {}} />

      {/* Mobile Drawer */}
      <MobileDrawer open={open} setOpen={setOpen} />

      {/* Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/70 px-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <button
              className="lg:hidden rounded-lg border border-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-900"
              onClick={() => setOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="hidden pl-1 text-sm text-zinc-400 lg:block">
              {loc.pathname}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* room for notifications, search, theme toggle */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-300">
              Enterprise
            </div>
          </div>
        </header>

        {/* Scrollable page area */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
