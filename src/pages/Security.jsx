// FILE: src/pages/Security.jsx
// Purpose: Account Security Center for Atlas Command
// - Current session summary
// - Login Activity (last 5 logins from security_login_events, org-scoped via RLS)
// - Password change
// - REAL TOTP 2FA (Supabase MFA)
// - MFA backup codes (generate + count)
// - Security / Compliance status summary
// - Tenant Isolation "Security Center" (audit views + drilldown)
// - Recent security events (org_audit_events)
// - API keys placeholder
// - Known devices (device fingerprinting, "This device" tagging)

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Shield,
  KeyRound,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Smartphone,
  Lock,
  Database,
  Table as TableIcon,
  Eye,
  ListChecks,
  X,
  MapPin,
  Clock,
  ShieldCheck,
} from "lucide-react";
import {
  getCurrentDeviceFingerprint,
  getCurrentDeviceLabel,
} from "../lib/deviceFingerprint.js";

export default function SecurityPage() {
  const [session, setSession] = useState(null);

  // Recent security events (from org_audit_events)
  const [securityEvents, setSecurityEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Sessions (simple current-session view)
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessions, setSessions] = useState([]);

  // Login activity (from security_login_events, last 5)
  const [loginEvents, setLoginEvents] = useState([]);
  const [loadingLoginEvents, setLoadingLoginEvents] = useState(true);

  // Known devices
  const [knownDevices, setKnownDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState(null);
  const [currentFingerprint, setCurrentFingerprint] = useState(null);
  const [currentDeviceLabel, setCurrentDeviceLabel] = useState("This device");

  // Password change
  const [passwordNew, setPasswordNew] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  // API key placeholder
  const [apiKey, setApiKey] = useState("••••••••••••••••••••••••••");
  const [regeneratingKey, setRegeneratingKey] = useState(false);

  // TOTP MFA state
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaFactors, setMfaFactors] = useState([]); // existing TOTP factors
  const [mfaError, setMfaError] = useState(null);

  const [enrolling, setEnrolling] = useState(false);
  const [totpData, setTotpData] = useState(null); // { factorId, qrCode, secret, uri, challengeId, friendlyName }
  const [verificationCode, setVerificationCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [unenrollingId, setUnenrollingId] = useState(null);

  // Backup codes state
  const [backupCodesCount, setBackupCodesCount] = useState(null);
  const [loadingBackupCodes, setLoadingBackupCodes] = useState(false);
  const [generatingBackupCodes, setGeneratingBackupCodes] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState([]);
  const [backupError, setBackupError] = useState(null);

  // Security Center / Tenant Audit state
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState(null);
  const [auditTables, setAuditTables] = useState([]);
  const [auditPolicies, setAuditPolicies] = useState([]);
  const [auditViews, setAuditViews] = useState([]);
  const [auditFunctions, setAuditFunctions] = useState([]);

  // Drill-down modal state
  const [detail, setDetail] = useState(null); // { type, record }

  // ----- Helpers -----
  function cx(...a) {
    return a.filter(Boolean).join(" ");
  }

   
  
  useEffect(() => {
    async function loadSessions() {
      setLoadingSessions(true);
      const { data } = await supabase.auth.getSession();
      const currentSession = data?.session || null;

      setSession(currentSession); // <-- important

      if (currentSession) {
        setSessions([
          {
            id: currentSession.access_token,
            userAgent: navigator.userAgent,
            lastActive: new Date().toLocaleString(),
            current: true,
          },
        ]);
      } else {
        setSessions([]);
      }
      setLoadingSessions(false);
    }
    loadSessions();
  }, []);




  // Compute current browser fingerprint + label (mirrors Edge Function logic)
  useEffect(() => {
    let cancelled = false;

    async function loadFingerprint() {
      try {
        const fp = await getCurrentDeviceFingerprint();
        if (!cancelled) {
          setCurrentFingerprint(fp);
          setCurrentDeviceLabel(getCurrentDeviceLabel());
        }
      } catch (err) {
        console.error("[Security] Failed to compute device fingerprint", err);
      }
    }

    loadFingerprint();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load security activity (org_audit_events for this user)
  useEffect(() => {
    async function loadLogs() {
      if (!session?.user?.id) return;
      setLoadingEvents(true);

      try {
        // get org id via team_members RPC
        const { data: teamData, error: teamError } = await supabase.rpc(
          "rpc_team_members_for_current_org"
        );
        if (teamError || !teamData || teamData.length === 0) {
          setSecurityEvents([]);
          setLoadingEvents(false);
          return;
        }

        const orgId = teamData[0].org_id;

        const { data: logs, error: logsError } = await supabase
          .from("org_audit_events")
          .select("*")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(20);

        if (logsError) {
          console.error(logsError);
          setSecurityEvents([]);
        } else {
          setSecurityEvents(logs || []);
        }
      } finally {
        setLoadingEvents(false);
      }
    }
    loadLogs();
  }, [session]);

  // Load login activity (security_login_events for current org, last 5)
  useEffect(() => {
    async function loadLoginEvents() {
      if (!session) return;
      setLoadingLoginEvents(true);
      try {
        const { data, error } = await supabase
          .from("security_login_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(5);
        if (error) {
          console.error("[SecurityPage] Failed to load login events:", error);
          setLoginEvents([]);
        } else {
          setLoginEvents(data || []);
        }
      } finally {
        setLoadingLoginEvents(false);
      }
    }
    loadLoginEvents();
  }, [session]);

  // Load known devices from security_known_devices
  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    async function loadKnownDevices() {
      setDevicesLoading(true);
      setDevicesError(null);
      try {
      const { data, error } = await supabase
  .from("security_known_devices")
  .select(
    "id, email, device_label, device_fingerprint, last_ip, first_seen_at, last_seen_at"
  )
  .order("last_seen_at", { ascending: false });


        if (error) throw error;
        if (!cancelled) {
          setKnownDevices(data || []);
        }
      } catch (e) {
        console.error("[Security] Failed to load known devices", e);
        if (!cancelled) {
          setDevicesError("Failed to load known devices");
          setKnownDevices([]);
        }
      } finally {
        if (!cancelled) {
          setDevicesLoading(false);
        }
      }
    }

    loadKnownDevices();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // ---- TOTP MFA LOGIC ----

  const loadMfaFactors = async () => {
    if (!session) return;
    setMfaLoading(true);
    setMfaError(null);

    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;

      let totpFactors = data?.totp ?? [];

      // Auto-remove any factor that is stuck in non-verified / incomplete state
      for (const f of totpFactors) {
        if (f.status !== "verified") {
          console.log("Removing incomplete MFA factor:", f.id);
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }

      // Reload clean list after cleanup
      const { data: cleanData } = await supabase.auth.mfa.listFactors();
      totpFactors = cleanData?.totp ?? [];

      setMfaFactors(totpFactors);
    } catch (e) {
      console.error(e);
      setMfaError(e.message || "Failed to load 2FA factors.");
    } finally {
      setMfaLoading(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    loadMfaFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const startTotpEnrollment = async () => {
    setEnrolling(true);
    setMfaError(null);
    setTotpData(null);
    setVerificationCode("");
    try {
      // Use a unique friendly name per factor to avoid "already exists" error
      const friendlyName = `Atlas Authenticator ${new Date().toISOString()}`;

      // 1) Enroll a new TOTP factor
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName,
      });
      if (error) throw error;

      const { id, totp, friendly_name } = data;

      // 2) Create a challenge for that factor
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: id });
      if (challengeError) throw challengeError;

      setTotpData({
        factorId: id,
        qrCode: totp?.qr_code,
        secret: totp?.secret,
        uri: totp?.uri,
        challengeId: challenge.id,
        friendlyName: friendly_name,
      });
    } catch (e) {
      console.error(e);
      setMfaError(
        e.message ||
          "Failed to start 2FA enrollment. Check Supabase MFA configuration."
      );
    } finally {
      setEnrolling(false);
    }
  };

  const verifyTotpEnrollment = async () => {
    if (!totpData?.factorId || !totpData?.challengeId) return;
    if (!verificationCode.trim()) {
      alert("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setVerifying(true);
    setMfaError(null);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: totpData.factorId,
        challengeId: totpData.challengeId,
        code: verificationCode.trim(),
      });
      if (error) throw error;

      // Success: clear state and reload factors
      setVerificationCode("");
      setTotpData(null);
      await loadMfaFactors();
      alert("Two-factor authentication has been enabled for your account.");
    } catch (e) {
      console.error(e);
      setMfaError(
        e.message ||
          "Failed to verify code. Make sure the code is correct and try again."
      );
    } finally {
      setVerifying(false);
    }
  };

  const cancelTotpEnrollment = () => {
    setTotpData(null);
    setVerificationCode("");
    setMfaError(null);
  };

  const unenrollFactor = async (factorId) => {
    const confirmed = window.confirm(
      "Disable this 2FA factor? You will no longer be prompted for a second code on login."
    );
    if (!confirmed) return;

    setUnenrollingId(factorId);
    setMfaError(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      await loadMfaFactors();
      alert("Two-factor authentication factor disabled.");
    } catch (e) {
      console.error(e);
      setMfaError(e.message || "Failed to disable 2FA factor.");
    } finally {
      setUnenrollingId(null);
    }
  };

  // ---- BACKUP CODES LOGIC ----

  const loadBackupCodesMeta = async () => {
    if (!session) return;
    setLoadingBackupCodes(true);
    setBackupError(null);
    try {
      const { data, error } = await supabase
        .from("mfa_backup_codes")
        .select("id, used_at");
      if (error) throw error;

      const unused = (data || []).filter((row) => !row.used_at).length;
      setBackupCodesCount(unused);
    } catch (e) {
      console.error(e);
      setBackupError(e.message || "Failed to load backup codes.");
      setBackupCodesCount(null);
    } finally {
      setLoadingBackupCodes(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    loadBackupCodesMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const handleGenerateBackupCodes = async () => {
    setBackupError(null);
    setGeneratingBackupCodes(true);
    setGeneratedCodes([]);

    try {
      const { data, error } = await supabase.rpc("rpc_generate_backup_codes", {
        p_count: 10,
      });
      if (error) throw error;

      const codes = (data || []).map((row) => row.code);
      setGeneratedCodes(codes);
      setBackupCodesCount(codes.length);
      alert(
        "New backup codes generated.\n\n" +
          "They are now shown on the page. Save them somewhere safe.\n" +
          "Each code can only be used once."
      );
    } catch (e) {
      console.error(e);
      setBackupError(
        e.message || "Failed to generate backup codes. Please try again."
      );
    } finally {
      setGeneratingBackupCodes(false);
    }
  };

  // Password change handler
  const handleChangePassword = async () => {
    if (!passwordNew.trim()) {
      alert("Enter a new password.");
      return;
    }

    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordNew.trim(),
      });
      if (error) throw error;

      setPasswordNew("");
      alert("Password updated successfully.");
    } catch (e) {
      alert(e.message || "Failed to update password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const regenerateAPIKey = async () => {
    setRegeneratingKey(true);
    setTimeout(() => {
      setApiKey("NEW_API_KEY_" + Math.random().toString(36).slice(2));
      setRegeneratingKey(false);
    }, 800);
  };

  // ---- SECURITY CENTER / TENANT AUDIT ----
  const loadAudit = async () => {
    if (!session) return;
    setAuditLoading(true);
    setAuditError(null);

    try {
      const [tablesRes, policiesRes, viewsRes, funcsRes] = await Promise.all([
        supabase.from("v_tenant_audit_tables").select("*"),
        supabase.from("v_tenant_audit_policies").select("*"),
        supabase.from("v_tenant_audit_views_sensitive").select("*"),
        supabase.from("v_tenant_audit_functions").select("*"),
      ]);

      if (tablesRes.error) throw tablesRes.error;
      if (policiesRes.error) throw policiesRes.error;
      if (viewsRes.error) throw viewsRes.error;
      if (funcsRes.error) throw funcsRes.error;

      setAuditTables(tablesRes.data || []);
      setAuditPolicies(policiesRes.data || []);
      setAuditViews(viewsRes.data || []);
      setAuditFunctions(funcsRes.data || []);
    } catch (e) {
      console.error("[SecurityCenter] Audit load error:", e);
      setAuditError(e.message || "Failed to load tenant audit data.");
      setAuditTables([]);
      setAuditPolicies([]);
      setAuditViews([]);
      setAuditFunctions([]);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    loadAudit();
  }, [session]);

  if (!session) {
    return (
      <div className="p-8 text-center text-gray-300">
        <Loader2 className="animate-spin mx-auto mb-2" />
        Loading your session…
      </div>
    );
  }

  const hasTotpEnabled = (mfaFactors || []).some(
    (f) => f.status === "verified"
  );

  // Static flags for demo/compliance (we've configured these via SQL already)
  const tenantRlsOn = true;
  const aiRlsOn = true;

  // Derived audit metrics
  const riskyTables = auditTables.filter(
    (t) => !t.rls_enabled || !t.has_org_id
  );
  const riskyPolicies = auditPolicies.filter(
    (p) => p.mentions_org_scope === false
  );
  const riskyViews = auditViews.filter((v) => v.mentions_org_scope === false);
  const definerFunctions = auditFunctions.filter(
    (f) => f.is_security_definer === true
  );

  return (
    <div className="p-8 text-gray-200 space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-pink-400" />
          <div>
            <h1 className="text-3xl font-semibold">Security</h1>
            <p className="text-sm text-gray-400">
              Account protection, tenant isolation, and audit signals for Atlas
              Command.
            </p>
          </div>
        </div>
      </div>

      {/* Security / Compliance Status Strip */}
      <section className="border border-slate-700 rounded-2xl p-4 bg-slate-950/60">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">
          Security &amp; Compliance Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          {/* MFA Status */}
          <div className="border border-slate-700 rounded-xl px-3 py-2 bg-slate-900/80 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400 uppercase tracking-wide">
                MFA (TOTP)
              </span>
              <span
                className={
                  hasTotpEnabled
                    ? "px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/50 text-emerald-300 border border-emerald-600/70"
                    : "px-2 py-0.5 rounded-full text-[10px] bg-yellow-900/40 text-yellow-200 border border-yellow-600/70"
                }
              >
                {hasTotpEnabled ? "ENABLED" : "RECOMMENDED"}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {hasTotpEnabled
                ? "Authenticator app required at sign-in."
                : "Turn on 2FA to protect your account."}
            </p>
          </div>

          {/* Backup Codes */}
          <div className="border border-slate-700 rounded-xl px-3 py-2 bg-slate-900/80 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400 uppercase tracking-wide">
                Backup Codes
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-900/40 text-blue-200 border border-blue-600/70">
                {loadingBackupCodes
                  ? "CHECKING…"
                  : backupCodesCount && backupCodesCount > 0
                  ? `${backupCodesCount} ACTIVE`
                  : "NONE"}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {loadingBackupCodes
                ? "Checking your backup code status…"
                : backupCodesCount === null
                ? "Status unavailable. Generate new codes below."
                : backupCodesCount === 0
                ? "No unused codes. Generate a fresh set."
                : "You have one-time codes for emergency access."}
            </p>
          </div>

          {/* Tenant RLS */}
          <div className="border border-slate-700 rounded-xl px-3 py-2 bg-slate-900/80 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400 uppercase tracking-wide">
                Tenant Isolation
              </span>
              <span
                className={
                  tenantRlsOn
                    ? "px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/50 text-emerald-300 border border-emerald-600/70"
                    : "px-2 py-0.5 rounded-full text-[10px] bg-red-900/40 text-red-200 border border-red-600/70"
                }
              >
                {tenantRlsOn ? "ON" : "OFF"}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              Core operational data is scoped to your organization via RLS.
            </p>
          </div>

          {/* AI Data RLS */}
          <div className="border border-slate-700 rounded-xl px-3 py-2 bg-slate-900/80 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400 uppercase tracking-wide">
                AI Data Isolation
              </span>
              <span
                className={
                  aiRlsOn
                    ? "px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/50 text-emerald-300 border border-emerald-600/70"
                    : "px-2 py-0.5 rounded-full text-[10px] bg-red-900/40 text-red-200 border border-red-600/70"
                }
              >
                {aiRlsOn ? "ON" : "OFF"}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              AI training, feedback &amp; predictions are isolated per org via
              RLS.
            </p>
          </div>
        </div>
      </section>

      {/* SECURITY CENTER / TENANT AUDIT */}
      <section className="border border-purple-600/40 rounded-2xl p-5 bg-black/40">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-purple-300" />
            <div>
              <h2 className="text-lg font-semibold">Security Center</h2>
              <p className="text-xs text-gray-400">
                Live audit of tenant isolation: tables, views, policies, and RLS
                bypass risks.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadAudit}
            disabled={auditLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-purple-500/60 bg-purple-900/30 hover:bg-purple-900/50 text-xs disabled:opacity-50"
          >
            <RefreshCw
              className={cx("w-4 h-4", auditLoading && "animate-spin")}
            />
            Refresh Audit
          </button>
        </div>

        {auditError && (
          <div className="border border-red-500/60 bg-red-900/30 text-red-200 rounded-xl px-3 py-2 mb-3 flex gap-2 items-start text-xs">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <span>{auditError}</span>
          </div>
        )}

        {/* Summary Pills */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 text-xs">
          <SummaryPill
            icon={TableIcon}
            label="Tables needing attention"
            value={riskyTables.length}
            tone={riskyTables.length === 0 ? "good" : "warn"}
          />
          <SummaryPill
            icon={ListChecks}
            label="Policies w/out org scope"
            value={riskyPolicies.length}
            tone={riskyPolicies.length === 0 ? "good" : "warn"}
          />
          <SummaryPill
            icon={Eye}
            label="Sensitive views w/out org scope"
            value={riskyViews.length}
            tone={riskyViews.length === 0 ? "good" : "warn"}
          />
          <SummaryPill
            icon={AlertTriangle}
            label="SECURITY DEFINER functions"
            value={definerFunctions.length}
            tone={definerFunctions.length === 0 ? "good" : "danger"}
          />
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 text-xs">
          {/* Risky tables */}
          <div className="border border-slate-700 rounded-xl p-3 bg-slate-950/60">
            <div className="flex items-center gap-2 mb-2">
              <TableIcon className="w-4 h-4 text-slate-200" />
              <h3 className="font-semibold text-sm">Tables</h3>
            </div>
            {auditLoading ? (
              <div className="flex items-center gap-2 text-gray-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading table audit…
              </div>
            ) : riskyTables.length === 0 ? (
              <p className="text-gray-400">All tables have RLS and org_id.</p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {riskyTables.slice(0, 8).map((t) => (
                  <button
                    key={`${t.schema_name}.${t.table_name}`}
                    type="button"
                    onClick={() => setDetail({ type: "table", record: t })}
                    className="w-full text-left border border-slate-800 rounded-lg px-2 py-1 bg-slate-900/70 hover:bg-slate-800/80 transition-colors"
                  >
                    <p className="font-mono text-[11px] text-gray-100">
                      {t.schema_name}.{t.table_name}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      RLS:{" "}
                      <span
                        className={
                          t.rls_enabled ? "text-emerald-300" : "text-red-300"
                        }
                      >
                        {t.rls_enabled ? "ON" : "OFF"}
                      </span>{" "}
                      • org_id:{" "}
                      <span
                        className={
                          t.has_org_id ? "text-emerald-300" : "text-red-300"
                        }
                      >
                        {t.has_org_id ? "YES" : "NO"}
                      </span>
                    </p>
                  </button>
                ))}
                {riskyTables.length > 8 && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    + {riskyTables.length - 8} more (see{" "}
                    <span className="font-mono">v_tenant_audit_tables</span> in
                    SQL).
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Risky views */}
          <div className="border border-slate-700 rounded-xl p-3 bg-slate-950/60">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="w-4 h-4 text-slate-200" />
              <h3 className="font-semibold text-sm">Sensitive Views</h3>
            </div>
            {auditLoading ? (
              <div className="flex items-center gap-2 text-gray-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading view audit…
              </div>
            ) : riskyViews.length === 0 ? (
              <p className="text-gray-400">
                All sensitive views mention org scope.
              </p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {riskyViews.slice(0, 8).map((v) => (
                  <button
                    key={`${v.schemaname}.${v.viewname}`}
                    type="button"
                    onClick={() => setDetail({ type: "view", record: v })}
                    className="w-full text-left border border-slate-800 rounded-lg px-2 py-1 bg-slate-900/70 hover:bg-slate-800/80 transition-colors"
                  >
                    <p className="font-mono text-[11px] text-gray-100">
                      {v.schemaname}.{v.viewname}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      Does not reference{" "}
                      <span className="font-mono">org_id</span> or{" "}
                      <span className="font-mono">current_org_id()</span>.
                    </p>
                  </button>
                ))}
                {riskyViews.length > 8 && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    + {riskyViews.length - 8} more (see{" "}
                    <span className="font-mono">
                      v_tenant_audit_views_sensitive
                    </span>
                    ).
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Policies */}
          <div className="border border-slate-700 rounded-xl p-3 bg-slate-950/60">
            <div className="flex items-center gap-2 mb-2">
              <ListChecks className="w-4 h-4 text-slate-200" />
              <h3 className="font-semibold text-sm">Policies</h3>
            </div>
            {auditLoading ? (
              <div className="flex items-center gap-2 text-gray-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading policy audit…
              </div>
            ) : riskyPolicies.length === 0 ? (
              <p className="text-gray-400">
                All policies mention org scoping.
              </p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {riskyPolicies.slice(0, 8).map((p) => (
                  <button
                    key={`${p.schemaname}.${p.tablename}.${p.policyname}`}
                    type="button"
                    onClick={() => setDetail({ type: "policy", record: p })}
                    className="w-full text-left border border-slate-800 rounded-lg px-2 py-1 bg-slate-900/70 hover:bg-slate-800/80 transition-colors"
                  >
                    <p className="font-mono text-[11px] text-gray-100">
                      {p.schemaname}.{p.tablename}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {p.policyname} • {p.cmd}
                    </p>
                  </button>
                ))}
                {riskyPolicies.length > 8 && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    + {riskyPolicies.length - 8} more (see{" "}
                    <span className="font-mono">v_tenant_audit_policies</span>
                    ).
                  </p>
                )}
              </div>
            )}
          </div>

          {/* SECURITY DEFINER functions */}
          <div className="border border-slate-700 rounded-xl p-3 bg-slate-950/60">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-slate-200" />
              <h3 className="font-semibold text-sm">
                Security Definer Functions
              </h3>
            </div>
            {auditLoading ? (
              <div className="flex items-center gap-2 text-gray-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading function audit…
              </div>
            ) : definerFunctions.length === 0 ? (
              <p className="text-gray-400">
                No <span className="font-mono">SECURITY DEFINER</span> functions
                in public schema.
              </p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {definerFunctions.slice(0, 8).map((f) => (
                  <button
                    key={`${f.schema_name}.${f.function_name}`}
                    type="button"
                    onClick={() => setDetail({ type: "function", record: f })}
                    className="w-full text-left border border-slate-800 rounded-lg px-2 py-1 bg-slate-900/70 hover:bg-slate-800/80 transition-colors"
                  >
                    <p className="font-mono text-[11px] text-gray-100">
                      {f.schema_name}.{f.function_name}()
                    </p>
                    <p className="text-[10px] text-red-300">
                      SECURITY DEFINER — review in{" "}
                      <span className="font-mono">
                        v_tenant_audit_functions
                      </span>
                      .
                    </p>
                  </button>
                ))}
                {definerFunctions.length > 8 && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    + {definerFunctions.length - 8} more (see{" "}
                    <span className="font-mono">
                      v_tenant_audit_functions
                    </span>
                    ).
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="mt-2 text-[10px] text-gray-500">
          This audit runs entirely through the anon Supabase client and RLS.
          For cross-checking, you can also query the views directly in the
          Supabase SQL editor:
          <span className="font-mono">
            {" "}
            v_tenant_audit_tables, v_tenant_audit_policies,
            v_tenant_audit_views_sensitive, v_tenant_audit_functions
          </span>
          .
        </p>
      </section>

      {/* Current Session */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <h2 className="text-xl font-semibold mb-4">Current Session</h2>
        <div className="border border-green-800/50 bg-green-900/20 rounded-xl p-4">
          <p className="font-medium">Active Now (This Device)</p>
          <p className="text-gray-400 text-sm">{navigator.userAgent}</p>
          <p className="text-gray-500 text-xs mt-1">
            Last active: {new Date().toLocaleString()}
          </p>
          <p className="text-gray-500 text-xs mt-2">
            Signed in as: <strong>{session.user.email}</strong>
          </p>
          <p className="text-gray-500 text-xs">User ID: {session.user.id}</p>
        </div>
      </section>

      {/* Known Devices */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <div className="flex items-center justify-between mb-3">
          <div className="flex flex-col">
            <h2 className="text-xl font-semibold">Known Devices</h2>
            <p className="text-xs text-gray-400">
              Devices that have been used to sign in to this account.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400">Current device</p>
            <p className="text-[11px] text-gray-300 font-mono max-w-xs truncate">
              {currentDeviceLabel || "This device"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 shadow-sm shadow-black/40">
          {devicesLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading devices…
            </div>
          ) : devicesError ? (
            <div className="text-sm text-red-400">{devicesError}</div>
          ) : knownDevices.length === 0 ? (
            <div className="text-sm text-zinc-400">
              No devices recorded yet. New logins will appear here.
            </div>
          ) : (
            <ul className="space-y-3">
              {knownDevices.map((dev) => {
                const isThisDevice =
                  currentFingerprint &&
                  dev.device_fingerprint === currentFingerprint;

                return (
                  <li
                    key={dev.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-100 truncate">
                          {dev.device_label || "Unknown device"}
                        </p>
                        {isThisDevice && (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 border border-emerald-500/30">
                            This device
                          </span>
                        )}
                        {dev.last_mfa_used && (
                          <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-400 border border-sky-500/30">
                            MFA used
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-zinc-400 break-all">
                        IP:{" "}
                        <span className="font-mono text-zinc-300">
                          {dev.last_ip || "Unknown"}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        First seen:{" "}
                        {dev.first_seen_at
                          ? new Date(dev.first_seen_at).toLocaleString()
                          : "Unknown"}
                        {" • "}
                        Last seen:{" "}
                        {dev.last_seen_at
                          ? new Date(dev.last_seen_at).toLocaleString()
                          : "Unknown"}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[11px] text-zinc-500">
                        {dev.email}
                      </span>
                      {/* Future: trust / revoke controls */}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Login Activity (last 5 logins) */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-300" />
            <h2 className="text-xl font-semibold">Login Activity</h2>
          </div>
          <p className="text-xs text-gray-400">
            Last 5 sign-ins for your organization (org-scoped via RLS).
          </p>
        </div>

        {loadingLoginEvents ? (
          <div className="text-center text-gray-300 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
            Loading login activity…
          </div>
        ) : loginEvents.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No login events recorded yet. Once users sign in, their login
            history will appear here.
          </p>
        ) : (
          <div className="space-y-3">
            {loginEvents.map((e) => {
              const locationParts = [e.city, e.region, e.country].filter(
                Boolean
              );
              const location =
                locationParts.length > 0 ? locationParts.join(", ") : null;
              const userAgent = e.user_agent || "Unknown device";
              const ip = e.ip_address || "Unknown IP";

              return (
                <div
                  key={e.id}
                  className="border border-gray-700 rounded-xl p-4 bg-gray-800/30 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-100">
                      {e.email || "Unknown user"}
                    </p>
                    <p className="text-xs text-gray-400">
                      IP: <span className="font-mono">{ip}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      Device:{" "}
                      <span className="break-all">
                        {userAgent.length > 140
                          ? userAgent.slice(0, 140) + "…"
                          : userAgent}
                      </span>
                    </p>
                    {location && (
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-emerald-300" />
                        {location}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-start md:items-end gap-2">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Clock className="w-4 h-4" />
                      <span>
                        {e.created_at
                          ? new Date(e.created_at).toLocaleString()
                          : "Unknown time"}
                      </span>
                    </div>
                    <span
                      className={cx(
                        "inline-flex items-center justify-center px-3 py-1 rounded-full text-[11px] border",
                        e.mfa_used
                          ? "bg-emerald-900/40 border-emerald-600/70 text-emerald-200"
                          : "bg-amber-900/30 border-amber-600/70 text-amber-200"
                      )}
                    >
                      {e.mfa_used ? "MFA USED" : "NO MFA"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Password Change */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <h2 className="text-xl font-semibold mb-4">Password</h2>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-500">New Password</label>
            <input
              type="password"
              className="w-full p-2 mt-1 rounded-lg bg-gray-900 border border-gray-700 text-gray-100"
              value={passwordNew}
              onChange={(e) => setPasswordNew(e.target.value)}
            />
          </div>
          <button
            onClick={handleChangePassword}
            disabled={passwordSaving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
          >
            {passwordSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                Saving…
              </>
            ) : (
              "Update Password"
            )}
          </button>
        </div>
      </section>

      {/* REAL TOTP 2FA */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-300" />
            <h2 className="text-xl font-semibold">
              Two-Factor Authentication
            </h2>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded-lg ${
              hasTotpEnabled
                ? "bg-green-900/40 text-green-300 border border-green-700/70"
                : "bg-yellow-900/40 text-yellow-300 border border-yellow-700/70"
            }`}
          >
            {hasTotpEnabled ? "Enabled" : "Recommended"}
          </span>
        </div>

        <p className="text-sm text-gray-400 mb-3">
          Protect your account with a 6-digit code from an authenticator app
          (Microsoft Authenticator, Google Authenticator, 1Password, etc.).
        </p>

        {mfaError && (
          <div className="border border-red-500/60 bg-red-500/10 text-red-200 rounded-xl px-3 py-2 mb-3 flex gap-2 items-start text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <span>{mfaError}</span>
          </div>
        )}

        {/* Existing factors list */}
        {mfaLoading ? (
          <div className="text-gray-300 text-sm flex items-center gap-2 mb-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading 2FA status…
          </div>
        ) : mfaFactors.length > 0 ? (
          <div className="mb-4">
            <p className="text-sm text-gray-300 mb-2">
              Active TOTP factors ({mfaFactors.length}):
            </p>
            <div className="space-y-2">
              {mfaFactors.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between border border-gray-700 rounded-lg px-3 py-2 bg-gray-800/40"
                >
                  <div>
                    <p className="text-sm text-gray-100">
                      {f.friendly_name || "Authenticator app"}
                    </p>
                    <p className="text-xs text-gray-500">
                      Status: {f.status} • Factor ID: {f.id.slice(0, 8)}…
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={unenrollingId === f.id}
                    onClick={() => unenrollFactor(f.id)}
                    className="text-xs px-3 py-1 rounded-md border border-red-500/70 text-red-300 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1"
                  >
                    {unenrollingId === f.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Lock className="w-3 h-3" />
                    )}
                    Disable
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-4">
            You have not enabled two-factor authentication yet.
          </p>
        )}

        {/* Enrollment flow UI */}
        {totpData ? (
          <div className="mt-4 border border-blue-700/70 bg-blue-900/20 rounded-xl p-4 space-y-3">
            <p className="font-medium text-sm text-blue-100">
              Step 1: Scan the QR code in your authenticator app
            </p>
            <div className="flex flex-col md:flex-row gap-4 md:items-center">
              <div className="bg-white p-2 rounded-lg inline-flex items-center justify-center">
                {/* Supabase returns qr_code as a URL – use it directly */}
                <img
                  src={totpData.qrCode}
                  alt={
                    totpData.uri ||
                    "Scan this QR code with your authenticator app"
                  }
                  className="w-40 h-40 object-contain"
                />
              </div>
              <div className="text-xs text-gray-200 space-y-2">
                <p className="text-gray-300">
                  If you can&apos;t scan the code, enter this key manually in
                  your app:
                </p>
                <div className="font-mono bg-gray-900/80 border border-gray-700 rounded-md px-2 py-1 inline-block">
                  {totpData.secret}
                </div>
                <p className="text-gray-400">
                  Make sure the app is set to{" "}
                  <strong>Time-based (TOTP)</strong>.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <p className="font-medium text-sm text-blue-100">
                Step 2: Enter the 6-digit code from your authenticator app
              </p>
              <div className="flex flex-col md:flex-row gap-2 md:items-center">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring focus:ring-blue-500/50"
                />
                <button
                  type="button"
                  onClick={verifyTotpEnrollment}
                  disabled={verifying}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm flex items-center gap-2"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    "Enable 2FA"
                  )}
                </button>
                <button
                  type="button"
                  onClick={cancelTotpEnrollment}
                  disabled={verifying}
                  className="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800/70"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={startTotpEnrollment}
            disabled={enrolling}
            className="mt-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm flex items-center gap-2"
          >
            {enrolling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting setup…
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                {hasTotpEnabled ? "Add another 2FA device" : "Enable 2FA"}
              </>
            )}
          </button>
        )}
      </section>

      {/* MFA Backup Codes */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <h2 className="text-xl font-semibold mb-2">Backup Codes</h2>
        <p className="text-sm text-gray-400 mb-3">
          Use backup codes if you lose access to your authenticator app. Each
          backup code can be used <span className="font-semibold">once</span> to
          finish signing in.
        </p>

        {backupError && (
          <div className="border border-red-500/60 bg-red-500/10 text-red-200 rounded-xl px-3 py-2 mb-3 flex gap-2 items-start text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <span>{backupError}</span>
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-300">
            {loadingBackupCodes ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking how many backup codes you have…
              </span>
            ) : backupCodesCount === null ? (
              "Backup codes status unavailable."
            ) : backupCodesCount === 0 ? (
              "You currently have no unused backup codes."
            ) : (
              `You currently have ${backupCodesCount} unused backup codes.`
            )}
          </p>
          <button
            type="button"
            onClick={handleGenerateBackupCodes}
            disabled={generatingBackupCodes}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs flex items-center gap-2"
          >
            {generatingBackupCodes ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate New Codes"
            )}
          </button>
        </div>

        {generatedCodes.length > 0 && (
          <div className="mt-3 border border-blue-700/70 bg-blue-900/20 rounded-xl p-4">
            <p className="text-xs text-blue-100 mb-2">
              These codes were just generated.{" "}
              <span className="font-semibold">
                Save them now — you won&apos;t be able to see them again after
                leaving this page.
              </span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-sm text-gray-100">
              {generatedCodes.map((c) => (
                <div
                  key={c}
                  className="px-2 py-1 rounded-md bg-gray-900 border border-gray-700 tracking-[0.2em]"
                >
                  {c}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Recent Security Activity */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>

        {loadingEvents ? (
          <div className="text-center text-gray-300">
            <Loader2 className="animate-spin mx-auto mb-2" />
            Loading activity…
          </div>
        ) : securityEvents.length === 0 ? (
          <p className="text-gray-500 text-sm">No recent security events.</p>
        ) : (
          <div className="space-y-3">
            {securityEvents.map((e) => (
              <div
                key={e.id}
                className="border border-gray-700 rounded-xl p-4 bg-gray-800/30"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium capitalize text-sm">
                      {e.event_type.replace(/_/g, " ")}
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      Details: {JSON.stringify(e.details)}
                    </p>
                  </div>
                  <div className="text-gray-400 text-xs">
                    {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* API Key Section */}
      <section className="border border-gray-700 rounded-2xl p-6 bg-gray-900/40">
        <h2 className="text-xl font-semibold mb-4">API Keys</h2>
        <div className="border border-gray-700 rounded-lg bg-gray-800/30 px-4 py-3 flex items-center justify-between">
          <span className="text-sm">
            {apiKey.substring(0, 8) + "••••••••••••••"}
          </span>
          <button
            onClick={regenerateAPIKey}
            disabled={regeneratingKey}
            className="text-xs px-3 py-1 rounded-md border border-blue-500/70 bg-blue-600/20 hover:bg-blue-700/20 disabled:opacity-50 flex items-center gap-1"
          >
            {regeneratingKey ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Regenerate
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          For beta this key is just a placeholder. Later we&apos;ll move this to
          real org-level API keys stored in the database.
        </p>
      </section>

      {/* Drill-down modal */}
      <DetailModal detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/** Small pill for Security Center summary row */
function SummaryPill({ icon: Icon, label, value, tone = "neutral" }) {
  let border = "border-slate-700";
  let bg = "bg-slate-900/70";
  let text = "text-slate-200";

  if (tone === "good") {
    border = "border-emerald-600/70";
    bg = "bg-emerald-900/30";
    text = "text-emerald-200";
  } else if (tone === "warn") {
    border = "border-amber-600/70";
    bg = "bg-amber-900/30";
    text = "text-amber-200";
  } else if (tone === "danger") {
    border = "border-rose-600/70";
    bg = "bg-rose-900/30";
    text = "text-rose-200";
  }

  return (
    <div
      className={`rounded-xl border ${border} ${bg} px-3 py-2 flex items-center justify-between`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/40">
          <Icon className={`w-3.5 h-3.5 ${text}`} />
        </span>
        <span className="text-[11px] text-gray-300">{label}</span>
      </div>
      <span className={`text-sm font-semibold ${text}`}>{value}</span>
    </div>
  );
}

/** Drill-down modal for tables/views/policies/functions */
function DetailModal({ detail, onClose }) {
  if (!detail) return null;
  const { type, record } = detail || {};

  const titleMap = {
    table: "Table details",
    view: "View details",
    policy: "Policy details",
    function: "Function details",
  };

  const title = titleMap[type] || "Details";

  // Safely stringify with 2-space indent, truncated
  let rawJson = "";
  try {
    rawJson = JSON.stringify(record || {}, null, 2);
    if (rawJson.length > 4000) {
      rawJson = rawJson.slice(0, 4000) + "\n… (truncated)";
    }
  } catch {
    rawJson = "Unable to render record JSON.";
  }

  // Helper fields per type
  const lines = [];
  if (type === "table") {
    lines.push(
      `Name: ${record?.schema_name || "?"}.${record?.table_name || "?"}`
    );
    lines.push(`RLS enabled: ${String(record?.rls_enabled)}`);
    lines.push(`Has org_id: ${String(record?.has_org_id)}`);
  } else if (type === "view") {
    lines.push(
      `Name: ${record?.schemaname || "?"}.${record?.viewname || "?"}`
    );
    lines.push(`Mentions org scope: ${String(record?.mentions_org_scope)}`);
  } else if (type === "policy") {
    lines.push(
      `Table: ${record?.schemaname || "?"}.${record?.tablename || "?"}`
    );
    lines.push(`Policy: ${record?.policyname || "?"}`);
    lines.push(`Command: ${record?.cmd || "?"}`);
    if (record?.roles) {
      lines.push(`Roles: ${record.roles}`);
    }
  } else if (type === "function") {
    lines.push(
      `Name: ${record?.schema_name || "?"}.${record?.function_name || "?"}()`
    );
    lines.push(`SECURITY DEFINER: ${String(record?.is_security_definer)}`);
  }

  // Possible long text fields to surface explicitly
  const usingExpr = record?.using_expression || record?.usingclause;
  const checkExpr = record?.with_check_expression || record?.checkclause;
  const definition = record?.definition || record?.prosrc || null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
            <p className="text-[11px] text-gray-400">
              Copy/paste into Supabase SQL editor to patch RLS / org scope.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-800 text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs text-gray-100">
          {lines.length > 0 && (
            <div className="space-y-0.5">
              {lines.map((l, idx) => (
                <p key={idx}>{l}</p>
              ))}
            </div>
          )}

          {type === "policy" && (usingExpr || checkExpr) && (
            <div className="mt-3 space-y-2">
              {usingExpr && (
                <div>
                  <p className="text-[11px] text-gray-400 mb-1">
                    USING expression
                  </p>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-black/70 border border-slate-800 p-2 text-[11px]">
                    {usingExpr}
                  </pre>
                </div>
              )}
              {checkExpr && (
                <div>
                  <p className="text-[11px] text-gray-400 mb-1">
                    WITH CHECK expression
                  </p>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-black/70 border border-slate-800 p-2 text-[11px]">
                    {checkExpr}
                  </pre>
                </div>
              )}
            </div>
          )}

          {definition && (
            <div className="mt-3">
              <p className="text-[11px] text-gray-400 mb-1">Definition</p>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-black/70 border border-slate-800 p-2 text-[11px]">
                {definition.length > 4000
                  ? definition.slice(0, 4000) + "\n… (truncated)"
                  : definition}
              </pre>
            </div>
          )}

          {/* Raw JSON for anything else / quick copy */}
          <div className="mt-3">
            <p className="text-[11px] text-gray-400 mb-1">
              Raw record (for debugging)
            </p>
            <pre className="whitespace-pre overflow-x-auto rounded-lg bg-black/70 border border-slate-800 p-2 text-[11px]">
              {rawJson}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-[11px] text-gray-200 hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
