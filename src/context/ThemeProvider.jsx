import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * ThemeProvider.jsx
 * ----------------------------------------------------------------------------
 * - Manages theme: "light" | "dark" | "system"
 * - Manages brandColor: hex string (#RRGGBB)
 * - Persists to localStorage
 * - Applies CSS variables to :root ( --ac-primary, --ac-primary-50..900, --ac-on-primary )
 * - Adds data-theme="light|dark" on <html> for dark-mode styles
 *
 * API:
 *   const { theme, resolvedTheme, setTheme, brandColor, setBrandColor } = useTheme();
 *
 * Safe to import with:  import { ThemeProvider, useTheme } from "../context/ThemeProvider.jsx";
 */

const THEME_KEY = "atlas.theme.mode";          // "light" | "dark" | "system"
const BRAND_KEY = "atlas.theme.brandColor";    // "#RRGGBB"

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

/* ----------------------------- Helpers (no deps) ----------------------------- */

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

function getStoredMode() {
  if (!isBrowser) return "system";
  try {
    return localStorage.getItem(THEME_KEY) || "system";
  } catch {
    return "system";
  }
}

function setStoredMode(mode) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {}
}

function getStoredBrand() {
  if (!isBrowser) return "#4F46E5";
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (!raw) return "#4F46E5";
    const ok = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.trim());
    return ok ? raw.toUpperCase() : "#4F46E5";
  } catch {
    return "#4F46E5";
  }
}

function setStoredBrand(hex) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(BRAND_KEY, hex);
  } catch {}
}

// color math
function hexToRgb(hex) {
  let s = hex.replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" + [cl(r), cl(g), cl(b)].map((v) => v.toString(16).padStart(2, "0")).join("")
  ).toUpperCase();
}
function luminance({ r, g, b }) {
  const s = [r, g, b].map((v) => v / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}
function idealTextOn(rgb) {
  return luminance(rgb) > 0.55 ? "#111111" : "#FFFFFF";
}
function adjust(rgb, pct) {
  const f = pct / 100;
  return {
    r: rgb.r + (pct >= 0 ? (255 - rgb.r) * f : rgb.r * f),
    g: rgb.g + (pct >= 0 ? (255 - rgb.g) * f : rgb.g * f),
    b: rgb.b + (pct >= 0 ? (255 - rgb.b) * f : rgb.b * f),
  };
}
function buildPalette(hex) {
  const base = hexToRgb(hex);
  return {
    50: rgbToHex(adjust(base, 46)),
    100: rgbToHex(adjust(base, 40)),
    200: rgbToHex(adjust(base, 28)),
    300: rgbToHex(adjust(base, 18)),
    400: rgbToHex(adjust(base, 9)),
    500: rgbToHex(base),
    600: rgbToHex(adjust(base, -8)),
    700: rgbToHex(adjust(base, -16)),
    800: rgbToHex(adjust(base, -24)),
    900: rgbToHex(adjust(base, -32)),
  };
}

function applyBrandVariables(hex) {
  if (!isBrowser) return;
  const root = document.documentElement;
  const pal = buildPalette(hex);
  root.style.setProperty("--ac-primary", hex);
  Object.entries(pal).forEach(([k, v]) => {
    root.style.setProperty(`--ac-primary-${k}`, v);
  });
  root.style.setProperty("--ac-on-primary", idealTextOn(hexToRgb(hex)));
}

/* ------------------------------ Provider Impl ------------------------------- */

export function ThemeProvider({ children }) {
  // theme mode state
  const [theme, setThemeState] = useState(getStoredMode());
  // brand color state
  const [brandColor, setBrandColorState] = useState(getStoredBrand());

  // resolved theme (system or chosen)
  const mqRef = useRef(null);
  const [systemDark, setSystemDark] = useState(() => {
    if (!isBrowser || !window.matchMedia) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (!isBrowser || !window.matchMedia) return;
    mqRef.current = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => setSystemDark(e.matches);
    try {
      mqRef.current.addEventListener("change", handler);
    } catch {
      // Safari fallback
      mqRef.current.addListener(handler);
    }
    return () => {
      if (!mqRef.current) return;
      try {
        mqRef.current.removeEventListener("change", handler);
      } catch {
        mqRef.current.removeListener(handler);
      }
    };
  }, []);

  const resolvedTheme = useMemo(() => {
    return theme === "system" ? (systemDark ? "dark" : "light") : theme;
  }, [theme, systemDark]);

  // Apply data-theme to <html>
  useEffect(() => {
    if (!isBrowser) return;
    const root = document.documentElement;
    root.setAttribute("data-theme", resolvedTheme);
    setStoredMode(theme);
  }, [theme, resolvedTheme]);

  // Apply brand CSS vars
  useEffect(() => {
    applyBrandVariables(brandColor);
    setStoredBrand(brandColor);
  }, [brandColor]);

  // Public setters (stable)
  const setTheme = (mode) => {
    if (!["light", "dark", "system"].includes(mode)) return;
    setThemeState(mode);
  };
  const setBrandColor = (hex) => {
    if (typeof hex !== "string") return;
    const ok = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
    if (!ok) return;
    setBrandColorState(hex.toUpperCase());
  };

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, brandColor, setBrandColor }),
    [theme, resolvedTheme, brandColor]
  );

  // Minimal default surfaces/text so variables exist even without extra CSS.
  useEffect(() => {
    if (!isBrowser) return;
    const root = document.documentElement;
    // You can tune these neutrals; they won’t conflict with Tailwind.
    if (resolvedTheme === "dark") {
      root.style.setProperty("--ac-surface", "#0B0E14");
      root.style.setProperty("--ac-surface-2", "#0F131B");
      root.style.setProperty("--ac-text", "#EAECEF");
      root.style.setProperty("--ac-text-muted", "#A2A9B3");
    } else {
      root.style.setProperty("--ac-surface", "#FFFFFF");
      root.style.setProperty("--ac-surface-2", "#F6F8FA");
      root.style.setProperty("--ac-text", "#0B1117");
      root.style.setProperty("--ac-text-muted", "#5B6B7C");
    }
  }, [resolvedTheme]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export default ThemeProvider;
