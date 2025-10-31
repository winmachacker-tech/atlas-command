import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function MainLayout() {
  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-slate-100">
      <div className="relative flex min-h-screen">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          <Topbar />
          <main className="flex-1 min-w-0 overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
