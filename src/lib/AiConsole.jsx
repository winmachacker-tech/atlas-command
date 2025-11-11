// src/pages/AiConsole.jsx
import { useState, useRef, useMemo } from "react";
import {
  Loader2,
  Send,
  AlertTriangle,
  Bot,
  Trash2,
  ClipboardCopy,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  Wand2,
} from "lucide-react";
import { aiChat } from "../lib/aiClient";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/** Heuristic: pull out "Subject:" header and prettify body paragraphs */
function parseEmailLike(text) {
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
  // trim leading/trailing blank lines from body
  const body = rest.join("\n").replace(/^\s+|\s+$/g, "");
  return { subject, body };
}

/** Copy to clipboard with small success flash */
function useClipboard() {
  const [copied, setCopied] = useState(false);
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }
  return { copied, copy };
}

export default function AiConsole() {
  const [prompt, setPrompt] = useState(
    "Write a short customer email: the driver is delayed 45 minutes, new ETA 10:15 AM."
  );
  const [response, setResponse] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [raw, setRaw] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [beautifyEmail, setBeautifyEmail] = useState(true);
  const inputRef = useRef(null);

  const usage = useMemo(() => {
    try {
      const u =
        raw &&
        (raw.usage ||
          raw.raw?.usage ||
          (raw.raw && raw.raw.usage));
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

  const emailView = useMemo(() => parseEmailLike(response), [response]);

  const subjClip = useClipboard();
  const bodyClip = useClipboard();
  const fullClip = useClipboard();

  async function handleSend(e) {
    e?.preventDefault?.();
    if (!prompt.trim()) return;
    setErr("");
    setResponse("");
    setBusy(true);
    setRaw(null);
    try {
      const res = await aiChat({
        prompt: prompt.trim(),
        model,
        temperature: 0.2,
        max_tokens: 800,
      });

      if (!res.ok) {
        setErr(res.error || "AI request failed");
        setRaw(res.details || null);
        return;
      }

      // Our function returns { ok, output, model, raw }
      setResponse(res.output || "");
      setModel(res.model || model);
      setRaw(res.raw || null);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function handleClear() {
    setPrompt("");
    setResponse("");
    setErr("");
    setRaw(null);
    setShowRaw(false);
    inputRef.current?.focus();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-zinc-800/60 border border-zinc-700">
            <Bot className="w-5 h-5 text-zinc-200" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">AI Console</h1>
            <p className="text-sm text-zinc-400">
              Clean tester for your <span className="font-mono">ai-chat</span> function with pretty output.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={beautifyEmail}
              onChange={(e) => setBeautifyEmail(e.target.checked)}
            />
            <Wand2 className="w-4 h-4" />
            Beautify emails
          </label>
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            title="Clear"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Ask somethingâ€¦ e.g., "Write a customer email: 45-min delay, ETA 10:15 AM."'
            rows={6}
            className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
          />

          <div className="flex flex-col gap-3">
            <label className="text-sm text-zinc-400">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-xl border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
            >
              <option value="gpt-4o-mini">gpt-4o-mini (cheap)</option>
              <option value="gpt-4o">gpt-4o</option>
            </select>

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
                  Sendingâ€¦
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
      <div className="mt-6 grid gap-3">
        {/* Pretty Email Card OR Plain Text */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm uppercase tracking-wide text-zinc-400">
              Output
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fullClip.copy(response)}
                className={cx(
                  "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                  fullClip.copied
                    ? "border-emerald-700 bg-emerald-900/30 text-emerald-200"
                    : "border-zinc-700 bg-zinc-950/40 text-zinc-200 hover:bg-zinc-800"
                )}
                title="Copy full output"
              >
                {fullClip.copied ? (
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
          </div>

          {!response ? (
            <div className="text-zinc-500">â€”</div>
          ) : beautifyEmail ? (
            <div className="space-y-3">
              {/* Subject (if any) */}
              {emailView.subject ? (
                <div className="rounded-xl border border-zinc-700 bg-zinc-950/50 p-3">
                  <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">
                    Subject
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-zinc-100">{emailView.subject}</div>
                    <button
                      onClick={() => subjClip.copy(emailView.subject)}
                      className={cx(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                        subjClip.copied
                          ? "border-emerald-700 bg-emerald-900/30 text-emerald-200"
                          : "border-zinc-700 bg-zinc-950/40 text-zinc-200 hover:bg-zinc-800"
                      )}
                    >
                      {subjClip.copied ? (
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
                </div>
              ) : null}

              {/* Body */}
              <div className="rounded-xl border border-zinc-700 bg-zinc-950/50 p-3">
                <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">
                  Body
                </div>
                <div className="prose prose-invert max-w-none">
                  {emailView.body
                    .split(/\n{2,}/)
                    .map((para, i) => (
                      <p key={i} className="text-zinc-100 leading-7">
                        {para.trim()}
                      </p>
                    ))}
                </div>
                <div className="mt-2">
                  <button
                    onClick={() => bodyClip.copy(emailView.body || response)}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
                      bodyClip.copied
                        ? "border-emerald-700 bg-emerald-900/30 text-emerald-200"
                        : "border-zinc-700 bg-zinc-950/40 text-zinc-200 hover:bg-zinc-800"
                    )}
                  >
                    {bodyClip.copied ? (
                      <>
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        Copied Body
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="w-3.5 h-3.5" />
                        Copy Body
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Plain mode (no beautify)
            <pre className="whitespace-pre-wrap text-zinc-100">{response}</pre>
          )}
        </div>

        {/* Meta / Usage */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm uppercase tracking-wide text-zinc-400">
              Meta
            </div>
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

        {/* Raw JSON (collapsible) */}
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
                <div className="text-zinc-500 text-sm">â€”</div>
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

