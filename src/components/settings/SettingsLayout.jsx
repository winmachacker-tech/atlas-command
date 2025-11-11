// src/pages/settings/SettingsLayout.jsx
import React from "react";
import { Settings as SettingsIcon } from "lucide-react";

/**
 * SettingsLayout (menu-less)
 * - Removes the internal settings sidebar entirely.
 * - Keeps a simple header and renders {children} only.
 * - Use this for all settings subpages: Profile, Appearance, Notifications, etc.
 *
 * Usage:
 *   <SettingsLayout title="Profile & Account" subtitle="Manage your account">
 *     ...page content...
 *   </SettingsLayout>
 */
export default function SettingsLayout({
  title = "Settings",
  subtitle = "Configure preferences",
  children,
}) {
  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl grid place-items-center bg-[var(--brand-700,#4f46e5)]/20 text-[var(--brand-500,#8b5cf6)]">
            <SettingsIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Content (no internal menu) */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-5">
        {children}
      </div>
    </div>
  );
}

