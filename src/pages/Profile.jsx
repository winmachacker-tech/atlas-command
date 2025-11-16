import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  UserRound,
  KeyRound,
  ShieldCheck,
  Save,
  Loader2,
  ImagePlus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Profile & Account
 * - Back button (history back or "/")
 * - Avatar upload via Edge Function: /functions/v1/avatar-upload
 *   -> requires deployed Supabase function "avatar-upload"
 *   -> returns { publicUrl, path, userId, dbUpdated }
 * - Updates user_metadata: { full_name, phone, avatar_url, avatar_key }
 * - Email is read-only
 *
 * Added:
 * - Organization section:
 *   - Loads user's default org via team_members
 *   - Reads org name from orgs (fallback: organizations)
 *   - Allows renaming org (updates orgs + organizations)
 *
 * Optional env:
 *   VITE_SUPABASE_FUNCTIONS_URL (falls back to `${VITE_SUPABASE_URL}/functions/v1`)
 */
export default function Profile() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // auth/user
  const [userId, setUserId] = useState(null);

  // Profile form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarKey, setAvatarKey] = useState("");
  const fileInputRef = useRef(null);

  // Password form
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const [lastSignIn, setLastSignIn] = useState(null);
  const [note, setNote] = useState("");

  // Org info
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState("");
  const [orgSaving, setOrgSaving] = useState(false);

  // Prefer explicit functions URL, else rely on project URL
  const FUNCTIONS_URL =
    import.meta.env.VITE_SUPABASE_FUNCTIONS_URL?.replace(/\/+$/, "") ||
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setNote("");

        const [{ data: sess }, { data: usr }] = await Promise.all([
          supabase.auth.getSession(),
          supabase.auth.getUser(),
        ]);

        const user = usr?.user ?? sess?.session?.user ?? null;
        if (!alive || !user) {
          setLoading(false);
          return;
        }

        setUserId(user.id);
        const meta = user.user_metadata || {};
        setFullName(meta.full_name || meta.name || "");
        setPhone(meta.phone || "");
        setEmail(user.email || "");
        setLastSignIn(user.last_sign_in_at || sess?.session?.expires_at || null);

        // avatar (read from metadata)
        const key = meta.avatar_key || meta.avatarPath || "";
        const url = meta.avatar_url || "";
        setAvatarKey(key || "");
        setAvatarUrl(url || "");

        // --- Load organization info for this user ---
        // 1) Get default membership from team_members
        const { data: memberships, error: tmError } = await supabase
          .from("team_members")
          .select("org_id, is_default, role, status")
          .eq("user_id", user.id)
          .order("is_default", { ascending: false })
          .limit(1);

        if (tmError) throw tmError;

        const defaultMembership = memberships?.[0] || null;

        if (defaultMembership?.org_id) {
          const thisOrgId = defaultMembership.org_id;

          // 2) Try to load name from orgs
          const { data: orgsData, error: orgsError } = await supabase
            .from("orgs")
            .select("id, name")
            .eq("id", thisOrgId)
            .limit(1);

          if (orgsError) throw orgsError;

          let name = orgsData?.[0]?.name || "";

          // 3) Fallback: try organizations if orgs row missing
          if (!name) {
            const { data: orgMirrorData, error: orgMirrorError } = await supabase
              .from("organizations")
              .select("id, name")
              .eq("id", thisOrgId)
              .limit(1);

            if (orgMirrorError) throw orgMirrorError;
            name = orgMirrorData?.[0]?.name || "";
          }

          if (alive) {
            setOrgId(thisOrgId);
            setOrgName(name || "");
          }
        }
      } catch (err) {
        console.error("[Profile] init error:", err);
        if (alive) {
          setNote(err.message || "Could not load your profile.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function onSaveProfile(e) {
    e.preventDefault();
    try {
      setBusy(true);
      setNote("");
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName, phone, avatar_url: avatarUrl, avatar_key: avatarKey },
      });
      if (error) throw error;
      setNote("Profile updated.");
    } catch (err) {
      console.error(err);
      setNote(err.message || "Failed to update profile.");
    } finally {
      setBusy(false);
    }
  }

  async function onChangePassword(e) {
    e.preventDefault();
    if (!pw1 || !pw2) return setNote("Enter and confirm your new password.");
    if (pw1 !== pw2) return setNote("Passwords do not match.");

    try {
      setBusy(true);
      setNote("");
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      setPw1("");
      setPw2("");
      setNote("Password changed.");
    } catch (err) {
      console.error(err);
      setNote(err.message || "Failed to change password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAvatarSelected(file) {
    if (!file) return;
    if (!userId) {
      setNote("Not signed in.");
      return;
    }

    try {
      setUploading(true);
      setNote("");

      // Basic guards
      if (!file.type?.startsWith("image/")) {
        setNote("Please choose an image file.");
        return;
      }
      // Client cap (function allows up to 10MB; keep tighter client-side guard if desired)
      if (file.size > 5 * 1024 * 1024) {
        setNote("Image too large (max 5MB).");
        return;
      }

      // Get the current access token for the function Authorization header
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess?.session?.access_token;
      if (!accessToken) {
        setNote("Missing access token.");
        return;
      }

      // Send to Edge Function (service-role does the privileged work)
      const form = new FormData();
      form.append("file", file);

      const res = await fetch(`${FUNCTIONS_URL}/avatar-upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      });

      // The function always returns JSON (even on error)
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          json?.detail || json?.error || `Upload failed (${res.status})`;
        throw new Error(msg);
      }

      // Expect: { publicUrl, path, userId, dbUpdated }
      const { publicUrl, path, dbUpdated } = json;

      if (!publicUrl) {
        throw new Error("Upload OK but missing publicUrl.");
      }

      // Cache-bust the avatar preview to reflect the fresh upload immediately
      const previewUrl = `${publicUrl}${
        publicUrl.includes("?") ? "&" : "?"
      }t=${Date.now()}`;

      // Update UI immediately
      setAvatarKey(path || "");
      setAvatarUrl(previewUrl);

      // Persist to user metadata (metadata is separate from the function's DB write)
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl, avatar_key: path || "" },
      });

      if (metaErr) {
        console.warn("Avatar uploaded, but metadata update failed:", metaErr);
        setNote("Photo uploaded, but profile metadata update had an issue.");
      } else {
        setNote(dbUpdated ? "Profile photo updated." : "Photo uploaded.");
      }
    } catch (err) {
      console.error(err);
      setNote(err.message || "Failed to upload profile photo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onSaveOrgName(e) {
    e.preventDefault();
    setNote("");

    if (!orgId) {
      setNote("No organization is linked to this account.");
      return;
    }

    const trimmed = (orgName || "").trim();
    if (!trimmed) {
      setNote("Organization name cannot be empty.");
      return;
    }
    if (trimmed.length < 3) {
      setNote("Organization name should be at least 3 characters long.");
      return;
    }

    try {
      setOrgSaving(true);

      // Update orgs
      const { error: orgUpdateError } = await supabase
        .from("orgs")
        .update({ name: trimmed })
        .eq("id", orgId);

      if (orgUpdateError) throw orgUpdateError;

      // Update organizations mirror
      const { error: orgMirrorUpdateError } = await supabase
        .from("organizations")
        .update({ name: trimmed })
        .eq("id", orgId);

      if (orgMirrorUpdateError) throw orgMirrorUpdateError;

      setNote("Organization name updated.");
    } catch (err) {
      console.error("[Profile] Failed to update org name:", err);
      setNote(err.message || "Failed to update organization name.");
    } finally {
      setOrgSaving(false);
    }
  }

  const onBack = () => {
    if (window.history.length > 1) nav(-1);
    else nav("/");
  };

  const avatarInitials = useMemo(() => {
    const n = (fullName || email || "U").trim();
    const parts = n.split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase()).join("");
  }, [fullName, email]);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Top bar with Back */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 h-10 px-3 rounded-xl
                     border border-[var(--border)] bg-[var(--panel)]
                     text-[var(--text-base)] hover:shadow-sm transition"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
        <div className="ml-2">
          <h1 className="text-2xl md:text-3xl font-semibold text-[var(--text-strong)]">
            Profile &amp; Account
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Manage your personal details, organization, and account security.
          </p>
        </div>
        <div className="ml-auto hidden md:flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <ShieldCheck className="h-4 w-4" />
          <span>Self-managed</span>
        </div>
      </div>

      {/* Status / note */}
      {note ? (
        <div
          className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--panel)]
                        text-[var(--text-base)] px-4 py-3"
        >
          {note}
        </div>
      ) : null}

      {/* Profile panel */}
      <section
        className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--panel)]
                   shadow-sm overflow-hidden"
      >
        <div className="px-6 pt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl
                            bg-[var(--bg-muted)] border border-[var(--border)]"
            >
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-medium">Profile</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Basic details used across the app.
              </p>
            </div>
          </div>

          {/* Avatar uploader */}
          <div className="flex items-center gap-4">
            <div
              className="h-16 w-16 rounded-full border border-[var(--border)]
                         bg-[var(--bg-muted)] overflow-hidden grid place-items-center text-sm"
              title="Profile photo"
            >
              {avatarUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[var(--text-muted)]">{avatarInitials}</span>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-xl
                         border border-[var(--border)] bg-[var(--bg-input)]
                         text-[var(--text-base)] hover:shadow-sm transition disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              <span>{uploading ? "Uploading..." : "Change photo"}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleAvatarSelected(e.target.files?.[0])}
            />
          </div>
        </div>

        <form
          onSubmit={onSaveProfile}
          className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div className="col-span-1">
            <label className="block text-xs mb-1 text-[var(--text-muted)]">
              Full name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-[var(--border)]
                         bg-[var(--bg-input)] text-[var(--text-base)]
                         focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
              placeholder="Your name"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs mb-1 text-[var(--text-muted)]">
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-[var(--border)]
                         bg-[var(--bg-input)] text-[var(--text-base)]
                         focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
              placeholder="(555) 555-5555"
            />
          </div>

          <div className="col-span-1 md:col-span-2">
            <label className="block text-xs mb-1 text-[var(--text-muted)]">
              Email
            </label>
            <input
              type="email"
              value={email}
              disabled
              readOnly
              className="w-full h-11 px-3 rounded-xl border border-[var(--border)]
                         bg-[var(--bg-muted)]/60 text-[var(--text-muted)]
                         cursor-not-allowed"
            />
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Email changes require admin or identity re-verification.
            </p>
          </div>

          <div className="col-span-1 md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busy || loading}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl
                         bg-[var(--accent)] text-white disabled:opacity-60
                         shadow-sm hover:shadow transition"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>Save changes</span>
            </button>
          </div>
        </form>
      </section>

      {/* Organization panel */}
      <section
        className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--panel)]
                   shadow-sm overflow-hidden"
      >
        <div className="flex items-center gap-3 px-6 pt-6">
          <div
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl
                          bg-[var(--bg-muted)] border border-[var(--border)]"
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-medium">Organization</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Rename your default organization. This is how your company appears in Atlas.
            </p>
          </div>
        </div>

        <form
          onSubmit={onSaveOrgName}
          className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div className="col-span-1 md:col-span-2">
            <label className="block text-xs mb-1 text-[var(--text-muted)]">
              Organization name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={!orgId}
              className="w-full h-11 px-3 rounded-xl border border-[var(--border)]
                         bg-[var(--bg-input)] text-[var(--text-base)]
                         focus:outline-none focus:ring-4 focus:ring-[var(--ring)]
                         disabled:bg-[var(--bg-muted)]/60 disabled:text-[var(--text-muted)]
                         disabled:cursor-not-allowed"
              placeholder="e.g. VNG Transport Inc"
            />
            {orgId ? (
              <p className="mt-1 text-[10px] text-[var(--text-muted)] font-mono">
                org_id: <span className="text-[var(--text-base)]">{orgId}</span>
              </p>
            ) : (
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                No organization is linked to this account yet.
              </p>
            )}
          </div>

          <div className="col-span-1 md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={orgSaving || loading || !orgId}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl
                         bg-[var(--accent)] text-white disabled:opacity-60
                         shadow-sm hover:shadow transition"
            >
              {orgSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>Save org name</span>
            </button>
          </div>
        </form>
      </section>

      {/* Security panel */}
      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--panel)]
                   shadow-sm overflow-hidden"
      >
        <div className="flex items-center gap-3 px-6 pt-6">
          <div
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl
                          bg-[var(--bg-muted)] border border-[var(--border)]"
          >
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-medium">Security</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Change your password and review recent access.
            </p>
          </div>
        </div>

        <form
          onSubmit={onChangePassword}
          className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div className="col-span-1">
            <label className="block text-xs mb-1 text-[var(--text-muted)]">
              New password
            </label>
            <input
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-[var(--border)]
                         bg-[var(--bg-input)] text-[var(--text-base)]
                         focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs mb-1 text-[var(--text-muted)]">
              Confirm password
            </label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-[var(--border)]
                         bg-[var(--bg-input)] text-[var(--text-base)]
                         focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
            />
          </div>

          <div className="col-span-1 md:col-span-2 text-xs text-[var(--text-muted)]">
            {lastSignIn ? (
              <span>Last sign-in: {new Date(lastSignIn).toLocaleString()}</span>
            ) : (
              <span>Last sign-in: —</span>
            )}
          </div>

          <div className="col-span-1 md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busy || loading}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl
                         bg-[var(--accent)] text-white disabled:opacity-60
                         shadow-sm hover:shadow transition"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              <span>Change password</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
