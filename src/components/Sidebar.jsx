// src/components/Sidebar.jsx
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  Route,
  Truck,
  Shield,
  Users,
} from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/loads", label: "Loads", icon: ClipboardList },
  { to: "/in-transit", label: "In Transit", icon: Route },
  { to: "/trucks", label: "Trucks", icon: Truck },
  { to: "/drivers", label: "Drivers", icon: Users },
  { to: "/admin/audit", label: "Audit Log", icon: Shield },
];

export default function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
      <div className="h-14 flex items-center px-4 font-semibold tracking-wide">
        Atlas Command
      </div>
      <nav className="flex-1 px-2 py-2">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              "flex items-center gap-3 px-3 py-2 rounded-xl mb-1 " +
              (isActive
                ? "bg-black text-white"
                : "hover:bg-gray-100 dark:hover:bg-neutral-900")
            }
            end={to === "/"}
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
