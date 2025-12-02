// FILE: src/components/DriverDetailPanel.jsx
// Purpose: Slide-out panel for viewing/editing driver details
// Sections: Profile, License & Compliance, Home & Preferences, Pay Configuration, Equipment, HOS

import { useEffect, useState, useMemo } from "react";
import {
  X,
  Loader2,
  User,
  Shield,
  Home,
  DollarSign,
  Truck,
  Clock,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function cleanStr(v) {
  return (v ?? "").toString().trim();
}

function numOrNull(v) {
  const s = cleanStr(v);
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function formatDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function getExpirationStatus(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return { status: "unknown", label: "Not set", color: "slate" };
  if (days < 0) return { status: "expired", label: "Expired", color: "red" };
  if (days <= 30) return { status: "critical", label: `${days}d left`, color: "red" };
  if (days <= 60) return { status: "warning", label: `${days}d left`, color: "amber" };
  return { status: "valid", label: `${days}d left`, color: "emerald" };
}

function formatMinutesToHm(min) {
  if (min == null) return null;
  const total = Number(min);
  if (!Number.isFinite(total)) return null;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0 && minutes <= 0) return "0h";
  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/* ---------------------------- constants ---------------------------- */
const DRIVER_TYPES = [
  { value: "company", label: "Company Driver" },
  { value: "owner_op", label: "Owner-Operator" },
  { value: "lease", label: "Lease Purchase" },
];

const CDL_CLASSES = [
  { value: "A", label: "Class A" },
  { value: "B", label: "Class B" },
  { value: "C", label: "Class C" },
];

const ENDORSEMENTS = [
  { value: "H", label: "H - Hazmat" },
  { value: "N", label: "N - Tank" },
  { value: "P", label: "P - Passenger" },
  { value: "S", label: "S - School Bus" },
  { value: "T", label: "T - Doubles/Triples" },
  { value: "X", label: "X - Hazmat + Tank" },
];

const PAY_MODELS = [
  { value: "PERCENT", label: "Percent of Load" },
  { value: "PER_MILE", label: "Per Mile" },
  { value: "FLAT_PER_LOAD", label: "Flat Per Load" },
  { value: "CUSTOM", label: "Custom" },
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

/* ---------------------------- sub-components ---------------------------- */

function SectionHeader({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
      <Icon className="w-4 h-4 text-emerald-400" />
      <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-300">
        {title}
      </h3>
    </div>
  );
}

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs text-slate-400 mb-1">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", ...props }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
      {...props}
    />
  );
}

function SelectInput({ value, onChange, options, placeholder }) {
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-white/10 bg-slate-900/70 px-3 pr-8 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function DateInput({ value, onChange }) {
  return (
    <input
      type="date"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
    />
  );
}

function ExpirationBadge({ dateStr, label }) {
  const exp = getExpirationStatus(dateStr);
  const colorClasses = {
    red: "border-red-500/60 bg-red-500/10 text-red-200",
    amber: "border-amber-500/60 bg-amber-500/10 text-amber-200",
    emerald: "border-emerald-500/60 bg-emerald-500/10 text-emerald-200",
    slate: "border-slate-500/60 bg-slate-700/30 text-slate-300",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-200">{dateStr ? formatDate(dateStr) : "—"}</span>
        <span
          className={cx(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
            colorClasses[exp.color]
          )}
        >
          {exp.status === "expired" && <AlertTriangle className="w-3 h-3 mr-1" />}
          {exp.status === "valid" && <CheckCircle className="w-3 h-3 mr-1" />}
          {exp.label}
        </span>
      </div>
    </div>
  );
}

function EndorsementCheckboxes({ selected = [], onChange }) {
  const selectedSet = new Set(selected || []);

  function toggle(value) {
    const newSet = new Set(selectedSet);
    if (newSet.has(value)) {
      newSet.delete(value);
    } else {
      newSet.add(value);
    }
    onChange(Array.from(newSet));
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ENDORSEMENTS.map((e) => {
        const isChecked = selectedSet.has(e.value);
        return (
          <button
            key={e.value}
            type="button"
            onClick={() => toggle(e.value)}
            className={cx(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border transition",
              isChecked
                ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-100"
                : "border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700/50"
            )}
          >
            {e.value}
            <span className="ml-1 text-[10px] text-slate-400 hidden sm:inline">
              {e.label.split(" - ")[1]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HosDisplay({ driver }) {
  const drive = formatMinutesToHm(driver.hos_drive_remaining_min);
  const shift = formatMinutesToHm(driver.hos_shift_remaining_min);
  const cycle = formatMinutesToHm(driver.hos_cycle_remaining_min);

  if (!driver.hos_status && !drive && !shift && !cycle) {
    return (
      <div className="text-sm text-slate-500 italic">
        No HOS data available
      </div>
    );
  }

  const statusColors = {
    DRIVING: "border-emerald-500/60 bg-emerald-500/10 text-emerald-100",
    ON_DUTY: "border-amber-500/60 bg-amber-500/10 text-amber-100",
    OFF_DUTY: "border-slate-500/60 bg-slate-700/30 text-slate-100",
    SLEEPER: "border-blue-500/60 bg-blue-500/10 text-blue-100",
    RESTING: "border-slate-500/60 bg-slate-700/30 text-slate-100",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border",
            statusColors[driver.hos_status] || statusColors.OFF_DUTY
          )}
        >
          {driver.hos_status || "Unknown"}
        </span>
        {driver.hos_last_synced_at && (
          <span className="text-[10px] text-slate-500">
            Updated {new Date(driver.hos_last_synced_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3 text-center">
          <div className="text-lg font-semibold text-slate-100">{drive || "—"}</div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Drive</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3 text-center">
          <div className="text-lg font-semibold text-slate-100">{shift || "—"}</div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Shift</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3 text-center">
          <div className="text-lg font-semibold text-slate-100">{cycle || "—"}</div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Cycle</div>
        </div>
      </div>
    </div>
  );
}

/* ============================== MAIN COMPONENT ============================== */

export default function DriverDetailPanel({
  driver,
  isNew = false,
  onClose,
  onSave,
  saving = false,
  error = "",
  vehicles = [],
}) {
  const [form, setForm] = useState({});
  const [activeSection, setActiveSection] = useState("profile");

  // Initialize form when driver changes
  useEffect(() => {
    if (isNew) {
      setForm({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        driver_type: "company",
        emergency_contact_name: "",
        emergency_contact_phone: "",
        cdl_number: "",
        cdl_state: "",
        cdl_class: "A",
        cdl_exp: "",
        med_exp: "",
        endorsements: [],
        home_city: "",
        home_state: "",
        preferred_lanes: [],
        home_time_request: "",
        home_time_priority: "flexible",
        pay_model: "PERCENT",
        pay_rate_percent: "",
        pay_rate_per_mile: "",
        pay_flat_per_load: "",
        escrow_percent: "",
        advance_limit: "",
        pay_notes: "",
        vehicle_id: "",
        notes: "",
      });
    } else if (driver) {
      setForm({
        first_name: driver.first_name ?? "",
        last_name: driver.last_name ?? "",
        email: driver.email ?? "",
        phone: driver.phone ?? "",
        driver_type: driver.driver_type ?? "company",
        emergency_contact_name: driver.emergency_contact_name ?? "",
        emergency_contact_phone: driver.emergency_contact_phone ?? "",
        cdl_number: driver.cdl_number ?? driver.license_number ?? "",
        cdl_state: driver.cdl_state ?? "",
        cdl_class: driver.cdl_class ?? "A",
        cdl_exp: driver.cdl_exp ?? driver.license_expiry ?? "",
        med_exp: driver.med_exp ?? driver.med_card_expiry ?? "",
        endorsements: driver.endorsements ?? [],
        home_city: driver.home_city ?? "",
        home_state: driver.home_state ?? "",
        preferred_lanes: driver.preferred_lanes ?? [],
        home_time_request: driver.home_time_request ?? "",
        home_time_priority: driver.home_time_priority ?? "flexible",
        pay_model: driver.pay_model ?? "PERCENT",
        pay_rate_percent: driver.pay_rate_percent != null ? String(driver.pay_rate_percent) : "",
        pay_rate_per_mile: driver.pay_rate_per_mile != null ? String(driver.pay_rate_per_mile) : "",
        pay_flat_per_load: driver.pay_flat_per_load != null ? String(driver.pay_flat_per_load) : "",
        escrow_percent: driver.escrow_percent != null ? String(driver.escrow_percent) : "",
        advance_limit: driver.advance_limit != null ? String(driver.advance_limit) : "",
        pay_notes: driver.pay_notes ?? "",
        vehicle_id: driver.vehicle_id ?? "",
        notes: driver.notes ?? "",
      });
    }
  }, [driver, isNew]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    
    // Build payload
    const payload = {
      first_name: cleanStr(form.first_name) || null,
      last_name: cleanStr(form.last_name) || null,
      email: cleanStr(form.email) || null,
      phone: cleanStr(form.phone) || null,
      driver_type: form.driver_type || "company",
      emergency_contact_name: cleanStr(form.emergency_contact_name) || null,
      emergency_contact_phone: cleanStr(form.emergency_contact_phone) || null,
      cdl_number: cleanStr(form.cdl_number) || null,
      license_number: cleanStr(form.cdl_number) || null, // Keep in sync
      cdl_state: cleanStr(form.cdl_state) || null,
      cdl_class: form.cdl_class || null,
      cdl_exp: form.cdl_exp || null,
      license_expiry: form.cdl_exp || null, // Keep in sync
      med_exp: form.med_exp || null,
      med_card_expiry: form.med_exp || null, // Keep in sync
      endorsements: form.endorsements || [],
      home_city: cleanStr(form.home_city) || null,
      home_state: cleanStr(form.home_state) || null,
      preferred_lanes: form.preferred_lanes || [],
      home_time_request: form.home_time_request || null,
      home_time_priority: form.home_time_priority || "flexible",
      pay_model: form.pay_model || "PERCENT",
      pay_rate_percent: numOrNull(form.pay_rate_percent),
      pay_rate_per_mile: numOrNull(form.pay_rate_per_mile),
      pay_flat_per_load: numOrNull(form.pay_flat_per_load),
      escrow_percent: numOrNull(form.escrow_percent),
      advance_limit: numOrNull(form.advance_limit),
      pay_notes: cleanStr(form.pay_notes) || null,
      vehicle_id: form.vehicle_id || null,
      notes: cleanStr(form.notes) || null,
    };

    onSave(payload);
  }

  // Compliance warnings
  const cdlExpStatus = getExpirationStatus(form.cdl_exp);
  const medExpStatus = getExpirationStatus(form.med_exp);
  const hasComplianceWarning =
    cdlExpStatus.status === "critical" ||
    cdlExpStatus.status === "expired" ||
    medExpStatus.status === "critical" ||
    medExpStatus.status === "expired";

  const sections = [
    { id: "profile", label: "Profile", icon: User },
    { id: "compliance", label: "License", icon: Shield, warning: hasComplianceWarning },
    { id: "home", label: "Home", icon: Home },
    { id: "pay", label: "Pay", icon: DollarSign },
    { id: "equipment", label: "Equipment", icon: Truck },
    ...(!isNew ? [{ id: "hos", label: "HOS", icon: Clock }] : []),
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-slate-950 shadow-2xl shadow-black/50 border-l border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-400/80">
              {isNew ? "New Driver" : "Edit Driver"}
            </p>
            <h2 className="text-xl font-semibold text-slate-50">
              {isNew
                ? "Add Driver"
                : `${form.first_name || ""} ${form.last_name || ""}`.trim() || "Driver Details"}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {saving && (
              <div className="flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 transition-colors hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 border-b border-white/10 px-5 py-2 overflow-x-auto">
          {sections.map((s) => {
            const Icon = s.icon;
            const isActive = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={cx(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  isActive
                    ? "bg-emerald-500/20 text-emerald-100 border border-emerald-500/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {s.label}
                {s.warning && (
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-5 py-4"
        >
          {/* PROFILE SECTION */}
          {activeSection === "profile" && (
            <div className="space-y-4">
              <SectionHeader icon={User} title="Profile Information" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel required>First Name</FieldLabel>
                  <TextInput
                    value={form.first_name}
                    onChange={(v) => updateField("first_name", v)}
                    placeholder="John"
                  />
                </div>
                <div>
                  <FieldLabel required>Last Name</FieldLabel>
                  <TextInput
                    value={form.last_name}
                    onChange={(v) => updateField("last_name", v)}
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Driver Type</FieldLabel>
                <SelectInput
                  value={form.driver_type}
                  onChange={(v) => updateField("driver_type", v)}
                  options={DRIVER_TYPES}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Phone</FieldLabel>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="tel"
                      value={form.phone ?? ""}
                      onChange={(e) => updateField("phone", e.target.value)}
                      placeholder="(555) 123-4567"
                      className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                    />
                  </div>
                </div>
                <div>
                  <FieldLabel>Email</FieldLabel>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      value={form.email ?? ""}
                      onChange={(e) => updateField("email", e.target.value)}
                      placeholder="john@example.com"
                      className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/5">
                <h4 className="text-xs font-medium text-slate-300 mb-3">Emergency Contact</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Contact Name</FieldLabel>
                    <TextInput
                      value={form.emergency_contact_name}
                      onChange={(v) => updateField("emergency_contact_name", v)}
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div>
                    <FieldLabel>Contact Phone</FieldLabel>
                    <TextInput
                      value={form.emergency_contact_phone}
                      onChange={(v) => updateField("emergency_contact_phone", v)}
                      placeholder="(555) 987-6543"
                    />
                  </div>
                </div>
              </div>

              <div>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  rows={3}
                  value={form.notes ?? ""}
                  onChange={(e) => updateField("notes", e.target.value)}
                  placeholder="Internal notes about this driver..."
                  className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          )}

          {/* LICENSE & COMPLIANCE SECTION */}
          {activeSection === "compliance" && (
            <div className="space-y-4">
              <SectionHeader icon={Shield} title="License & Compliance" />

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <FieldLabel>CDL Number</FieldLabel>
                  <TextInput
                    value={form.cdl_number}
                    onChange={(v) => updateField("cdl_number", v)}
                    placeholder="DL-12345678"
                  />
                </div>
                <div>
                  <FieldLabel>Issuing State</FieldLabel>
                  <SelectInput
                    value={form.cdl_state}
                    onChange={(v) => updateField("cdl_state", v)}
                    options={US_STATES.map((s) => ({ value: s, label: s }))}
                    placeholder="State"
                  />
                </div>
              </div>

              <div>
                <FieldLabel>CDL Class</FieldLabel>
                <SelectInput
                  value={form.cdl_class}
                  onChange={(v) => updateField("cdl_class", v)}
                  options={CDL_CLASSES}
                />
              </div>

              <div>
                <FieldLabel>Endorsements</FieldLabel>
                <EndorsementCheckboxes
                  selected={form.endorsements}
                  onChange={(v) => updateField("endorsements", v)}
                />
              </div>

              <div className="pt-3 border-t border-white/5 space-y-3">
                <h4 className="text-xs font-medium text-slate-300">Expiration Dates</h4>

                <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-4 items-end">
                    <div>
                      <FieldLabel>CDL Expiration</FieldLabel>
                      <DateInput
                        value={form.cdl_exp}
                        onChange={(v) => updateField("cdl_exp", v)}
                      />
                    </div>
                    <ExpirationBadge dateStr={form.cdl_exp} label="Status" />
                  </div>

                  <div className="grid grid-cols-2 gap-4 items-end">
                    <div>
                      <FieldLabel>Medical Card Expiration</FieldLabel>
                      <DateInput
                        value={form.med_exp}
                        onChange={(v) => updateField("med_exp", v)}
                      />
                    </div>
                    <ExpirationBadge dateStr={form.med_exp} label="Status" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* HOME & PREFERENCES SECTION */}
          {activeSection === "home" && (
            <div className="space-y-4">
              <SectionHeader icon={Home} title="Home & Preferences" />

              <div>
                <FieldLabel>Home Domicile</FieldLabel>
                <div className="grid grid-cols-[2fr,1fr] gap-2">
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={form.home_city ?? ""}
                      onChange={(e) => updateField("home_city", e.target.value)}
                      placeholder="City"
                      className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                    />
                  </div>
                  <SelectInput
                    value={form.home_state}
                    onChange={(v) => updateField("home_state", v)}
                    options={US_STATES.map((s) => ({ value: s, label: s }))}
                    placeholder="State"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-white/5">
                <h4 className="text-xs font-medium text-slate-300 mb-3">Home Time</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Next Home Time Request</FieldLabel>
                    <DateInput
                      value={form.home_time_request}
                      onChange={(v) => updateField("home_time_request", v)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Priority</FieldLabel>
                    <SelectInput
                      value={form.home_time_priority}
                      onChange={(v) => updateField("home_time_priority", v)}
                      options={[
                        { value: "flexible", label: "Flexible" },
                        { value: "preferred", label: "Preferred" },
                        { value: "required", label: "Required" },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-white/5">
                <h4 className="text-xs font-medium text-slate-300 mb-2">Preferred Lanes</h4>
                <p className="text-[11px] text-slate-500 mb-2">
                  Define preferred routes or regions this driver likes to run.
                </p>
                <textarea
                  rows={3}
                  value={
                    Array.isArray(form.preferred_lanes)
                      ? form.preferred_lanes.join("\n")
                      : ""
                  }
                  onChange={(e) => {
                    const lines = e.target.value.split("\n").filter((l) => l.trim());
                    updateField("preferred_lanes", lines);
                  }}
                  placeholder="CA → TX&#10;West Coast runs&#10;No Northeast"
                  className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          )}

          {/* PAY CONFIGURATION SECTION */}
          {activeSection === "pay" && (
            <div className="space-y-4">
              <SectionHeader icon={DollarSign} title="Pay Configuration" />

              <div>
                <FieldLabel>Pay Model</FieldLabel>
                <SelectInput
                  value={form.pay_model}
                  onChange={(v) => updateField("pay_model", v)}
                  options={PAY_MODELS}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <FieldLabel>% of Load</FieldLabel>
                  <div className="relative">
                    <TextInput
                      value={form.pay_rate_percent}
                      onChange={(v) => updateField("pay_rate_percent", v)}
                      placeholder="75"
                      type="number"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <FieldLabel>Per Mile</FieldLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.pay_rate_per_mile ?? ""}
                      onChange={(e) => updateField("pay_rate_per_mile", e.target.value)}
                      placeholder="0.55"
                      className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 pl-7 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                    />
                  </div>
                </div>
                <div>
                  <FieldLabel>Flat / Load</FieldLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.pay_flat_per_load ?? ""}
                      onChange={(e) => updateField("pay_flat_per_load", e.target.value)}
                      placeholder="500"
                      className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 pl-7 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-white/5">
                <h4 className="text-xs font-medium text-slate-300 mb-3">Deductions & Limits</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Escrow %</FieldLabel>
                    <div className="relative">
                      <TextInput
                        value={form.escrow_percent}
                        onChange={(v) => updateField("escrow_percent", v)}
                        placeholder="5"
                        type="number"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                        %
                      </span>
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Advance Limit</FieldLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                        $
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        value={form.advance_limit ?? ""}
                        onChange={(e) => updateField("advance_limit", e.target.value)}
                        placeholder="500"
                        className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 pl-7 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <FieldLabel>Pay Notes</FieldLabel>
                <textarea
                  rows={2}
                  value={form.pay_notes ?? ""}
                  onChange={(e) => updateField("pay_notes", e.target.value)}
                  placeholder="Special pay arrangements, bonuses, etc."
                  className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-400/50"
                />
              </div>
            </div>
          )}

          {/* EQUIPMENT SECTION */}
          {activeSection === "equipment" && (
            <div className="space-y-4">
              <SectionHeader icon={Truck} title="Equipment Assignment" />

              <div>
                <FieldLabel>Assigned Vehicle</FieldLabel>
                {vehicles.length > 0 ? (
                  <SelectInput
                    value={form.vehicle_id}
                    onChange={(v) => updateField("vehicle_id", v)}
                    options={[
                      { value: "", label: "No vehicle assigned" },
                      ...vehicles.map((v) => ({
                        value: v.id,
                        label: `${v.unit_number || v.id.slice(0, 8)} - ${v.make || ""} ${v.model || ""}`.trim(),
                      })),
                    ]}
                  />
                ) : (
                  <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3 text-sm text-slate-400">
                    No vehicles available. Add vehicles in the Fleet page.
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500">
                Vehicle assignment links this driver to a specific truck for tracking and reporting.
              </p>
            </div>
          )}

          {/* HOS SECTION (view only, not for new drivers) */}
          {activeSection === "hos" && !isNew && driver && (
            <div className="space-y-4">
              <SectionHeader icon={Clock} title="Hours of Service" />
              <HosDisplay driver={driver} />
              <p className="text-xs text-slate-500">
                HOS data is read-only and synced from ELD/telematics integrations or the simulation system.
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !form.last_name}
            className={cx(
              "inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400",
              (saving || !form.last_name) && "opacity-60 cursor-not-allowed"
            )}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{saving ? "Saving…" : isNew ? "Create Driver" : "Save Changes"}</span>
          </button>
        </div>
      </div>
    </>
  );
}