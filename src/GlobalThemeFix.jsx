import { useEffect } from "react";

/*
  GlobalThemeFix
  ----------------------------------------------------------
  Purpose: Stop pages from looking empty in dark mode by
  overriding light-only utilities (text-zinc-900, bg-white, etc.)
  with dark-safe values. Non-destructive and easy to remove later.

  How to use:
    - Import and place <GlobalThemeFix /> once near the top of your app
      (e.g., inside MainLayout, before your Routes).
*/

const CSS = `
/* ---------- Dark-mode emergency readability map ---------- */
.dark body { color: var(--text-base) !important; background: var(--bg-base) !important; }

/* Text colors commonly used in light mode */
.dark .text-black,
.dark .text-white,          /* keep white as-is on dark backgrounds */
.dark .text-zinc-900,
.dark .text-gray-900,
.dark .text-neutral-900,
.dark .text-zinc-800,
.dark .text-gray-800,
.dark .text-neutral-800,
.dark .text-zinc-700,
.dark .text-gray-700,
.dark .text-neutral-700,
.dark .text-zinc-600,
.dark .text-gray-600,
.dark .text-neutral-600 {
  color: var(--text-base) !important;
}

/* Muted text */
.dark .text-zinc-500,
.dark .text-gray-500,
.dark .text-neutral-500,
.dark .text-zinc-400,
.dark .text-gray-400,
.dark .text-neutral-400 {
  color: var(--text-muted) !important;
}

/* Backgrounds that vanish on dark */
.dark .bg-white,
.dark .bg-zinc-50,
.dark .bg-gray-50,
.dark .bg-neutral-50 {
  background-color: var(--bg-surface) !important;
}

/* Borders that become invisible on dark */
.dark .border-zinc-200,
.dark .border-gray-200,
.dark .border-neutral-200,
.dark .divide-zinc-200 > :not([hidden]) ~ :not([hidden]),
.dark .divide-gray-200 > :not([hidden]) ~ :not([hidden]),
.dark .divide-neutral-200 > :not([hidden]) ~ :not([hidden]) {
  border-color: #27272a !important; /* zinc-800-ish */
}

/* Tables */
.dark table thead th {
  color: var(--text-base) !important;
  background-color: var(--bg-surface) !important;
}
.dark table tbody td {
  color: var(--text-base) !important;
}

/* Cards / panels convenience */
.dark .surface-card {
  background-color: var(--bg-surface) !important;
  border: 1px solid #27272a !important;
}
`;

export default function GlobalThemeFix() {
  useEffect(() => {
    const id = "atlas-global-theme-fix";
    let tag = document.getElementById(id);
    if (!tag) {
      tag = document.createElement("style");
      tag.id = id;
      tag.appendChild(document.createTextNode(CSS));
      document.head.appendChild(tag);
    } else {
      // keep it updated if hot reloaded
      tag.textContent = CSS;
    }
    return () => {};
  }, []);

  return null;
}

