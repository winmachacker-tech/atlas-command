// src/components/settings/SettingsLayout.jsx
import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  User,
  Bell,
  Palette,
  Plug,
  CreditCard,
  Shield,
  Users,
  Settings as SettingsIcon,
} from "lucide-react";

/**
 * Streamlined SettingsLayout
 * - Transparent integration with Atlas Command theme
 * - Slim sidebar accent line instead of second "block"
 * - Neutral darks instead of green panels
 */
const SettingsLayout = () => {
  const nav = [
    { path: "/settings/profile", label: "Profile & Account", icon: User },
    { path: "/settings/appearance", label: "Appearance", icon: Palette },
    { path: "/settings/notifications", label: "Notifications", icon: Bell },
    { path: "/settings/integrations", label: "Integrations", icon: Plug },
    { path: "/settings/billing", label: "Billing", icon: CreditCard },
    { path: "/settings/security", label: "Security", icon: Shield },
    { path: "/settings/team", label: "Team Management", icon: Users },
  ];

  return (
    <div className="flex min-h-screen bg-[#0f131a] text-white">
      {/* Slim settings sidebar */}
      <aside className="w-56 shrink-0 border-r border-gray-800 bg-[#121821]/80 backdrop-blur-xl">
        <div className="p-5 border-b border-gray-800 flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600/90 rounded-lg grid place-items-center">
            <SettingsIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Settings</h2>
            <p className="text-[11px] text-gray-400">Configure preferences</p>
          </div>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-1">
          {nav.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-all",
                  isActive
                    ? "bg-indigo-600/90 text-white"
                    : "text-gray-400 hover:text-white hover:bg-[#1b2430]",
                ].join(" ")
              }
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Right content area */}
      <main className="flex-1 overflow-auto bg-[#0f131a]">
        <Outlet />
      </main>
    </div>
  );
};

export default SettingsLayout;
