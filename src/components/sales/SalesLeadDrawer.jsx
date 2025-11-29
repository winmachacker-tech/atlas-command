// FILE: src/components/sales/SalesLeadDrawer.jsx
// Purpose:
// - Slide-in drawer for creating & editing sales_prospects (FMCSA carriers).
// - Shows basic info (company, contact, phone, email, DOT, MC, notes, status).
// - Includes "AI Outreach Assist":
//     • Draft intro email via Edge Function `sales-generate-email`
//     • Let user edit the draft
//     • Send email via Edge Function `sales-send-email`
//     • Show email history from public.sales_email_log
// - Includes "AI Call History":
//     • Uses SalesCallHistory to display Atlas AI outbound calls
//     • Shows summaries + full transcripts per call
// - Includes "Dipsy Follow-Up Email (Last AI Call)":
//     • Finds the most recent AI sales call for this prospect
//     • Generates a personalized follow-up email draft via `sales-generate-followup-email`
//     • Lets Mark edit + save the draft into public.email_drafts
//     • Approve (no send yet) marks the draft as `approved`
//     • No automatic sending; Step 4 will wire "Approve & Send" into `sales-send-email`
//
// Security:
// - Frontend-only code; uses the logged-in Supabase client.
// - All row-level security is enforced in the database and Edge Functions.
// - No secrets or service role keys are used here.

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Loader2,
  ChevronDown,
  Sparkles,
  Mail,
  Clipboard,
  ClipboardCheck,
  PhoneCall,
  FileText,
  ThumbsUp,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import SalesCallHistory from "./SalesCallHistory";

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

// NOTE: These values match the CHECK constraint on public.sales_prospects.sales_status
const STAGE_OPTIONS = [
  { value: "NEW", label: "New" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WARM", label: "Warm" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "DO_NOT_CONTACT", label: "Do not contact" },
];

export default function SalesLeadDrawer({
  isOpen,
  onClose,
  lead, // sales_prospects row or null
  onSaved, // callback(newLeadOrUpdatedLead)
}) {
  const isEditing = !!lead?.id;

  // --- Lead form state ---
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState("NEW"); // maps to sales_status column
  const [notes, setNotes] = useState("");

  // NEW: human-editable DOT & MC (stored as bigint in DB)
  const [dotNumber, setDotNumber] = useState("");
  const [mcNumber, setMcNumber] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // --- Email / AI outreach state ---
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [draftingEmail, setDraftingEmail] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [emailError, setEmailError] = useState("");

  const [emailHistory, setEmailHistory] = useState([]);
  const [loadingEmailHistory, setLoadingEmailHistory] = useState(false);

  // --- AI Call History / Last Call state ---
  const [latestCall, setLatestCall] = useState(null);
  const [loadingLatestCall, setLoadingLatestCall] = useState(false);

  // --- Dipsy Follow-Up Email state (email_drafts) ---
  const [followupDraftId, setFollowupDraftId] = useState(null);
  const [followupSubject, setFollowupSubject] = useState(
    "Follow-up from our call with Atlas Command",
  );
  const [followupBodyText, setFollowupBodyText] = useState("");
  const [followupBodyHtml, setFollowupBodyHtml] = useState("");
  const [followupStatus, setFollowupStatus] = useState("draft");
  const [followupAiVersion, setFollowupAiVersion] = useState("");
  const [followupSentAt, setFollowupSentAt] = useState(null);
  const [followupStatusMessage, setFollowupStatusMessage] = useState("");
  const [followupError, setFollowupError] = useState("");
  const [followupGenerating, setFollowupGenerating] = useState(false);
  const [followupSaving, setFollowupSaving] = useState(false);
  const [followupLoading, setFollowupLoading] = useState(false);

  const followupBusy =
    followupGenerating || followupSaving || followupLoading;

  // --- NEW: Dipsy Follow-Up Call state (frontend-only) ---
  const [followupCallLoading, setFollowupCallLoading] = useState(false);
  const [followupCallStatus, setFollowupCallStatus] = useState("");

  // --- Drawer open → initialize state from lead ---
  useEffect(() => {
    if (!isOpen) return;

    setSaveError("");
    setEmailError("");
    setEmailCopied(false);

    // Reset follow-up state on drawer open
    setLatestCall(null);
    setLoadingLatestCall(false);
    setFollowupDraftId(null);
    setFollowupSubject("Follow-up from our call with Atlas Command");
    setFollowupBodyText("");
    setFollowupBodyHtml("");
    setFollowupStatus("draft");
    setFollowupAiVersion("");
    setFollowupSentAt(null);
    setFollowupStatusMessage("");
    setFollowupError("");

    // Reset follow-up call UI state
    setFollowupCallLoading(false);
    setFollowupCallStatus("");

    if (lead) {
      // Base company name from FMCSA + overrides
      setCompanyName(
        lead.legal_name ||
          lead.dba_name ||
          lead.company_name ||
          lead.carrier_name ||
          "",
      );
      setContactName(lead.contact_name || "");
      setEmail(lead.email || "");
      setPhone(lead.phone || lead.phone_number || "");

      // Pull from real DB column sales_status, default NEW if missing.
      setStage(lead.sales_status || "NEW");

      setNotes(lead.notes || "");

      // DOT / MC (bigint → string for the inputs)
      setDotNumber(
        typeof lead.dot_number === "number" || typeof lead.dot_number === "bigint"
          ? String(lead.dot_number)
          : lead.dot_number
          ? String(lead.dot_number)
          : "",
      );
      setMcNumber(
        typeof lead.mc_number === "number" || typeof lead.mc_number === "bigint"
          ? String(lead.mc_number)
          : lead.mc_number
          ? String(lead.mc_number)
          : "",
      );

      // Reset AI intro email draft when switching leads
      setEmailSubject("");
      setEmailBody("");

      fetchEmailHistory(lead.id);
      fetchLatestCallAndDraft(lead);
    } else {
      // New lead
      setCompanyName("");
      setContactName("");
      setEmail("");
      setPhone("");
      setStage("NEW");
      setNotes("");
      setDotNumber("");
      setMcNumber("");

      setEmailSubject("");
      setEmailBody("");
      setEmailHistory([]);

      setLatestCall(null);
    }
  }, [isOpen, lead?.id]);

  // --- Email history loader ---
  async function fetchEmailHistory(prospectId) {
    if (!prospectId) return;
    setLoadingEmailHistory(true);
    setEmailError("");

    const { data, error } = await supabase
      .from("sales_email_log")
      .select(
        `
        id,
        org_id,
        prospect_id,
        to_email,
        subject,
        status,
        error_message,
        sent_at,
        created_at
      `,
      )
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(
        "[SalesLeadDrawer] Error loading email history:",
        error,
      );
      setEmailError("Unable to load email history right now.");
      setEmailHistory([]);
    } else {
      setEmailHistory(data || []);
    }

    setLoadingEmailHistory(false);
  }

  // --- Latest AI call + existing follow-up draft loader ---
  async function fetchLatestCallAndDraft(currentLead) {
    if (!currentLead?.id) return;

    setLoadingLatestCall(true);
    setFollowupLoading(true);
    setFollowupError("");
    setFollowupStatusMessage("");

    try {
      // 1) Find the most recent sales_call for this prospect.
      const { data: call, error: callError } = await supabase
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
          started_at,
          ended_at,
          transcript,
          ai_summary
        `,
        )
        .eq("prospect_id", currentLead.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (callError && callError.code !== "PGRST116") {
        console.error(
          "[SalesLeadDrawer] Error loading latest call:",
          callError,
        );
        setLatestCall(null);
        setFollowupStatusMessage(
          "Unable to load latest call for follow-up.",
        );
        return;
      }

      if (!call) {
        setLatestCall(null);
        setFollowupStatusMessage(
          "No AI calls yet for this prospect. Make a call with Dipsy first.",
        );
        return;
      }

      setLatestCall(call);

      // 2) Load existing email_draft (if any) for this (org, prospect, call)
      const { data: draft, error: draftError } = await supabase
        .from("email_drafts")
        .select(
          `
          id,
          org_id,
          prospect_id,
          call_id,
          subject,
          draft_text,
          draft_html,
          ai_version,
          status,
          sent_at
        `,
        )
        .eq("org_id", call.org_id)
        .eq("prospect_id", call.prospect_id)
        .eq("call_id", call.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (draftError && draftError.code !== "PGRST116") {
        console.error(
          "[SalesLeadDrawer] Error loading follow-up draft:",
          draftError,
        );
        setFollowupStatusMessage(
          "Latest call loaded, but unable to load existing draft.",
        );
        return;
      }

      if (draft) {
        setFollowupDraftId(draft.id);
        setFollowupSubject(
          draft.subject ||
            "Follow-up from our call with Atlas Command",
        );
        setFollowupBodyText(draft.draft_text || "");
        setFollowupBodyHtml(draft.draft_html || "");
        setFollowupStatus(draft.status || "draft");
        setFollowupAiVersion(draft.ai_version || "");
        setFollowupSentAt(draft.sent_at || null);

        setFollowupStatusMessage(
          draft.status === "sent"
            ? "Latest call + follow-up email already sent."
            : "Latest call + existing draft loaded.",
        );
      } else {
        // No draft yet for this call
        setFollowupDraftId(null);
        setFollowupSubject(
          "Follow-up from our call with Atlas Command",
        );
        setFollowupBodyText("");
        setFollowupBodyHtml("");
        setFollowupStatus("draft");
        setFollowupAiVersion("");
        setFollowupSentAt(null);
        setFollowupStatusMessage(
          "Latest call loaded. Generate a follow-up draft with Dipsy.",
        );
      }
    } catch (err) {
      console.error(
        "[SalesLeadDrawer] Unexpected error loading latest call/draft:",
        err,
      );
      setFollowupError(
        "Unexpected error while loading latest call or draft.",
      );
    } finally {
      setLoadingLatestCall(false);
      setFollowupLoading(false);
    }
  }

  // --- Derived label for title ---
  const titleLabel = useMemo(() => {
    if (!lead) return "New Prospect";
    const name =
      lead.legal_name ||
      lead.dba_name ||
      lead.company_name ||
      lead.carrier_name ||
      "Prospect";
    return name;
  }, [lead]);

  // --- Save / upsert lead ---
  async function handleSaveLead() {
    if (!companyName.trim()) {
      setSaveError("Company name is required.");
      return;
    }

    setSaving(true);
    setSaveError("");

    try {
      // Convert DOT / MC to numbers or null (DB type: bigint)
      const normalizedDot =
        dotNumber && dotNumber.trim().length > 0
          ? Number(dotNumber.trim())
          : null;
      const normalizedMc =
        mcNumber && mcNumber.trim().length > 0
          ? Number(mcNumber.trim())
          : null;

      const payload = {
        legal_name: companyName.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        sales_status: stage, // sync with DB column
        notes: notes.trim() || null,
        dot_number:
          normalizedDot && Number.isFinite(normalizedDot)
            ? normalizedDot
            : null,
        mc_number:
          normalizedMc && Number.isFinite(normalizedMc)
            ? normalizedMc
            : null,
      };

      let result;
      if (isEditing) {
        result = await supabase
          .from("sales_prospects")
          .update(payload)
          .eq("id", lead.id)
          .select()
          .maybeSingle();
      } else {
        // org_id is assumed to be handled by your usual trigger / default using current_org_id().
        result = await supabase
          .from("sales_prospects")
          .insert(payload)
          .select()
          .maybeSingle();
      }

      const { data, error } = result;
      if (error) {
        console.error("[SalesLeadDrawer] Error saving lead:", error);
        setSaveError("Unable to save this prospect. Please try again.");
      } else if (data) {
        if (onSaved) onSaved(data);
      }
    } catch (err) {
      console.error("[SalesLeadDrawer] Unexpected error saving lead:", err);
      setSaveError("Unexpected error while saving prospect.");
    } finally {
      setSaving(false);
    }
  }

  // --- AI: Draft intro email via Edge Function ---
  async function handleDraftIntroEmail() {
    if (!lead?.id) {
      setEmailError(
        "You need to save this prospect before drafting an email.",
      );
      return;
    }

    setDraftingEmail(true);
    setEmailError("");
    setEmailCopied(false);

    try {
      const { data, error } = await supabase.functions.invoke(
        "sales-generate-email",
        {
          body: {
            prospect_id: lead.id,
            // custom_context: notes || null,
          },
        },
      );

      if (error) {
        console.error(
          "[SalesLeadDrawer] sales-generate-email error:",
          error,
        );
        setEmailError("AI failed to draft an email. Please try again.");
      } else if (!data || !data.draft_body) {
        console.warn(
          "[SalesLeadDrawer] AI returned successfully, but no draft text.",
        );
        setEmailError(
          "AI did not return a draft. You can still write your own email.",
        );
      } else {
        setEmailSubject(
          data.draft_subject ||
            `Quick intro from Atlas Command (AI-powered TMS)`,
        );
        setEmailBody(data.draft_body);
      }
    } catch (err) {
      console.error(
        "[SalesLeadDrawer] Unexpected error invoking sales-generate-email:",
        err,
      );
      setEmailError(
        "Unexpected error while drafting email. Please try again.",
      );
    } finally {
      setDraftingEmail(false);
    }
  }

  // --- AI: Send intro email via Edge Function ---
  async function handleSendEmail() {
    if (!lead?.id) {
      setEmailError(
        "You need to save this prospect before sending an email.",
      );
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      setEmailError("Subject and body are required to send an email.");
      return;
    }

    setSendingEmail(true);
    setEmailError("");

    try {
      const { data, error } = await supabase.functions.invoke(
        "sales-send-email",
        {
          body: {
            prospect_id: lead.id,
            subject: emailSubject.trim(),
            body: emailBody.trim(),
          },
        },
      );

      if (error) {
        console.error(
          "[SalesLeadDrawer] sales-send-email error:",
          error,
        );
        setEmailError(
          "Failed to send email. Please review and try again.",
        );
      } else {
        // Optionally refetch email history
        fetchEmailHistory(lead.id);
      }
    } catch (err) {
      console.error(
        "[SalesLeadDrawer] Unexpected error invoking sales-send-email:",
        err,
      );
      setEmailError("Unexpected error while sending email.");
    } finally {
      setSendingEmail(false);
    }
  }

  // --- Utility: copy email body to clipboard ---
  async function handleCopyEmailBody() {
    try {
      await navigator.clipboard.writeText(emailBody || "");
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 1500);
    } catch (err) {
      console.error("[SalesLeadDrawer] Failed to copy email body:", err);
    }
  }

  // --- Dipsy Follow-Up: Generate draft for latest call ---
  async function handleGenerateFollowup() {
    if (!lead?.id) {
      setFollowupError(
        "You need to save this prospect before generating a follow-up.",
      );
      return;
    }
    if (!latestCall?.id) {
      setFollowupError(
        "No AI calls found for this prospect. Make a call with Dipsy first.",
      );
      return;
    }

    setFollowupGenerating(true);
    setFollowupError("");
    setFollowupStatusMessage("");

    try {
      const { data, error } = await supabase.functions.invoke(
        "sales-generate-followup-email",
        {
          body: {
            prospect_id: lead.id,
            call_id: latestCall.id,
          },
        },
      );

      if (error) {
        console.error(
          "[SalesLeadDrawer] sales-generate-followup-email error:",
          error,
        );
        setFollowupError(
          error.message ||
            "Failed to generate follow-up email. Please try again.",
        );
        return;
      }

      if (!data || !data.ok) {
        console.error(
          "[SalesLeadDrawer] sales-generate-followup-email data error:",
          data,
        );
        setFollowupError(
          (data && data.error) ||
            "OpenAI did not return a valid follow-up draft.",
        );
        return;
      }

      setFollowupSubject(
        data.subject ||
          "Follow-up from our call with Atlas Command",
      );
      setFollowupBodyText(data.draft_text || "");
      setFollowupBodyHtml(data.draft_html || "");
      setFollowupAiVersion(data.model || "");
      setFollowupStatus("draft");
      setFollowupDraftId(null);
      setFollowupSentAt(null);
      setFollowupStatusMessage(
        "Draft generated by Dipsy. Review and edit before saving.",
      );
    } catch (err) {
      console.error(
        "[SalesLeadDrawer] Unexpected error generating follow-up:",
        err,
      );
      setFollowupError("Unexpected error while generating follow-up.");
    } finally {
      setFollowupGenerating(false);
    }
  }

  // --- Dipsy Follow-Up: Save draft (insert/update) ---
  async function saveFollowup(statusOverride) {
    if (!lead?.id || !lead.org_id) {
      setFollowupError(
        "Missing org/prospect info. Please refresh and try again.",
      );
      return;
    }
    if (!latestCall?.id) {
      setFollowupError(
        "No AI call selected for follow-up. Make a call with Dipsy first.",
      );
      return;
    }
    if (!followupBodyText.trim()) {
      setFollowupError("Email body cannot be empty.");
      return;
    }

    setFollowupSaving(true);
    setFollowupError("");
    setFollowupStatusMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error(
          "[SalesLeadDrawer] auth.getUser error (follow-up):",
          userError,
        );
        setFollowupError("Unable to determine current user.");
        setFollowupSaving(false);
        return;
      }

      const finalStatus = statusOverride || followupStatus || "draft";
      const html =
        followupBodyHtml && followupBodyHtml.trim()
          ? followupBodyHtml
          : textToSimpleHtml(followupBodyText);

      if (!followupDraftId) {
        // INSERT new email_drafts row
        const { data, error } = await supabase
          .from("email_drafts")
          .insert([
            {
              org_id: lead.org_id,
              prospect_id: lead.id,
              call_id: latestCall.id,
              subject: followupSubject,
              draft_text: followupBodyText,
              draft_html: html,
              ai_version: followupAiVersion || null,
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
            "[SalesLeadDrawer] insert email_drafts error:",
            error,
          );
          setFollowupError(
            error.message || "Failed to save follow-up draft.",
          );
        } else if (data) {
          setFollowupDraftId(data.id);
          setFollowupStatus(data.status || finalStatus);
          setFollowupSentAt(data.sent_at || null);
          setFollowupAiVersion(
            data.ai_version || followupAiVersion || "",
          );
          setFollowupSubject(data.subject || followupSubject);
          setFollowupBodyText(
            data.draft_text || followupBodyText,
          );
          setFollowupBodyHtml(data.draft_html || html);
          setFollowupStatusMessage(
            finalStatus === "approved"
              ? "Draft saved and marked as approved."
              : "Draft saved.",
          );
        }
      } else {
        // UPDATE existing email_drafts row
        const { data, error } = await supabase
          .from("email_drafts")
          .update({
            subject: followupSubject,
            draft_text: followupBodyText,
            draft_html: html,
            ai_version: followupAiVersion || null,
            status: finalStatus,
          })
          .eq("id", followupDraftId)
          .eq("org_id", lead.org_id)
          .select(
            "id, status, sent_at, ai_version, subject, draft_text, draft_html",
          )
          .single();

        if (error) {
          console.error(
            "[SalesLeadDrawer] update email_drafts error:",
            error,
          );
          setFollowupError(
            error.message || "Failed to update follow-up draft.",
          );
        } else if (data) {
          setFollowupStatus(data.status || finalStatus);
          setFollowupSentAt(data.sent_at || null);
          setFollowupAiVersion(
            data.ai_version || followupAiVersion || "",
          );
          setFollowupSubject(data.subject || followupSubject);
          setFollowupBodyText(
            data.draft_text || followupBodyText,
          );
          setFollowupBodyHtml(data.draft_html || html);
          setFollowupStatusMessage(
            finalStatus === "approved"
              ? "Draft updated and marked as approved."
              : "Draft updated.",
          );
        }
      }
    } catch (err) {
      console.error("[SalesLeadDrawer] save follow-up error:", err);
      setFollowupError("Unexpected error while saving follow-up.");
    } finally {
      setFollowupSaving(false);
    }
  }

  async function handleSaveFollowupDraft() {
    await saveFollowup("revised");
  }

  async function handleApproveFollowup() {
    // For now, this only marks status = "approved".
    // Step 4 will also send via sales-send-email and then mark "sent".
    await saveFollowup("approved");
  }

  // --- NEW: Dipsy Follow-Up Call: start a follow-up call via Edge Function ---
  async function handleFollowupCallWithAI() {
    if (!lead?.id) {
      setFollowupCallStatus(
        "Save this prospect before placing a follow-up call.",
      );
      return;
    }

    if (!phone || !phone.trim()) {
      setFollowupCallStatus(
        "Add a phone number before placing a follow-up call.",
      );
      return;
    }

    setFollowupCallLoading(true);
    setFollowupCallStatus("");

    try {
      const { data, error } = await supabase.functions.invoke(
        "sales-initiate-call",
        {
          body: {
            prospect_id: lead.id,
            // Hint for backend / Dipsy brain – treated as metadata only.
            call_mode: "FOLLOW_UP",
          },
        },
      );

      if (error) {
        console.error(
          "[SalesLeadDrawer] sales-initiate-call error (transport):",
          error,
        );
        setFollowupCallStatus(
          "Failed to contact voice call service. Please try again or check logs.",
        );
        return;
      }

      if (!data || data.ok === false) {
        console.error(
          "[SalesLeadDrawer] sales-initiate-call returned error payload:",
          data,
        );
        const message =
          (data && data.error) ||
          "Follow-up call could not be started. Please check logs or try again.";
        setFollowupCallStatus(message);
        return;
      }

      const twilio = data.twilio || {};
      const call = data.call || null;

      if (twilio.called) {
        const sid = twilio.sid || "unknown SID";
        const status = twilio.status || "queued";
        const toNumber =
          call?.to_number || phone || "the prospect's phone number";

        setFollowupCallStatus(
          `Follow-up call queued to ${toNumber}. Twilio status: ${status}. SID: ${sid}.`,
        );
      } else {
        const reason = twilio.reason || twilio.error || "unknown reason";
        setFollowupCallStatus(
          `Follow-up call record created, but Twilio did not place a live call (${reason}).`,
        );
      }
    } catch (err) {
      console.error(
        "[SalesLeadDrawer] Unexpected error starting follow-up call:",
        err,
      );
      setFollowupCallStatus(
        "Unexpected error while starting follow-up call.",
      );
    } finally {
      setFollowupCallLoading(false);
    }
  }

  // --- Close handler (reset some transient state) ---
  function handleClose() {
    setSaveError("");
    setEmailError("");
    setEmailCopied(false);
    onClose?.();
  }

  // Drawer hidden?
  if (!isOpen) return null;

  // Derived: can we offer a follow-up call?
  const canFollowupCall =
    !!lead?.id &&
    !!(phone && phone.trim()) &&
    (stage === "WARM" || stage === "CUSTOMER");

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Drawer panel */}
      <div className="relative ml-auto flex h-full w-full max-w-xl flex-col bg-slate-950 border-l border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-100">
              {titleLabel}
            </span>
            <span className="text-xs text-slate-400">
              {isEditing
                ? "Edit carrier details, human-only fields, AI outreach, and call history."
                : "Create a new prospect and generate AI outreach."}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/
80 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* Basic info */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Prospect Details
              </h2>
            </div>
            {saveError && (
              <div className="rounded-lg border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
                {saveError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Company
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Carrier / trucking company name"
                />
              </div>

              {/* DOT / MC numbers (human-editable) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    DOT Number
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    value={dotNumber}
                    onChange={(e) => setDotNumber(e.target.value)}
                    placeholder="e.g. 1234567"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    MC Number
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    value={mcNumber}
                    onChange={(e) => setMcNumber(e.target.value)}
                    placeholder="e.g. 123456"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Owner / dispatcher"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Sales Status
                  </label>
                  <div className="relative">
                    <select
                      className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 pr-8 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                      value={stage}
                      onChange={(e) => setStage(e.target.value)}
                    >
                      {STAGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-slate-500" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@carrier.com"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 555-5555"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Notes
                </label>
                <textarea
                  className="w-full min-h-[60px] rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything about their lanes, fleet size, TMS, pain points…"
                />
              </div>
            </div>
          </section>

          {/* AI Outreach Assist */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-slate-100">
                    AI Outreach Assist
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Draft and send a personalized intro email with Atlas AI.
                  </span>
                </div>
              </div>
            </div>

            {emailError && (
              <div className="rounded-lg border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
                {emailError}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDraftIntroEmail}
                  disabled={draftingEmail || !lead?.id}
                  className={classNames(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                    draftingEmail || !lead?.id
                      ? "border-slate-800 bg-slate-900/70 text-slate-500"
                      : "border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
                  )}
                >
                  {draftingEmail ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Drafting…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Draft intro email</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={sendingEmail || !lead?.id}
                  className={classNames(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                    sendingEmail || !lead?.id
                      ? "border-slate-800 bg-slate-900/70 text-slate-500"
                      : "border-emerald-500/60 bg-emerald-500 text-slate-950 hover:bg-emerald-400",
                  )}
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Sending…</span>
                    </>
                  ) : (
                    <>
                      <Mail className="h-3.5 w-3.5" />
                      <span>Send email</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleCopyEmailBody}
                  disabled={!emailBody}
                  className={classNames(
                    "ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium",
                    emailBody
                      ? "border-slate-700 bg-slate-900/80 text-slate-200 hover:bg-slate-800"
                      : "border-slate-800 bg-slate-900/40 text-slate-500",
                  )}
                >
                  {emailCopied ? (
                    <>
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Clipboard className="h-3.5 w-3.5" />
                      <span>Copy body</span>
                    </>
                  )}
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Subject line for your intro email"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Body
                  </label>
                  <textarea
                    className="w-full min-h-[120px] rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Click 'Draft intro email' or write from scratch…"
                  />
                </div>
              </div>
            </div>

            {/* Email history */}
            <div className="mt-3 border-t border-slate-800/70 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[11px] font-semibold text-slate-300">
                  Email History
                </span>
              </div>
              {loadingEmailHistory && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Loading emails…</span>
                </div>
              )}
              {!loadingEmailHistory && emailHistory.length === 0 && (
                <div className="text-[11px] text-slate-500">
                  No emails logged yet for this prospect.
                </div>
              )}
              {!loadingEmailHistory && emailHistory.length > 0 && (
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {emailHistory.map((emailRow) => (
                    <div
                      key={emailRow.id}
                      className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-200">
                          {emailRow.subject || "(no subject)"}
                        </span>
                        <span className="text-slate-500">
                          {emailRow.sent_at
                            ? new Date(
                                emailRow.sent_at,
                              ).toLocaleString()
                            : ""}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        To: {emailRow.to_email || "(unknown)"}
                      </div>
                      {emailRow.body_preview && (
                        <div className="mt-0.5 text-[10px] text-slate-400 line-clamp-2">
                          {emailRow.body_preview}
                        </div>
                      )}
                      {emailRow.status && (
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          Status:{" "}
                          <span className="capitalize">
                            {emailRow.status.toLowerCase()}
                          </span>
                        </div>
                      )}
                      {emailRow.error_message && (
                        <div className="mt-0.5 text-[10px] text-rose-400">
                          Error: {emailRow.error_message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* AI Call History */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10">
                <PhoneCall className="h-4 w-4 text-sky-400" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-100">
                  AI Call History
                </span>
                <span className="text-[11px] text-slate-400">
                  Atlas AI outbound calls, summaries, and transcripts.
                </span>
              </div>
            </div>

            {followupCallStatus && (
              <div className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-200">
                {followupCallStatus}
              </div>
            )}

            {lead?.id ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-300">
                    Recent AI calls
                  </span>
                  <button
                    type="button"
                    onClick={handleFollowupCallWithAI}
                    disabled={!canFollowupCall || followupCallLoading}
                    className={classNames(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium",
                      !canFollowupCall || followupCallLoading
                        ? "border-slate-800 bg-slate-900/70 text-slate-500 cursor-not-allowed"
                        : "border-emerald-500/60 bg-emerald-600 text-slate-950 hover:bg-emerald-500",
                    )}
                  >
                    {followupCallLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Calling…</span>
                      </>
                    ) : (
                      <>
                        <PhoneCall className="h-3.5 w-3.5" />
                        <span>Follow-up call with AI</span>
                      </>
                    )}
                  </button>
                </div>

                <SalesCallHistory prospectId={lead.id} />
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                Save this prospect to see call history.
              </div>
            )}
          </section>

          {/* Dipsy Follow-Up Email (Last AI Call) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10">
                  <FileText className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-slate-100">
                    Dipsy Follow-Up Email (Last AI Call)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Draft a follow-up email for the most recent AI call. You
                    review and approve before anything is sent.
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerateFollowup}
                disabled={
                  followupGenerating || !lead?.id || !latestCall?.id
                }
                className={classNames(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                  followupGenerating || !lead?.id || !latestCall?.id
                    ? "border-slate-800 bg-slate-900/70 text-slate-500 cursor-not-allowed"
                    : "border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
                )}
              >
                {followupGenerating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Generating…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Generate draft</span>
                  </>
                )}
              </button>
            </div>

            {loadingLatestCall && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading latest AI call…</span>
              </div>
            )}

            {!loadingLatestCall && !latestCall && (
              <div className="text-[11px] text-slate-500">
                No AI calls yet for this prospect. Once Dipsy has made a
                call, you&apos;ll be able to generate a follow-up here.
              </div>
            )}

            {latestCall && (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      Last call:{" "}
                      {latestCall.started_at
                        ? new Date(
                            latestCall.started_at,
                          ).toLocaleString()
                        : "(time unknown)"}
                    </span>
                    <span className="text-slate-500">
                      {latestCall.direction || "OUTBOUND"} •{" "}
                      {latestCall.status || ""}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-400">
                    To: {latestCall.to_number || "(unknown)"} | From:{" "}
                    {latestCall.from_number || "(unknown)"}
                  </div>
                  {latestCall.ai_summary && (
                    <div className="mt-1 text-slate-400 line-clamp-2">
                      Summary: {latestCall.ai_summary}
                    </div>
                  )}
                </div>

                {followupError && (
                  <div className="flex items-start gap-1.5 rounded-lg border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
                    <AlertTriangle className="h-3.5 w-3.5 mt-px" />
                    <span>{followupError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                      value={followupSubject}
                      onChange={(e) =>
                        setFollowupSubject(e.target.value)
                      }
                      placeholder="Subject line for your follow-up email"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Email body (plain text)
                    </label>
                    <textarea
                      className="w-full min-h-[120px] rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                      value={followupBodyText}
                      onChange={(e) =>
                        setFollowupBodyText(e.target.value)
                      }
                      placeholder="Hi [Name],&#10;&#10;Thanks again for taking the time to speak today..."
                    />
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-3 md:gap-4">
                  <div className="flex-1 flex flex-col gap-2">
                    <label className="text-xs text-slate-400">
                      HTML preview (read-only)
                    </label>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 max-h-48 overflow-auto">
                      <div
                        // In a real app, consider sanitizing HTML.
                        dangerouslySetInnerHTML={{
                          __html:
                            followupBodyHtml &&
                            followupBodyHtml.trim()
                              ? followupBodyHtml
                              : textToSimpleHtml(
                                  followupBodyText || "",
                                ),
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500">
                      This is roughly how the email will look in HTML when
                      sent.
                    </p>
                  </div>

                  <div className="w-full md:w-56 flex flex-col gap-2">
                    <label className="text-xs text-slate-400">
                      Draft status
                    </label>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-100 flex flex-col gap-1">
                      <span>
                        Status:{" "}
                        <span className="font-semibold capitalize">
                          {followupStatus}
                        </span>
                      </span>
                      {followupAiVersion && (
                        <span className="text-[10px] text-slate-400">
                          AI version: {followupAiVersion}
                        </span>
                      )}
                      {followupDraftId && (
                        <span className="text-[10px] text-slate-500">
                          Draft ID: {followupDraftId}
                        </span>
                      )}
                      {followupSentAt && (
                        <span className="text-[10px] text-emerald-400">
                          Sent at:{" "}
                          {new Date(
                            followupSentAt,
                          ).toLocaleString()}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveFollowupDraft}
                      disabled={followupBusy || !followupBodyText.trim()}
                      className={classNames(
                        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                        followupBusy || !followupBodyText.trim()
                          ? "bg-slate-900/80 border border-slate-800 text-slate-500 cursor-not-allowed"
                          : "bg-slate-900/80 border border-slate-700 text-slate-100 hover:border-emerald-500/70 hover:bg-emerald-500/5",
                      )}
                    >
                      {followupSaving ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <FileText className="h-3.5 w-3.5" />
                          Save draft
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleApproveFollowup}
                      disabled={followupBusy || !followupBodyText.trim()}
                      className={classNames(
                        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                        followupBusy || !followupBodyText.trim()
                          ? "bg-slate-900/80 border border-slate-800 text-slate-500 cursor-not-allowed"
                          : "bg-emerald-600 text-slate-50 hover:bg-emerald-500",
                      )}
                    >
                      {followupSaving ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Updating…
                        </>
                      ) : (
                        <>
                          <ThumbsUp className="h-3.5 w-3.5" />
                          Approve (no send yet)
                        </>
                      )}
                    </button>

                    <p className="text-[10px] text-slate-500">
                      Approve marks this draft as ready. In the next step,
                      this button will also send via Atlas&apos;{" "}
                      <code>sales-send-email</code>.
                    </p>
                  </div>
                </div>

                {followupStatusMessage && (
                  <div className="text-[11px] text-emerald-400 pt-1">
                    {followupStatusMessage}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-950/95">
          <div className="text-[11px] text-slate-500">
            Changes are saved per prospect under your org.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSaveLead}
              disabled={saving}
              className={classNames(
                "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-medium",
                saving
                  ? "border-slate-700 bg-slate-900/80 text-slate-400"
                  : "border-emerald-500/70 bg-emerald-500 text-slate-950 hover:bg-emerald-400",
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  Saving…
                </>
              ) : (
                "Save prospect"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Simple helpers for follow-up HTML preview ---

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
