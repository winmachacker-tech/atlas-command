import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Mail, Smartphone, CheckCircle2, ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function Notifications() {
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState({
    email: true,
    inApp: true,
    sms: false,
    loadAssigned: true,
    loadStatus: true,
    podUploaded: true,
    problemFlagged: true,
    freq: "immediate",
  });

  async function savePrefs() {
    const user = (await supabase.auth.getUser()).data.user;
    await supabase.from("user_notifications").upsert({
      user_id: user.id,
      ...prefs,
    });
    alert("Preferences saved successfully");
  }

  return (
    <div className="p-6 space-y-8 max-w-3xl mx-auto">
      {/* 🔙 Back Button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-base)] transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      {/* Header */}
      <h1 className="text-2xl font-semibold flex items-center gap-2 mt-2">
        <Bell className="w-6 h-6 text-amber-500" /> Notification Settings
      </h1>

      {/* Channels */}
      <section className="bg-[var(--bg-card)] p-4 rounded-2xl border space-y-3">
        <h2 className="font-medium text-lg">Preferred Channels</h2>
        <div className="flex gap-6">
          <Toggle
            label="Email"
            icon={Mail}
            value={prefs.email}
            onChange={(v) => setPrefs({ ...prefs, email: v })}
          />
          <Toggle
            label="In-App"
            icon={Bell}
            value={prefs.inApp}
            onChange={(v) => setPrefs({ ...prefs, inApp: v })}
          />
          <Toggle
            label="SMS"
            icon={Smartphone}
            value={prefs.sms}
            onChange={(v) => setPrefs({ ...prefs, sms: v })}
          />
        </div>
      </section>

      {/* Operational Alerts */}
      <section className="bg-[var(--bg-card)] p-4 rounded-2xl border space-y-3">
        <h2 className="font-medium text-lg">Operational Alerts</h2>
        <Toggle
          label="Load Assigned"
          value={prefs.loadAssigned}
          onChange={(v) => setPrefs({ ...prefs, loadAssigned: v })}
        />
        <Toggle
          label="Load Status Change"
          value={prefs.loadStatus}
          onChange={(v) => setPrefs({ ...prefs, loadStatus: v })}
        />
        <Toggle
          label="POD Uploaded"
          value={prefs.podUploaded}
          onChange={(v) => setPrefs({ ...prefs, podUploaded: v })}
        />
        <Toggle
          label="Problem Flagged"
          value={prefs.problemFlagged}
          onChange={(v) => setPrefs({ ...prefs, problemFlagged: v })}
        />
      </section>

      {/* Frequency */}
      <section className="bg-[var(--bg-card)] p-4 rounded-2xl border space-y-3">
        <h2 className="font-medium text-lg">Frequency</h2>
        <select
          className="rounded-lg p-2 bg-transparent border"
          value={prefs.freq}
          onChange={(e) => setPrefs({ ...prefs, freq: e.target.value })}
        >
          <option value="immediate">Immediate</option>
          <option value="hourly">Hourly Digest</option>
          <option value="daily">Daily Summary</option>
        </select>
      </section>

      {/* Save Button */}
      <button
        onClick={savePrefs}
        className="bg-amber-500 text-black px-6 py-2 rounded-xl hover:bg-amber-400 transition"
      >
        Save Preferences
      </button>
    </div>
  );
}

/* ----------------------------- Toggle Helper ----------------------------- */
function Toggle({ label, icon: Icon, value, onChange }) {
  return (
    <label className="flex items-center justify-between w-full cursor-pointer py-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-5 h-5 text-amber-500" />}
        <span>{label}</span>
      </div>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-amber-500 w-5 h-5"
      />
    </label>
  );
}
