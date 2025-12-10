// FILE: src/pages/DipsyQualityDashboard.jsx
// Purpose: Dipsy AI Quality Monitoring Dashboard
// - Shows evaluation runs (auto + manual)
// - Displays scores, pass rates, hallucination issues
// - Lets you run a manual evaluation via the dipsy-auto-eval edge function
// - Knowledge Drafts tab for reviewing AI-generated documentation
// - Edit drafts before publishing
// - Manually submit knowledge gaps
//
// Security:
// - Uses the logged-in user's Supabase JWT via supabase-js.
// - All reads/writes go through RLS-protected tables.
// - No service_role keys and no security policies are modified here.

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  Brain,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  FileQuestion,
  Target,
  Zap,
  BarChart3,
  Loader2,
  AlertCircle,
  Eye,
  Plus,
  Flag,
  Bot,
  ArrowUp,
  ArrowDown,
  Minus,
  BookOpen,
  FileText,
  Check,
  X,
  MessageSquare,
  Pencil,
  Save,
  RotateCcw,
  Sparkles,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLE MARKDOWN PREVIEW
// ─────────────────────────────────────────────────────────────────────────────
function MarkdownPreview({ content }) {
  if (!content) return <p className="text-zinc-500 italic">No content</p>;

  const lines = content.split("\n");
  const elements = [];

  lines.forEach((line, idx) => {
    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={idx} className="text-sm font-semibold text-white mt-3 mb-1">
          {line.slice(4)}
        </h4>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h3 key={idx} className="text-base font-semibold text-white mt-4 mb-2">
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h2 key={idx} className="text-lg font-bold text-white mt-4 mb-2">
          {line.slice(2)}
        </h2>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={idx} className="text-sm text-zinc-300 ml-4 list-disc">
          {line.slice(2)}
        </li>
      );
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(
        <li key={idx} className="text-sm text-zinc-300 ml-4 list-decimal">
          {line.replace(/^\d+\.\s/, "")}
        </li>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={idx} className="h-2" />);
    } else {
      const processed = line.replace(
        /\*\*(.+?)\*\*/g,
        '<strong class="text-white font-medium">$1</strong>'
      );
      elements.push(
        <p
          key={idx}
          className="text-sm text-zinc-300"
          dangerouslySetInnerHTML={{ __html: processed }}
        />
      );
    }
  });

  return <div className="space-y-1">{elements}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────
function DraftStatusBadge({ status }) {
  const styles = {
    draft: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    approved: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    published: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const labels = {
    draft: "Pending Review",
    approved: "Approved",
    published: "Published",
    rejected: "Rejected",
  };

  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
        styles[status] || styles.draft
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT CARD COMPONENT (with edit mode)
// ─────────────────────────────────────────────────────────────────────────────
function DraftCard({ draft, isExpanded, onToggle, onApprove, onReject, onUpdate, isProcessing }) {
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title);
  const [editBody, setEditBody] = useState(draft.body || "");
  const [isSaving, setIsSaving] = useState(false);

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleRejectClick = () => {
    if (showRejectInput && rejectReason.trim()) {
      onReject(draft.id, rejectReason);
      setShowRejectInput(false);
      setRejectReason("");
    } else {
      setShowRejectInput(true);
    }
  };

  const handleSaveEdit = async () => {
    setIsSaving(true);
    await onUpdate(draft.id, { title: editTitle, body: editBody });
    setIsSaving(false);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(draft.title);
    setEditBody(draft.body || "");
    setIsEditing(false);
  };

  const sourceQuestions = draft.source_questions || [];

  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden">
      {/* Header - Always visible */}
      <div
        onClick={onToggle}
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-zinc-700/30 transition-colors"
      >
        <button className="text-zinc-400">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        <div className={`p-2 rounded-lg border ${
          draft.status === "published" 
            ? "bg-emerald-500/10 border-emerald-500/20" 
            : draft.status === "rejected"
            ? "bg-red-500/10 border-red-500/20"
            : "bg-amber-500/10 border-amber-500/20"
        }`}>
          <FileText className={`w-4 h-4 ${
            draft.status === "published" 
              ? "text-emerald-400" 
              : draft.status === "rejected"
              ? "text-red-400"
              : "text-amber-400"
          }`} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{draft.title}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {draft.doc_type || "knowledge"} • {formatDate(draft.created_at)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {sourceQuestions.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <MessageSquare className="w-3.5 h-3.5" />
              {sourceQuestions.length} question{sourceQuestions.length !== 1 ? "s" : ""}
            </span>
          )}
          <DraftStatusBadge status={draft.status} />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-zinc-700/50 bg-zinc-900/30">
          {/* Source Questions */}
          {sourceQuestions.length > 0 && (
            <div className="px-4 py-3 border-b border-zinc-700/30">
              <p className="text-xs font-medium text-zinc-400 mb-2">
                Questions that triggered this draft:
              </p>
              <div className="space-y-1">
                {sourceQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-sm text-zinc-300"
                  >
                    <span className="text-zinc-600">•</span>
                    <span>{q}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content Preview / Edit Mode */}
          <div className="px-4 py-4">
            {isEditing ? (
              <div className="space-y-4">
                {/* Title Edit */}
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-2 block">
                    Title:
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                {/* Body Edit */}
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-2 block">
                    Content (Markdown supported):
                  </label>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    rows={12}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono resize-y"
                  />
                </div>
                {/* Edit Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveEdit();
                    }}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save Changes
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelEdit();
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-zinc-400">
                    Generated Content:
                  </p>
                  {draft.status === "draft" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsEditing(true);
                      }}
                      className="flex items-center gap-1 text-xs text-zinc-400 hover:text-emerald-400 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  )}
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <MarkdownPreview content={draft.body} />
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          {draft.status === "draft" && !isEditing && (
            <div className="px-4 py-3 border-t border-zinc-700/30 flex items-center gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(draft.id);
                }}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Approve & Publish
              </button>

              {showRejectInput ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Reason for rejection..."
                    className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500"
                    autoFocus
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRejectClick();
                    }}
                    disabled={!rejectReason.trim() || isProcessing}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRejectInput(false);
                      setRejectReason("");
                    }}
                    className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRejectClick();
                  }}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
                >
                  <X className="w-4 h-4" />
                  Reject
                </button>
              )}
            </div>
          )}

          {/* Rejection reason display */}
          {draft.status === "rejected" && draft.rejection_reason && (
            <div className="px-4 py-3 border-t border-zinc-700/30">
              <p className="text-xs text-red-400">
                <span className="font-medium">Rejection reason:</span>{" "}
                {draft.rejection_reason}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD QUESTION MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AddQuestionModal({ isOpen, onClose, onSubmit, isSubmitting }) {
  const [question, setQuestion] = useState("");

  const handleSubmit = () => {
    if (question.trim()) {
      onSubmit(question.trim());
      setQuestion("");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-400" />
            Add Knowledge Gap
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-zinc-400">
            Enter a question that Dipsy should be able to answer. This will be logged as a knowledge gap and included in the next clustering run.
          </p>

          <div>
            <label className="text-xs font-medium text-zinc-400 mb-2 block">
              Question:
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g., What is a bill of lading?"
              rows={3}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-600 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 resize-none"
              autoFocus
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={!question.trim() || isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add Question
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN CLUSTERING MODAL
// ─────────────────────────────────────────────────────────────────────────────
function RunClusteringModal({ isOpen, onClose, onRun, isRunning, result }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Run Knowledge Clustering
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {result ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">Clustering Complete!</span>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-3 space-y-2 text-sm">
                <p className="text-zinc-300">
                  <span className="text-zinc-500">Gaps processed:</span> {result.gaps_processed || 0}
                </p>
                <p className="text-zinc-300">
                  <span className="text-zinc-500">Clusters created:</span> {result.clusters_created || 0}
                </p>
                <p className="text-zinc-300">
                  <span className="text-zinc-500">Drafts generated:</span> {result.drafts_generated || 0}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-zinc-400">
                This will analyze all unprocessed knowledge gaps, cluster similar questions together, and generate documentation drafts using AI.
              </p>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-sm text-amber-400">
                  ⚡ This uses GPT-4 API calls and may take a minute depending on the number of gaps.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={onRun}
                  disabled={isRunning}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Run Clustering
                    </>
                  )}
                </button>
                <button
                  onClick={onClose}
                  disabled={isRunning}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED RUN STATUS WIDGET
// ─────────────────────────────────────────────────────────────────────────────
function ScheduledRunStatus({ runs }) {
  const scheduledRuns = runs.filter((r) => r.run_type === "scheduled");
  const lastScheduled = scheduledRuns[0];
  const previousScheduled = scheduledRuns[1];

  if (!lastScheduled) {
    return null;
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return "N/A";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    return `${diffDays} days ago`;
  };

  let passRateDelta = null;
  let deltaDirection = null;

  if (
    previousScheduled &&
    lastScheduled.total_questions > 0 &&
    previousScheduled.total_questions > 0
  ) {
    const currentPassRate =
      (lastScheduled.passed || 0) / lastScheduled.total_questions;
    const previousPassRate =
      (previousScheduled.passed || 0) / previousScheduled.total_questions;
    passRateDelta = Math.round((currentPassRate - previousPassRate) * 100);
    deltaDirection =
      passRateDelta > 0 ? "up" : passRateDelta < 0 ? "down" : "same";
  }

  const isSuccess =
    lastScheduled.run_status === "completed" &&
    (lastScheduled.failed || 0) === 0;
  const hasFailures = (lastScheduled.failed || 0) > 0;
  const needsReview = (lastScheduled.needs_review || 0) > 0;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${
        isSuccess
          ? "bg-emerald-500/10 border-emerald-500/30"
          : hasFailures
          ? "bg-red-500/10 border-red-500/30"
          : needsReview
          ? "bg-amber-500/10 border-amber-500/30"
          : "bg-zinc-700/30 border-zinc-600/30"
      }`}
    >
      <div
        className={`p-1.5 rounded-full ${
          isSuccess
            ? "bg-emerald-500/20"
            : hasFailures
            ? "bg-red-500/20"
            : "bg-amber-500/20"
        }`}
      >
        {isSuccess ? (
          <Bot className="w-4 h-4 text-emerald-400" />
        ) : hasFailures ? (
          <AlertCircle className="w-4 h-4 text-red-400" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Last Auto-Eval</span>
          <span className="text-xs text-zinc-500">
            {formatTime(lastScheduled.started_at || lastScheduled.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs mt-0.5">
          <span className="text-emerald-400">✓ {lastScheduled.passed || 0}</span>
          {(lastScheduled.soft_passed || 0) > 0 && (
            <span className="text-blue-400">◐ {lastScheduled.soft_passed}</span>
          )}
          {(lastScheduled.needs_review || 0) > 0 && (
            <span className="text-amber-400">⚠ {lastScheduled.needs_review}</span>
          )}
          {(lastScheduled.failed || 0) > 0 && (
            <span className="text-red-400">✗ {lastScheduled.failed}</span>
          )}
        </div>
      </div>

      {passRateDelta !== null && deltaDirection !== "same" && (
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
            deltaDirection === "up"
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {deltaDirection === "up" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )}
          {Math.abs(passRateDelta)}%
        </div>
      )}
      {passRateDelta !== null && deltaDirection === "same" && (
        <div className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-zinc-600/30 text-zinc-400">
          <Minus className="w-3 h-3" />
          No change
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, subValue, color = "emerald" }) {
  const colorClasses = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    red: "text-red-400 bg-red-500/10 border-red-500/20",
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    zinc: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
  };

  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg border ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-zinc-400 text-sm">{label}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
          {subValue && <p className="text-xs text-zinc-500">{subValue}</p>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VERDICT BADGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function VerdictBadge({ verdict }) {
  const styles = {
    pass: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    soft_pass: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    needs_review: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    soft_fail: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    fail: "bg-red-500/20 text-red-400 border-red-500/30",
    no_docs: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const labels = {
    pass: "Pass",
    soft_pass: "Soft Pass",
    needs_review: "Needs Review",
    soft_fail: "Soft Fail",
    fail: "Fail",
    no_docs: "No Docs",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
  };

  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
        styles[verdict] || styles.needs_review
      }`}
    >
      {labels[verdict] || verdict}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE BAR COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function ScoreBar({ label, value, color = "emerald" }) {
  const percentage = Math.round((value || 0) * 100);
  const colorClasses = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    blue: "bg-blue-500",
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300 font-medium">{percentage}%</span>
      </div>
      <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EVALUATION RESULT ROW COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function EvaluationResultRow({
  result,
  isExpanded,
  onToggle,
  onMarkFalsePositive,
}) {
  return (
    <div className="border-b border-zinc-700/50 last:border-0">
      <div
        onClick={onToggle}
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-zinc-700/30 transition-colors"
      >
        <button className="text-zinc-400">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{result.question}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {result.question_type || "general"} • {result.domain || "Core"}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-medium text-white">
              {Math.round((result.overall_score || 0) * 100)}%
            </p>
            <p className="text-xs text-zinc-500">Score</p>
          </div>
          <VerdictBadge verdict={result.verdict} />
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 bg-zinc-800/30 border-t border-zinc-700/30">
          <div className="pt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ScoreBar label="Accuracy" value={result.accuracy} color="emerald" />
              <ScoreBar label="Grounding" value={result.grounding} color="blue" />
              <ScoreBar label="Completeness" value={result.completeness} color="amber" />
              <ScoreBar
                label="Overall"
                value={result.overall_score}
                color={
                  result.overall_score >= 0.9
                    ? "emerald"
                    : result.overall_score >= 0.7
                    ? "amber"
                    : "red"
                }
              />
            </div>

            {result.dipsy_answer && (
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-2">
                  Dipsy's Answer:
                </p>
                <div className="bg-zinc-900/50 rounded-lg p-3 text-sm text-zinc-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {result.dipsy_answer}
                </div>
              </div>
            )}

            {result.issues && result.issues.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-400 mb-2">
                  Issues Found:
                </p>
                <div className="flex flex-wrap gap-2">
                  {result.issues.map((issue, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 text-xs bg-amber-500/10 text-amber-400 rounded border border-amber-500/20"
                    >
                      {issue}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.hallucinations && result.hallucinations.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red-400 mb-2">
                  Hallucinations Detected:
                </p>
                <div className="flex flex-wrap gap-2">
                  {result.hallucinations.map((h, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20"
                    >
                      {h}
                    </span>
                  ))}
                </div>
                {onMarkFalsePositive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkFalsePositive(result);
                    }}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    Mark as False Positive
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN HISTORY ROW COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function RunHistoryRow({ run, isSelected, onSelect }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const runDate = run.started_at || run.created_at;

  return (
    <div
      onClick={() => onSelect(run.id)}
      className={`p-4 border-b border-zinc-700/50 last:border-0 cursor-pointer transition-colors ${
        isSelected
          ? "bg-emerald-500/10 border-l-2 border-l-emerald-500"
          : "hover:bg-zinc-700/30"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={run.run_status} />
          <span className="text-xs text-zinc-500">{run.run_type}</span>
        </div>
        <span className="text-xs text-zinc-500">{formatDate(runDate)}</span>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1 text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{run.passed || 0}</span>
        </div>
        <div className="flex items-center gap-1 text-blue-400">
          <Target className="w-3.5 h-3.5" />
          <span>{run.soft_passed || 0}</span>
        </div>
        <div className="flex items-center gap-1 text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{run.needs_review || 0}</span>
        </div>
        <div className="flex items-center gap-1 text-red-400">
          <XCircle className="w-3.5 h-3.5" />
          <span>{run.failed || 0}</span>
        </div>
      </div>

      {run.avg_accuracy !== null && (
        <div className="mt-2 flex items-center gap-4 text-xs text-zinc-400">
          <span>Avg Accuracy: {Math.round((run.avg_accuracy || 0) * 100)}%</span>
          <span>Avg Grounding: {Math.round((run.avg_grounding || 0) * 100)}%</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function DipsyQualityDashboard() {
  const [loading, setLoading] = useState(true);
  const [runningEval, setRunningEval] = useState(false);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState("evaluations");

  // Evaluation data states
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [results, setResults] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [expandedResultId, setExpandedResultId] = useState(null);

  // Knowledge Drafts states
  const [drafts, setDrafts] = useState([]);
  const [draftFilter, setDraftFilter] = useState("pending");
  const [expandedDraftId, setExpandedDraftId] = useState(null);
  const [processingDraftId, setProcessingDraftId] = useState(null);
  const [draftsLoading, setDraftsLoading] = useState(false);

  // Knowledge Gaps states
  const [gapCount, setGapCount] = useState(0);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false);
  const [showClusteringModal, setShowClusteringModal] = useState(false);
  const [isRunningClustering, setIsRunningClustering] = useState(false);
  const [clusteringResult, setClusteringResult] = useState(null);

  // Stats
  const [stats, setStats] = useState({
    totalRuns: 0,
    totalQuestions: 0,
    avgAccuracy: 0,
    avgGrounding: 0,
    passRate: 0,
  });

  // Draft stats
  const [draftStats, setDraftStats] = useState({
    pending: 0,
    published: 0,
    rejected: 0,
  });

  // Get session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH EVALUATION RUNS
  // ─────────────────────────────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from("dipsy_eval_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (fetchError) {
        if (fetchError.code === "42P01" || fetchError.code === "42703") {
          console.log("[DipsyQuality] Eval tables not yet created");
          setRuns([]);
          return;
        }
        throw fetchError;
      }

      setRuns(data || []);

      if (data && data.length > 0) {
        const completedRuns = data.filter((r) => r.run_status === "completed");
        const totalPassed = completedRuns.reduce(
          (sum, r) => sum + (r.passed || 0),
          0
        );
        const totalQuestions = completedRuns.reduce(
          (sum, r) => sum + (r.total_questions || 0),
          0
        );
        const avgAcc =
          completedRuns.reduce((sum, r) => sum + (r.avg_accuracy || 0), 0) /
          (completedRuns.length || 1);
        const avgGnd =
          completedRuns.reduce((sum, r) => sum + (r.avg_grounding || 0), 0) /
          (completedRuns.length || 1);

        setStats({
          totalRuns: data.length,
          totalQuestions,
          avgAccuracy: avgAcc,
          avgGrounding: avgGnd,
          passRate: totalQuestions > 0 ? totalPassed / totalQuestions : 0,
        });
      }

      if (data && data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0].id);
      }
    } catch (err) {
      console.error("Error fetching runs:", err);
      if (err.code !== "42P01" && err.code !== "42703") {
        setError("Failed to load evaluation runs");
      }
    }
  }, [selectedRunId]);

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH RESULTS FOR SELECTED RUN
  // ─────────────────────────────────────────────────────────────────────────
  const fetchResults = useCallback(async (runId) => {
    if (!runId) return;

    try {
      const { data, error: fetchError } = await supabase
        .from("dipsy_eval_results")
        .select("*")
        .eq("run_id", runId)
        .order("evaluated_at", { ascending: true });

      if (fetchError) throw fetchError;
      setResults(data || []);
    } catch (err) {
      console.error("Error fetching results:", err);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH TEST QUESTIONS
  // ─────────────────────────────────────────────────────────────────────────
  const fetchQuestions = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from("dipsy_eval_questions")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: true });

      if (fetchError) {
        if (fetchError.code === "42P01" || fetchError.code === "42703") {
          console.log("[DipsyQuality] Questions table not yet created");
          setQuestions([]);
          return;
        }
        throw fetchError;
      }
      setQuestions(data || []);
    } catch (err) {
      console.error("Error fetching questions:", err);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH KNOWLEDGE DRAFTS
  // ─────────────────────────────────────────────────────────────────────────
  const fetchDrafts = useCallback(async () => {
    setDraftsLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from("atlas_docs_drafts")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) {
        if (fetchError.code === "42P01" || fetchError.code === "42703") {
          console.log("[DipsyQuality] Drafts table not yet created");
          setDrafts([]);
          return;
        }
        throw fetchError;
      }

      setDrafts(data || []);

      const pending = (data || []).filter((d) => d.status === "draft").length;
      const published = (data || []).filter(
        (d) => d.status === "published" || d.status === "approved"
      ).length;
      const rejected = (data || []).filter((d) => d.status === "rejected").length;

      setDraftStats({ pending, published, rejected });
    } catch (err) {
      console.error("Error fetching drafts:", err);
      setError("Failed to load knowledge drafts");
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH KNOWLEDGE GAPS COUNT
  // ─────────────────────────────────────────────────────────────────────────
  const fetchGapCount = useCallback(async () => {
    try {
      const { count, error: fetchError } = await supabase
        .from("knowledge_gaps")
        .select("*", { count: "exact", head: true })
        .is("cluster_id", null);

      if (fetchError) {
        if (fetchError.code === "42P01") {
          setGapCount(0);
          return;
        }
        throw fetchError;
      }

      setGapCount(count || 0);
    } catch (err) {
      console.error("Error fetching gap count:", err);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RUN EVALUATION
  // ─────────────────────────────────────────────────────────────────────────
  const runEvaluation = async () => {
    if (!session?.access_token) {
      setError("No authentication token available");
      return;
    }

    setRunningEval(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dipsy-auto-eval`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ run_type: "manual" }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Evaluation failed");
      }

      await fetchRuns();

      if (data.run_id) {
        setSelectedRunId(data.run_id);
      }
    } catch (err) {
      console.error("Evaluation error:", err);
      setError(err.message || "Failed to run evaluation");
    } finally {
      setRunningEval(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // APPROVE DRAFT
  // ─────────────────────────────────────────────────────────────────────────
  const handleApproveDraft = async (draftId) => {
    if (!session?.access_token) {
      setError("No authentication token available");
      return;
    }

    setProcessingDraftId(draftId);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-doc-draft`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "approve", draft_id: draftId }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Approval failed");
      }


      await fetchDrafts();
    } catch (err) {
      console.error("Approval error:", err);
      setError(err.message || "Failed to approve draft");
    } finally {
      setProcessingDraftId(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // REJECT DRAFT
  // ─────────────────────────────────────────────────────────────────────────
  const handleRejectDraft = async (draftId, reason) => {
    if (!session?.access_token) {
      setError("No authentication token available");
      return;
    }

    setProcessingDraftId(draftId);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-doc-draft`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "reject",
            draft_id: draftId,
            rejection_reason: reason,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Rejection failed");
      }

      await fetchDrafts();
    } catch (err) {
      console.error("Rejection error:", err);
      setError(err.message || "Failed to reject draft");
    } finally {
      setProcessingDraftId(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE DRAFT (edit title/body)
  // ─────────────────────────────────────────────────────────────────────────
  const handleUpdateDraft = async (draftId, updates) => {
    try {
      const { error: updateError } = await supabase
        .from("atlas_docs_drafts")
        .update({
          title: updates.title,
          body: updates.body,
          updated_at: new Date().toISOString(),
        })
        .eq("id", draftId);

      if (updateError) throw updateError;

      await fetchDrafts();
    } catch (err) {
      console.error("Update error:", err);
      setError("Failed to update draft: " + err.message);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ADD QUESTION (manual gap submission)
  // ─────────────────────────────────────────────────────────────────────────
  const handleAddQuestion = async (question) => {
    if (!session?.access_token) {
      setError("No authentication token available");
      return;
    }

    setIsSubmittingQuestion(true);

    try {
      // Get user's org_id from user_active_org
      const { data: { user } } = await supabase.auth.getUser();
      const { data: activeOrg } = await supabase
        .from("user_active_org")
        .select("org_id")
        .eq("user_id", user.id)
        .single();

      if (!activeOrg?.org_id) {
        throw new Error("No organization found");
      }

      // Generate embedding for the question
      const embeddingResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-embedding`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: question }),
        }
      );

      let embedding = null;
      if (embeddingResponse.ok) {
        const embData = await embeddingResponse.json();
        embedding = embData.embedding;
      }

      // Insert into knowledge_gaps
      const { error: insertError } = await supabase
        .from("knowledge_gaps")
        .insert({
          org_id: activeOrg.org_id,
          question: question,
          source_channel: "web_ui_manual",
          embedding: embedding,
        });

      if (insertError) throw insertError;

      setShowAddQuestion(false);
      await fetchGapCount();
    } catch (err) {
      console.error("Error adding question:", err);
      setError("Failed to add question: " + err.message);
    } finally {
      setIsSubmittingQuestion(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RUN CLUSTERING
  // ─────────────────────────────────────────────────────────────────────────
  const handleRunClustering = async () => {
    if (!session?.access_token) {
      setError("No authentication token available");
      return;
    }

    setIsRunningClustering(true);
    setClusteringResult(null);

    try {
      // Get user's org_id from user_active_org
      const { data: { user } } = await supabase.auth.getUser();
      const { data: activeOrg } = await supabase
        .from("user_active_org")
        .select("org_id")
        .eq("user_id", user.id)
        .single();

      if (!activeOrg?.org_id) {
        throw new Error("No organization found");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cluster-knowledge-gaps`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ org_id: activeOrg.org_id }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Clustering failed");
      }

      setClusteringResult(data);
      await fetchDrafts();
      await fetchGapCount();
    } catch (err) {
      console.error("Clustering error:", err);
      setError(err.message || "Failed to run clustering");
    } finally {
      setIsRunningClustering(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // MARK FALSE POSITIVE
  // ─────────────────────────────────────────────────────────────────────────
  const handleMarkFalsePositive = async (result) => {
    if (!result.hallucinations || result.hallucinations.length === 0) return;

    const falsePositiveTerms = result.hallucinations.map((h) => {
      const match = h.match(/Hallucinated:\s*(.+)/i);
      return match ? match[1].trim() : h;
    });

    try {
      const { error: feedbackError } = await supabase
        .from("dipsy_eval_feedback")
        .insert({
          result_id: result.id,
          question_id: result.question_id,
          feedback_type: "false_positive",
          false_positive_terms: falsePositiveTerms,
          notes: "Marked as false positive - terms appeared in negation context",
        });

      if (feedbackError) {
        if (feedbackError.code === "42P01") {
          setError("Feedback table not created yet. Run the SQL migration first.");
          return;
        }
        throw feedbackError;
      }

      setError(null);
      alert(
        `✓ Marked ${falsePositiveTerms.length} term(s) as false positive. Future evaluations will ignore these in negation context.`
      );
    } catch (err) {
      console.error("Error saving feedback:", err);
      setError("Failed to save feedback: " + err.message);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchRuns(), fetchQuestions(), fetchDrafts(), fetchGapCount()]);
      setLoading(false);
    };
    init();
  }, [fetchRuns, fetchQuestions, fetchDrafts, fetchGapCount]);

  useEffect(() => {
    if (selectedRunId) {
      fetchResults(selectedRunId);
    }
  }, [selectedRunId, fetchResults]);

  // Filter drafts based on selected filter
  const filteredDrafts = drafts.filter((d) => {
    if (draftFilter === "pending") return d.status === "draft";
    if (draftFilter === "approved")
      return d.status === "published" || d.status === "approved";
    if (draftFilter === "rejected") return d.status === "rejected";
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const selectedRun = runs.find((r) => r.id === selectedRunId);
  const selectedRunTimestamp =
    selectedRun && (selectedRun.started_at || selectedRun.created_at);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <Brain className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              Dipsy Quality Dashboard
            </h1>
            <p className="text-sm text-zinc-400">
              Monitor and evaluate AI response quality
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              fetchRuns();
              fetchQuestions();
              fetchDrafts();
              fetchGapCount();
            }}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-700/50 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>

          {activeTab === "evaluations" && (
            <button
              onClick={runEvaluation}
              disabled={runningEval}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
            >
              {runningEval ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Evaluation
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 p-1 bg-zinc-800/50 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("evaluations")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "evaluations"
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <Target className="w-4 h-4" />
          Evaluations
        </button>
        <button
          onClick={() => setActiveTab("drafts")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "drafts"
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Knowledge Drafts
          {draftStats.pending > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full">
              {draftStats.pending}
            </span>
          )}
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* EVALUATIONS TAB */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "evaluations" && (
        <>
          {/* Scheduled Run Status Widget */}
          <ScheduledRunStatus runs={runs} />

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard icon={BarChart3} label="Total Runs" value={stats.totalRuns} color="blue" />
            <StatCard
              icon={FileQuestion}
              label="Active Questions"
              value={questions.length}
              color="zinc"
            />
            <StatCard
              icon={Target}
              label="Avg Accuracy"
              value={`${Math.round(stats.avgAccuracy * 100)}%`}
              color="emerald"
            />
            <StatCard
              icon={Zap}
              label="Avg Grounding"
              value={`${Math.round(stats.avgGrounding * 100)}%`}
              color="amber"
            />
            <StatCard
              icon={TrendingUp}
              label="Pass Rate"
              value={`${Math.round(stats.passRate * 100)}%`}
              color={
                stats.passRate >= 0.9
                  ? "emerald"
                  : stats.passRate >= 0.7
                  ? "amber"
                  : "red"
              }
            />
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Run History Panel */}
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700/50">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-zinc-400" />
                  Run History
                </h2>
              </div>

              <div className="max-h-[500px] overflow-y-auto">
                {runs.length === 0 ? (
                  <div className="p-8 text-center">
                    <BarChart3 className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                    <p className="text-zinc-400">No evaluation runs yet</p>
                    <p className="text-sm text-zinc-500 mt-1">
                      Click &quot;Run Evaluation&quot; to start
                    </p>
                  </div>
                ) : (
                  runs.map((run) => (
                    <RunHistoryRow
                      key={run.id}
                      run={run}
                      isSelected={selectedRunId === run.id}
                      onSelect={setSelectedRunId}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Results Panel */}
            <div className="lg:col-span-2 bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <Eye className="w-4 h-4 text-zinc-400" />
                  Evaluation Results
                  {selectedRun && selectedRunTimestamp && (
                    <span className="text-xs text-zinc-500 font-normal ml-2">
                      {new Date(selectedRunTimestamp).toLocaleString()}
                    </span>
                  )}
                </h2>

                {selectedRun && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">
                      {results.length} questions
                    </span>
                    <VerdictBadge verdict={selectedRun.run_status} />
                  </div>
                )}
              </div>

              <div className="max-h-[500px] overflow-y-auto">
                {!selectedRun ? (
                  <div className="p-8 text-center">
                    <Target className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                    <p className="text-zinc-400">Select a run to view results</p>
                  </div>
                ) : results.length === 0 ? (
                  <div className="p-8 text-center">
                    <FileQuestion className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                    <p className="text-zinc-400">No results for this run</p>
                    <p className="text-sm text-zinc-500 mt-1">
                      {selectedRun.run_status === "running"
                        ? "Evaluation in progress..."
                        : "Run may have failed"}
                    </p>
                  </div>
                ) : (
                  results.map((result) => (
                    <EvaluationResultRow
                      key={result.id}
                      result={result}
                      isExpanded={expandedResultId === result.id}
                      onToggle={() =>
                        setExpandedResultId(
                          expandedResultId === result.id ? null : result.id
                        )
                      }
                      onMarkFalsePositive={handleMarkFalsePositive}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Test Questions Summary */}
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <FileQuestion className="w-4 h-4 text-zinc-400" />
                Test Questions ({questions.length})
              </h2>
              <button className="flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
                <Plus className="w-4 h-4" />
                Add Question
              </button>
            </div>

            <div className="p-4">
              {questions.length === 0 ? (
                <p className="text-center text-zinc-500 py-4">
                  No test questions configured
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {questions.slice(0, 9).map((q) => (
                    <div
                      key={q.id}
                      className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/30 hover:border-zinc-600/50 transition-colors"
                    >
                      <p className="text-sm text-white line-clamp-2">{q.question}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 text-xs bg-zinc-700/50 text-zinc-400 rounded">
                          {q.question_type || "general"}
                        </span>
                        <span className="px-2 py-0.5 text-xs bg-zinc-700/50 text-zinc-400 rounded">
                          {q.domain || "Core"}
                        </span>
                      </div>
                    </div>
                  ))}
                  {questions.length > 9 && (
                    <div className="p-3 bg-zinc-900/30 rounded-lg border border-dashed border-zinc-700/50 flex items-center justify-center">
                      <span className="text-sm text-zinc-500">
                        +{questions.length - 9} more questions
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* KNOWLEDGE DRAFTS TAB */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "drafts" && (
        <>
          {/* Draft Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={Clock}
              label="Pending Review"
              value={draftStats.pending}
              color="amber"
            />
            <StatCard
              icon={CheckCircle2}
              label="Published"
              value={draftStats.published}
              color="emerald"
            />
            <StatCard
              icon={XCircle}
              label="Rejected"
              value={draftStats.rejected}
              color="red"
            />
            <StatCard
              icon={FileQuestion}
              label="Unprocessed Gaps"
              value={gapCount}
              color="blue"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddQuestion(true)}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Question
            </button>

            <button
              onClick={() => {
                setClusteringResult(null);
                setShowClusteringModal(true);
              }}
              disabled={gapCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Run Clustering
              {gapCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-white/20 rounded">
                  {gapCount}
                </span>
              )}
            </button>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2">
            {[
              { key: "pending", label: "Pending", count: draftStats.pending },
              { key: "approved", label: "Published", count: draftStats.published },
              { key: "rejected", label: "Rejected", count: draftStats.rejected },
              { key: "all", label: "All", count: drafts.length },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setDraftFilter(tab.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  draftFilter === tab.key
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-xs text-zinc-500">({tab.count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Drafts List */}
          {draftsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          ) : filteredDrafts.length === 0 ? (
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-12 text-center">
              <BookOpen className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-400">
                {draftFilter === "pending"
                  ? "No pending drafts to review"
                  : draftFilter === "approved"
                  ? "No published documents yet"
                  : draftFilter === "rejected"
                  ? "No rejected drafts"
                  : "No knowledge drafts yet"}
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                Drafts are auto-generated when Dipsy can't answer questions
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDrafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  isExpanded={expandedDraftId === draft.id}
                  onToggle={() =>
                    setExpandedDraftId(
                      expandedDraftId === draft.id ? null : draft.id
                    )
                  }
                  onApprove={handleApproveDraft}
                  onReject={handleRejectDraft}
                  onUpdate={handleUpdateDraft}
                  isProcessing={processingDraftId === draft.id}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <AddQuestionModal
        isOpen={showAddQuestion}
        onClose={() => setShowAddQuestion(false)}
        onSubmit={handleAddQuestion}
        isSubmitting={isSubmittingQuestion}
      />

      <RunClusteringModal
        isOpen={showClusteringModal}
        onClose={() => setShowClusteringModal(false)}
        onRun={handleRunClustering}
        isRunning={isRunningClustering}
        result={clusteringResult}
      />
    </div>
  );
}
