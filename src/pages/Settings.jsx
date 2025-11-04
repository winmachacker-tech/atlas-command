// src/pages/Settings.jsx
import React from "react";
import ThemeMenu from "../components/ThemeMenu.jsx";

export default function Settings() {
  return (
    <div className="w-full">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Configure your Atlas Command preferences.
        </p>
      </div>

      {/* Appearance Section */}
      <section className="rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Appearance
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Changes apply instantly and persist.
          </span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            Choose a theme (Light/Dark/System) and a brand color.
          </div>
          {/* The new dropdown button */}
          <ThemeMenu />
        </div>
      </section>

      {/* (Optional) Add more settings sections below */}
      {/* <section className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
        <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">Notifications</h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">Configure email and in-app alerts.</p>
      </section> */}
    </div>
  );
}
