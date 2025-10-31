// src/components/Topbar.jsx
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useActiveOrg } from "../lib/useActiveOrg";
import { LogOut, Plus, UserCircle2, Building2 } from "lucide-react";
import AddLoadModal from "./AddLoadModal";

export default function Topbar() {
  const loc = useLocation();
  const onLoads = loc.pathname.startsWith("/loads");

  const [showAdd, setShowAdd] = useState(false);
  const [user, setUser] = useState(null);
  const { orgName } = useActiveOrg();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user || null));
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-neutral-800">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          {loc.pathname === "/" ? "Dashboard" : formatTitle(loc.pathname)}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Show user + org */}
        {user && (
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <UserCircle2 className="h-4 w-4" />
            <span>{user.email}</span>
            {orgName && (
              <>
                <span className="text-neutral-400">•</span>
                <Building2 className="h-4 w-4" />
                <span>{orgName}</span>
              </>
            )}
          </div>
        )}

        {/* Add Load button */}
        {onLoads && (
          <>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-black text-white px-3 py-2 hover:bg-black/90"
              data-testid="add-load-btn"
              title="Add Load"
            >
              <Plus className="h-4 w-4" />
              Add Load
            </button>
            {showAdd && (
              <AddLoadModal
                open={showAdd}
                onClose={() => setShowAdd(false)}
                onCreated={() => setShowAdd(false)}
              />
            )}
          </>
        )}

        {/* Sign out button */}
        {user && (
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-sm"
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function formatTitle(pathname) {
  const map = {
    "/loads": "Loads",
    "/in-transit": "In Transit",
    "/trucks": "Trucks",
    "/admin/audit": "Admin Audit",
  };
  return map[pathname] || "Atlas Command";
}
