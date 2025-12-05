// FILE: src/lib/dipsy/FaqTestPanel.tsx
import React, { useState } from "react";
import { askDipsyQuestion } from "@/lib/dipsy/askDipsyQuestion";

type QuestionsBrainResponse = {
  answer?: string;
  sources?: any[];
  matched_docs?: any[];
  error?: string;
  [key: string]: any;
};

const SAMPLE_QUESTIONS: string[] = [
  "Explain the full load lifecycle in Atlas Command.",
  "What does 'Ready for Billing' do?",
  "What's the difference between DELIVERED and READY_FOR_BILLING?",
  "What load statuses exist in Atlas Command?",
];

const FaqTestPanel: React.FC = () => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<QuestionsBrainResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [strictMode, setStrictMode] = useState(true);
  const [sourceTag, setSourceTag] = useState("faq-test-panel");

  async function handleAsk() {
    if (!question.trim()) {
      setError("Please type a question first.");
      return;
    }

    setLoading(true);
    setError(null);
    setAnswer("");
    setRaw(null);

    try {
      const res = (await askDipsyQuestion(question, {
        source: sourceTag || "faq-test-panel",
        strictMode,
      })) as QuestionsBrainResponse;

      setRaw(res);

      if (res.error) {
        setError(res.error);
      }

      if (typeof res.answer === "string") {
        setAnswer(res.answer);
      } else {
        setAnswer("");
      }
    } catch (err: any) {
      console.error("[FaqTestPanel] askDipsyQuestion error:", err);
      setError(err?.message || "Unexpected error calling questions-brain.");
    } finally {
      setLoading(false);
    }
  }

  function handleSampleClick(q: string) {
    setQuestion(q);
    setAnswer("");
    setError(null);
    setRaw(null);
  }

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-base)]">
      <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">
              Dipsy FAQ / Atlas Docs Test Panel
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              Test the <code>questions-brain</code> Edge Function against{" "}
              <code>atlas_docs</code>.
            </p>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(e) => setStrictMode(e.target.checked)}
            />
            <span>Strict anti-hallucination</span>
          </label>
        </header>

        {/* Question input + samples */}
        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Ask Dipsy a question</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Uses <code>askDipsyQuestion()</code> with your current session
                JWT.
              </p>
            </div>
            <input
              type="text"
              value={sourceTag}
              onChange={(e) => setSourceTag(e.target.value)}
              className="w-40 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-[11px]"
              placeholder="source tag"
            />
          </div>

          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full min-h-[100px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
            placeholder="e.g. Explain the full load lifecycle in Atlas Command."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleAsk();
              }
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSampleClick(q)}
                  className="px-3 py-1.5 rounded-full bg-[var(--bg-hover)] text-xs hover:bg-[var(--bg-active)]"
                >
                  {q.length > 40 ? `${q.slice(0, 37)}…` : q}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAsk}
              disabled={loading}
              className="px-4 py-2 rounded-full bg-emerald-500 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-60"
            >
              {loading ? "Asking Dipsy…" : "Ask Dipsy"}
            </button>
          </div>

          {error && (
            <div className="mt-2 rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
        </section>

        {/* Answer + raw JSON */}
        <section className="grid gap-4 md:grid-cols-[2fr,1.4fr]">
          {/* Answer */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Answer</h2>
              {raw && (
                <button
                  type="button"
                  onClick={() => setShowRaw((prev) => !prev)}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-base)]"
                >
                  {showRaw ? "Hide raw JSON" : "Show raw JSON"}
                </button>
              )}
            </div>

            <div className="min-h-[120px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm whitespace-pre-wrap">
              {loading && !answer && "Thinking…"}
              {!loading && !answer && !error && "Ask a question to see an answer."}
              {answer && answer}
            </div>

            {showRaw && raw && (
              <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-[11px] leading-snug">
                {JSON.stringify(raw, null, 2)}
              </pre>
            )}
          </div>

          {/* Sources */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 space-y-2">
            <h2 className="text-sm font-medium">Matched docs / sources</h2>
            <p className="text-[11px] text-[var(--text-muted)] mb-1">
              If the FAQ agent is behaving, every substantive answer about Atlas
              should be backed by at least one source from <code>atlas_docs</code>.
            </p>

            {(() => {
              const sources =
                (raw?.sources as any[]) ||
                (raw?.matched_docs as any[]) ||
                [];

              if (!sources.length) {
                return (
                  <p className="text-xs text-[var(--text-muted)]">
                    No sources reported for the last answer.
                  </p>
                );
              }

              return (
                <ul className="space-y-2 text-xs">
                  {sources.map((src, idx) => (
                    <li
                      key={src.id ?? idx}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
                    >
                      <div className="font-medium">
                        {src.title || src.slug || `Doc ${idx + 1}`}
                      </div>
                      {src.slug && (
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {src.slug}
                        </div>
                      )}
                      {typeof src.similarity === "number" && (
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          similarity: {src.similarity.toFixed(3)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        </section>
      </div>
    </div>
  );
};

export default FaqTestPanel;
