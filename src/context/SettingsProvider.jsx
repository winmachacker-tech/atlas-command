// src/context/SettingsProvider.jsx
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const SettingsCtx = createContext(null);
const THEME_KEY = "ac:theme";

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    root.classList.toggle("dark", !!prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}

export function SettingsProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    site_name: "Atlas Command",
    theme: "system",
    timezone: "America/Los_Angeles",
    items_per_page: 50,
    telemetry_opt_in: false,
  });
  const [flags, setFlags] = useState([]);
  const flagsMap = useMemo(() => Object.fromEntries(flags.map(f => [f.key, !!f.enabled])), [flags]);
  const [error, setError] = useState("");

  // Initial theme from localStorage (prevents flash)
  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "system" || stored === "light" || stored === "dark") {
      try { applyTheme(stored); } catch {}
    }
  }, []);

  // Load settings + flags
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true); setError("");
      const [{ data, error: e1 }, { data: fdata, error: e2 }] = await Promise.all([
        supabase.from("app_settings").select("*").eq("id", 1).single(),
        supabase.from("feature_flags").select("key,enabled,description").order("key", { ascending: true })
      ]);

      if (!mounted) return;

      if (e1) { setError(e1.message); }
      if (data) {
        setSettings({
          site_name: data.site_name ?? "Atlas Command",
          theme: data.theme ?? "system",
          timezone: data.timezone ?? "America/Los_Angeles",
          items_per_page: data.items_per_page ?? 50,
          telemetry_opt_in: !!data.telemetry_opt_in,
        });
        // apply + persist theme
        try {
          applyTheme(data.theme ?? "system");
          localStorage.setItem(THEME_KEY, data.theme ?? "system");
        } catch {}
      }

      if (!e2 && fdata) setFlags(fdata);
      setLoading(false);
    })();

    // Real-time: watch feature_flags
    const ch = supabase
      .channel("realtime:feature_flags")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feature_flags" },
        (payload) => {
          setFlags((prev) => {
            const row = payload.new ?? payload.old;
            const without = prev.filter(f => f.key !== row.key);
            if (payload.eventType === "DELETE") return without;
            return [...without, payload.new].sort((a,b) => a.key.localeCompare(b.key));
          });
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      try { supabase.removeChannel(ch); } catch {}
    };
  }, []);

  async function saveSettings(patch) {
    const next = { ...settings, ...patch };
    // optimistic UI
    setSettings(next);
    if (patch.theme) {
      try {
        applyTheme(patch.theme);
        localStorage.setItem(THEME_KEY, patch.theme);
      } catch {}
    }
    const { error } = await supabase.from("app_settings").update({
      site_name: next.site_name,
      theme: next.theme,
      timezone: next.timezone,
      items_per_page: Number(next.items_per_page),
      telemetry_opt_in: !!next.telemetry_opt_in,
    }).eq("id", 1);
    if (error) {
      setError(error.message);
      // revert if needed? You can fetch again; here we leave optimistic state.
    } else {
      setError("");
    }
  }

  async function toggleFlag(key) {
    const found = flags.find(f => f.key === key);
    if (!found) return;
    const newVal = !found.enabled;
    // optimistic
    setFlags(prev => prev.map(f => f.key === key ? { ...f, enabled: newVal } : f));
    const { error } = await supabase.from("feature_flags").update({ enabled: newVal }).eq("key", key);
    if (error) {
      // revert on failure
      setFlags(prev => prev.map(f => f.key === key ? { ...f, enabled: !newVal } : f));
      setError(error.message);
    } else {
      setError("");
    }
  }

  const value = { loading, error, settings, saveSettings, flags, flagsMap, toggleFlag };
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}

