// FILE: src/pages/Sales.jsx
// Purpose:
// - V1 "Atlas Sales Engine" page
// - Read-only view of sales_prospects for the current org
// - Simple filters (state, sales_status, text search, Atlas fit tier, source)
// - FMCSA import via sales-pull-fmcsa Edge Function
// - Import list (Highway campaign CSV, etc.) via sales-import-list Edge Function
// - "Draft email" button -> sales-generate-email Edge Function
// - "Send email" button -> sales-send-email Edge Function
// - "Call with AI" button per prospect -> sales-initiate-call Edge Function
//   • Creates a sales_calls row
//   • Places an outbound Twilio call when configured
//   • Shows a clear success/error status banner in the UI
// - Per-prospect Call History & Details drawer
//   • Lists recent AI calls for that prospect from public.sales_calls
//   • Shows transcript + AI summary + metadata for a selected call
//
// Security:
// - Uses the standard Supabase client from ../lib/supabase
// - Relies on RLS + current_org_id() on public.sales_prospects and public.sales_calls
// - Does NOT bypass or weaken any security, does NOT use service_role,
//   and does NOT expose any secrets in the browser. The service-role logic
//   runs *inside* the Edge Functions only.

import SalesVoiceDiagnostics from "../components/sales/SalesVoiceDiagnostics";
import SalesLeadDrawer from "../components/sales/SalesLeadDrawer";
import { useEffect, useMemo, useState } from "react";
import {
  Filter,
  RefreshCw,
  Search,
  Mail,
  Phone,
  Building2,
  MapPin,
  Tag,
  CloudDownload,
  MailPlus,
  Loader2,
  Send,
  Clipboard,
  ClipboardCheck,
  PhoneCall,
  X,
  FileText,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Voicemail,
  Upload,
} from "lucide-react";
import { supabase } from "../lib/supabase";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

const SALES_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "NEW", label: "New" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WARM", label: "Warm" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "DO_NOT_CONTACT", label: "Do not contact" },
];

// Placeholders for future use (if we want “sticky” logic in the UI)
const STICKY_STATUSES = ["WARM", "HOT"];
const HIDDEN_STATUSES = ["ARCHIVED"];

// Heuristic: determine if a call likely went to voicemail based on transcript.
// This is UI-only and does NOT require any backend schema changes.
function isLikelyVoicemail(call) {
  if (!call || !call.transcript) return false;
  const t = call.transcript.toLowerCase();

  const voicemailKeywords = [
    "leave a message",
    "your call has been forwarded",
    "voicemail",
    "after the tone",
    "after the beep",
    "please record your message",
    "not available to take your call",
  ];

  const hasKeyword = voicemailKeywords.some((kw) => t.includes(kw));

  // If there's at least one voicemail phrase AND
  // very little Dipsy <-> Caller back-and-forth, we call it "likely voicemail".
  const callerMatches = t.match(/caller:/gi);
  const userMatches = t.match(/user:/gi);
  const dipsyMatches = t.match(/dipsy:/gi);

  const callerCount =
    (callerMatches ? callerMatches.length : 0) +
    (userMatches ? userMatches.length : 0);
  const dipsyCount = dipsyMatches ? dipsyMatches.length : 0;

  if (!hasKeyword) return false;

  // If we basically only have system-style lines + 0–1 short exchanges,
  // that's very likely a voicemail.
  if (callerCount <= 2 && dipsyCount <= 2) return true;

  return false;
}

function Sales() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [stateFilter, setStateFilter] = useState("");
  // Default to "All statuses" so WARM/HOT leads stay visible
  const [statusFilter, setStatusFilter] = useState("");
  const [tierFilter, setTierFilter] = useState(""); // Atlas fit tier: "", "A", "B", "C"
  const [sourceFilter, setSourceFilter] = useState(""); // "", "FMCSA", "IMPORT_LIST"
  const [searchTerm, setSearchTerm] = useState("");

  // FMCSA import state
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState(null); // { ok: boolean, message: string }

  // Import-list (CSV upload) state
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // { ok: boolean, message: string }

  // AI draft state
  const [draftLoadingId, setDraftLoadingId] = useState(null); // prospect.id currently drafting
  const [draftError, setDraftError] = useState(null);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftProspect, setDraftProspect] = useState(null);

  // Send email state
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null); // { ok: boolean, message: string }

  // Copy state
  const [copied, setCopied] = useState(false);

  // Voice call state
  const [voiceCallLoadingId, setVoiceCallLoadingId] = useState(null); // prospect.id currently calling
  const [voiceCallStatus, setVoiceCallStatus] = useState(null); // { ok: boolean, message: string }

  // Call history drawer state (per prospect)
  const [callHistoryOpen, setCallHistoryOpen] = useState(false);
  const [selectedProspectForCalls, setSelectedProspectForCalls] =
    useState(null);
  const [callsForProspect, setCallsForProspect] = useState([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [callsError, setCallsError] = useState(null);
  const [selectedCall, setSelectedCall] = useState(null);

  // Local-only call quality feedback (thumbs up / down), stored per call ID in localStorage.
  // This does NOT write to Supabase or change any backend logic.
  const [callQualityMap, setCallQualityMap] = useState({});

  // Lead drawer (create/edit prospect) state
  const [leadDrawerOpen, setLeadDrawerOpen] = useState(false);
  const [selectedLeadForEdit, setSelectedLeadForEdit] = useState(null);

  // Load call quality map from localStorage on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("atlas_call_quality");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setCallQualityMap(parsed);
        }
      }
    } catch (err) {
      console.error("[Sales] Failed to load call quality map:", err);
    }
  }, []);

  // Persist call quality map whenever it changes
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "atlas_call_quality",
        JSON.stringify(callQualityMap)
      );
    } catch (err) {
      console.error("[Sales] Failed to persist call quality map:", err);
    }
  }, [callQualityMap]);

  // ---------------------------------------------------------------------------
  // Load prospects
  // ---------------------------------------------------------------------------

  async function fetchProspects({ showSpinner = true } = {}) {
    try {
      if (showSpinner) setLoading(true);
      setError(null);

      // IMPORTANT:
      // Only show large fleets by default (power_units >= 5),
      // BUT always include:
      // - WARM/HOT leads even if they are small
      // - Manual test/seed rows like the Dipsy Test Carrier (tagged DIPSY or MANUAL_TEST_SEED)
      const { data, error: queryError } = await supabase
        .from("sales_prospects")
        .select("*")
        .or(
          [
            "power_units.gte.5",
            "sales_status.eq.WARM",
            "sales_status.eq.HOT",
            "tags.cs.{DIPSY}",
            "source_system.eq.MANUAL_TEST_SEED",
          ].join(",")
        )
        .order("created_at", { ascending: false })
        .limit(500);

      if (queryError) {
        console.error("[Sales] Error loading sales_prospects:", queryError);
        setError("Unable to load prospects. Please try again.");
        return;
      }

      setProspects(data || []);
    } catch (err) {
      console.error("[Sales] Unexpected error:", err);
      setError("Something went wrong while loading prospects.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchProspects();
  }, []);

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------

  const uniqueStates = useMemo(() => {
    const set = new Set();
    prospects.forEach((p) => {
      if (p.state) set.add(p.state);
    });
    return Array.from(set).sort();
  }, [prospects]);

  const filteredProspects = useMemo(() => {
    let result = prospects;

    if (stateFilter) {
      result = result.filter((p) => p.state === stateFilter);
    }

    // Source filter:
    // - FMCSA: treat null/undefined source_system as FMCSA (legacy FMCSA rows)
    // - IMPORT_LIST: explicit import-list rows
    if (sourceFilter === "FMCSA") {
      result = result.filter(
        (p) => !p.source_system || p.source_system === "FMCSA"
      );
    } else if (sourceFilter === "IMPORT_LIST") {
      result = result.filter((p) => p.source_system === "IMPORT_LIST");
    }

    // When statusFilter === "", we treat it as "All statuses" (no filter).
    if (statusFilter) {
      result = result.filter((p) => p.sales_status === statusFilter);
    }

    if (tierFilter) {
      result = result.filter(
        (p) => normalizeCarrierTier(p.carrier_tier) === tierFilter
      );
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter((p) => {
        const fields = [
          p.legal_name,
          p.dba_name,
          p.city,
          p.state,
          p.email,
          p.phone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return fields.includes(term);
      });
    }

    return result;
  }, [
    prospects,
    stateFilter,
    sourceFilter,
    statusFilter,
    tierFilter,
    searchTerm,
  ]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchProspects({ showSpinner: !prospects.length });
  };

  // ---------------------------------------------------------------------------
  // FMCSA import via Edge Function
  // ---------------------------------------------------------------------------

  async function handleImportFmcsA() {
    try {
      setImporting(true);
      setError(null);
      setImportStatus(null);

      const { data, error } = await supabase.functions.invoke(
        "sales-pull-fmcsa",
        {
          body: {},
        }
      );

      if (error) {
        console.error("[Sales] sales-pull-fmcsa error:", error);
        setImportStatus({
          ok: false,
          message:
            "FMCSA import failed. Please check logs or try again in a moment.",
        });
        return;
      }

      if (data && data.ok) {
        const total = data.total ?? 0;
        const inserted = data.inserted ?? 0;
        const updated = data.updated ?? 0;

        setImportStatus({
          ok: true,
          message: `FMCSA sync complete: ${total} records processed (${inserted} inserted, ${updated} upserted).`,
        });

        await fetchProspects({ showSpinner: false });
      } else {
        console.warn("[Sales] sales-pull-fmcsa returned non-ok payload:", data);
        setImportStatus({
          ok: false,
          message: "FMCSA import did not return a successful response.",
        });
      }
    } catch (err) {
      console.error("[Sales] Unexpected FMCSA import error:", err);
      setImportStatus({
        ok: false,
        message:
          "Unexpected error during FMCSA import. Please try again or check function logs.",
      });
    } finally {
      setImporting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Import carrier list via sales-import-list (CSV upload)
  // This uses your existing Edge Function which expects:
  //   { rows: ImportCarrierRow[], list_tag?: string }
  // ---------------------------------------------------------------------------

  async function handleUploadCarrierList(event) {
    const files = event.target.files;
    const file = files && files[0];
    if (!file) return;

    setUploadStatus(null);
    setError(null);
    setUploading(true);

    try {
      const csvText = await file.text();

      // Very simple CSV parsing:
      // - Assumes first line is header row
      // - Splits on commas (your sample data should be safe with this)
      // - Trims quotes and whitespace
      const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length < 2) {
        setUploadStatus({
          ok: false,
          message: "CSV file appears to be empty or missing data rows.",
        });
        setUploading(false);
        event.target.value = "";
        return;
      }

      const headerLine = lines[0];
      const headers = headerLine
        .split(",")
        .map((h) => h.replace(/^"|"$/g, "").trim());

      const rows = lines.slice(1).map((line) => {
        const cols = line.split(",");
        const row = {};
        headers.forEach((header, index) => {
          const raw = cols[index] ?? "";
          const cleaned = raw.replace(/^"|"$/g, "").trim();
          row[header] = cleaned === "" ? null : cleaned;
        });
        return row;
      });

      // You can customize this tag if you like
      const listTag = "highway_atlas_campaign_2025_11";

      const { data, error } = await supabase.functions.invoke(
        "sales-import-list",
        {
          body: {
            rows,
            list_tag: listTag,
          },
        }
      );

      if (error) {
        console.error("[Sales] sales-import-list error (transport):", error);
        const message =
          error.message ||
          "Import failed. Please check logs or try again.";
        setUploadStatus({ ok: false, message });
        return;
      }

      if (!data || data.status !== "ok") {
        console.error(
          "[Sales] sales-import-list returned non-ok payload:",
          data
        );
        setUploadStatus({
          ok: false,
          message:
            data?.error ||
            "Import did not complete successfully. Please check function logs.",
        });
        return;
      }

      const inserted =
        data.inserted_rows ?? data.imported_rows ?? data.requested_rows ?? "?";

      setUploadStatus({
        ok: true,
        message: `Imported ${inserted} carriers from list (tag: ${listTag}).`,
      });

      // Refresh table without full-page spinner
      await fetchProspects({ showSpinner: false });
    } catch (err) {
      console.error("[Sales] Unexpected error during list import:", err);
      setUploadStatus({
        ok: false,
        message:
          "Unexpected error while uploading/importing carriers. Please try again.",
      });
    } finally {
      setUploading(false);
      // Allow re-selecting the same file again if needed
      event.target.value = "";
    }
  }

  // ---------------------------------------------------------------------------
  // AI: Draft email for a prospect
  // ---------------------------------------------------------------------------

  async function handleDraftEmail(prospect) {
    try {
      setDraftError(null);
      setDraftEmail("");
      setDraftProspect(null);
      setDraftLoadingId(prospect.id);
      setSendStatus(null);
      setCopied(false);

      const { data, error } = await supabase.functions.invoke(
        "sales-generate-email",
        {
          body: {
            prospect_id: prospect.id,
          },
        }
      );

      if (error) {
        console.error("[Sales] sales-generate-email error (transport):", error);
        setDraftError("Failed to contact AI email service. Please try again.");
        return;
      }

      if (!data || !data.ok) {
        console.error(
          "[Sales] sales-generate-email returned error payload:",
          data
        );
        const message =
          data?.error ||
          "AI email generation failed. Please check logs or try again.";
        setDraftError(message);
        return;
      }

      setDraftProspect(prospect);
      setDraftEmail(data.email_text || "");
    } catch (err) {
      console.error("[Sales] Unexpected error drafting email:", err);
      setDraftError("Unexpected error while generating email.");
    } finally {
      setDraftLoadingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Send email via sales-send-email
  // ---------------------------------------------------------------------------

  async function handleSendEmail() {
    try {
      setSendStatus(null);

      if (!draftProspect) {
        setSendStatus({
          ok: false,
          message: "No prospect selected. Draft an email first.",
        });
        return;
      }

      const prospectEmail =
        draftProspect.email && String(draftProspect.email).trim();

      if (!prospectEmail) {
        setSendStatus({
          ok: false,
          message:
            "This prospect has no email on file. You can copy the draft and send it manually.",
        });
        return;
      }

      if (!draftEmail || !draftEmail.trim()) {
        setSendStatus({
          ok: false,
          message: "Draft is empty. Please generate or write an email first.",
        });
        return;
      }

      setSending(true);

      const { data, error } = await supabase.functions.invoke(
        "sales-send-email",
        {
          body: {
            prospect_id: draftProspect.id,
            lead_id: draftProspect.id, // backwards-compat with old function
            email_text: draftEmail,
            body_text: draftEmail,
          },
        }
      );

      if (error) {
        console.error("[Sales] sales-send-email error (transport):", error);
        setSendStatus({
          ok: false,
          message: "Failed to contact email service. Please try again.",
        });
        return;
      }

      if (!data || data.ok === false) {
        console.error("[Sales] sales-send-email returned error payload:", data);
        const message =
          data?.error ||
          "Email send failed. Please check logs or try again.";
        setSendStatus({
          ok: false,
          message,
        });
        return;
      }

      setSendStatus({
        ok: true,
        message: "Email sent (or queued) successfully.",
      });
    } catch (err) {
      console.error("[Sales] Unexpected error sending email:", err);
      setSendStatus({
        ok: false,
        message: "Unexpected error while sending email.",
      });
    } finally {
      setSending(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Voice: Call with AI (Twilio via sales-initiate-call)
  // ---------------------------------------------------------------------------

  async function handleCallWithAI(prospect) {
    try {
      setVoiceCallStatus(null);
      setVoiceCallLoadingId(prospect.id);

      const { data, error } = await supabase.functions.invoke(
        "sales-initiate-call",
        {
          body: {
            prospect_id: prospect.id,
          },
        }
      );

      if (error) {
        console.error("[Sales] sales-initiate-call error (transport):", error);
        setVoiceCallStatus({
          ok: false,
          message:
            "Failed to contact voice call service. Please try again or check logs.",
        });
        return;
      }

      console.log("[Sales] Voice call initiated:", data);

      if (!data || data.ok === false) {
        const message =
          data?.error ||
          "Voice call could not be started. Please check logs or try again.";
        setVoiceCallStatus({ ok: false, message });
        return;
      }

      const twilio = data.twilio || {};
      const call = data.call || null;

      if (twilio.called) {
        const sid = twilio.sid || "unknown SID";
        const status = twilio.status || "queued";
        const toNumber =
          (call && call.to_number) || prospect.phone || "the prospect's phone number";

        setVoiceCallStatus({
          ok: true,
          message: `Call queued to ${toNumber}. Twilio status: ${status}. SID: ${sid}.`,
        });
      } else {
        const reason = twilio.reason || twilio.error || "unknown reason";
        setVoiceCallStatus({
          ok: false,
          message: `Call record created for ${
            prospect.legal_name || "this carrier"
          }, but Twilio did not place a live call (${reason}).`,
        });
      }
    } catch (err) {
      console.error("[Sales] Unexpected error starting voice call:", err);
      setVoiceCallStatus({
        ok: false,
        message: "Unexpected error while starting voice call.",
      });
    } finally {
      setVoiceCallLoadingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Voice: Call history drawer (load calls for a prospect)
  // ---------------------------------------------------------------------------

  async function loadCallsForProspect(prospectId, { showSpinner = true } = {}) {
    try {
      if (showSpinner) setCallsLoading(true);
      setCallsError(null);

      // NOTE: order by created_at so newest inserted call is always first,
      // even if started_at is null.
      const { data, error } = await supabase
        .from("sales_calls")
        .select("*")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(25);

      if (error) {
        console.error("[Sales] Error loading sales_calls:", error);
        setCallsError("Unable to load calls for this prospect.");
        setCallsForProspect([]);
        setSelectedCall(null);
        return;
      }

      setCallsForProspect(data || []);

      setSelectedCall((prev) => {
        if (prev && data && data.some((c) => c.id === prev.id)) {
          // keep same selected call if it still exists
          return data.find((c) => c.id === prev.id) || null;
        }
        // otherwise default to newest call
        return data && data.length > 0 ? data[0] : null;
      });
    } catch (err) {
      console.error("[Sales] Unexpected error loading call history:", err);
      setCallsError("Unexpected error while loading call history.");
      setCallsForProspect([]);
      setSelectedCall(null);
    } finally {
      setCallsLoading(false);
    }
  }

  async function handleOpenCallHistory(prospect) {
    setSelectedProspectForCalls(prospect);
    setCallHistoryOpen(true);
    await loadCallsForProspect(prospect.id);
  }

  // Lead drawer handlers
  function handleOpenLeadDrawer(prospect) {
    setSelectedLeadForEdit(prospect);
    setLeadDrawerOpen(true);
  }

  function handleLeadSaved(updated) {
    if (!updated || !updated.id) return;
    setProspects((prev) => {
      if (!Array.isArray(prev)) return prev;
      const idx = prev.findIndex((p) => p.id === updated.id);
      if (idx === -1) {
        return [updated, ...prev];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...updated };
      return next;
    });
    setSelectedLeadForEdit(updated);
  }

  // Optional: live updates for call history when drawer is open
  useEffect(() => {
    if (!callHistoryOpen || !selectedProspectForCalls) return;

    const prospectId = selectedProspectForCalls.id;

    const channel = supabase
      .channel(`sales_calls_prospect_${prospectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_calls",
          filter: `prospect_id=eq.${prospectId}`,
        },
        () => {
          // refresh calls quietly when something changes
          loadCallsForProspect(prospectId, { showSpinner: false });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [callHistoryOpen, selectedProspectForCalls]);

  // ---------------------------------------------------------------------------
  // Copy draft to clipboard (AI email)
  // ---------------------------------------------------------------------------

  async function handleCopyDraft() {
    if (!draftEmail) return;
    try {
      await navigator.clipboard.writeText(draftEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error("[Sales] copy error:", err);
    }
  }

  // Derived: can we send?
  const canSend =
    !!draftProspect &&
    !!(draftProspect.email && String(draftProspect.email).trim()) &&
    !!(draftEmail && draftEmail.trim());

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col px-6 py-4 lg:px-8 lg:py-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">
            Atlas Sales Engine
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            View carrier prospects from FMCSA and imported lists, and manage
            your sales pipeline. Data is isolated per org via RLS.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || refreshing || importing || uploading}
              className={cx(
                "inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium",
                "bg-slate-900/70 text-slate-100 hover:bg-slate-800/80",
                (loading || refreshing || importing || uploading) &&
                  "cursor-not-allowed opacity-60"
              )}
            >
              <RefreshCw
                className={cx(
                  "h-4 w-4",
                  (refreshing || loading) && "animate-spin"
                )}
              />
              <span>
                {refreshing || loading ? "Refreshing..." : "Refresh"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleImportFmcsA}
              disabled={importing || loading || uploading}
              className={cx(
                "inline-flex items-center gap-2 rounded-lg border border-emerald-500/60 px-3 py-2 text-sm font-medium shadow-sm",
                "bg-emerald-600 text-slate-950 hover:bg-emerald-500",
                (importing || loading || uploading) &&
                  "cursor-not-allowed opacity-70"
              )}
            >
              <CloudDownload
                className={cx("h-4 w-4", importing && "animate-bounce")}
              />
              <span>
                {importing ? "Importing FMCSA…" : "Import FMCSA data"}
              </span>
            </button>

            {/* Upload carriers from CSV */}
            <label
              className={cx(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm cursor-pointer",
                "border-sky-500/60 bg-sky-700 text-slate-50 hover:bg-sky-600",
                (uploading || importing || loading) &&
                  "cursor-not-allowed opacity-70"
              )}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleUploadCarrierList}
                disabled={uploading || importing || loading}
              />
              <Upload
                className={cx("h-4 w-4", uploading && "animate-bounce")}
              />
              <span>{uploading ? "Uploading…" : "Upload carriers (CSV)"}</span>
            </label>
          </div>

          {/* Status messages for FMCSA + Import List */}
          {importStatus && (
            <div
              className={cx(
                "mt-1 text-xs",
                importStatus.ok ? "text-emerald-300" : "text-amber-300"
              )}
            >
              {importStatus.message}
            </div>
          )}

          {uploadStatus && (
            <div
              className={cx(
                "mt-1 text-xs",
                uploadStatus.ok ? "text-sky-300" : "text-amber-300"
              )}
            >
              {uploadStatus.message}
            </div>
          )}
        </div>
      </div>

      {/* Top layout: Diagnostics + Filters side-by-side on desktop */}
      <div className="mb-3 space-y-3 md:mb-4 md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-4 md:space-y-0">
        {/* AI Caller Diagnostics */}
        <div className="order-1">
          <SalesVoiceDiagnostics />
        </div>

        {/* Filters */}
        <div className="order-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm shadow-black/40">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <Filter className="h-4 w-4" />
            <span>Filters</span>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            {/* Search */}
            <div className="flex-1 min-w-[220px] md:flex-[1.3]">
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Search
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by name, city, state, email or phone"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-900/80 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Dropdown filters */}
            <div className="mt-1 flex flex-col gap-3 md:mt-0 md:flex-row md:flex-wrap md:flex-[1.7]">
              <div className="flex-1 min-w-[140px]">
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  State
                </label>
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">All states</option>
                  {uniqueStates.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[160px]">
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Sales status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {SALES_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[180px]">
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Atlas fit tier
                </label>
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">All tiers</option>
                  <option value="A">Tier A (20+ power units)</option>
                  <option value="B">Tier B (5–19 power units)</option>
                  <option value="C">Tier C (other / unknown)</option>
                </select>
              </div>

              <div className="flex-1 min-w-[180px]">
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Source
                </label>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">All sources</option>
                  <option value="FMCSA">FMCSA only</option>
                  <option value="IMPORT_LIST">Imported lists only</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Voice call status banner */}
      {voiceCallStatus && (
        <div
          className={cx(
            "mb-3 rounded-lg border px-3 py-2 text-xs",
            voiceCallStatus.ok
              ? "border-emerald-500/70 bg-emerald-950/40 text-emerald-200"
              : "border-amber-500/70 bg-amber-950/30 text-amber-100"
          )}
        >
          {voiceCallStatus.message}
        </div>
      )}

      {/* Main content: table + AI panel */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Table */}
        <div className="flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 shadow-inner shadow-black/40">
          {loading && !refreshing ? (
            <div className="flex h-full items-center justify-center px-4 py-10 text-sm text-slate-400">
              Loading prospects…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <p className="text-sm text-red-400">{error}</p>
              <button
                type="button"
                onClick={handleRefresh}
                className="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Try again</span>
              </button>
            </div>
          ) : filteredProspects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <p className="text-sm text-slate-300">
                No prospects match your filters.
              </p>
              <p className="text-xs text-slate-500">
                Try clearing filters, importing FMCSA data, or uploading a
                carrier list into
                <span className="font-semibold"> sales_prospects</span>.
              </p>
            </div>
          ) : (
            <div className="h-full overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur">
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left font-medium">
                      Carrier
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Fit</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Location
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Contact
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Ops</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Sales status
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Tags</th>
                    <th className="px-4 py-3 text-left font-medium">
                      AI outreach
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProspects.map((p) => {
                    const isDrafting = draftLoadingId === p.id;
                    const isCalling = voiceCallLoadingId === p.id;
                    const normalizedTier = normalizeCarrierTier(p.carrier_tier);
                    const tierMeta = getCarrierTierMeta(normalizedTier);

                    return (
                      <tr
                        key={p.id}
                        className="border-b border-slate-900/80 hover:bg-slate-900/60"
                      >
                        {/* Carrier */}
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1">
                            <div
                              className="flex items-center gap-2 cursor-pointer hover:text-emerald-300"
                              onClick={() => handleOpenLeadDrawer(p)}
                            >
                              <Building2 className="h-4 w-4 text-emerald-400" />
                              <span className="font-medium text-slate-50">
                                {p.legal_name || "—"}
                              </span>
                            </div>
                            {p.dba_name && (
                              <div className="pl-6 text-xs text-slate-400">
                                DBA: {p.dba_name}
                              </div>
                            )}
                            <div className="pl-6 text-[11px] text-slate-500">
                              DOT: {p.dot_number || "—"} · MC:{" "}
                              {p.mc_number || "—"}
                            </div>
                            {p.source_system && (
                              <div className="pl-6 text-[10px] text-slate-500">
                                Source: {p.source_system}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Fit (Atlas carrier tier) */}
                        <td className="px-4 py-3 align-top">
                          <div
                            className={cx(
                              "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                              tierMeta.className
                            )}
                            title={tierMeta.tooltip}
                          >
                            <span className="mr-1 text-xs font-semibold">
                              {normalizedTier}
                            </span>
                            <span className="hidden sm:inline">
                              {tierMeta.label}
                            </span>
                          </div>
                        </td>

                        {/* Location */}
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1 text-xs text-slate-300">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3 w-3 text-slate-500" />
                              <span>
                                {p.city || "—"},{" "}
                                {p.state ||
                                  (p.country && p.country !== "US"
                                    ? p.country
                                    : "—")}
                              </span>
                            </div>
                            <div className="pl-5 text-[11px] text-slate-500">
                              {p.address_line1 || ""}
                              {p.address_line2 ? `, ${p.address_line2}` : ""}
                              {p.postal_code ? ` ${p.postal_code}` : ""}
                            </div>
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1 text-xs">
                            <div className="flex items-center gap-2 text-slate-300">
                              <Phone className="h-3 w-3 text-slate-500" />
                              <span>{p.phone || "—"}</span>
                            </div>
                            <div className="flex items-center gap-2 text-slate-300">
                              <Mail className="h-3 w-3 text-slate-500" />
                              <span className="truncate">
                                {p.email || "—"}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Operations */}
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1 text-xs text-slate-300">
                            <div>
                              <span className="font-medium text-slate-200">
                                {p.operation_type || "—"}
                              </span>
                              {p.power_units !== null &&
                                p.power_units !== undefined && (
                                  <span className="ml-2 text-slate-400">
                                    · {p.power_units} power units
                                  </span>
                                )}
                            </div>
                            {p.cargo_types && p.cargo_types.length > 0 && (
                              <div className="text-[11px] text-slate-500">
                                {p.cargo_types.slice(0, 3).join(", ")}
                                {p.cargo_types.length > 3 && "…"}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Sales status */}
                        <td className="px-4 py-3 align-top">
                          <div className="inline-flex rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-slate-100">
                            {formatSalesStatus(p.sales_status)}
                          </div>
                          {p.last_contacted_at && (
                            <div className="mt-1 text-[11px] text-slate-500">
                              Last contact:{" "}
                              {new Date(
                                p.last_contacted_at
                              ).toLocaleDateString()}
                            </div>
                          )}
                        </td>

                        {/* Tags */}
                        <td className="px-4 py-3 align-top">
                          {p.tags && p.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {p.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] text-slate-200"
                                >
                                  <Tag className="h-3 w-3 text-slate-500" />
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>

                        {/* AI outreach */}
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1.5">
                            {/* Draft email */}
                            <button
                              type="button"
                              onClick={() => handleDraftEmail(p)}
                              disabled={draftLoadingId !== null}
                              className={cx(
                                "inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                                draftLoadingId === p.id
                                  ? "border-emerald-500/60 bg-emerald-600/90 text-slate-950"
                                  : "border-slate-700 bg-slate-900/80 text-slate-100 hover:border-emerald-500 hover:text-emerald-300"
                              )}
                            >
                              {isDrafting ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Drafting…</span>
                                </>
                              ) : (
                                <>
                                  <MailPlus className="h-3 w-3" />
                                  <span>Draft email</span>
                                </>
                              )}
                            </button>

                            {/* Call with AI */}
                            <button
                              type="button"
                              onClick={() => handleCallWithAI(p)}
                              disabled={!!voiceCallLoadingId}
                              className={cx(
                                "inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                                isCalling
                                  ? "border-emerald-500/60 bg-emerald-600 text-slate-950"
                                  : "border-slate-700 bg-slate-900/80 text-slate-100 hover:border-emerald-500 hover:text-emerald-300",
                                voiceCallLoadingId &&
                                  voiceCallLoadingId !== p.id &&
                                  "opacity-60 cursor-not-allowed"
                              )}
                            >
                              {isCalling ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Calling…</span>
                                </>
                              ) : (
                                <>
                                  <PhoneCall className="h-3 w-3" />
                                  <span>Call with AI</span>
                                </>
                              )}
                            </button>

                            {/* View call history / details */}
                            <button
                              type="button"
                              onClick={() => handleOpenCallHistory(p)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-slate-100 hover:border-emerald-500 hover:text-emerald-300"
                            >
                              <Phone className="h-3 w-3" />
                              <span>View calls</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* AI Draft Panel */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm shadow-black/40">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-50">
                AI email draft
              </h2>
              <p className="text-xs text-slate-400">
                Atlas AI drafts an email based on the selected carrier&apos;s
                profile. You can edit it here, then either send (if an email is
                on file) or copy and paste into your email tool.
              </p>
            </div>
            {draftProspect && (
              <div className="text-right text-xs text-slate-400">
                <div className="font-medium text-slate-100">
                  {draftProspect.legal_name ||
                    draftProspect.dba_name ||
                    "—"}
                </div>
                <div className="text-[11px] text-slate-500">
                  DOT: {draftProspect.dot_number || "—"} · MC:{" "}
                  {draftProspect.mc_number || "—"}
                </div>
              </div>
            )}
          </div>

          {draftError && (
            <div className="mb-2 rounded-md border border-red-500/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {draftError}
            </div>
          )}

          {draftLoadingId && !draftError && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Generating personalized email…</span>
            </div>
          )}

          {!draftLoadingId && !draftError && !draftEmail && (
            <div className="text-xs text-slate-500">
              Click <span className="font-semibold">Draft email</span> on any
              carrier row to generate a personalized outreach email.
            </div>
          )}

          {draftEmail && !draftError && (
            <>
              <div className="mt-2">
                <textarea
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  className="h-44 w-full resize-vertical rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSendEmail}
                    disabled={sending || !canSend}
                    className={cx(
                      "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm",
                      !canSend || sending
                        ? "border-slate-700 bg-slate-800/80 text-slate-400 cursor-not-allowed"
                        : "border-emerald-500/60 bg-emerald-600 text-slate-950 hover:bg-emerald-500"
                    )}
                  >
                    {sending ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Sending…</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3 w-3" />
                        <span>Send email</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyDraft}
                    disabled={!draftEmail}
                    className={cx(
                      "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium",
                      draftEmail
                        ? "border-slate-600 bg-slate-900/80 text-slate-100 hover:bg-slate-800"
                        : "border-slate-700 bg-slate-900/60 text-slate-500 cursor-not-allowed"
                    )}
                  >
                    {copied ? (
                      <>
                        <ClipboardCheck className="h-3 w-3" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Clipboard className="h-3 w-3" />
                        <span>Copy draft</span>
                      </>
                    )}
                  </button>

                  {!sending &&
                    draftProspect &&
                    !(draftProspect.email &&
                      String(draftProspect.email).trim()) && (
                      <span className="text-[11px] text-amber-300">
                        This prospect has no email on file. Use&nbsp;
                        <span className="font-semibold">Copy draft</span> to
                        send manually.
                      </span>
                    )}
                </div>

                {sendStatus && (
                  <div
                    className={cx(
                      "text-xs",
                      sendStatus.ok ? "text-emerald-300" : "text-amber-300"
                    )}
                  >
                    {sendStatus.message}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sales Lead Drawer (edit / view prospect details) */}
      <SalesLeadDrawer
        isOpen={leadDrawerOpen}
        onClose={() => {
          setLeadDrawerOpen(false);
          setSelectedLeadForEdit(null);
        }}
        lead={selectedLeadForEdit}
        onSaved={handleLeadSaved}
      />

      {/* Call History & Details Drawer (lives inside Sales page) */}
      <CallHistoryDrawer
        open={callHistoryOpen}
        prospect={selectedProspectForCalls}
        calls={callsForProspect}
        loading={callsLoading}
        error={callsError}
        selectedCall={selectedCall}
        onSelectCall={setSelectedCall}
        onClose={() => {
          setCallHistoryOpen(false);
          setSelectedProspectForCalls(null);
          setCallsForProspect([]);
          setSelectedCall(null);
          setCallsError(null);
        }}
        callQualityMap={callQualityMap}
        onSetCallQuality={(callId, value) => {
          if (!callId) return;
          setCallQualityMap((prev) => {
            const next = { ...prev };
            if (!value) {
              // clear rating
              delete next[callId];
            } else {
              next[callId] = value; // "up" or "down"
            }
            return next;
          });
        }}
      />
    </div>
  );
}

function formatSalesStatus(status) {
  if (!status) return "New";
  switch (status) {
    case "NEW":
      return "New";
    case "IN_PROGRESS":
      return "In progress";
    case "WARM":
      return "Warm";
    case "CUSTOMER":
      return "Customer";
    case "DO_NOT_CONTACT":
      return "Do not contact";
    default:
      return status;
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return "—";

  const diffMs = end - start;
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

// Normalize carrier tier into A / B / C with a safe default (C)
function normalizeCarrierTier(rawTier) {
  if (rawTier === "A" || rawTier === "B" || rawTier === "C") return rawTier;
  return "C";
}

// Return label + Tailwind classes for each tier
function getCarrierTierMeta(tier) {
  switch (tier) {
    case "A":
      return {
        label: "Strong fit",
        className:
          "border-emerald-500/70 bg-emerald-500/10 text-emerald-200",
        tooltip: "Tier A – 20+ power units",
      };
    case "B":
      return {
        label: "Good fit",
        className: "border-sky-500/70 bg-sky-500/10 text-sky-200",
        tooltip: "Tier B – 5–19 power units",
      };
    case "C":
    default:
      return {
        label: "Other / unknown",
        className: "border-slate-700 bg-slate-900/80 text-slate-300",
        tooltip: "Tier C – other / unknown",
      };
  }
}

// ---------------------------------------------------------------------------
// CallHistoryDrawer: lives inside the Sales page
// ---------------------------------------------------------------------------

function CallHistoryDrawer({
  open,
  prospect,
  calls,
  loading,
  error,
  selectedCall,
  onSelectCall,
  onClose,
  callQualityMap,
  onSetCallQuality,
}) {
  const [recordingUrl, setRecordingUrl] = useState(null);

  // Load / refresh a signed URL for the recording whenever selectedCall changes
  useEffect(() => {
    let isCancelled = false;

    async function loadRecordingUrl() {
      if (!selectedCall) {
        setRecordingUrl(null);
        return;
      }

      // Prefer Atlas Storage recording if present
      if (selectedCall.recording_storage_path) {
        try {
          const { data, error } = await supabase.storage
            .from("call-recordings")
            .createSignedUrl(selectedCall.recording_storage_path, 60 * 60); // 1 hour

          if (!isCancelled) {
            if (error) {
              console.error(
                "[Sales] Failed to create signed URL for recording:",
                error
              );
              setRecordingUrl(null);
            } else {
              setRecordingUrl(data && data.signedUrl ? data.signedUrl : null);
            }
          }
        } catch (err) {
          if (!isCancelled) {
            console.error(
              "[Sales] Unexpected error creating signed URL:",
              err
            );
            setRecordingUrl(null);
          }
        }
        return;
      }

      // Fallback: if we ONLY have a Twilio URL, do NOT play it directly (to avoid auth popup).
      setRecordingUrl(null);
    }

    loadRecordingUrl();

    return () => {
      isCancelled = true;
    };
  }, [selectedCall]);

  if (!open) return null;

  const hasCalls = calls && calls.length > 0;

  const currentQuality =
    selectedCall && callQualityMap
      ? callQualityMap[selectedCall.id] || null
      : null;

  const selectedIsVoicemail = isLikelyVoicemail(selectedCall);

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative w-full max-w-3xl bg-slate-950 text-slate-100 border-l border-slate-800 shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Call history & details
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PhoneCall className="h-4 w-4 text-emerald-400" />
              <div className="text-sm font-semibold text-slate-50">
                {prospect &&
                  (prospect.legal_name || prospect.dba_name) ||
                  "Selected carrier"}
              </div>
              {selectedIsVoicemail && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/70 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                  <Voicemail className="h-3 w-3" />
                  Likely voicemail
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              {prospect && prospect.phone && (
                <>
                  <span>Phone: {prospect.phone}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-600" />
                </>
              )}
              {prospect && prospect.email && (
                <>
                  <span>Email: {prospect.email}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-600" />
                </>
              )}
              <span>Data is scoped to your org via RLS</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 border border-slate-700/80 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: responsive layout (stack on mobile, split on desktop) */}
        <div className="flex h-[75vh] flex-col md:h-[80vh] md:flex-row md:divide-x md:divide-slate-800">
          {/* Left: call list */}
          <div className="flex flex-col border-b border-slate-800 md:w-64 md:border-b-0">
            <div className="px-4 py-3 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Recent calls
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  Loading calls…
                </div>
              )}

              {!loading && error && (
                <div className="px-4 py-3 text-xs text-rose-300">{error}</div>
              )}

              {!loading && !error && !hasCalls && (
                <div className="px-4 py-3 text-xs text-slate-500">
                  No calls logged yet for this prospect.
                  <br />
                  Use <span className="font-semibold">Call with AI</span> on
                  the sales table to start one.
                </div>
              )}

              {!loading && !error && hasCalls && (
                <ul className="py-1 text-xs">
                  {calls.map((call) => {
                    const isActive =
                      selectedCall && call.id === selectedCall.id;
                    const statusLabel = call.status || "UNKNOWN";
                    const durationLabel = formatDuration(
                      call.started_at,
                      call.ended_at
                    );
                    const timestamp =
                      call.started_at || call.created_at || null;
                    const callIsVoicemail = isLikelyVoicemail(call);

                    return (
                      <li key={call.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelectCall) onSelectCall(call);
                          }}
                          className={cx(
                            "w-full px-3 py-2 text-left",
                            "hover:bg-slate-900/80",
                            isActive &&
                              "bg-slate-900 border-l-2 border-emerald-500"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-slate-100">
                              {statusLabel}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {durationLabel}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                            <span>{formatDateTime(timestamp)}</span>
                            {callIsVoicemail && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-200">
                                <Voicemail className="h-3 w-3" />
                                Voicemail
                              </span>
                            )}
                          </div>
                          {call.direction && (
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              Direction: {call.direction}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right: call details */}
          <div className="flex-1 flex flex-col">
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-slate-50">
                    Call details
                  </span>
                </div>
                {selectedCall && (
                  <>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>Status: {selectedCall.status || "UNKNOWN"}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-600" />
                      <span>
                        Duration:{" "}
                        {formatDuration(
                          selectedCall.started_at,
                          selectedCall.ended_at
                        )}
                      </span>
                      {(selectedCall.started_at ||
                        selectedCall.created_at) && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-slate-600" />
                          <span>
                            Started:{" "}
                            {formatDateTime(
                              selectedCall.started_at ||
                                selectedCall.created_at
                            )}
                          </span>
                        </>
                      )}
                      {selectedCall.ended_at && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-slate-600" />
                          <span>
                            Ended: {formatDateTime(selectedCall.ended_at)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Local thumbs up / down call quality feedback */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>Call quality (local only):</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (onSetCallQuality) {
                            onSetCallQuality(
                              selectedCall.id,
                              currentQuality === "up" ? null : "up"
                            );
                          }
                        }}
                        className={cx(
                          "inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                          currentQuality === "up"
                            ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                            : "border-slate-700 bg-slate-900/80 text-slate-400 hover:border-emerald-500 hover:text-emerald-300"
                        )}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (onSetCallQuality) {
                            onSetCallQuality(
                              selectedCall.id,
                              currentQuality === "down" ? null : "down"
                            );
                          }
                        }}
                        className={cx(
                          "inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                          currentQuality === "down"
                            ? "border-amber-500 bg-amber-600/20 text-amber-300"
                            : "border-slate-700 bg-slate-900/80 text-slate-400 hover:border-amber-500 hover:text-amber-300"
                        )}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                      {currentQuality && (
                        <span className="text-[10px] text-slate-500">
                          {currentQuality === "up"
                            ? "Marked as helpful."
                            : "Marked as needs work."}
                        </span>
                      )}
                      {selectedIsVoicemail && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                          <Voicemail className="h-3 w-3" />
                          Likely voicemail (heuristic)
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {selectedCall && (
                <div className="flex flex-col items-end gap-1 text-[10px] text-slate-500">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {formatDuration(
                        selectedCall.started_at,
                        selectedCall.ended_at
                      )}
                    </span>
                  </div>
                  <div>
                    To:{" "}
                    <span className="text-slate-300">
                      {selectedCall.to_number || "—"}
                    </span>
                  </div>
                  <div>
                    From:{" "}
                    <span className="text-slate-300">
                      {selectedCall.from_number || "—"}
                    </span>
                  </div>
                  {selectedCall.twilio_call_sid && (
                    <div className="text-[9px] text-slate-600">
                      Twilio SID: {selectedCall.twilio_call_sid}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {!selectedCall && (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  {loading
                    ? "Loading call details…"
                    : "Select a call from the left to view details."}
                </div>
              )}

              {selectedCall && (
                <>
                  {/* Recording playback if available in Atlas Storage */}
                  {selectedCall && recordingUrl && (
                    <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Voicemail className="h-3.5 w-3.5 text-slate-300" />
                        <h3 className="text-xs font-semibold text-slate-100">
                          Call recording
                        </h3>
                      </div>
                      <p className="text-[10px] text-slate-500 mb-2">
                        This audio is stored securely in Atlas (Supabase
                        Storage) and streamed via a signed URL.
                      </p>
                      <audio controls src={recordingUrl} className="mt-1 w-full" />
                    </section>
                  )}

                  {/* For older calls that only have a Twilio URL, show a note instead of a player */}
                  {selectedCall &&
                    !recordingUrl &&
                    selectedCall.recording_url && (
                      <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Voicemail className="h-3.5 w-3.5 text-slate-300" />
                          <h3 className="text-xs font-semibold text-slate-100">
                            Call recording (Twilio only)
                          </h3>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          This call&apos;s audio is stored only in Twilio for
                          now, so playback isn&apos;t available directly in
                          Atlas. New calls will be recorded and streamed from
                          Atlas automatically.
                        </p>
                      </section>
                    )}

                  {/* AI summary */}
                  <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileText className="h-3.5 w-3.5 text-emerald-300" />
                      <h3 className="text-xs font-semibold text-emerald-100">
                        AI summary
                      </h3>
                    </div>
                    <p className="text-[11px] leading-relaxed text-emerald-50/90 whitespace-pre-wrap">
                      {selectedCall.ai_summary ||
                        "No AI summary is available for this call yet."}
                    </p>
                  </section>

                  {/* Transcript */}
                  <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileText className="h-3.5 w-3.5 text-slate-300" />
                      <h3 className="text-xs font-semibold text-slate-100">
                        Transcript
                      </h3>
                    </div>
                    <div className="max-h-[50vh] overflow-y-auto rounded-lg bg-slate-950/80 px-3 py-2 text-[11px] leading-relaxed text-slate-100 whitespace-pre-wrap">
                      {selectedCall.transcript ||
                        "Transcript is not available for this call."}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      In later versions, Atlas will auto-tag key moments,
                      objections, and next actions directly from this
                      transcript.
                    </p>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Sales;
