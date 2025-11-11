import * as React from "react";

export function Dialog({ open, onOpenChange, children }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={() => onOpenChange?.(false)}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg w-full max-w-md mx-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogContent({ children }) {
  return <div className="space-y-4">{children}</div>;
}

export function DialogHeader({ children }) {
  return <div className="border-b border-zinc-200 dark:border-zinc-800 pb-2">{children}</div>;
}

export function DialogTitle({ children }) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}

export function DialogFooter({ children }) {
  return <div className="pt-4 flex justify-end gap-2">{children}</div>;
}

export function DialogClose({ asChild, children }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("dialog-close"))}
      className="px-3 py-1.5 rounded-md text-sm bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700"
    >
      {children}
    </button>
  );
}

