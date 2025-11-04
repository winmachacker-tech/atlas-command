// src/pages/settings/ProfileSettings.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  User,
  Mail,
  Phone,
  Building2,
  Save,
  Upload,
  Shield,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { getProfile, updateProfile, uploadAvatar } from "../../lib/userSettings";

/** Simple bus: other parts of the app can listen for profile updates */
function emitProfileUpdated(detail) {
  try {
    // Helpful for listeners AND DevTools
    localStorage.setItem("atlas:displayName", detail?.fullName || "");
  } catch {}
  window.dispatchEvent(new CustomEvent("profile:updated", { detail }));
}

export default function ProfileSettings() {
  const fileRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "idle", msg: "" });

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    title: "",
    timezone: "America/Los_Angeles",
  });

  /* ------------------------------ Load profile ----------------------------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const p = await getProfile();
        if (!mounted) return;
        setForm({
          fullName: p.fullName ?? "",
          email: p.email ?? "",
          phone: p.phone ?? "",
          company: p.company ?? "",
          title: p.title ?? "",
          timezone: p.timezone ?? "America/Los_Angeles",
        });
        setAvatarUrl(p.avatar_url || null);
        setStatus({ type: "idle", msg: "" });
      } catch (err) {
        console.error("[ProfileSettings] load error:", err);
        setStatus({
          type: "error",
          msg:
            err?.message ||
            "Failed to load profile. Please refresh or re-login.",
        });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /* ------------------------------ Handlers -------------------------------- */
  function onChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      setStatus({ type: "idle", msg: "" });

      const updated = await updateProfile({
        fullName: form.fullName,
        phone: form.phone,
        company: form.company,
        title: form.title,
        timezone: form.timezone,
      });

      // Reflect returned values
      const merged = {
        ...form,
        fullName: updated.fullName ?? form.fullName,
        phone: updated.phone ?? form.phone,
        company: updated.company ?? form.company,
        title: updated.title ?? form.title,
        timezone: updated.timezone ?? form.timezone,
        email: updated.email ?? form.email,
      };
      setForm(merged);
      if (updated.avatar_url) setAvatarUrl(updated.avatar_url);

      // 🔔 Notify app (sidebar etc.) immediately
      emitProfileUpdated({
        fullName: merged.fullName,
        email: merged.email,
        avatar_url: updated.avatar_url || avatarUrl || null,
      });

      setStatus({ type: "success", msg: "Profile updated." });
    } catch (err) {
      console.error("[ProfileSettings] save error:", err);
      setStatus({
        type: "error",
        msg: err?.message || "Failed to save. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onPickAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setSaving(true);
      setStatus({ type: "idle", msg: "" });

      const { avatar_url } = await uploadAvatar(file);
      setAvatarUrl(avatar_url || null);

      // 🔔 Notify app so any user chips/avatars update right away
      emitProfileUpdated({
        fullName: form.fullName,
        email: form.email,
        avatar_url: avatar_url || null,
      });

      setStatus({ type: "success", msg: "Avatar updated." });
    } catch (err) {
      console.error("[ProfileSettings] avatar upload error:", err);
      setStatus({
        type: "error",
        msg: err?.message || "Avatar upload failed.",
      });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setSaving(false);
    }
  }

  function onReset() {
    setForm((_) => ({
      fullName: "",
      email: form.email,
      phone: "",
      company: "",
      title: "",
      timezone: "America/Los_Angeles",
    }));
    setStatus({ type: "idle", msg: "" });
  }

  /* --------------------------------- UI ----------------------------------- */
  return (
    <div className="min-h-[calc(100vh-0px)] bg-[#0f131a] text-white">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-gray-900/70 bg-[#0f131a] sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Profile & Account</h1>
            <p className="text-sm text-gray-400">
              Manage your personal details and account settings.
            </p>
          </div>

          <div className="hidden md:flex items-center gap-3 text-xs">
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                <span className="text-gray-400">Saving…</span>
              </>
            ) : status.type === "success" ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Saved</span>
              </>
            ) : status.type === "error" ? (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400">{status.msg}</span>
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 text-gray-400" />
                <span className="text-gray-400">Changes are saved securely</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <form onSubmit={onSubmit} className="px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Avatar card */}
          <section className="lg:col-span-1 bg-[#121821] border border-gray-900/70 rounded-2xl p-6">
            <h2 className="text-sm font-medium text-gray-300 mb-4">
              Profile Photo
            </h2>

            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl bg-[#171e29] border border-gray-900/70 overflow-hidden grid place-items-center">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-8 h-8 text-gray-500" />
                )}
              </div>

              <div>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#171e29] border border-gray-900/70 cursor-pointer hover:bg-[#1d2634] transition">
                  <Upload className="w-4 h-4" />
                  <span className="text-sm">
                    {saving ? "Uploading…" : "Upload"}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPickAvatar}
                    disabled={saving}
                  />
                </label>
                <p className="text-xs text-gray-500 mt-2">
                  PNG/JPG/WebP up to ~2&nbsp;MB.
                </p>
              </div>
            </div>
          </section>

          {/* Form card */}
          <section className="lg:col-span-2 bg-[#121821] border border-gray-900/70 rounded-2xl p-6">
            <h2 className="text-sm font-medium text-gray-300 mb-4">
              Personal Information
            </h2>

            {loading ? (
              <div className="flex items-center gap-3 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading profile…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Full name */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Full name
                    </label>
                    <div className="flex items-center gap-2 bg-[#171e29] border border-gray-900/70 rounded-lg px-3">
                      <User className="w-4 h-4 text-gray-500" />
                      <input
                        className="w-full bg-transparent py-2.5 outline-none text-sm"
                        value={form.fullName}
                        onChange={(e) => onChange("fullName", e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Email
                    </label>
                    <div className="flex items-center gap-2 bg-[#171e29] border border-gray-900/70 rounded-lg px-3 opacity-90">
                      <Mail className="w-4 h-4 text-gray-500" />
                      <input
                        className="w-full bg-transparent py-2.5 outline-none text-sm"
                        value={form.email}
                        readOnly
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Phone
                    </label>
                    <div className="flex items-center gap-2 bg-[#171e29] border border-gray-900/70 rounded-lg px-3">
                      <Phone className="w-4 h-4 text-gray-500" />
                      <input
                        className="w-full bg-transparent py-2.5 outline-none text-sm"
                        value={form.phone}
                        onChange={(e) => onChange("phone", e.target.value)}
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                  </div>

                  {/* Company */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Company
                    </label>
                    <div className="flex items-center gap-2 bg-[#171e29] border border-gray-900/70 rounded-lg px-3">
                      <Building2 className="w-4 h-4 text-gray-500" />
                      <input
                        className="w-full bg-transparent py-2.5 outline-none text-sm"
                        value={form.company}
                        onChange={(e) => onChange("company", e.target.value)}
                        placeholder="T3RA Logistics"
                      />
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Title
                    </label>
                    <input
                      className="w-full bg-[#171e29] border border-gray-900/70 rounded-lg px-3 py-2.5 outline-none text-sm"
                      value={form.title}
                      onChange={(e) => onChange("title", e.target.value)}
                      placeholder="Director of Operational Development"
                    />
                  </div>

                  {/* Timezone */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Timezone
                    </label>
                    <select
                      className="w-full bg-[#171e29] border border-gray-900/70 rounded-lg px-3 py-2.5 outline-none text-sm"
                      value={form.timezone}
                      onChange={(e) => onChange("timezone", e.target.value)}
                    >
                      <option value="America/Los_Angeles">America/Los_Angeles</option>
                      <option value="America/Denver">America/Denver</option>
                      <option value="America/Chicago">America/Chicago</option>
                      <option value="America/New_York">America/New_York</option>
                    </select>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg border border-gray-900/70 bg-[#171e29] text-sm hover:bg-[#1d2634] transition"
                    onClick={onReset}
                    disabled={saving}
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 transition text-sm disabled:opacity-70"
                    aria-label="Save profile"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Save changes
                      </>
                    )}
                  </button>
                </div>

                {/* Inline status for small screens */}
                <div className="mt-3 md:hidden">
                  {status.type === "success" && (
                    <p className="text-xs text-emerald-400 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {status.msg || "Saved."}
                    </p>
                  )}
                  {status.type === "error" && (
                    <p className="text-xs text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {status.msg || "Action failed."}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </form>
    </div>
  );
}
