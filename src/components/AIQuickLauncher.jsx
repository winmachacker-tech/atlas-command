// src/components/AIQuickLauncher.jsx
// Floating button that opens Dispatch AI in a modal overlay.
// No changes to main.jsx or App.jsx required.
// Drop <AIQuickLauncher /> anywhere (e.g., in MainLayout) and you're done.

import { useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import AIAssistant from "./AIAssistant";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function AIQuickLauncher({
  initialOpen = false,
  placement = "bottom-right", // 'bottom-right' | 'bottom-left'
}) {
  const [open, setOpen] = useState(initialOpen);
  const overlayRef = useRef(null);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Close on click outside the panel
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const panel = overlayRef.current?.querySelector("[data-ai-panel]");
      if (panel && !panel.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const btnPos =
    placement === "bottom-left"
      ? "left-5 bottom-5"
      : "right-5 bottom-5"; // default bottom-right

  return (
    <>
      {/* Floating Launch Button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          "fixed z-50 inline-flex items-center gap-2 rounded-full",
          "border border-emerald-700/40 bg-emerald-600 text-white",
          "px-4 py-2 shadow-lg hover:bg-emerald-500 focus:outline-none",
          btnPos
        )}
        title="Open Dispatch AI"
      >
        <Bot className="h-4 w-4" />
        Dispatch AI
      </button>

      {/* Modal Overlay */}
      {open && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          aria-modal="true"
          role="dialog"
        >
          <div
            data-ai-panel
            className={cx(
              "relative w-[95vw] max-w-5xl",
              "rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            )}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:bg-zinc-900"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>

            {/* AI Panel */}
            <AIAssistant className="max-w-none" />
          </div>
        </div>
      )}
    </>
  );
}
