// FILE: src/pages/DipsyTrainingReview.jsx
// Purpose: Human-in-the-loop review UI for dipsy_training_examples.
//
// - Lists training examples (defaults to status='draft').
// - Shows question, original_answer, rewritten_answer, evaluation metadata.
// - Allows admin/owner to Approve or Reject each example.
// - Includes a manual "Run Training Now" button that triggers the training ingest via the safe proxy function.
// - Uses RLS + JWT: only admins/owners in the org can see/update rows.

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// Hook to get current org and role
function useCurrentOrg() {
  const [orgId, setOrgId] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchOrgAndRole() {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) {
          setLoading(false);
          return;
        }

        // Get org from membership (orgs table has no owner column)
        const { data: membership } = await supabase
          .from("org_members")
          .select("org_id, role")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;

        if (membership) {
          setOrgId(membership.org_id);
          setRole(membership.role);
        } else {
          console.warn("[useCurrentOrg] No org membership found for user:", userId);
        }
      } catch (err) {
        console.error("[useCurrentOrg] Error:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchOrgAndRole();
    return () => {
      cancelled = true;
    };
  }, []);

  return { orgId, role, loading };
}

// === Run Training Now Button ===
function RunTrainingNow({ onComplete }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  async function runTraining() {
    setRunning(true);
    setResult(null);

    const { data, error } = await supabase.functions.invoke(
      "dipsy-training-run",
      {
        method: "POST",
        body: { batch_size: 50 },
      }
    );

    if (error) {
      setResult({ error: error.message });
    } else {
      setResult(data);
      if (onComplete) onComplete();
    }

    setRunning(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={runTraining}
        disabled={running}
        className="h-8 rounded-md border border-emerald-600 bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {running ? "Running Training…" : "Run Training Now"}
      </button>

      {result && (
        <pre className="mt-1 max-w-[300px] overflow-auto rounded-md bg-slate-900 p-2 text-[10px] text-slate-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

const STATUS_FILTER_LABELS = {
  draft: "Drafts",
  approved: "Approved",
  rejected: "Rejected",
  all: "All",
};

const SORT_LABELS = {
  newest: "Newest first",
  oldest: "Oldest first",
  score_low: "Lowest score first",
  score_high: "Highest score first",
};

export default function DipsyTrainingReview() {
  const { orgId, role, loading: orgLoading } = useCurrentOrg();

  const [loading, setLoading] = useState(false);
  const [examples, setExamples] = useState([]);
  const [error, setError] = useState(null);

  const [statusFilter, setStatusFilter] = useState("draft");
  const [verdictFilter, setVerdictFilter] = useState(null);
  const [minScore, setMinScore] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const [expandedId, setExpandedId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [rejectionNotes, setRejectionNotes] = useState({});
  const [rewriteDrafts, setRewriteDrafts] = useState({});

  const hasAccess = role === "admin" || role === "owner";

  useEffect(() => {
    if (!orgId || !hasAccess) return;
    fetchExamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, hasAccess, statusFilter, verdictFilter, minScore, search, sortBy]);

  async function fetchExamples() {
    setLoading(true);
    setError(null);

    let query = supabase
      .from("dipsy_training_examples")
      .select(`
        id,
        org_id,
        created_at,
        question,
        original_answer,
        rewritten_answer,
        evaluation,
        overall_score,
        verdict,
        status,
        approved_at,
        approved_by,
        rejected_at,
        rejected_by,
        rejection_reason
      `)
      .or(`org_id.eq.${orgId},org_id.is.null`);

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    if (verdictFilter) query = query.eq("verdict", verdictFilter);

    if (minScore != null) query = query.gte("overall_score", minScore);

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(
        `question.ilike.${term},original_answer.ilike.${term},rewritten_answer.ilike.${term}`
      );
    }

    switch (sortBy) {
      case "newest":
        query = query.order("created_at", { ascending: false });
        break;
      case "oldest":
        query = query.order("created_at", { ascending: true });
        break;
      case "score_low":
        query = query.order("overall_score", {
          ascending: true,
          nullsFirst: true,
        });
        break;
      case "score_high":
        query = query.order("overall_score", {
          ascending: false,
          nullsLast: true,
        });
        break;
      default:
        break;
    }

    query = query.limit(50);

    const { data, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching training examples:", fetchError);
      setError(fetchError.message);
    } else {
      const rows = data ?? [];
      setExamples(rows);

      const newRewriteDrafts = {};
      const newRejectionNotes = {};
      rows.forEach((ex) => {
        newRewriteDrafts[ex.id] = ex.rewritten_answer || "";
        newRejectionNotes[ex.id] = ex.rejection_reason || "";
      });
      setRewriteDrafts(newRewriteDrafts);
      setRejectionNotes(newRejectionNotes);
    }

    setLoading(false);
  }

  async function handleDecision(exampleId, decision) {
    setSavingId(exampleId);
    setError(null);

    const now = new Date().toISOString();

    const rejectionReasonRaw = (rejectionNotes[exampleId] || "").trim();
    const rejectionReason =
      decision === "reject" && rejectionReasonRaw ? rejectionReasonRaw : null;

    const currentExample = examples.find((ex) => ex.id === exampleId);
    const draftValue =
      rewriteDrafts[exampleId] != null
        ? rewriteDrafts[exampleId]
        : currentExample?.rewritten_answer || "";
    const rewrittenFromDraft = draftValue.trim();

    const updates = {
      status: decision === "approve" ? "approved" : "rejected",
      approved_at: decision === "approve" ? now : null,
      rejected_at: decision === "reject" ? now : null,
      rejection_reason: decision === "reject" ? rejectionReason : null,
      ...(decision === "approve"
        ? { rewritten_answer: rewrittenFromDraft }
        : {}),
    };

    const { error: updateError } = await supabase
      .from("dipsy_training_examples")
      .update(updates)
      .eq("id", exampleId);

    if (updateError) {
      console.error("Error updating training example:", updateError);
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    setExamples((prev) =>
      prev
        .map((ex) =>
          ex.id === exampleId
            ? {
                ...ex,
                ...updates,
                rewritten_answer:
                  decision === "approve"
                    ? rewrittenFromDraft
                    : ex.rewritten_answer,
              }
            : ex
        )
        .filter((ex) => {
          if (statusFilter === "draft") return ex.status === "draft";
          if (statusFilter === "approved") return ex.status === "approved";
          if (statusFilter === "rejected") return ex.status === "rejected";
          return true;
        })
    );

    setSavingId(null);
    setExpandedId(null);
  }

  const draftCount = useMemo(
    () => examples.filter((ex) => ex.status === "draft").length,
    [examples]
  );

  const approvedCount = useMemo(
    () => examples.filter((ex) => ex.status === "approved").length,
    [examples]
  );

  const avgDraftScore = useMemo(() => {
    const draftScores = examples
      .filter((ex) => ex.status === "draft" && ex.overall_score != null)
      .map((ex) => ex.overall_score);
    if (!draftScores.length) return null;
    const sum = draftScores.reduce((a, b) => a + b, 0);
    return sum / draftScores.length;
  }, [examples]);

  const avgApprovedScore = useMemo(() => {
    const approvedScores = examples
      .filter((ex) => ex.status === "approved" && ex.overall_score != null)
      .map((ex) => ex.overall_score);
    if (!approvedScores.length) return null;
    const sum = approvedScores.reduce((a, b) => a + b, 0);
    return sum / approvedScores.length;
  }, [examples]);

  if (orgLoading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold mb-2">Dipsy Training Review</h1>
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold mb-2">Dipsy Training Review</h1>
        <p className="text-sm text-gray-500">
          You don't have permission to access this page. Admin or owner role
          required.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Dipsy Training Review</h1>
            <p className="text-sm text-gray-500 max-w-2xl">
              Review and approve Dipsy's rewritten FAQ answers before they
              become training data. Only approved examples are used to shape
              future behavior.
            </p>
            <div className="mt-2 inline-flex items-center gap-2 text-xs">
              <span className="inline-flex items-center rounded-full bg-slate-900/80 px-3 py-1 text-[11px] font-medium text-slate-100">
                Brain: Questions / FAQ
              </span>
            </div>
          </div>

          {/* Run Training Now */}
          <RunTrainingNow onComplete={fetchExamples} />

          <div className="flex flex-col items-end gap-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Chip label={`Drafts: ${draftCount}`} />
              <Chip label={`Approved (loaded): ${approvedCount}`} />
              <Chip
                label={
                  avgDraftScore != null
                    ? `Avg draft score: ${avgDraftScore.toFixed(1)}`
                    : "Avg draft score: —"
                }
              />
              <Chip
                label={
                  avgApprovedScore != null
                    ? `Avg approved score: ${avgApprovedScore.toFixed(1)}`
                    : "Avg approved score: —"
                }
              />
            </div>
            {loading && (
              <span className="text-[11px] text-gray-500">
                Refreshing examples…
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Filters / Controls */}
      <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">Status</span>
            <div className="inline-flex overflow-hidden rounded-full border border-slate-700 bg-slate-900">
              {["draft", "approved", "rejected", "all"].map((value) => {
                const active = statusFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={[
                      "px-3 py-1.5 text-[11px] font-medium transition",
                      active
                        ? "bg-slate-100 text-slate-900"
                        : "text-gray-400 hover:bg-slate-800/80",
                    ].join(" ")}
                  >
                    {STATUS_FILTER_LABELS[value]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Verdict filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">Verdict</span>
            <input
              type="text"
              placeholder="e.g. needs_improvement"
              value={verdictFilter ?? ""}
              onChange={(e) => setVerdictFilter(e.target.value || null)}
              className="h-7 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 placeholder:text-slate-500"
            />
          </div>

          {/* Min score */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">Min score</span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={minScore ?? ""}
              onChange={(e) =>
                setMinScore(
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
              className="h-7 w-20 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 placeholder:text-slate-500"
            />
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-7 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search question / answers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 min-w-[220px] rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={() => fetchExamples()}
              className="h-8 rounded-md border border-slate-600 bg-slate-100 px-3 text-xs font-medium text-slate-900 hover:bg-white"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">Error: {error}</p>}
      </section>

      {/* Examples list */}
      <section className="space-y-3">
        {examples.length === 0 && !loading && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-gray-400">
            No training examples found for this filter.
          </div>
        )}

        {examples.map((ex) => {
          const isExpanded = expandedId === ex.id;
          const evalJson = ex.evaluation ?? {};
          const issues = evalJson.issues ?? [];
          const verdict = ex.verdict ?? evalJson.verdict ?? "unknown";
          const score =
            ex.overall_score != null
              ? ex.overall_score
              : evalJson.overall_score != null
              ? evalJson.overall_score
              : null;

          return (
            <article
              key={ex.id}
              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80"
            >
              {/* Collapsed header */}
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : ex.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-900/80"
              >
                <div className="flex-1">
                  <p className="line-clamp-1 text-sm font-medium text-slate-100">
                    {ex.question}
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                    ID: {ex.id}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    <span>
                      Created{" "}
                      {new Date(ex.created_at).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    <span className="h-3 w-px bg-slate-700" />
                    <span>
                      {issues.length} issue
                      {issues.length === 1 ? "" : "s"} flagged
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={ex.status} />
                    <VerdictPill verdict={verdict} />
                    <ScorePill score={score} />
                  </div>
                  <span className="text-[10px] text-gray-500">
                    {isExpanded ? "Collapse" : "Expand"} ▾
                  </span>
                </div>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-slate-800 bg-slate-950 px-4 py-4 text-sm text-slate-100">
                  <p className="text-[11px] font-mono text-slate-500 mb-3">
                    Example ID: {ex.id}
                  </p>

                  <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)]">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Evaluation summary
                        </p>
                        <p className="mt-1 text-sm">
                          Verdict:{" "}
                          <span className="font-medium">{verdict}</span>
                          {score != null && (
                            <>
                              {" · "}
                              Score:{" "}
                              <span className="font-mono">
                                {score.toFixed(1)} / 10
                              </span>
                            </>
                          )}
                        </p>
                      </div>

                      {issues.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-400">
                            Key issues
                          </p>
                          <ul className="list-disc space-y-1 pl-4 text-xs text-gray-300">
                            {issues.map((issue, idx) => (
                              <li key={idx}>
                                {issue.type && (
                                  <span className="font-semibold">
                                    {issue.type}:{" "}
                                  </span>
                                )}
                                {issue.description || JSON.stringify(issue)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {evalJson.notes_for_rewriter && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-400">
                            Notes for rewriter
                          </p>
                          <p className="rounded-md bg-slate-900/80 p-2 text-xs text-gray-200">
                            {evalJson.notes_for_rewriter}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Answer comparison
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-gray-400">
                            Original answer
                          </p>
                          <div className="max-h-56 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2 text-[11px] leading-relaxed text-gray-100">
                            {ex.original_answer}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-gray-400">
                            Rewritten answer (proposed training example)
                          </p>
                          <textarea
                            className="max-h-56 min-h-[80px] w-full rounded-md border border-emerald-800/70 bg-slate-950 p-2 text-[11px] leading-relaxed text-gray-100"
                            value={
                              rewriteDrafts[ex.id] ?? ex.rewritten_answer ?? ""
                            }
                            onChange={(e) =>
                              setRewriteDrafts((prev) => ({
                                ...prev,
                                [ex.id]: e.target.value,
                              }))
                            }
                            placeholder="Edit the ideal answer Dipsy should learn. This will be saved into rewritten_answer when you approve."
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-500">
                        Compare side-by-side and decide if this rewritten
                        answer is safe to treat as ground truth.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-2 flex flex-col gap-3 border-t border-slate-800 pt-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2 text-[11px] text-gray-400">
                      <span>Decision for this example:</span>
                      <StatusPill status={ex.status} />
                    </div>

                    <div className="flex flex-1 flex-col items-stretch gap-3 md:flex-row md:items-center md:justify-end">
                      <div className="flex-1">
                        <label className="mb-1 block text-[11px] font-medium text-gray-400">
                          Rejection notes (optional)
                        </label>
                        <textarea
                          rows={2}
                          placeholder="If rejecting, briefly explain why…"
                          value={rejectionNotes[ex.id] ?? ""}
                          onChange={(e) =>
                            setRejectionNotes((prev) => ({
                              ...prev,
                              [ex.id]: e.target.value,
                            }))
                          }
                          className="w-full rounded-md border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-100 placeholder:text-slate-500"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={savingId === ex.id}
                          onClick={() => handleDecision(ex.id, "reject")}
                          className={[
                            "h-9 rounded-md border px-3 text-xs font-medium transition",
                            "border-red-500/60 bg-transparent text-red-300 hover:bg-red-500/10",
                            savingId === ex.id ? "opacity-60" : "",
                          ].join(" ")}
                        >
                          {savingId === ex.id ? "Rejecting…" : "Reject"}
                        </button>
                        <button
                          type="button"
                          disabled={savingId === ex.id}
                          onClick={() => handleDecision(ex.id, "approve")}
                          className={[
                            "h-9 rounded-md border px-3 text-xs font-medium transition",
                            "border-emerald-500 bg-emerald-500 text-slate-950 hover:bg-emerald-400",
                            savingId === ex.id ? "opacity-70" : "",
                          ].join(" ")}
                        >
                          {savingId === ex.id
                            ? "Approving…"
                            : "Approve as training example"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

/* Presentational helpers */

function Chip({ label }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-gray-200">
      {label}
    </span>
  );
}

function StatusPill({ status }) {
  const label =
    status === "draft"
      ? "Draft"
      : status === "approved"
      ? "Approved"
      : "Rejected";
  const base =
    "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium";
  const styles =
    status === "draft"
      ? "bg-slate-800 text-slate-100"
      : status === "approved"
      ? "bg-emerald-500/90 text-slate-950"
      : "bg-red-500/90 text-slate-950";
  return <span className={`${base} ${styles}`}>{label}</span>;
}

function VerdictPill({ verdict }) {
  const base =
    "inline-flex items-center rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-100";
  return <span className={base}>{verdict || "No verdict"}</span>;
}

function ScorePill({ score }) {
  const base =
    "inline-flex items-center rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-mono";
  return (
    <span className={base}>
      {score != null ? `${score.toFixed(1)}/10` : "—/10"}
    </span>
  );
}