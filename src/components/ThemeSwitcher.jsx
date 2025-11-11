// src/components/ThemeSwitcher.jsx
// Adapter: keep existing imports/usages but render the new ThemeMenu dropdown.
// This prevents UI drift where the old card still appears in the sidebar.

import React from "react";
import ThemeMenu from "./ThemeMenu.jsx";

/**
 * ThemeSwitcher (Adapter)
 * ---------------------------------------------------------------------------
 * Any place that used to render the old card-based ThemeSwitcher will now
 * show the compact ThemeMenu button/dropdown insteadâ€”without touching other files.
 *
 * Usage stays the same:
 *   import ThemeSwitcher from "../components/ThemeSwitcher.jsx";
 *   <ThemeSwitcher className="ml-auto" />
 *
 * Optional props:
 *   - align: "right" | "left" | "center" (pass through to ThemeMenu in future)
 *   - className: Tailwind utility classes to position the button
 */
export default function ThemeSwitcher({ className = "", align = "right" }) {
  return <ThemeMenu className={className} align={align} />;
}

