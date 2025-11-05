import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  MonitorSmartphone,
  Paintbrush,
  Bell,
  Brain,
  UserRound,
} from "lucide-react";

/** Small cx helper */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

/** Local defaults if user has no settings yet */
const DEFAULTS = {
  theme: "dark",            // 'light' | 'dark' | 'system'
  accent: "emerald",        // tailwind accent key name
  font_scale: "md",         // 'sm' | 'md' | 'lg'
  email_alerts: true,
  desktop_push: false,
  sms_alerts: false,
  ai_smart_dispatch: true,
  ai_detention: true,
  ai_eta: true,
};

/** Accent options should match your Tailwind palette keys */
const ACCENTS = ["emerald", "sky", "violet", "amber", "rose", "cyan", "lime"];

/** Simple inline alert */
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
        {kind === "success" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : kind === "error" ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <AlertCircle className="h-4 w-4" />
        )}
        <span>{children}</span>
      </div>
    </div>
  );
}

/** Reusable card */
function Card({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-emerald-500/40 bg-[#12151b] p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        {Icon ? <Icon className="h-5 w-5 opacity-70" /> : null}
        <div>
          <div className="text-base font-semibold">{title}</div>
          {subtitle ? (
            <div className="text-xs opacity-60">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: 'success'|'error'|'info', text: string }
  const [user, setUser] = useState(null);

  // form state
  const [form, setForm] = useState(DEFAULTS);

  /** derive accent sample class */
  const accentRing = useMemo(() => {
    return {
      emerald: "ring-emerald-400",
      sky: "ring-sky-400",
      violet: "ring-violet-400",
      amber: "ring-amber-400",
      rose: "ring-rose-400",
      cyan: "ring-cyan-400",
      lime: "ring-lime-400",
    }[form.accent] || "ring-emerald-400";
  }, [form.accent]);

  /** helper to patch form */
  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /** load user + settings */
  useEffect(() => {
    let isMounted = true;

    async function run() {
      setLoading(true);
      setMsg(null);

      const { data: { session }, error: sErr } = await supabase.auth.getSession();
      if (sErr) {
        if (!isMounted) return;
        setMsg({ kind: "error", text: "Auth error. Please re-login." });
        setLoading(false);
        return;
      }
      const u = session?.user || null;
      if (!isMounted) return;
      setUser(u);

      if (!u) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", u.id)
        .maybeSingle();

      if (!isMounted) return;

      if (error && error.code !== "PGRST116") {
        setMsg({ kind: "error", text: "Failed to load your settings." });
        setForm(DEFAULTS);
      } else if (!data) {
        // no row yet → defaults
        setForm(DEFAULTS);
      } else {
        // merge with defaults in case we add new fields later
        setForm({ ...DEFAULTS, ...data });
      }

      // Sync appearance to localStorage for your theme system
      try {
        localStorage.setItem("atlas.theme", (data?.theme ?? DEFAULTS.theme));
        localStorage.setItem("atlas.accent", (data?.accent ?? DEFAULTS.accent));
        localStorage.setItem("atlas.fontScale", (data?.font_scale ?? DEFAULTS.font_scale));
      } catch {}

      setLoading(false);
    }

    run();
    return () => {
      isMounted = false;
    };
  }, []);

  /** save handler */
  const onSave = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setMsg(null);

    try {
      // Request browser permission if enabling desktop push
      if (form.desktop_push && "Notification" in window) {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission !== "granted") {
          // If user denies, reflect it in UI (don't force)
          patch("desktop_push", false);
          setMsg({
            kind: "error",
            text: "Desktop notifications are blocked by the browser.",
          });
        }
      }

      // persist to Supabase
      const payload = {
        user_id: user.id,
        theme: form.theme,
        accent: form.accent,
        font_scale: form.font_scale,
        email_alerts: form.email_alerts,
        desktop_push: form.desktop_push,
        sms_alerts: form.sms_alerts,
        ai_smart_dispatch: form.ai_smart_dispatch,
        ai_detention: form.ai_detention,
        ai_eta: form.ai_eta,
      };

      const { error } = await supabase
        .from("user_settings")
        .upsert(payload, { onConflict: "user_id" });

      if (error) throw error;

      // also mirror appearance locally for fast UX
      try {
        localStorage.setItem("atlas.theme", form.theme);
        localStorage.setItem("atlas.accent", form.accent);
        localStorage.setItem("atlas.fontScale", form.font_scale);
      } catch {}

      setMsg({ kind: "success", text: "Settings saved." });
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
          <div className="flex items-center gap-2 opacity-70">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading your settings…</span>
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
            You’re not signed in. Please log in to manage your settings.
          </InlineAlert>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page header */}
        <div className="rounded-2xl border border-emerald-500/40 bg-[#0f1318] p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xl font-semibold">Settings</div>
              <div className="text-sm opacity-60">
                Configure your personal preferences. These settings follow your account.
              </div>
            </div>

            <button
              onClick={onSave}
              disabled={saving}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition",
                saving
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:border-emerald-400/60",
                "border-emerald-500/40"
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save
                </>
              )}
            </button>
          </div>

          {msg ? (
            <div className="mt-3">
              <InlineAlert kind={msg.kind}>{msg.text}</InlineAlert>
            </div>
          ) : null}
        </div>

        {/* Profile (read-only basics) */}
        <Card
          icon={UserRound}
          title="Profile & Account"
          subtitle="Your identity inside Atlas Command"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs opacity-70">User ID</label>
              <div className="mt-1 rounded-lg border border-white/10 bg-black/20 p-2 text-sm opacity-80 select-all">
                {user.id}
              </div>
            </div>
            <div>
              <label className="text-xs opacity-70">Email</label>
              <div className="mt-1 rounded-lg border border-white/10 bg-black/20 p-2 text-sm opacity-80">
                {user.email}
              </div>
            </div>
          </div>
        </Card>

        {/* Appearance */}
        <Card
          icon={Paintbrush}
          title="Theme & Appearance"
          subtitle="How Atlas looks for you"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs opacity-70">Theme</label>
              <select
                value={form.theme}
                onChange={(e) => patch("theme", e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm"
              >
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
              <p className="mt-1 text-xs opacity-60">
                Saved to your account and local device.
              </p>
            </div>

            <div>
              <label className="text-xs opacity-70">Accent</label>
              <div className="mt-1 grid grid-cols-7 gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => patch("accent", a)}
                    className={cx(
                      "h-8 rounded-lg ring-2 transition hover:opacity-90",
                      form.accent === a ? "ring-offset-2" : "ring-transparent"
                    )}
                    style={{ background: `var(--tw-color-${a}500, #10b981)` }}
                    title={a}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs opacity-60">
                Current: <span className={cx("rounded px-1", accentRing)}>{form.accent}</span>
              </p>
            </div>

            <div>
              <label className="text-xs opacity-70">Font size</label>
              <select
                value={form.font_scale}
                onChange={(e) => patch("font_scale", e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm"
              >
                <option value="sm">Small</option>
                <option value="md">Default</option>
                <option value="lg">Large</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Notifications */}
        <Card
          icon={Bell}
          title="Notifications"
          subtitle="Get alerted when important events happen"
        >
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
              hint="Future: Twilio integration"
              checked={form.sms_alerts}
              onChange={(v) => patch("sms_alerts", v)}
            />
          </div>
        </Card>

        {/* AI & Automation */}
        <Card
          icon={Brain}
          title="AI & Automation"
          subtitle="Let Atlas help with proactive insights"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ToggleRow
              label="Smart dispatch suggestions"
              hint="Suggest best matching driver/equipment"
              checked={form.ai_smart_dispatch}
              onChange={(v) => patch("ai_smart_dispatch", v)}
            />
            <ToggleRow
              label="Detention risk alerts"
              hint="Pings when wait time approaches threshold"
              checked={form.ai_detention}
              onChange={(v) => patch("ai_detention", v)}
            />
            <ToggleRow
              label="ETA predictions"
              hint="Improved arrival estimates using historicals"
              checked={form.ai_eta}
              onChange={(v) => patch("ai_eta", v)}
            />
          </div>
        </Card>

        {/* Sticky save on mobile view */}
        <div className="sticky bottom-4 z-10 flex justify-end">
          <button
            onClick={onSave}
            disabled={saving}
            className={cx(
              "inline-flex items-center gap-2 rounded-2xl border border-emerald-500/60 bg-emerald-500/10 px-5 py-2 text-sm backdrop-blur transition",
              saving ? "opacity-60 cursor-not-allowed" : "hover:bg-emerald-500/20"
            )}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Toggle row component */
function ToggleRow({ label, hint, checked, onChange, icon: Icon }) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-white/10 bg-black/10 p-3">
      <div className="min-w-0 pr-3">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4 opacity-60" /> : null}
          <div className="text-sm font-medium">{label}</div>
        </div>
        {hint ? <div className="text-xs opacity-60">{hint}</div> : null}
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={!!checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="peer h-6 w-11 rounded-full bg-white/10 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-emerald-500/60 peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}
