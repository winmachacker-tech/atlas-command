import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Save,
  Loader2,
  Shield,
  Building2,
  Palette,
  Bell,
  PlugZap,
  Users,
  Wrench,
  Database,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import RenderGuard from "../components/RenderGuard.jsx"; // keep this; non-destructive wrapper

/**
 * Settings.jsx — Enterprise-safe scaffold
 * -------------------------------------------------------------
 * Goals
 * 1) Non-destructive: doesn't remove existing features; drop-in safe.
 * 2) Crash-resistant: guarded by <RenderGuard/>; failures don't break app.
 * 3) Extensible: clear sections + local state; API calls are isolated.
 * 4) Minimal deps: React + lucide + supabase. No new libraries.
 * 5) Meant to evolve: TODO hooks marked; wire up gradually.
 */

// ---- helpers --------------------------------------------------------------
function Section({ icon: Icon, title, desc, children, right = null }) {
  return (
    <section className="rounded-2xl border border-neutral-200/70 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5"><Icon className="size-5 opacity-80" /></div>
          <div>
            <h3 className="text-base sm:text-lg font-semibold tracking-tight">{title}</h3>
            {desc && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1 max-w-prose">{desc}</p>
            )}
          </div>
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-3 border-b last:border-b-0 border-neutral-200/70 dark:border-neutral-800">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-neutral-500 mt-0.5">{hint}</div>}
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">{children}</div>
    </div>
  );
}

function Button({ children, className = "", loading = false, ...rest }) {
  return (
    <button
      {...rest}
      disabled={loading || rest.disabled}
      className={
        "inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-60 " +
        className
      }
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

function PrimaryButton({ children, loading = false, ...rest }) {
  return (
    <Button
      {...rest}
      loading={loading}
      className="bg-black text-white hover:bg-black/90 border-transparent"
    >
      {children}
    </Button>
  );
}

// safe parse/merge helpers
const BOOL = (v, d = false) => (typeof v === "boolean" ? v : d);
const STR = (v, d = "") => (typeof v === "string" ? v : d);

// ---- component ------------------------------------------------------------
export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // Single source of truth for form state; you can split later by section
  const [form, setForm] = useState({
    // Organization
    org_name: "",
    timezone: "America/Los_Angeles",
    phone_format: "+1 (###) ###-####",
    default_driver_pay_mi: 0.85, // Mark's current assumption

    // Appearance
    theme: "system", // system | light | dark
    compact_density: false,

    // Notifications
    notify_dispatch_email: true,
    notify_dispatch_sms: false,
    daily_digest_hour: 7,

    // Security
    require_2fa: false,
    session_timeout_min: 480,

    // Integrations (placeholder; never show secrets in full)
    webhooks_enabled: false,
    webhook_url: "",
    api_tokens_issued: 0,

    // Ops rules
    at_risk_threshold_hours: 2,
    problem_escalation_minutes: 30,
  });

  // derived display
  const themeLabel = useMemo(() => {
    return form.theme === "system" ? "Follow device" : form.theme;
  }, [form.theme]);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      setLoading(true);
      setErrorMsg("");
      setOkMsg("");

      try {
        // 1) Attempt fetch org-level settings; keep this resilient.
        const { data, error, status } = await supabase
          .from("org_settings")
          .select("*")
          .eq("org_id", "default") // TODO: replace with your real org_id
          .single();

        if (error && status !== 406) throw error;
        if (data) {
          setForm((prev) => ({
            ...prev,
            org_name: STR(data.org_name, prev.org_name),
            timezone: STR(data.timezone, prev.timezone),
            phone_format: STR(data.phone_format, prev.phone_format),
            default_driver_pay_mi: Number(data.default_driver_pay_mi ?? prev.default_driver_pay_mi),
            theme: STR(data.theme, prev.theme),
            compact_density: BOOL(data.compact_density, prev.compact_density),
            notify_dispatch_email: BOOL(data.notify_dispatch_email, prev.notify_dispatch_email),
            notify_dispatch_sms: BOOL(data.notify_dispatch_sms, prev.notify_dispatch_sms),
            daily_digest_hour: Number(data.daily_digest_hour ?? prev.daily_digest_hour),
            require_2fa: BOOL(data.require_2fa, prev.require_2fa),
            session_timeout_min: Number(data.session_timeout_min ?? prev.session_timeout_min),
            webhooks_enabled: BOOL(data.webhooks_enabled, prev.webhooks_enabled),
            webhook_url: STR(data.webhook_url, prev.webhook_url),
            api_tokens_issued: Number(data.api_tokens_issued ?? prev.api_tokens_issued),
            at_risk_threshold_hours: Number(data.at_risk_threshold_hours ?? prev.at_risk_threshold_hours),
            problem_escalation_minutes: Number(data.problem_escalation_minutes ?? prev.problem_escalation_minutes),
          }));
        }
      } catch (e) {
        console.error("Settings bootstrap error", e);
        setErrorMsg(e.message || "Failed to load settings");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  function patch(p) {
    setForm((f) => ({ ...f, ...p }));
  }

  async function handleSave() {
    setSaving(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      // Upsert keeps it non-destructive and idempotent
      const payload = { ...form, org_id: "default", updated_at: new Date().toISOString() };
      const { error } = await supabase.from("org_settings").upsert(payload, { onConflict: "org_id" });
      if (error) throw error;
      setOkMsg("Settings saved");
    } catch (e) {
      console.error("Save failed", e);
      setErrorMsg(e.message || "Save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setOkMsg(""), 2500);
    }
  }

  // ---- UI -----------------------------------------------------------------
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Safe, modular, and enterprise-friendly.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => window.location.reload()} title="Reload settings">
            <Wrench className="size-4" /> Reload
          </Button>
          <PrimaryButton onClick={handleSave} loading={saving} title="Save all">
            <Save className="size-4" /> Save
          </PrimaryButton>
        </div>
      </div>

      <RenderGuard
        loading={loading}
        error={errorMsg}
        isEmpty={false}
        onRetry={() => window.location.reload()}
        emptyTitle="No settings"
        emptyMessage="Defaults will be created on save."
      >
        <div className="grid grid-cols-1 gap-4 sm:gap-6">
          {/* Organization */}
          <Section
            icon={Building2}
            title="Organization"
            desc="Company-wide defaults that influence new loads, drivers, and notifications."
            right={
              okMsg ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm">
                  <CheckCircle2 className="size-4" /> {okMsg}
                </span>
              ) : null
            }
          >
            <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
              <Row label="Org name" hint="Shown across the app in titles and exports.">
                <input
                  value={form.org_name}
                  onChange={(e) => patch({ org_name: e.target.value })}
                  className="w-full sm:max-w-md rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                  placeholder="Atlas Command"
                />
              </Row>
              <Row label="Timezone" hint="Defaults for ETAs, scheduling, and digests.">
                <select
                  value={form.timezone}
                  onChange={(e) => patch({ timezone: e.target.value })}
                  className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                >
                  {/* keep list small; extend later */}
                  <option value="America/Los_Angeles">America/Los_Angeles</option>
                  <option value="America/Denver">America/Denver</option>
                  <option value="America/Chicago">America/Chicago</option>
                  <option value="America/New_York">America/New_York</option>
                </select>
              </Row>
              <Row label="Phone format" hint="Formatting helper for contacts & drivers.">
                <input
                  value={form.phone_format}
                  onChange={(e) => patch({ phone_format: e.target.value })}
                  className="w-full sm:max-w-md rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                />
              </Row>
              <Row label="Default driver pay ($/mi)" hint="Used by margin calculators when driver pay is missing on a load.">
                <input
                  type="number"
                  step="0.01"
                  value={form.default_driver_pay_mi}
                  onChange={(e) => patch({ default_driver_pay_mi: Number(e.target.value) })}
                  className="w-32 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                />
              </Row>
            </div>
          </Section>

          {/* Appearance */}
          <Section icon={Palette} title="Appearance" desc="Theme and density preferences.">
            <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
              <Row label="Theme" hint="This sets the app base theme.">
                <div className="flex items-center gap-2">
                  {[
                    { id: "system", label: "System" },
                    { id: "light", label: "Light" },
                    { id: "dark", label: "Dark" },
                  ].map((t) => (
                    <label key={t.id} className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="theme"
                        checked={form.theme === t.id}
                        onChange={() => patch({ theme: t.id })}
                      />
                      <span className="text-sm">{t.label}</span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-neutral-500">Current: {themeLabel}</div>
              </Row>
              <Row label="Density" hint="Compact density shows more rows per view.">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.compact_density}
                    onChange={(e) => patch({ compact_density: e.target.checked })}
                  />
                  <span className="text-sm">Compact</span>
                </label>
              </Row>
            </div>
          </Section>

          {/* Notifications */}
          <Section icon={Bell} title="Notifications" desc="Email/SMS dispatch alerts and digests.">
            <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
              <Row label="Dispatch email alerts">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.notify_dispatch_email}
                    onChange={(e) => patch({ notify_dispatch_email: e.target.checked })}
                  />
                  <span className="text-sm">Enabled</span>
                </label>
              </Row>
              <Row label="Dispatch SMS alerts">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.notify_dispatch_sms}
                    onChange={(e) => patch({ notify_dispatch_sms: e.target.checked })}
                  />
                  <span className="text-sm">Enabled</span>
                </label>
              </Row>
              <Row label="Daily digest hour" hint="24h format in org timezone.">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={form.daily_digest_hour}
                  onChange={(e) => patch({ daily_digest_hour: Number(e.target.value) })}
                  className="w-24 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                />
              </Row>
            </div>
          </Section>

          {/* Security */}
          <Section icon={Shield} title="Security" desc="Hardening and session controls.">
            <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
              <Row label="Require 2FA for staff">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.require_2fa}
                    onChange={(e) => patch({ require_2fa: e.target.checked })}
                  />
                  <span className="text-sm">Required</span>
                </label>
              </Row>
              <Row label="Session timeout (min)" hint="Force re-auth after inactivity.">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={form.session_timeout_min}
                  onChange={(e) => patch({ session_timeout_min: Number(e.target.value) })}
                  className="w-28 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                />
              </Row>
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mt-2">
                <AlertTriangle className="size-4" />
                Changing security settings may sign users out when enforced.
              </div>
            </div>
          </Section>

          {/* Integrations */}
          <Section icon={PlugZap} title="Integrations & API" desc="Webhooks and access tokens.">
            <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
              <Row label="Webhooks">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.webhooks_enabled}
                    onChange={(e) => patch({ webhooks_enabled: e.target.checked })}
                  />
                  <span className="text-sm">Enabled</span>
                </label>
              </Row>
              <Row label="Webhook URL" hint="Receives event posts from Atlas Command.">
                <input
                  value={form.webhook_url}
                  onChange={(e) => patch({ webhook_url: e.target.value })}
                  className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                  placeholder="https://hooks.mycompany.com/atlas"
                />
              </Row>
              <Row label="API tokens issued" hint="Managed elsewhere; read-only here.">
                <code className="text-xs bg-neutral-100 dark:bg-neutral-900 px-2 py-1 rounded">{form.api_tokens_issued}</code>
              </Row>
            </div>
          </Section>

          {/* Ops rules */}
          <Section icon={Wrench} title="Operations rules" desc="Thresholds that drive at-risk and escalation logic.">
            <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
              <Row label="At-risk threshold (hours)" hint="Mark loads 'at risk' when ETA < threshold.">
                <input
                  type="number"
                  min={0}
                  max={72}
                  value={form.at_risk_threshold_hours}
                  onChange={(e) => patch({ at_risk_threshold_hours: Number(e.target.value) })}
                  className="w-28 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                />
              </Row>
              <Row label="Problem escalation (min)" hint="Auto escalate problems older than this.">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={form.problem_escalation_minutes}
                  onChange={(e) => patch({ problem_escalation_minutes: Number(e.target.value) })}
                  className="w-28 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                />
              </Row>
            </div>
          </Section>

          {/* System */}
          <Section icon={Database} title="Data & Privacy" desc="Export and data lifecycle.">
            <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
              <Row label="Export data">
                <PrimaryButton onClick={() => alert("TODO: export")}>Export CSV</PrimaryButton>
              </Row>
              <Row label="Retention policy" hint="Future: auto-archive delivered loads after N days.">
                <Button disabled>Configure (soon)</Button>
              </Row>
            </div>
          </Section>

          {/* People */}
          <Section icon={Users} title="Users & Roles" desc="Manage staff access (opens users page).">
            <Button onClick={() => (window.location.href = "/settings/users")}>
              <KeyRound className="size-4" /> Open Users & Roles
            </Button>
          </Section>
        </div>
      </RenderGuard>
    </div>
  );
}
