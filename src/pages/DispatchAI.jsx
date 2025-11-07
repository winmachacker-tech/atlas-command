// src/pages/DispatchAI.jsx
import { useMemo, useRef, useState } from "react";
import {
  Bot,
  Loader2,
  Send,
  ClipboardCopy,
  ClipboardCheck,
  AlertTriangle,
  Wand2,
  Settings,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { aiChat } from "../lib/aiClient";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const PRESETS = [
  {
    id: "check-call",
    title: "Check call script",
    hint:
      "Write a brief check call script for a driver on an IN_TRANSIT load. Ask for current location, trailer status (sealed? temp?), ETA, and any issues.",
    prompt:
      "Write a concise check-call script to phone a driver on an IN_TRANSIT load. Ask: current exact location, next stop, trailer status (sealed/temperature), ETA to next stop, issues/holds, and special instructions confirmation.",
  },
  {
    id: "assign-note",
    title: "Assign driver note",
    hint:
      "Draft an internal note for assigning a driver to a load. Include a 3-bullet checklist.",
    prompt:
      "Draft a short internal note assigning Driver <NAME> to Load <LOAD_ID> picking up <PICKUP_TIME_LOCAL> in <CITY>, delivering <DELIVERY_TIME_LOCAL> in <CITY>. Include a 3-bullet checklist (docs, ELD status, trailer readiness).",
  },
  {
    id: "rate-math",
    title: "Rate math",
    hint:
      "Given distance and rate, calculate RPM and a 5% fuel surcharge scenario.",
    prompt:
      "Given 812 miles and all-in rate $2,150, calculate RPM. Then show a 5% fuel surcharge scenario and the adjusted RPM. Keep it tight.",
  },
  {
    id: "customer-update",
    title: "Customer update",
    hint:
      "Write a concise customer email: driver delayed 45 minutes; updated ETA 10:15 AM. Offer to call if further changes.",
    prompt:
      "Write a concise, professional customer email: the driver is delayed 45 minutes due to traffic; updated ETA is 10:15 AM. Offer to call if anything changes. Include a subject line and clean paragraphs.",
  },
  {
    id: "at-risk",
    title: "At-risk triage",
    hint:
      "Create a quick triage plan for a slipping schedule.",
    prompt:
      "Create a quick triage plan for a load slipping schedule: identify likely cause, mitigation steps (who/what/when), who to notify, and a 3-line phone script for the customer.",
  },
];

function useClipboard() {
  const [copied, setCopied] = useState(false);
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {}
  }
  return { copied, copy };
}

export default function DispatchAI() {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [raw, setRaw] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [beautify, setBeautify] = useState(true);
  const inputRef = useRef(null);

  const copyFull = useClipboard();

  const usage = useMemo(() => {
    try {
      const u = raw?.usage || raw?.raw?.usage;
      if (!u) return null;
      return {
        prompt: u.prompt_tokens,
        completion: u.completion_tokens,
        total: u.total_tokens,
      };
    } catch {
      return null;
    }
  }, [raw]);

  async function run(promptText) {
    if (!promptText.trim()) return;
    setBusy(true);
    setErr("");
    setOutput("");
    setRaw(null);
    try {
      const res = await aiChat({
        prompt: promptText.trim(),
        model,
        temperature: 0.2,
        max_tokens: 800,
      });

      if (!res.ok) {
        setErr(res.error || "AI request failed");
        setRaw(res.details || null);
        return;
      }

      setOutput(res.output || "");
      setRaw(res.raw || null);
      if (res.model) setModel(res.model);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function handleSend(e) {
    e?.preventDefault?.();
    run(prompt);
  }

  function applyPreset(p) {
    setPrompt(p.prompt);
    // optional: auto-send
    run(p.prompt);
  }

  function clearAll() {
    setPrompt("");
    setOutput("");
    setErr("");
    setRaw(null);
    setShowRaw(false);
    inputRef.current?.focus();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-zinc-800/60 border border-zinc-700">
            <Bot className="w-5 h-5 text-zinc-200" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={beautify}
              onChange={(e) => setBeautify(e.target.checked)}
            />
            <Wand2 className="w-4 h-4" />
            Beautify
          </label>
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Settings className="w-4 h-4" />
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-zinc-100"
            >
              <option value="gpt-4o-mini">gpt-4o-mini (cheap)</option>
              <option value="gpt-4o">gpt-4o</option>
            </select>
          </div>
          <button
            onClick={clearAll}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p)}
            className="group text-left rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 hover:border-emerald-700/60 hover:bg-zinc-900"
            title={p.hint}
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-zinc-100">{p.title}</div>
              <span className="text-xs text-zinc-400 group-hover:text-emerald-400">Use</span>
            </div>
            <div className="mt-1 text-sm text-zinc-400 line-clamp-2">{p.hint}</div>
          </button>
        ))}
      </div>

      {/* Error */}
      {err ? (
        <div className="mb-4 rounded-lg border border-rose-700 bg-rose-950/40 p-3 text-rose-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>
              <div className="font-medium">Request failed</div>
              <div className="text-sm">{String(err)}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Form */}
      <form
        onSubmit={handleSend}
        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask Dispatch AI… include load ID, city, time, constraints"
            rows={6}
            className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
          />
          <div className="flex flex-col gap-3">
            <button
              type="submit"
              disabled={busy || !prompt.trim()}
              className={cx(
                "mt-auto inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium",
                busy || !prompt.trim()
                  ? "bg-emerald-900/40 text-emerald-200 border border-emerald-800 cursor-not-allowed"
                  : "bg-emerald-600 text-white hover:bg-emerald-500"
              )}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Output */}
      <div className="mt-4 grid gap-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm uppercase tracking-wide text-zinc-400">Output</div>
            <button
              onClick={() => copyFull.copy(output)}
              className={cx(
                "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                copyFull.copied
                  ? "border-emerald-700 bg-emerald-900/30 text-emerald-200"
                  : "border-zinc-700 bg-zinc-950/40 text-zinc-200 hover:bg-zinc-800"
              )}
            >
              {copyFull.copied ? (
                <>
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>

          {!output ? (
            <div className="text-zinc-500">—</div>
          ) : beautify ? (
            <PrettyEmail text={output} />
          ) : (
            <pre className="whitespace-pre-wrap text-zinc-100">{output}</pre>
          )}
        </div>

        {/* Meta / Usage */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm uppercase tracking-wide text-zinc-400">Meta</div>
            <div className="text-xs text-zinc-400 font-mono">model: {model}</div>
          </div>
          <div className="mt-2 text-sm text-zinc-300">
            {usage ? (
              <div className="flex flex-wrap gap-4">
                <span>
                  prompt tokens:{" "}
                  <span className="font-mono text-zinc-100">{usage.prompt}</span>
                </span>
                <span>
                  completion tokens:{" "}
                  <span className="font-mono text-zinc-100">{usage.completion}</span>
                </span>
                <span>
                  total:{" "}
                  <span className="font-mono text-zinc-100">{usage.total}</span>
                </span>
              </div>
            ) : (
              <span className="text-zinc-500">No usage reported.</span>
            )}
          </div>
        </div>

        {/* Raw JSON (debug) */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div className="text-sm uppercase tracking-wide text-zinc-400">
              Raw JSON (debug)
            </div>
            {showRaw ? (
              <ChevronUp className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            )}
          </button>
          {showRaw ? (
            <div className="border-t border-zinc-800 p-4">
              {!raw ? (
                <div className="text-zinc-500 text-sm">—</div>
              ) : (
                <pre className="whitespace-pre-wrap text-xs text-zinc-300">
                  {JSON.stringify(raw, null, 2)}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function parseEmail(text) {
  if (!text) return { subject: "", body: text || "" };
  const lines = text.split(/\r?\n/);
  let subject = "";
  const rest = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trim();
    if (!subject && /^subject\s*:/i.test(L)) {
      subject = L.replace(/^subject\s*:\s*/i, "").trim();
      continue;
    }
    rest.push(lines[i]);
  }
  const body = rest.join("\n").trim();
  return { subject, body };
}

function PrettyEmail({ text }) {
  const { subject, body } = parseEmail(text);
  return (
    <div className="space-y-3">
      {subject ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-950/50 p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">
            Subject
          </div>
          <div className="font-medium text-zinc-100">{subject}</div>
        </div>
      ) : null}
      <div className="prose prose-invert max-w-none">
        {body
          ? body.split(/\n{2,}/).map((p, i) => (
              <p key={i} className="text-zinc-100 leading-7">
                {p.trim()}
              </p>
            ))
          : null}
      </div>
    </div>
  );
}
