import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { MailPlus, Loader2, X } from "lucide-react";

/**
 * InviteButton (forced-Authorization variant)
 * - Explicitly adds Authorization: Bearer <access_token> header when invoking the Edge Function.
 * - Hides itself for non-admins by checking public.users.is_admin for the current user.
 * - Shows detailed error messages to speed up debugging.
 *
 * Usage:
 *   import InviteButton from "../components/InviteButton.jsx";
 *   <InviteButton onInvited={() => reloadUsers()} />
 */
export default function InviteButton({ onInvited }) {
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = useMemo(() => `${window.location.origin}/set-password`, []);

  // --- Admin check (reads from your public.users table) ---
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoadingAdmin(true);

        const { data: userRes, error: authErr } = await supabase.auth.getUser();
        if (authErr || !userRes?.user) {
          if (active) setIsAdmin(false);
          return;
        }

        const uid = userRes.user.id;
        const { data, error } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", uid)
          .maybeSingle();

        if (!active) return;

        if (error) {
          console.error("Admin check error:", error);
          setIsAdmin(false);
        } else {
          setIsAdmin(Boolean(data?.is_admin));
        }
      } catch (e) {
        console.error("Admin check exception:", e);
        if (active) setIsAdmin(false);
      } finally {
        if (active) setLoadingAdmin(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // --- Submit handler: force-send Authorization header ---
  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) return;

    setSubmitting(true);
    try {
      // 1) Get the current session and access token explicitly
      const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        console.error("getSession error:", sessErr);
        alert("Invite failed: Unable to get session. Please re-login.");
        return;
      }

      const accessToken = sessionRes?.session?.access_token;
      if (!accessToken) {
        console.error("No access token found.");
        alert("Invite failed: Not signed in. Please log in again.");
        return;
      }

      // 2) Call the Edge Function and FORCE the Authorization header
      const { data, error } = await supabase.functions.invoke("admin-invite-user", {
        body: { email, role, redirectTo },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // 3) Handle supabase-js level errors
      if (error) {
        // error.message is often generic; try to pull server JSON if present
        console.error("Supabase invoke error:", error);
        alert(`Invite failed (invoke): ${error.message || "Unknown error"}`);
        return;
      }

      // 4) Handle function-level error payloads
      if (data?.error) {
        console.error("Function returned error payload:", data);
        const details = data.details ? `\nDetails: ${data.details}` : "";
        alert(`Invite failed: ${data.error}${details}`);
        return;
      }

      alert(`Invite sent to ${email}`);
      setEmail("");
      setRole("user");
      setOpen(false);
      onInvited?.();
    } catch (err) {
      console.error("Invite exception:", err);
      alert("Invite failed: Internal error. Check console for details.");
    } finally {
      setSubmitting(false);
    }
  }

  // While checking admin, keep layout stable (optional)
  if (loadingAdmin) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-400"
        title="Checking permissions…"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Invite
      </button>
    );
  }

  // Hide for non-admins (keeps it clean)
  if (!isAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
      >
        <MailPlus className="h-4 w-4" />
        Invite
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !submitting && setOpen(false)}
          />
          <div className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Invite a user
              </h3>
              <button
                onClick={() => !submitting && setOpen(false)}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Close"
              >
                <X className="h-5 w-5 text-zinc-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-zinc-600 dark:text-zinc-300">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-zinc-600 dark:text-zinc-300">Role (optional)</label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="user"
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-zinc-500">
                  Stored in user metadata as <code>app_role</code> on invite.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !email}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send invite
                </button>
              </div>
            </form>

            <div className="px-5 pb-5">
              <p className="text-xs text-zinc-500">
                The invite link will redirect to: <span className="font-mono">{redirectTo}</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
