// src/context/ThemeProvider.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "atlas-theme";            // persisted preference
const VALID = new Set(["light", "dark", "system"]);

const ThemeContext = createContext({
  theme: "system",            // user choice: 'light' | 'dark' | 'system'
  resolvedTheme: "light",     // effective theme after resolving system
  setTheme: (_t) => {},       // setTheme('dark'|'light'|'system')
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
  // (Your index.css uses data-theme vars too; this keeps both happy.)
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Optional: better-looking native scrollbars
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }) {
  const initial = useMemo(() => {
    try {
      const fromStorage = localStorage.getItem(STORAGE_KEY);
      return VALID.has(fromStorage) ? fromStorage : "system";
    } catch {
      return "system";
    }
  }, []);

  const [theme, setThemeState] = useState(initial);
  const [resolvedTheme, setResolvedTheme] = useState(resolveTheme(initial));

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

  // Apply on mount and whenever the user changes the preference
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

  // Public setter with validation
  function setTheme(next) {
    setThemeState(VALID.has(next) ? next : "system");
  }

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
