// src/components/Sidebar.jsx
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Truck,
  Users,
  Route as RouteIcon,
  CreditCard,
  UserRound,
  Paintbrush,
  Bell,
  Plug,
  Shield,
  BarChart3,
} from "lucide-react";

/**
 * Sidebar for Atlas Command
 * - Main Ops section
 * - AI Lab (Lane Intelligence)
 * - Settings section
 */

export default function Sidebar() {
  const linkBase =
    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors";
  const linkActive = "bg-[var(--brand-600)] text-white";
  const linkInactive =
    "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-base)]";

  return (
    <aside
      className="flex h-full w-64 flex-col border-r border-[var(--border)]
                 bg-[var(--bg-elev)] px-4 py-6"
    >
      {/* Brand / Logo */}
      <div className="mb-8 flex items-center gap-2 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--brand-600)] text-white font-bold">
          A
        </div>
        <div>
          <div className="text-base font-semibold leading-tight">
            Atlas Command
          </div>
          <div className="text-xs text-[var(--text-muted)]">Operations</div>
        </div>
      </div>

      {/* Main Nav Links */}
      <nav className="flex flex-col gap-1 text-sm">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </NavLink>

        <NavLink
          to="/loads"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <Truck className="h-4 w-4" />
          Loads
        </NavLink>

        <NavLink
          to="/drivers"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <Users className="h-4 w-4" />
          Drivers
        </NavLink>

        <NavLink
          to="/in-transit"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <RouteIcon className="h-4 w-4" />
          In Transit
        </NavLink>

        <NavLink
          to="/billing"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <CreditCard className="h-4 w-4" />
          Billing
        </NavLink>
      </nav>

      {/* Divider between Ops and AI */}
      <div className="my-6 border-t border-[var(--border)]" />

      {/* AI Lab Section */}
      <div className="mb-6 flex flex-col gap-1">
        <div className="px-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
          AI Lab
        </div>

        <NavLink
          to="/ai/lanes"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <BarChart3 className="h-4 w-4" />
          Lane Intelligence
        </NavLink>
      </div>

      {/* Divider between AI and Settings */}
      <div className="mb-4 border-t border-[var(--border)]" />

      {/* Settings Section */}
      <div className="flex flex-col gap-1">
        <div className="px-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
          Settings
        </div>

        <NavLink
          to="/settings/profile"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <UserRound className="h-4 w-4" />
          Profile &amp; Account
        </NavLink>

        <NavLink
          to="/settings/appearance"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <Paintbrush className="h-4 w-4" />
          Appearance
        </NavLink>

        <NavLink
          to="/settings/notifications"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <Bell className="h-4 w-4" />
          Notifications
        </NavLink>

        <NavLink
          to="/settings/integrations"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <Plug className="h-4 w-4" />
          Integrations
        </NavLink>

        <NavLink
          to="/settings/security"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <Shield className="h-4 w-4" />
          Security
        </NavLink>

        <NavLink
          to="/settings/team"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? linkActive : linkInactive}`
          }
        >
          <Users className="h-4 w-4" />
          Team Management
        </NavLink>
      </div>

      {/* Spacer / Footer */}
      <div className="mt-auto border-t border-[var(--border)] pt-4 text-xs text-[var(--text-muted)]">
        © {new Date().getFullYear()} Atlas Command
      </div>
    </aside>
  );
}
