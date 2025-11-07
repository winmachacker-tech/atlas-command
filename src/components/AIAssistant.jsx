// src/components/AIAssistant.jsx
// Drop-in Dispatch AI panel that streams via useAIStream()
// - Uses your existing Tailwind/Lucide stack
// - No external deps, mounts anywhere in your layout
// - Opinionated system prompt for freight/dispatch operations

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Send,
  StopCircle,
  Loader2,
  Trash2,
  Clipboard,
  Sparkles,
  History,
  Undo2,
  Settings2,
  ArrowDown,
} from "lucide-react";
import useAIStream from "../hooks/useAIStream";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const DEFAULT_SYSTEM_PROMPT = `
You are Atlas Command's Dispatch AI Assistant for a trucking carrier/brokerage.
Be concise, actionable, and accurate. If data is missing, ask for only the ONE
most important missing item. NEVER invent load IDs or rates.

Priorities (in order):
1) Safety & compliance. 2) On-time pickup/delivery. 3) Carrier/driver relationships.
4) Profit optimization (consider RPM, deadhead, fuel, tolls, detention, layover).

When giving answers:
- Use bullet points and short sentences.
- Include a tiny checklist when relevant.
- If doing math, show the equation briefly.
- If giving a call/email script, keep it professional and clear.
- If asked about status flow, reflect Atlas terms:
  Loads: AVAILABLE, IN_TRANSIT, DELIVERED, CANCELLED, AT_RISK, PROBLEM.
  Drivers: ACTIVE, ASSIGNED, INACTIVE.
- If suggesting DB updates, clearly mark them as suggestions (do not claim they are applied).
`;

const SUGGESTIONS = [
  {
    title: "Check call script",
    prompt:
      "Write a brief check call script for a driver on an IN_TRANSIT load. Ask for current location, trailer status (sealed? temp?), ETA, and any issues.",
  },
  {
    title: "Rate math",
    prompt:
      "Given distance 812 miles and all-in rate $2,150, calculate RPM, then show a 5% fuel surcharge scenario. Keep it tight.",
  },
  {
    title: "Assign driver note",
    prompt:
      "Draft an internal note for assigning Driver John Doe to Load 12345 picking up tomorrow 08:00 in Sacramento, delivering next day in Phoenix. Include a 3-bullet checklist.",
  },
  {
    title: "Customer update",
    prompt:
      "Write a concise customer email: driver delayed 45 minutes due to traffic; updated ETA is 10:15 AM. Offer to call if further changes.",
  },
  {
    title: "At-risk triage",
    prompt:
      "Create a quick triage plan for a load slipping schedule: identify cause, mitigation steps, who to notify, and a 3-line phone script.",
  },
];

export default function AIAssistant({ className = "" }) {
  const [input, setInput] = useState("");
  const [system, setSystem] = useState(DEFAULT_SYSTEM_PROMPT.trim());
  const [showSettings, setShowSettings] = useState(false);
  const [stickyScroll, setStickyScroll] = useState(true);

  const {
    send,
    stop,
    isStreaming,
    output,
    error,
    reset,
    pushToHistory,
    getHistory,
    setHistory,
  } = useAIStream();

  const scrollRef = useRef(null);
  const outRef = useRef(null);

  // Auto-scroll when streaming
  useEffect(() => {
    if (!stickyScroll) return;
    const el = outRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output, stickyScroll]);

  const canSend = input.trim().length > 0 && !isStreaming;

  const handleSend = async (text) => {
    const prompt = (text ?? input).trim();
    if (!prompt) return;
    setInput("");
    await send({
      prompt,
      system,
      model: "gpt-4o-mini",
      temperature: 0.3,
    });
  };

  const handleSuggestion = (s) => {
    setInput(s.prompt);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output || "");
    } catch {
      // ignore
    }
  };

  const handleUndo = () => {
    // pop last two messages from history (assistant + user) if present
    const hist = getHistory();
    if (hist.length === 0) return;
    const trimmed = hist.slice(0, -1); // drop last
    // If last is assistant, also drop preceding user if present
    if (hist[hist.length - 1]?.role === "assistant" && trimmed.length > 0) {
      const maybeUser = trimmed[trimmed.length - 1];
      if (maybeUser?.role === "user") trimmed.pop();
    }
    setHistory(trimmed);
  };

  const OutputHeader = useMemo(
    () => (
      <div className="flex items-center justify-between border-b border-zinc-800/50 p-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <Bot className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-sm">
            <div className="font-medium text-zinc-100">Dispatch AI</div>
            <div className="text-xs text-zinc-400">Atlas Command assistant</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
            title="Settings"
            type="button"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
            title="Copy"
            type="button"
          >
            <Clipboard className="h-3.5 w-3.5" />
            Copy
          </button>
          <button
            onClick={() => {
              reset();
              setHistory([]);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
            title="Clear"
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
          <button
            onClick={handleUndo}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
            title="Undo last exchange"
            type="button"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>
        </div>
      </div>
    ),
    [handleCopy, reset, setHistory]
  );

  return (
    <div
      className={cx(
        "rounded-2xl border border-zinc-800 bg-zinc-950/60 shadow-xl backdrop-blur",
        "flex flex-col overflow-hidden",
        className
      )}
      ref={scrollRef}
    >
      {OutputHeader}

      {/* Settings */}
      {showSettings && (
        <div className="border-b border-zinc-800/50">
          <div className="p-3">
            <label className="text-xs font-medium text-zinc-300">System Prompt</label>
            <textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              rows={6}
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 text-sm text-zinc-100 placeholder-zinc-500"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="text-xs text-zinc-400">
                Tailored for dispatch ops. Keep it concise and safe.
              </div>
              <button
                type="button"
                onClick={() => setSystem(DEFAULT_SYSTEM_PROMPT.trim())}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                <History className="h-3.5 w-3.5" />
                Reset to default
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suggestions */}
      <div className="border-b border-zinc-800/50">
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSuggestion(s)}
              className="group flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-left hover:bg-zinc-900"
              title={s.title}
            >
              <div className="mt-0.5 rounded-md bg-emerald-500/15 p-1.5">
                <Sparkles className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-200">{s.title}</div>
                <div className="mt-0.5 text-xs text-zinc-400 line-clamp-2">{s.prompt}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Output */}
      <div
        ref={outRef}
        className="min-h-[220px] max-h-[42vh] overflow-auto p-4 text-sm leading-6 text-zinc-100"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
          setStickyScroll(atBottom);
        }}
      >
        {(!output && !isStreaming && !error) && (
          <div className="text-zinc-400 text-sm">
            Ask about loads, drivers, ETAs, customer updates, quick math, and call/email scripts.
          </div>
        )}

        {!!output && (
          <pre className="whitespace-pre-wrap break-words font-sans text-zinc-100">
            {output}
          </pre>
        )}

        {isStreaming && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-xs text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Streaming…
          </div>
        )}

        {!!error && (
          <div className="mt-3 rounded-lg border border-red-900/40 bg-red-900/10 p-2 text-xs text-red-300">
            {String(error)}
          </div>
        )}

        {!stickyScroll && (
          <button
            type="button"
            onClick={() => {
              const el = outRef.current;
              if (!el) return;
              el.scrollTop = el.scrollHeight;
              setStickyScroll(true);
            }}
            className="mt-3 inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
            title="Jump to latest"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-zinc-800/50 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Dispatch AI… (e.g., 'Draft a customer update for Load 12345 with a 30 min delay')"
            rows={2}
            className="min-h-[44px] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (canSend) handleSend();
              }
            }}
          />
          {!isStreaming ? (
            <button
              type="button"
              disabled={!canSend}
              onClick={() => handleSend()}
              className={cx(
                "inline-flex h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium",
                canSend
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              )}
              title="Send (Ctrl/Cmd+Enter)"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-[44px] items-center gap-2 rounded-xl bg-zinc-800 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
              title="Stop streaming"
            >
              <StopCircle className="h-4 w-4" />
              Stop
            </button>
          )}
        </div>

        {/* Tiny footer tips */}
        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
          <div>Press <kbd className="rounded bg-zinc-800 px-1">Ctrl</kbd>/<kbd className="rounded bg-zinc-800 px-1">Cmd</kbd>+<kbd className="rounded bg-zinc-800 px-1">Enter</kbd> to send</div>
          <div>Be specific: include load ID, city, time, and constraints.</div>
        </div>
      </div>
    </div>
  );
}
