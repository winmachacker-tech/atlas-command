// src/context/ThemeProvider.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "atlas-theme";            // persisted preference
const ACCENT_KEY = "atlas-accent";            // persisted accent color
const VALID = new Set(["light", "dark", "system"]);
const VALID_ACCENTS = new Set(["emerald", "sky", "violet", "amber", "rose", "cyan", "lime", "pink"]);

const ThemeContext = createContext({
  theme: "system",            // user choice: 'light' | 'dark' | 'system'
  resolvedTheme: "light",     // effective theme after resolving system
  accent: "emerald",          // accent color choice
  setTheme: (_t) => {},       // setTheme('dark'|'light'|'system')
  setAccent: (_a) => {},      // setAccent('emerald'|'sky'|'violet'|etc)
});

function getSystemPrefersDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(choice) {
  if (choice === "system") return getSystemPrefersDark() ? "dark" : "light";
  return choice;
}

function applyThemeToDocument(resolved) {
  const root = document.documentElement; // <html>
  // Set data-theme for your CSS variables and any non-tailwind usage
  root.setAttribute("data-theme", resolved);

  // Toggle Tailwind's dark mode class if you're using 'class' strategy
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Optional: better-looking native scrollbars
  root.style.colorScheme = resolved;
}

function applyAccentToDocument(accent) {
  const root = document.documentElement;
  
  // Set data-accent attribute for CSS to use
  root.setAttribute("data-accent", accent);
  
  // Also set CSS custom properties for more flexibility
  const accentColors = {
    emerald: {
      50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7",
      400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857",
      800: "#065f46", 900: "#064e3b"
    },
    sky: {
      50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc",
      400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1",
      800: "#075985", 900: "#0c4a6e"
    },
    violet: {
      50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd",
      400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9",
      800: "#5b21b6", 900: "#4c1d95"
    },
    amber: {
      50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d",
      400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309",
      800: "#92400e", 900: "#78350f"
    },
    rose: {
      50: "#fff1f2", 100: "#ffe4e6", 200: "#fecdd3", 300: "#fda4af",
      400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c",
      800: "#9f1239", 900: "#881337"
    },
    cyan: {
      50: "#ecfeff", 100: "#cffafe", 200: "#a5f3fc", 300: "#67e8f9",
      400: "#22d3ee", 500: "#06b6d4", 600: "#0891b2", 700: "#0e7490",
      800: "#155e75", 900: "#164e63"
    },
    lime: {
      50: "#f7fee7", 100: "#ecfccb", 200: "#d9f99d", 300: "#bef264",
      400: "#a3e635", 500: "#84cc16", 600: "#65a30d", 700: "#4d7c0f",
      800: "#3f6212", 900: "#365314"
    },
    pink: {
      50: "#fdf2f8", 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4",
      400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d",
      800: "#9d174d", 900: "#831843"
    }
  };

  const colors = accentColors[accent] || accentColors.emerald;
  
  // Set all accent shades as CSS variables
  Object.keys(colors).forEach(shade => {
    root.style.setProperty(`--ac-primary-${shade}`, colors[shade]);
  });
  
  // Also set some convenience variables
  root.style.setProperty("--accent-primary", colors[500]);
  root.style.setProperty("--accent-hover", colors[600]);
}

export function ThemeProvider({ children }) {
  const initialTheme = useMemo(() => {
    try {
      const fromStorage = localStorage.getItem(STORAGE_KEY);
      return VALID.has(fromStorage) ? fromStorage : "system";
    } catch {
      return "system";
    }
  }, []);

  const initialAccent = useMemo(() => {
    try {
      const fromStorage = localStorage.getItem(ACCENT_KEY);
      return VALID_ACCENTS.has(fromStorage) ? fromStorage : "emerald";
    } catch {
      return "emerald";
    }
  }, []);

  const [theme, setThemeState] = useState(initialTheme);
  const [accent, setAccentState] = useState(initialAccent);
  const [resolvedTheme, setResolvedTheme] = useState(resolveTheme(initialTheme));

  // Track media query so we can react when the OS toggles light/dark
  const mqlRef = useRef(null);

  // Initialize media query listener once
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mqlRef.current = mql;

    const handle = () => {
      if (theme === "system") {
        const next = mql.matches ? "dark" : "light";
        setResolvedTheme(next);
        applyThemeToDocument(next);
      }
    };

    mql.addEventListener ? mql.addEventListener("change", handle) : mql.addListener(handle);
    return () => {
      mql.removeEventListener ? mql.removeEventListener("change", handle) : mql.removeListener(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme on mount and whenever the user changes the preference
  useEffect(() => {
    const nextResolved = resolveTheme(theme);
    setResolvedTheme(nextResolved);
    applyThemeToDocument(nextResolved);

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage failures
    }
  }, [theme]);

  // Apply accent on mount and whenever it changes
  useEffect(() => {
    applyAccentToDocument(accent);
    
    try {
      localStorage.setItem(ACCENT_KEY, accent);
    } catch {
      // ignore storage failures
    }
  }, [accent]);

  // Public setters with validation
  function setTheme(next) {
    setThemeState(VALID.has(next) ? next : "system");
  }

  function setAccent(next) {
    if (VALID_ACCENTS.has(next)) {
      setAccentState(next);
    }
  }

  const value = useMemo(
    () => ({ theme, resolvedTheme, accent, setTheme, setAccent }),
    [theme, resolvedTheme, accent]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}