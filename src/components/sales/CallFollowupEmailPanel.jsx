// FILE: src/components/sales/CallFollowupEmailPanel.jsx
//
// Purpose:
// - UI panel for Dipsy Follow-Up Emails tied to a specific sales call.
// - For a given (org_id, prospect_id, call_id), it will:
//     • Load the latest email_draft (if one exists).
//     • Let you generate a new AI draft via the sales-generate-followup-email Edge Function.
//     • Let you edit the subject + body text.
//     • Save the draft into public.email_drafts (insert or update).
//     • Mark a draft as "approved" (Approve button).
//
// What this DOES NOT do yet:
// - It does NOT send the email. Step 4 will wire "Approve & Send" into sales-send-email.
// - It does NOT weaken any security. Uses only the anon Supabase client and your user JWT.
//
// Props expected:
//   - orgId: string (current organization id)
//   - prospectId: string (the sales_prospects.id)
//   - callId: string (the sales_calls.id)
//   - prospectName?: string (optional, for display only)
//   - prospectEmail?: string (optional, for display only)
//
// How to use (example):
//   <CallFollowupEmailPanel
//     orgId={currentOrg.id}
//     prospectId={selectedLead.id}
//     callId={selectedCall.id}
//     prospectName={selectedLead.legal_name || selectedLead.dba_name}
//     prospectEmail={selectedLead.contact_email}
//   />
//
// Security:
// - Uses supabase from ../../lib/supabase, which already includes the logged-in user JWT.
// - All DB writes/reads are subject to RLS (org_id must match current_org_id()).
// - No secrets are in the browser. Edge Functions still hold OPENAI_API_KEY, etc.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  Loader2,
  RefreshCw,
  FileText,
  Save,
  ThumbsUp,
  AlertTriangle,
} from "lucide-react";

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function CallFollowupEmailPanel({
  orgId,
  prospectId,
  callId,
  prospectName,
  prospectEmail,
}) {
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [draftId, setDraftId] = useState(null);
  const [subject, setSubject] = useState(
    "Follow-up from our call with Atlas Command",
  );
  const [bodyText, setBodyText] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [draftStatus, setDraftStatus] = useState("draft");
  const [aiVersion, setAiVersion] = useState("");
  const [sentAt, setSentAt] = useState(null);

  // Load latest draft for this call (if any)
  useEffect(() => {
    let isMounted = true;

    async function loadDraft() {
      setLoadingDraft(true);
      setErrorMessage("");
      setStatusMessage("");

      if (!orgId || !prospectId || !callId) {
        setErrorMessage("Missing org / prospect / call ids.");
        setLoadingDraft(false);
        return;
      }

      const { data, error } = await supabase
        .from("email_drafts")
        .select(
          "id, subject, draft_text, draft_html, status, ai_version, sent_at",
        )
        .eq("org_id", orgId)
        .eq("prospect_id", prospectId)
        .eq("call_id", callId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!isMounted) return;

      if (error && error.code !== "PGRST116") {
        console.error("[CallFollowupEmailPanel] loadDraft error:", error);
        setErrorMessage("Failed to load existing email draft.");
      } else if (data) {
        setDraftId(data.id);
        setSubject(
          data.subject ||
            "Follow-up from our call with Atlas Command",
        );
        setBodyText(data.draft_text || "");
        setBodyHtml(data.draft_html || "");
        setDraftStatus(data.status || "draft");
        setAiVersion(data.ai_version || "");
        setSentAt(data.sent_at || null);
        setStatusMessage(
          data.status === "sent"
            ? "Last email has already been sent."
            : "Loaded existing draft.",
        );
      } else {
        // No existing draft
        setDraftId(null);
        setBodyText("");
        setBodyHtml("");
        setDraftStatus("draft");
        setAiVersion("");
        setSentAt(null);
        setStatusMessage("No draft yet. Generate one with Dipsy.");
      }

      setLoadingDraft(false);
    }

    loadDraft();

    return () => {
      isMounted = false;
    };
  }, [orgId, prospectId, callId]);

  async function handleGenerateDraft() {
    if (!prospectId || !callId) return;

    setGenerating(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { data, error } = await supabase.functions.invoke(
        "sales-generate-followup-email",
        {
          body: {
            prospect_id: prospectId,
            call_id: callId,
          },
        },
      );

      if (error) {
        console.error(
          "[CallFollowupEmailPanel] sales-generate-followup-email error:",
          error,
        );
        setErrorMessage(
          error.message ||
            "Failed to generate follow-up email. Please try again.",
        );
        return;
      }

      if (!data || !data.ok) {
        console.error(
          "[CallFollowupEmailPanel] sales-generate-followup-email data error:",
          data,
        );
        setErrorMessage(
          (data && data.error) ||
            "OpenAI did not return a valid email draft.",
        );
        return;
      }

      setSubject(
        data.subject ||
          "Follow-up from our call with Atlas Command",
      );
      setBodyText(data.draft_text || "");
      setBodyHtml(data.draft_html || "");
      setAiVersion(data.model || "");
      setDraftStatus("draft");
      setStatusMessage("Draft generated by Dipsy. Review and edit before saving.");
    } catch (err) {
      console.error(
        "[CallFollowupEmailPanel] Unexpected generate error:",
        err,
      );
      setErrorMessage("Unexpected error while generating draft.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(statusOverride) {
    if (!orgId || !prospectId || !callId) {
      setErrorMessage("Missing org / prospect / call ids.");
      return;
    }
    if (!bodyText.trim()) {
      setErrorMessage("Email body cannot be empty.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      // Get current user for created_by / updated_by auditing
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error(
          "[CallFollowupEmailPanel] auth.getUser error:",
          userError,
        );
        setErrorMessage("Unable to determine current user.");
        setSaving(false);
        return;
      }

      const finalStatus = statusOverride || draftStatus || "draft";

      // If no HTML, build a simple HTML wrapper from the text
      const html =
        bodyHtml && bodyHtml.trim()
          ? bodyHtml
          : textToSimpleHtml(bodyText);

      if (!draftId) {
        // INSERT new draft
        const { data, error } = await supabase
          .from("email_drafts")
          .insert([
            {
              org_id: orgId,
              prospect_id: prospectId,
              call_id: callId,
              subject,
              draft_text: bodyText,
              draft_html: html,
              ai_version: aiVersion || null,
              status: finalStatus,
              created_by: user.id,
            },
          ])
          .select(
            "id, status, sent_at, ai_version, subject, draft_text, draft_html",
          )
          .single();

        if (error) {
          console.error(
            "[CallFollowupEmailPanel] insert email_drafts error:",
            error,
          );
          setErrorMessage(
            error.message || "Failed to save email draft.",
          );
        } else if (data) {
          setDraftId(data.id);
          setDraftStatus(data.status || finalStatus);
          setSentAt(data.sent_at || null);
          setAiVersion(data.ai_version || aiVersion || "");
          setSubject(data.subject || subject);
          setBodyText(data.draft_text || bodyText);
          setBodyHtml(data.draft_html || html);
          setStatusMessage(
            finalStatus === "approved"
              ? "Draft saved and marked as approved."
              : "Draft saved.",
          );
        }
      } else {
        // UPDATE existing draft
        const { data, error } = await supabase
          .from("email_drafts")
          .update({
            subject,
            draft_text: bodyText,
            draft_html: html,
            ai_version: aiVersion || null,
            status: finalStatus,
          })
          .eq("id", draftId)
          .eq("org_id", orgId)
          .select(
            "id, status, sent_at, ai_version, subject, draft_text, draft_html",
          )
          .single();

        if (error) {
          console.error(
            "[CallFollowupEmailPanel] update email_drafts error:",
            error,
          );
          setErrorMessage(
            error.message || "Failed to update email draft.",
          );
        } else if (data) {
          setDraftStatus(data.status || finalStatus);
          setSentAt(data.sent_at || null);
          setAiVersion(data.ai_version || aiVersion || "");
          setSubject(data.subject || subject);
          setBodyText(data.draft_text || bodyText);
          setBodyHtml(data.draft_html || html);
          setStatusMessage(
            finalStatus === "approved"
              ? "Draft updated and marked as approved."
              : "Draft updated.",
          );
        }
      }
    } catch (err) {
      console.error("[CallFollowupEmailPanel] save error:", err);
      setErrorMessage("Unexpected error while saving draft.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    // For now: just save with status "approved".
    // Step 4 will hook this into sales-send-email and then update status -> "sent".
    await handleSave("approved");
  }

  const isBusy = loadingDraft || saving || generating;

  return (
    <div className="border border-slate-800/60 bg-slate-950/60 rounded-xl p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Dipsy Follow-Up Email (Draft)
            </h3>
            <p className="text-xs text-slate-400">
              Draft a follow-up email based on this call. You review
              and approve before anything is sent.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerateDraft}
            disabled={generating || !prospectId || !callId}
            className={classNames(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
              generating
                ? "bg-slate-900/80 border-slate-700 text-slate-400 cursor-wait"
                : "bg-slate-900/80 border-emerald-500/60 text-emerald-200 hover:bg-emerald-500/10",
            )}
          >
            {generating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Generate draft
              </>
            )}
          </button>
        </div>
      </div>

      {prospectName || prospectEmail ? (
        <div className="rounded-lg bg-slate-900/70 border border-slate-800/70 px-3 py-2 flex items-center justify-between text-xs text-slate-300">
          <div className="flex flex-col">
            {prospectName && (
              <span className="font-medium">{prospectName}</span>
            )}
            {prospectEmail && (
              <span className="text-slate-400">{prospectEmail}</span>
            )}
          </div>
          {sentAt && (
            <span className="text-[10px] text-emerald-400">
              Last sent at:{" "}
              {new Date(sentAt).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          )}
        </div>
      ) : null}

      {loadingDraft && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading existing draft…
        </div>
      )}

      {!loadingDraft && (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
              placeholder="Subject line for the follow-up email"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300">
              Email body (plain text)
            </label>
            <textarea
              rows={8}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/70 resize-y"
              placeholder="Hi [Name],&#10;&#10;It was great speaking with you about..."
            />
          </div>

          <div className="flex flex-col md:flex-row gap-3 md:gap-4">
            <div className="flex-1 flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-300">
                HTML preview (read-only for now)
              </label>
              <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 max-h-64 overflow-auto">
                <div
                  // NOTE: In a production app, consider sanitizing HTML.
                  dangerouslySetInnerHTML={{
                    __html:
                      bodyHtml && bodyHtml.trim()
                        ? bodyHtml
                        : textToSimpleHtml(bodyText || ""),
                  }}
                />
              </div>
              <p className="text-[10px] text-slate-500">
                This is how the email will roughly look in HTML. The
                actual send logic will use this HTML version.
              </p>
            </div>

            <div className="w-full md:w-56 flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-300">
                Draft status
              </label>
              <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 flex flex-col gap-1">
                <span>
                  Status:{" "}
                  <span className="font-semibold capitalize">
                    {draftStatus}
                  </span>
                </span>
                {aiVersion && (
                  <span className="text-[10px] text-slate-400">
                    AI version: {aiVersion}
                  </span>
                )}
                {draftId && (
                  <span className="text-[10px] text-slate-500">
                    Draft ID: {draftId}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleSave("revised")}
                  disabled={isBusy || !bodyText.trim()}
                  className={classNames(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                    isBusy || !bodyText.trim()
                      ? "bg-slate-900/80 border border-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-slate-900/80 border border-slate-700 text-slate-100 hover:border-emerald-500/70 hover:bg-emerald-500/5",
                  )}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      Save draft
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={isBusy || !bodyText.trim()}
                  className={classNames(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                    isBusy || !bodyText.trim()
                      ? "bg-slate-900/80 border border-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-emerald-600 text-slate-50 hover:bg-emerald-500",
                  )}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Updating…
                    </>
                  ) : (
                    <>
                      <ThumbsUp className="w-3.5 h-3.5" />
                      Approve (no send yet)
                    </>
                  )}
                </button>

                <p className="text-[10px] text-slate-500">
                  Approve marks this draft as ready. In the next step,
                  this button will also send via sales-send-email.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {statusMessage && (
        <div className="text-[11px] text-emerald-400 pt-1">
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div className="mt-1 flex items-start gap-1.5 text-[11px] text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-px" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

// Very simple text -> HTML converter for preview / fallback.
// This is intentionally minimal; you can replace with a richer formatter later.
function textToSimpleHtml(text) {
  if (!text) return "<p></p>";
  const lines = text.split(/\n+/).map((line) => line.trim());
  const paragraphs = lines
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeHtml(line)}</p>`);
  return paragraphs.join("");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
