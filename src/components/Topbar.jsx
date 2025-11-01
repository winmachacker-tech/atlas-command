import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function Topbar({ onOpenSidebar }) {
  const nav = useNavigate();
  const [userEmail, setUserEmail] = useState("");
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const session = data?.session ?? null;
      setHasSession(!!session);
      setUserEmail(session?.user?.email || "");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!mounted) return;
      setHasSession(!!session);
      setUserEmail(session?.user?.email || "");
    });

    load();
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setHasSession(false);
    setUserEmail("");
    nav("/login", { replace: true });
  }

  return (
    <div className="sticky top-0 z-10 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-zinc-200/60 dark:border-neutral-800">
      <div className="h-14 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {/* Mobile sidebar button */}
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={onOpenSidebar}
            className="md:hidden inline-flex items-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-neutral-900"
          >
            <Menu size={18} />
          </button>

          <Link to="/dashboard" className="font-medium">Command Center</Link>
          <span className="text-xs text-zinc-500">v0.1 • Dev</span>
        </div>

        <div className="flex items-center gap-3">
          {hasSession ? (
            <>
              <span className="hidden md:inline text-xs text-zinc-500 dark:text-zinc-400">
                {userEmail}
              </span>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
              >
                <LogOut size={16} />
                Logout
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="text-xs underline text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
