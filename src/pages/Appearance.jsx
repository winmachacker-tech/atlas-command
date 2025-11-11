// src/pages/Appearance.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useTheme } from "../context/ThemeProvider"; // âœ… NEW
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  Paintbrush,
  Palette,
  Type,
  Sun,
  Moon,
  MonitorSmartphone,
} from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const DEFAULTS = {
  theme: "dark",
  accent: "emerald",
  font_scale: "md",
};

const ACCENTS = [
  { name: "emerald", color: "#10b981", label: "Emerald" },
  { name: "sky", color: "#0ea5e9", label: "Sky Blue" },
  { name: "violet", color: "#8b5cf6", label: "Violet" },
  { name: "amber", color: "#f59e0b", label: "Amber" },
  { name: "rose", color: "#f43f5e", label: "Rose" },
  { name: "cyan", color: "#06b6d4", label: "Cyan" },
  { name: "lime", color: "#84cc16", label: "Lime" },
  { name: "pink", color: "#ec4899", label: "Pink" },
];

function InlineAlert({ kind = "info", children }) {
  const scheme =
    kind === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : kind === "error"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
      : "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return (
    <div className={cx("rounded-xl border px-3 py-2 text-sm", scheme)}>
      <div className="flex items-center gap-2">
        {kind === "success" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : kind === "error" ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <AlertCircle className="h-4 w-4" />
        )}
        <span>{children}</span>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#12151b] p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        {Icon ? (
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
            <Icon className="h-5 w-5 text-amber-400" />
          </div>
        ) : null}
        <div>
          <div className="text-lg font-semibold">{title}</div>
          {subtitle ? (
            <div className="text-sm text-white/60">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function Appearance() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [user, setUser] = useState(null);
  
  // âœ… Use ThemeProvider context
  const { theme, accent, setTheme, setAccent } = useTheme();
  
  const [form, setForm] = useState({
    theme: theme,
    accent: accent,
    font_scale: "md",
  });

  const patch = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    
    // âœ… Apply changes immediately via context
    if (k === "theme") {
      setTheme(v);
    } else if (k === "accent") {
      setAccent(v);
    } else if (k === "font_scale") {
      applyFontScale(v);
    }
  };

  // Apply font scale immediately
  const applyFontScale = (scale) => {
    const root = document.documentElement;
    
    const fontSizes = {
      sm: "14px",
      md: "16px",
      lg: "18px",
    };

    root.style.setProperty("--base-font-size", fontSizes[scale] || fontSizes.md);
  };

  // Load settings
  useEffect(() => {
    let isMounted = true;

    async function run() {
      setLoading(true);
      setMsg(null);

      const { data: { session }, error: sErr } = await supabase.auth.getSession();
      if (sErr || !session?.user) {
        if (!isMounted) return;
        setUser(null);
        setLoading(false);
        return;
      }

      const u = session.user;
      if (!isMounted) return;
      setUser(u);

      // Try to load from database
      try {
        const { data, error } = await supabase
          .from("user_settings")
          .select("theme, accent, font_scale")
          .eq("user_id", u.id)
          .maybeSingle();

        if (!isMounted) return;

        if (data) {
          setForm({
            theme: data.theme || theme,
            accent: data.accent || accent,
            font_scale: data.font_scale || DEFAULTS.font_scale,
          });
          // Apply font scale (theme/accent handled by context)
          applyFontScale(data.font_scale || DEFAULTS.font_scale);
        } else {
          // Try localStorage as fallback
          try {
            const localFont = localStorage.getItem("atlas.fontScale");
            
            const loadedForm = {
              theme: theme,
              accent: accent,
              font_scale: localFont || DEFAULTS.font_scale,
            };
            
            setForm(loadedForm);
            applyFontScale(loadedForm.font_scale);
          } catch {
            setForm({ theme, accent, font_scale: DEFAULTS.font_scale });
            applyFontScale(DEFAULTS.font_scale);
          }
        }
      } catch (e) {
        console.error("Failed to load appearance settings:", e);
        setForm(DEFAULTS);
      }

      setLoading(false);
    }

    run();
    return () => { isMounted = false; };
  }, []);

  // Save settings
  const onSave = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setMsg(null);

    try {
      // Save font scale to localStorage (theme/accent already handled by context)
      try {
        localStorage.setItem("atlas.fontScale", form.font_scale);
      } catch {}

      // Try to save to database
      try {
        const payload = {
          user_id: user.id,
          theme: form.theme,
          accent: form.accent,
          font_scale: form.font_scale,
        };

        const { error } = await supabase
          .from("user_settings")
          .upsert(payload, { onConflict: "user_id" });

        if (error && error.code !== "42P01") {
          // 42P01 = table doesn't exist
          throw error;
        }
      } catch (dbError) {
        // If DB save fails, context/localStorage still worked
        console.warn("Database save failed, using context/localStorage only:", dbError);
      }

      setMsg({ kind: "success", text: "Appearance saved successfully!" });
    } catch (e) {
      setMsg({ kind: "error", text: e.message || "Failed to save appearance." });
    } finally {
      setSaving(false);
    }
  }, [user, form]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center gap-2 text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading your appearance settingsâ€¦</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Page Header */}
        <div className="rounded-2xl border border-white/10 bg-[#0f1318] p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
                <Paintbrush className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold">Appearance</h1>
                <p className="text-sm text-white/60">
                  Customize how Atlas Command looks and feels
                </p>
              </div>
            </div>

            <button
              onClick={onSave}
              disabled={saving}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-black transition",
                saving
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:brightness-110"
              )}
              style={{ 
                backgroundColor: ACCENTS.find(a => a.name === form.accent)?.color || "#f59e0b" 
              }}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Savingâ€¦
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>

          {msg ? (
            <div className="mt-4">
              <InlineAlert kind={msg.kind}>{msg.text}</InlineAlert>
            </div>
          ) : null}
        </div>

        {/* Theme Selection */}
        <Card
          icon={Sun}
          title="Theme"
          subtitle="Choose your preferred color scheme"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ThemeOption
              icon={Sun}
              title="Light"
              description="Bright and clean"
              selected={form.theme === "light"}
              onClick={() => patch("theme", "light")}
            />
            <ThemeOption
              icon={Moon}
              title="Dark"
              description="Easy on the eyes"
              selected={form.theme === "dark"}
              onClick={() => patch("theme", "dark")}
            />
            <ThemeOption
              icon={MonitorSmartphone}
              title="System"
              description="Match your OS"
              selected={form.theme === "system"}
              onClick={() => patch("theme", "system")}
            />
          </div>
        </Card>

        {/* Accent Color */}
        <Card
          icon={Palette}
          title="Accent Color"
          subtitle="Pick your favorite color for highlights and buttons"
        >
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {ACCENTS.map((accent) => (
              <button
                key={accent.name}
                onClick={() => patch("accent", accent.name)}
                className={cx(
                  "group relative flex flex-col items-center gap-2 rounded-xl border p-3 transition",
                  form.accent === accent.name
                    ? "border-white/40 bg-white/10"
                    : "border-white/10 hover:border-white/20 hover:bg-white/5"
                )}
                title={accent.label}
              >
                <div
                  className={cx(
                    "h-10 w-10 rounded-lg transition",
                    form.accent === accent.name
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[#12151b]"
                      : "group-hover:scale-110"
                  )}
                  style={{ backgroundColor: accent.color }}
                />
                <span className="text-xs text-white/70">{accent.label}</span>
                {form.accent === accent.name && (
                  <CheckCircle2 className="absolute right-1 top-1 h-4 w-4 text-emerald-400" />
                )}
              </button>
            ))}
          </div>
        </Card>

        {/* Font Size */}
        <Card
          icon={Type}
          title="Font Size"
          subtitle="Adjust text size for better readability"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FontOption
              title="Small"
              description="Compact and space-efficient"
              selected={form.font_scale === "sm"}
              onClick={() => patch("font_scale", "sm")}
              size="sm"
            />
            <FontOption
              title="Default"
              description="Recommended for most users"
              selected={form.font_scale === "md"}
              onClick={() => patch("font_scale", "md")}
              size="md"
            />
            <FontOption
              title="Large"
              description="Easier to read"
              selected={form.font_scale === "lg"}
              onClick={() => patch("font_scale", "lg")}
              size="lg"
            />
          </div>
        </Card>

        {/* Preview Button */}
        <div className="rounded-2xl border border-white/10 bg-[#12151b] p-6">
          <h3 className="mb-3 text-sm font-medium text-white/70">Preview</h3>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                className="rounded-xl px-4 py-2 text-sm font-medium text-black transition"
                style={{ 
                  backgroundColor: ACCENTS.find(a => a.name === form.accent)?.color || "#f59e0b" 
                }}
              >
                Primary Button
              </button>
              <span className="text-sm text-white/60">
                This is how buttons will look with your accent color
              </span>
            </div>
            
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-sm text-white/80">
                Font size: <span className="font-medium">{form.font_scale === 'sm' ? 'Small' : form.font_scale === 'lg' ? 'Large' : 'Default'}</span>
              </p>
              <p className="text-xs text-white/60 mt-1">
                Sample text at your selected font size
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeOption({ icon: Icon, title, description, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
        selected
          ? "border-amber-500/60 bg-amber-500/10"
          : "border-white/10 hover:border-white/20 hover:bg-white/5"
      )}
    >
      <Icon className={cx("h-6 w-6", selected ? "text-amber-400" : "text-white/70")} />
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-white/60">{description}</div>
      </div>
      {selected && (
        <CheckCircle2 className="ml-auto h-5 w-5 text-amber-400" />
      )}
    </button>
  );
}

function FontOption({ title, description, selected, onClick, size }) {
  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  return (
    <button
      onClick={onClick}
      className={cx(
        "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
        selected
          ? "border-amber-500/60 bg-amber-500/10"
          : "border-white/10 hover:border-white/20 hover:bg-white/5"
      )}
    >
      <div className={cx("font-medium", sizeClasses[size])}>{title}</div>
      <div className="text-xs text-white/60">{description}</div>
      {selected && (
        <CheckCircle2 className="ml-auto h-5 w-5 text-amber-400" />
      )}
    </button>
  );
}
