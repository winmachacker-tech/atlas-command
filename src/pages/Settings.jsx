// src/pages/Settings.jsx
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  Bell,
  Brain,
  UserRound,
  Globe,
  MonitorSmartphone,
  Settings as SettingsIcon,
} from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const DEFAULTS = {
  // Notifications
  email_alerts: true,
  desktop_push: false,
  sms_alerts: false,
  // AI
  ai_smart_dispatch: true,
  ai_detention: true,
  ai_eta: true,
  // Regional
  date_format: "MM/DD/YYYY",
  time_format: "12h",
  timezone: "America/Los_Angeles",
  distance_unit: "miles",
  weight_unit: "lbs",
  currency: "USD",
};

const DATE_FORMATS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (US)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (UK/EU)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (ISO)" },
];

const TIME_FORMATS = [
  { value: "12h", label: "12-hour (2:30 PM)" },
  { value: "24h", label: "24-hour (14:30)" },
];

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AK)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
];

const CURRENCIES = [
  { value: "USD", label: "$ USD (US Dollar)", symbol: "$" },
  { value: "CAD", label: "$ CAD (Canadian Dollar)", symbol: "$" },
  { value: "EUR", label: "â‚¬ EUR (Euro)", symbol: "â‚¬" },
  { value: "GBP", label: "Â£ GBP (British Pound)", symbol: "Â£" },
  { value: "MXN", label: "$ MXN (Mexican Peso)", symbol: "$" },
];

function InlineAlert({ kind = "info", children }) {
  const scheme =
    kind === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : kind === "error"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
      : "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return (
    <div className={cx("rounded-xl border px-3 py-2 text-sm", scheme)}>
      <div className="flex items-center gap-2">
        {kind === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        <span>{children}</span>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#12151b] p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        {Icon ? (
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
            <Icon className="h-5 w-5 text-amber-400" />
          </div>
        ) : null}
        <div>
          <div className="text-lg font-semibold">{title}</div>
          {subtitle ? <div className="text-sm text-white/60">{subtitle}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(DEFAULTS);

  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let isMounted = true;

    async function run() {
      setLoading(true);
      setMsg(null);

      const { data: { session }, error: sErr } = await supabase.auth.getSession();
      if (sErr || !session?.user) {
        if (!isMounted) return;
        setUser(null);
        setLoading(false);
        return;
      }

      const u = session.user;
      if (!isMounted) return;
      setUser(u);

      try {
        const { data, error } = await supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", u.id)
          .maybeSingle();

        if (!isMounted) return;

        if (data) {
          setForm({ ...DEFAULTS, ...data });
        } else {
          setForm(DEFAULTS);
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
        setForm(DEFAULTS);
      }

      setLoading(false);
    }

    run();
    return () => { isMounted = false; };
  }, []);

  const onSave = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setMsg(null);

    try {
      // Request permission for desktop push if enabling
      if (form.desktop_push && "Notification" in window) {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission !== "granted") {
          patch("desktop_push", false);
          setMsg({
            kind: "error",
            text: "Desktop notifications are blocked by the browser.",
          });
          setSaving(false);
          return;
        }
      }

      const payload = {
        user_id: user.id,
        ...form,
      };

      const { error } = await supabase
        .from("user_settings")
        .upsert(payload, { onConflict: "user_id" });

      if (error && error.code !== "42P01") throw error;

      setMsg({ kind: "success", text: "Settings saved successfully!" });
    } catch (e) {
      setMsg({ kind: "error", text: e.message || "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }, [user, form]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2 text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading your settingsâ€¦</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-5xl">
          <InlineAlert kind="error">
            You're not signed in. Please log in to manage your settings.
          </InlineAlert>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page Header */}
        <div className="rounded-2xl border border-white/10 bg-[#0f1318] p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
                <SettingsIcon className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold">Settings</h1>
                <p className="text-sm text-white/60">
                  Configure your personal preferences
                </p>
              </div>
            </div>

            <button
              onClick={onSave}
              disabled={saving}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-medium text-black transition",
                saving ? "opacity-60 cursor-not-allowed" : "hover:bg-amber-400"
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Savingâ€¦
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>

          {msg ? (
            <div className="mt-4">
              <InlineAlert kind={msg.kind}>{msg.text}</InlineAlert>
            </div>
          ) : null}
        </div>

        {/* Profile */}
        <Card icon={UserRound} title="Profile & Account" subtitle="Your identity in Atlas Command">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-white/70">User ID</label>
              <div className="mt-1 rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white/80 select-all font-mono">
                {user.id}
              </div>
            </div>
            <div>
              <label className="text-xs text-white/70">Email</label>
              <div className="mt-1 rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white/80">
                {user.email}
              </div>
            </div>
          </div>
        </Card>

        {/* Regional & Units */}
        <Card icon={Globe} title="Regional & Units" subtitle="Date formats, units, and timezone">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-white/70">Date Format</label>
                <select
                  value={form.date_format}
                  onChange={(e) => patch("date_format", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm outline-none focus:border-amber-500/50"
                >
                  {DATE_FORMATS.map((f) => (
                    <option key={f.value} value={f.value} className="bg-[#0f1318]">
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Time Format</label>
                <select
                  value={form.time_format}
                  onChange={(e) => patch("time_format", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm outline-none focus:border-amber-500/50"
                >
                  {TIME_FORMATS.map((f) => (
                    <option key={f.value} value={f.value} className="bg-[#0f1318]">
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Timezone</label>
                <select
                  value={form.timezone}
                  onChange={(e) => patch("timezone", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm outline-none focus:border-amber-500/50"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value} className="bg-[#0f1318]">
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-white/70">Distance Unit</label>
                <select
                  value={form.distance_unit}
                  onChange={(e) => patch("distance_unit", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm outline-none focus:border-amber-500/50"
                >
                  <option value="miles" className="bg-[#0f1318]">Miles</option>
                  <option value="kilometers" className="bg-[#0f1318]">Kilometers</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Weight Unit</label>
                <select
                  value={form.weight_unit}
                  onChange={(e) => patch("weight_unit", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm outline-none focus:border-amber-500/50"
                >
                  <option value="lbs" className="bg-[#0f1318]">Pounds (lbs)</option>
                  <option value="kg" className="bg-[#0f1318]">Kilograms (kg)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/70">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => patch("currency", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm outline-none focus:border-amber-500/50"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value} className="bg-[#0f1318]">
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </Card>

        {/* Notifications */}
        <Card icon={Bell} title="Notifications" subtitle="Get alerted when important events happen">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ToggleRow
              label="Email alerts"
              hint="Load assigned, delivered, docs uploaded"
              checked={form.email_alerts}
              onChange={(v) => patch("email_alerts", v)}
            />
            <ToggleRow
              label="Desktop push"
              hint="Requires browser permission"
              checked={form.desktop_push}
              onChange={(v) => patch("desktop_push", v)}
              icon={MonitorSmartphone}
            />
            <ToggleRow
              label="SMS alerts"
              hint="Coming soon - Twilio integration"
              checked={form.sms_alerts}
              onChange={(v) => patch("sms_alerts", v)}
            />
          </div>
        </Card>

        {/* AI & Automation */}
        <Card icon={Brain} title="AI & Automation" subtitle="Let Atlas help with proactive insights">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ToggleRow
              label="Smart dispatch suggestions"
              hint="Suggest best matching driver/equipment"
              checked={form.ai_smart_dispatch}
              onChange={(v) => patch("ai_smart_dispatch", v)}
            />
            <ToggleRow
              label="Detention risk alerts"
              hint="Alerts when wait time approaches threshold"
              checked={form.ai_detention}
              onChange={(v) => patch("ai_detention", v)}
            />
            <ToggleRow
              label="ETA predictions"
              hint="Improved arrival estimates using history"
              checked={form.ai_eta}
              onChange={(v) => patch("ai_eta", v)}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, icon: Icon }) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-white/10 bg-black/10 p-3">
      <div className="min-w-0 pr-3">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4 text-white/60" /> : null}
          <div className="text-sm font-medium">{label}</div>
        </div>
        {hint ? <div className="text-xs text-white/60">{hint}</div> : null}
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={!!checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="peer h-6 w-11 rounded-full bg-white/10 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-amber-500/60 peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}
