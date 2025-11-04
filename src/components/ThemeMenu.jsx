// src/components/ThemeMenu.jsx
import { useEffect, useRef, useState } from "react";
import { Sun, Moon, Monitor, ChevronDown } from "lucide-react";

/* ----------------------------- Provider Bridge ---------------------------- */
let useThemeSafe = null;
try {
  const mod = await import("../context/ThemeProvider.jsx");
  useThemeSafe = mod?.useTheme ?? null;
} catch {}

/* --------------------------------- Consts --------------------------------- */
const STORAGE_KEY = "atlas.theme.brandColor";
const HEX_OK = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const PRESETS = [
  "#4F46E5", "#0EA5E9", "#3B82F6", "#10B981", "#22C55E", "#F59E0B",
  "#EF4444", "#A855F7", "#8B5CF6", "#14B8A6", "#E11D48", "#111827",
];

/* --------------------------------- Utils ---------------------------------- */
const loadBrand = () => {
  try {
    const c = localStorage.getItem(STORAGE_KEY);
    return c && HEX_OK.test(c) ? c.toUpperCase() : null;
  } catch { return null; }
};
const saveBrand = (hex) => { try { localStorage.setItem(STORAGE_KEY, hex); } catch {} };

function hexToRgb(hex) {
  let s = hex.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + [cl(r), cl(g), cl(b)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function adjust(rgb, pct) {
  const f = pct / 100;
  return {
    r: rgb.r + (pct >= 0 ? (255 - rgb.r) * f : rgb.r * f),
    g: rgb.g + (pct >= 0 ? (255 - rgb.g) * f : rgb.g * f),
    b: rgb.b + (pct >= 0 ? (255 - rgb.b) * f : rgb.b * f),
  };
}
function luminance({ r, g, b }) {
  const s = [r, g, b].map((v) => v / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}
function idealTextOnHex(hex) {
  const rgb = hexToRgb(hex);
  return luminance(rgb) > 0.55 ? "#111111" : "#FFFFFF";
}
function buildPalette(hex) {
  const base = hexToRgb(hex);
  const toHex = (p) => rgbToHex(adjust(base, p));
  return {
    50:  toHex(46),
    100: toHex(40),
    200: toHex(28),
    300: toHex(18),
    400: toHex(9),
    500: rgbToHex(base),
    600: toHex(-8),
    700: toHex(-16),
    800: toHex(-24),
    900: toHex(-32),
  };
}

/* ----------------------- Apply both AC and ACCENT vars --------------------- */
function writeBrandVars(hex) {
  const pal = buildPalette(hex);
  const on = idealTextOnHex(hex);
  const root = document.documentElement;

  // ---- AC namespace (what the picker originally used)
  root.style.setProperty("--ac-primary", hex);
  Object.entries(pal).forEach(([k, v]) => root.style.setProperty(`--ac-primary-${k}`, v));
  root.style.setProperty("--ac-on-primary", on);

  // ---- ACCENT namespace (what your UI uses: bg-[var(--accent-600)] etc.)
  // Map AC palette to ACCENT variables one-to-one
  Object.entries(pal).forEach(([k, v]) => root.style.setProperty(`--accent-${k}`, v));
  root.style.setProperty("--accent-600", pal[600]); // ensure main
  root.style.setProperty("--accent-700", pal[700]);
  root.style.setProperty("--accent-500", pal[500]);
  root.style.setProperty("--accent-400", pal[400]);
  root.style.setProperty("--accent-300", pal[300]);
  root.style.setProperty("--accent-200", pal[200]);
  root.style.setProperty("--accent-100", pal[100]);
  root.style.setProperty("--accent-50",  pal[50]);

  // Optional readable text on primary for helpers
  root.style.setProperty("--ac-on-primary", on);

  // Inject/update dedicated style tag for precedence
  const styleId = "ac-brand-vars";
  let tag = document.getElementById(styleId);
  const rules = [
    `:root{`,
    `--ac-primary:${hex};`,
    ...Object.entries(pal).map(([k, v]) => `--ac-primary-${k}:${v};`),
    `--ac-on-primary:${on};`,
    ...Object.entries(pal).map(([k, v]) => `--accent-${k}:${v};`),
    `}`,
  ].join("");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = styleId;
    document.head.appendChild(tag);
  }
  tag.textContent = rules;

  // Reflow nudge (rarely needed)
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  document.body?.offsetHeight;

  // Debug
  window.__ac_brand = { hex, on, pal, appliedAt: new Date().toISOString() };
  console.log("[Theme] brand applied:", window.__ac_brand);
}

/* -------------------------------- Component -------------------------------- */
export default function ThemeMenu({ className = "", align = "right" }) {
  const themeApi = (() => {
    try { if (typeof useThemeSafe === "function") return useThemeSafe(); } catch {}
    return null;
  })();

  const theme = themeApi?.theme ?? "system";
  const resolvedTheme = themeApi?.resolvedTheme ?? "light";
  const setTheme =
    themeApi?.setTheme ?? (() => console.warn("[ThemeMenu] ThemeProvider not found."));

  const providerBrand = themeApi?.brandColor;
  const [brand, setBrandState] = useState(providerBrand || loadBrand() || "#4F46E5");

  // Apply on mount & on change
  useEffect(() => { writeBrandVars(providerBrand || brand); }, [providerBrand, brand]);

  // Sync once from provider if present
  const firstSync = useRef(true);
  useEffect(() => {
    if (themeApi?.brandColor && firstSync.current) {
      firstSync.current = false;
      setBrandState(themeApi.brandColor);
    }
  }, [themeApi?.brandColor]);

  // Unified setter
  const commitBrand = (hex) => {
    const next = hex.toUpperCase();
    if (!HEX_OK.test(next)) return;
    try { themeApi?.setBrandColor?.(next); } catch {}
    setBrandState(next);
    writeBrandVars(next);
    saveBrand(next);
  };

  // Menu state
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const current = providerBrand || brand;
  const dropdownAlign = align === "left" ? "left-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "right-0";

  return (
    <div ref={rootRef} className={["relative inline-block", className].join(" ")}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-3 py-1.5 text-sm text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
      >
        <span className="inline-flex h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: current }} />
        <Icon className="h-4 w-4 opacity-80" />
        <span className="capitalize">{theme}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={`absolute ${dropdownAlign} z-50 mt-2 w-72 origin-top rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95`}
          style={{ transformOrigin: "top" }}
        >
          {/* Theme section */}
          <div className="mb-3">
            <div className="mb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Theme</div>
            <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              {[
                { key: "light", label: "Light", Icon: Sun },
                { key: "dark", label: "Dark", Icon: Moon },
                { key: "system", label: "System", Icon: Monitor },
              ].map(({ key, label, Icon }) => {
                const active = theme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setTheme(key); setOpen(false); }}
                    className={[
                      "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm transition",
                      active
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900/60",
                    ].join(" ")}
                    aria-pressed={active}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">
              Resolved: <span className="font-medium">{resolvedTheme}</span>
            </div>
          </div>

          {/* Brand section */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Brand color</div>
              <button
                type="button"
                onClick={() => { commitBrand("#4F46E5"); setOpen(false); }}
                className="rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
              >
                Reset
              </button>
            </div>

            <div className="grid grid-cols-8 gap-1.5">
              {PRESETS.map((hex) => {
                const selected = hex === current;
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => { commitBrand(hex); setOpen(false); }}
                    aria-label="choose color"
                    className={[
                      "h-7 w-full rounded-lg border border-black/10 focus:outline-none",
                      selected ? "ring-2 ring-black/35 dark:ring-white/35" : "",
                    ].join(" ")}
                    style={{ background: hex }}
                  />
                );
              })}
              {/* Custom input */}
              <label className="relative h-7 w-full overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
                <input
                  type="color"
                  value={current}
                  onChange={(e) => {
                    const v = (e.target.value || "").toUpperCase();
                    if (HEX_OK.test(v)) { commitBrand(v); setOpen(false); }
                  }}
                  aria-label="custom color"
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0"
                  style={{ WebkitAppearance: "none" }}
                />
              </label>
            </div>

            {/* Preview uses ACCENT vars (matches your UI) */}
            <div className="mt-3">
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-sm text-white"
                style={{
                  background: "var(--accent-600)",
                  border: "1px solid color-mix(in srgb, var(--accent-600) 55%, transparent)",
                }}
                onClick={() => setOpen(false)}
              >
                Primary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
