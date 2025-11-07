// src/pages/AI.jsx
// Atlas Command — Dispatch AI page
// Renders the AIAssistant (dispatch-focused) with a simple header + breadcrumbs.
// Add a route to this page in your router (e.g., /ai) when you're ready.

import { useEffect } from "react";
import { Bot, Home, Sparkles } from "lucide-react";
import AIAssistant from "../components/AIAssistant";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function AIPage() {
  useEffect(() => {
    document.title = "Atlas Command | Dispatch AI";
  }, []);

  return (
    <div className="p-4 sm:p-6 md:p-8">
      {/* Breadcrumbs */}
      <div className="mb-4 flex items-center gap-2 text-sm text-zinc-400">
        <Home className="h-4 w-4" />
        <span>/</span>
        <span className="text-zinc-300">AI</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15">
            <Bot className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Dispatch AI</h1>
            <p className="text-sm text-zinc-400">
              Fast, actionable help for loads, drivers, ETAs, customer updates, and quick math.
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          Powered by OpenAI via Supabase Edge
        </div>
      </div>

      {/* Panel */}
      <AIAssistant className="max-w-5xl" />
    </div>
  );
}
