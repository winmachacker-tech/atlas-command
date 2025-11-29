// FILE: src/components/sales/SalesCallHistory.jsx
// Purpose:
// - Show a list of AI sales calls for a given prospect.
// - For each call, display:
//     • When the call happened
//     • Direction & status
//     • To / from numbers
//     • Short preview of the AI summary
//     • Expandable section with full summary + full transcript
//     • Per-call thumbs up / down feedback stored in public.sales_call_feedback
//       with awareness of call type (live vs voicemail vs no-answer).
//
// Usage:
//   <SalesCallHistory prospectId={selectedLead?.id} />
//
// Security:
// - Uses the standard Supabase client from the frontend.
// - No service role, no secrets. All row-level security is enforced by the DB.
// - Reads from public.sales_calls filtered by prospect_id; RLS + current_org_id()
//   keep everything locked to the current org.
// - Writes to public.sales_call_feedback with:
//     • org_id (default current_org_id())
//     • prospect_id
//     • call_id
//     • created_by = auth.uid()
//     • rating (1 = up, -1 = down)
//     • feedback_type (e.g. VOICEMAIL_GOOD, LIVE_CALL_BAD)
//     • meta.interaction_type to distinguish LIVE vs VOICEMAIL, etc.
//
// Requirements:
// - Assumes you have a configured Supabase client at ../../lib/supabase
// - Assumes public.sales_calls has columns:
//     id, org_id, prospect_id, status, direction, to_number, from_number,
//     twilio_call_sid, started_at, ended_at, transcript, ai_summary, created_at,
//     answer_type, is_voicemail
// - Assumes public.sales_call_feedback exists with:
//     id, org_id, prospect_id, call_id, created_by, rating, feedback_type, notes, meta,
//     created_at, updated_at

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  PhoneCall,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function summarize(text, maxLength = 120) {
  if (!text) return "No AI summary available.";
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength - 3) + "...";
}

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

// Classify the interaction type for a call.
// This lets us distinguish voicemail vs live call vs no-answer/failed.
function getCallInteractionType(call) {
  if (!call) return "UNKNOWN";

  const status = (call.status || "").toUpperCase();
  const answerType = (call.answer_type || "").toUpperCase();
  const isVoicemail = !!call.is_voicemail;

  // Explicit voicemail flags from AI / Twilio
  if (isVoicemail || answerType === "VOICEMAIL") {
    return "VOICEMAIL";
  }

  // No-answer / failed style outcomes – nothing to really judge
  if (
    status === "NO_ANSWER" ||
    status === "FAILED" ||
    status === "RINGING"
  ) {
    return "NO_ANSWER_OR_FAILED";
  }

  // Completed calls that aren't flagged as voicemail → treat as live human attempt
  if (status === "COMPLETED") {
    return "LIVE";
  }

  return "UNKNOWN";
}

// Feedback copy per interaction type.
function getFeedbackCopy(interactionType) {
  switch (interactionType) {
    case "VOICEMAIL":
      return {
        label: "Rate this voicemail from Dipsy (only visible to you):",
        upLabel: "Good voicemail",
        downLabel: "Voicemail could be better",
        disableRating: false,
      };
    case "NO_ANSWER_OR_FAILED":
      return {
        label:
          "This call never really connected (no live conversation) — rating is disabled.",
        upLabel: "Good",
        downLabel: "Needs work",
        // We don't want to rate these at all.
        disableRating: true,
      };
    case "LIVE":
      return {
        label: "Rate this AI call (only visible to you):",
        upLabel: "Good conversation",
        downLabel: "Needs work",
        disableRating: false,
      };
    default:
      return {
        label: "Rate this AI call (only visible to you):",
        upLabel: "Good",
        downLabel: "Needs work",
        disableRating: false,
      };
  }
}

// NEW: Map interaction type + rating → feedback_type string saved in DB.
function getFeedbackType(interactionType, rating) {
  const r = Number(rating);
  switch (interactionType) {
    case "VOICEMAIL":
      return r === 1 ? "VOICEMAIL_GOOD" : "VOICEMAIL_BAD";
    case "LIVE":
      return r === 1 ? "LIVE_CALL_GOOD" : "LIVE_CALL_BAD";
    case "NO_ANSWER_OR_FAILED":
      // We generally disable rating for these, but keep a stable label if ever used.
      return "NO_ANSWER_OR_FAILED";
    case "UNKNOWN":
    default:
      return r === 1 ? "OTHER_GOOD" : "OTHER_BAD";
  }
}

export default function SalesCallHistory({ prospectId }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  // Feedback state keyed by call_id → { id, rating, feedback_type, notes }
  const [feedbackByCall, setFeedbackByCall] = useState({});
  const [feedbackError, setFeedbackError] = useState("");
  const [savingFeedbackFor, setSavingFeedbackFor] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Load calls + associated feedback when prospect changes
  useEffect(() => {
    if (!prospectId) {
      setCalls([]);
      setErrorMsg("");
      setFeedbackByCall({});
      setFeedbackError("");
      return;
    }

    let isCancelled = false;

    async function fetchCallsAndFeedback() {
      setLoading(true);
      setErrorMsg("");
      setFeedbackError("");
      setSavingFeedbackFor(null);

      // 1) Load calls (include answer_type, is_voicemail for interaction type)
      const { data: callRows, error: callError } = await supabase
        .from("sales_calls")
        .select(
          `
          id,
          org_id,
          prospect_id,
          status,
          direction,
          to_number,
          from_number,
          twilio_call_sid,
          started_at,
          ended_at,
          transcript,
          ai_summary,
          created_at,
          answer_type,
          is_voicemail
        `
        )
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false });

      if (isCancelled) return;

      if (callError) {
        console.error("[SalesCallHistory] Error loading calls:", callError);
        setErrorMsg("Unable to load call history right now.");
        setCalls([]);
        setFeedbackByCall({});
        setLoading(false);
        return;
      }

      const safeCalls = callRows || [];
      setCalls(safeCalls);
      setErrorMsg("");

      // 2) Load existing feedback for these calls (if any)
      if (safeCalls.length === 0) {
        setFeedbackByCall({});
        setLoading(false);
        return;
      }

      const callIds = safeCalls.map((c) => c.id);
      const { data: fbRows, error: fbError } = await supabase
        .from("sales_call_feedback")
        .select(
          `
          id,
          call_id,
          prospect_id,
          rating,
          feedback_type,
          notes
        `
        )
        .in("call_id", callIds);

      if (isCancelled) return;

      if (fbError) {
        console.error(
          "[SalesCallHistory] Error loading feedback:",
          fbError,
        );
        setFeedbackError(
          "Calls loaded, but feedback ratings could not be loaded.",
        );
        setFeedbackByCall({});
      } else {
        const map = {};
        (fbRows || []).forEach((row) => {
          // One feedback row per (user, call). We only see our own due to RLS.
          map[row.call_id] = {
            id: row.id,
            rating: row.rating,
            feedback_type: row.feedback_type || null,
            notes: row.notes || "",
          };
        });
        setFeedbackByCall(map);
        setFeedbackError("");
      }

      setLoading(false);
    }

    fetchCallsAndFeedback();

    return () => {
      isCancelled = true;
    };
  }, [prospectId]);

  // Ensure we know current user id when first needed
  async function ensureCurrentUserId() {
    if (currentUserId) return currentUserId;

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      console.error("[SalesCallHistory] auth.getUser error:", error);
      setFeedbackError("Unable to determine current user for feedback.");
      throw new Error("No current user");
    }

    setCurrentUserId(user.id);
    return user.id;
  }

  // Handle thumbs up/down click for a specific call
  async function handleFeedbackClick(call, rating) {
    if (!call?.id || !prospectId) return;

    const interactionType = getCallInteractionType(call);
    const feedbackCopy = getFeedbackCopy(interactionType);

    // If we decided to disable ratings for no-answer/failed, bail early.
    if (feedbackCopy.disableRating) {
      return;
    }

    setFeedbackError("");
    setSavingFeedbackFor(call.id);

    try {
      const userId = await ensureCurrentUserId();

      const existing = feedbackByCall[call.id] || null;
      const finalRating = rating; // 1 for up, -1 for down
      const finalFeedbackType = getFeedbackType(interactionType, finalRating);

      // Simple behavior:
      // - If no existing row → INSERT
      // - If exists and rating differs → UPDATE (rating + feedback_type)
      // - If exists and rating is the same → just keep it as-is (no-op)

      if (!existing) {
        // INSERT new feedback row
        const { data, error } = await supabase
          .from("sales_call_feedback")
          .insert([
            {
              // org_id uses default current_org_id()
              prospect_id: prospectId,
              call_id: call.id,
              created_by: userId,
              rating: finalRating,
              feedback_type: finalFeedbackType,
              // Meta now tells us what kind of interaction this was
              meta: {
                source: "SalesCallHistory",
                ui_version: "v2",
                interaction_type: interactionType,
              },
            },
          ])
          .select("id, call_id, rating, feedback_type, notes")
          .single();

        if (error) {
          console.error(
            "[SalesCallHistory] insert feedback error:",
            error,
          );
          setFeedbackError(
            "Unable to save feedback for this call. Please try again.",
          );
        } else if (data) {
          setFeedbackByCall((prev) => ({
            ...prev,
            [call.id]: {
              id: data.id,
              rating: data.rating,
              feedback_type: data.feedback_type || finalFeedbackType,
              notes: data.notes || "",
            },
          }));
        }
      } else if (existing.rating !== finalRating) {
        // UPDATE existing feedback row with new rating + feedback_type
        const { data, error } = await supabase
          .from("sales_call_feedback")
          .update({
            rating: finalRating,
            feedback_type: finalFeedbackType,
          })
          .eq("id", existing.id)
          .select("id, call_id, rating, feedback_type, notes")
          .single();

        if (error) {
          console.error(
            "[SalesCallHistory] update feedback error:",
            error,
          );
          setFeedbackError(
            "Unable to update feedback for this call. Please try again.",
          );
        } else if (data) {
          setFeedbackByCall((prev) => ({
            ...prev,
            [call.id]: {
              id: data.id,
              rating: data.rating,
              feedback_type: data.feedback_type || finalFeedbackType,
              notes: data.notes || "",
            },
          }));
        }
      } else {
        // Same rating clicked again → no-op for now.
        // (Later you can treat this as "clear feedback" if you want.)
      }
    } catch (err) {
      console.error(
        "[SalesCallHistory] unexpected feedback error:",
        err,
      );
      if (!feedbackError) {
        setFeedbackError(
          "Unexpected error while saving feedback for this call.",
        );
      }
    } finally {
      setSavingFeedbackFor(null);
    }
  }

  return (
    <div className="mt-6 border border-slate-800/60 rounded-2xl bg-slate-950/40 shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10">
          <PhoneCall className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-100">
            AI Call History
          </span>
          <span className="text-xs text-slate-400">
            Outbound Atlas AI calls and summaries for this prospect.
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-6 text-slate-400 text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading call history…</span>
          </div>
        )}

        {!loading && errorMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!loading && !errorMsg && feedbackError && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-100">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{feedbackError}</span>
          </div>
        )}

        {!loading && !errorMsg && (!calls || calls.length === 0) && (
          <div className="text-xs text-slate-500 py-2">
            No AI calls logged for this prospect yet. When Atlas AI makes or
            receives calls for this lead, they will appear here with
            transcripts and summaries.
          </div>
        )}

        {!loading &&
          !errorMsg &&
          calls &&
          calls.length > 0 &&
          calls.map((call) => {
            const isExpanded = expandedId === call.id;
            const createdLabel =
              call.started_at || call.ended_at || call.created_at;

            const feedback = feedbackByCall[call.id] || null;
            const rating = feedback?.rating ?? 0;
            const isSaving = savingFeedbackFor === call.id;

            const interactionType = getCallInteractionType(call);
            const feedbackCopy = getFeedbackCopy(interactionType);
            const disableRating = feedbackCopy.disableRating && !isSaving;

            return (
              <div
                key={call.id}
                className="rounded-xl border border-slate-800/70 bg-slate-950/60"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : call.id)
                  }
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-slate-900/70 rounded-t-xl transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    )}
                    <div className="flex flex-col min-w-0">
                      <div className="flex flex-wrap items-center gap-1 text-xs text-slate-300">
                        <span className="font-medium">
                          {formatDateTime(createdLabel)}
                        </span>
                        <span className="mx-1 text-slate-600">•</span>
                        <span className="uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded-full bg-slate-900/80 border border-slate-700/80 text-slate-300">
                          {call.direction || "OUTBOUND"}
                        </span>
                        {call.status && (
                          <>
                            <span className="mx-1 text-slate-600">•</span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-300">
                              {call.status}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        <span>
                          To:{" "}
                          <span className="text-slate-300 font-mono">
                            {call.to_number || "—"}
                          </span>
                        </span>
                        <span className="mx-1 text-slate-700">•</span>
                        <span>
                          From:{" "}
                          <span className="text-slate-300 font-mono">
                            {call.from_number || "—"}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-300 line-clamp-2">
                        {summarize(call.ai_summary)}
                      </div>
                    </div>
                  </div>
                </button>

                {/* Feedback row (thumbs up / down) */}
                <div className="flex items-center justify-between px-3 py-2 border-t border-slate-800/70 text-[11px]">
                  <span className="text-slate-500 pr-2">
                    {feedbackCopy.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleFeedbackClick(call, 1)}
                      disabled={isSaving || disableRating}
                      className={classNames(
                        "inline-flex items-center justify-center rounded-full border px-2 py-1",
                        "transition-colors",
                        isSaving || disableRating
                          ? "border-slate-800 bg-slate-900/70 text-slate-500 cursor-not-allowed"
                          : rating === 1
                          ? "border-emerald-500/70 bg-emerald-500/20 text-emerald-300"
                          : "border-slate-700 bg-slate-900/80 text-slate-300 hover:border-emerald-400/70 hover:bg-emerald-500/10"
                      )}
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                      <span>{feedbackCopy.upLabel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedbackClick(call, -1)}
                      disabled={isSaving || disableRating}
                      className={classNames(
                        "inline-flex items-center justify-center rounded-full border px-2 py-1",
                        "transition-colors",
                        isSaving || disableRating
                          ? "border-slate-800 bg-slate-900/70 text-slate-500 cursor-not-allowed"
                          : rating === -1
                          ? "border-rose-500/70 bg-rose-500/20 text-rose-300"
                          : "border-slate-700 bg-slate-900/80 text-slate-300 hover:border-rose-400/70 hover:bg-rose-500/10"
                      )}
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                      <span>{feedbackCopy.downLabel}</span>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-2 border-t border-slate-800/70 text-xs space-y-3 rounded-b-xl">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 mb-1">
                        AI Summary
                      </div>
                      <div className="text-slate-200 whitespace-pre-wrap">
                        {call.ai_summary
                          ? call.ai_summary
                          : "No AI summary was generated for this call."}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 mb-1">
                        Transcript
                      </div>
                      <pre className="max-h-40 overflow-y-auto rounded-xl bg-black/40 border border-slate-800/80 px-3 py-2 text-[11px] text-slate-200 whitespace-pre-wrap font-mono">
                        {call.transcript ||
                          "No transcript stored for this call."}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
