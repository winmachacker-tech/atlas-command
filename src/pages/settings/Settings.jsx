// src/pages/settings/Profile.jsx
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  UserRound,
  Mail,
  Building2,
  Save,
  Loader2,
} from "lucide-react";

/**
 * Profile & Account (no internal sidebar)
 * - Standalone page for /settings/profile
 * - Fetches basic user + metadata and allows update
 * - No SettingsLayout, no left menu — clean content only
 */
export { default } from "../Settings.jsx";
export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError("");
      setOk("");
      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr) throw userErr;

        if (!user) throw new Error("No auth session");

        if (!mounted) return;
        setEmail(user.email || "");
        setFullName(
          user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            ""
        );
        setCompany(user.user_metadata?.company || "");
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || "Failed to load profile");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setOk("");
    try {
      const { data: { user }, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      if (!user) throw new Error("No auth session");

      // Update user metadata
      const { error: upErr } = await supabase.auth.updateUser({
        data: {
          full_name: fullName,
          company,
        },
      });
      if (upErr) throw upErr;

      setOk("Profile saved.");
    } catch (e) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Profile &amp; Account</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Manage your personal information and account details.
          </p>
        </div>
      </div>

      {/* Content card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading profile…
          </div>
        ) : (
          <form onSubmit={onSave} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
                {error}
              </div>
            )}
            {ok && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 px-3 py-2 text-sm">
                {ok}
              </div>
            )}

            {/* Email (read-only) */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Email</label>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-[var(--text-muted)]" />
                <input
                  value={email}
                  readOnly
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-app)] px-3 py-2 text-sm opacity-80 cursor-not-allowed"
                />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Email changes are managed by an administrator.
              </p>
            </div>

            {/* Full name */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Full name</label>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-[var(--text-muted)]" />
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-app)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            </div>

            {/* Company */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Company</label>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[var(--text-muted)]" />
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company name"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-app)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save changes
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
