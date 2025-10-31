import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useActiveOrg } from "../lib/useActiveOrg";

export default function AddDriverModal({ open, onClose, onCreated }) {
  const { orgId, loading: orgLoading, error: orgError } = useActiveOrg();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    license_number: "",
    license_class: "A",
    license_expiry: "",
    med_card_expiry: "",
    status: "ACTIVE",
    notes: "",
  });

  useEffect(() => {
    if (!open) {
      setForm({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        license_number: "",
        license_class: "A",
        license_expiry: "",
        med_card_expiry: "",
        status: "ACTIVE",
        notes: "",
      });
      setErr("");
    }
  }, [open]);

  if (!open) return null;

  async function handleSave(e) {
    e.preventDefault();
    setErr("");

    if (orgLoading) return;
    if (!orgId) {
      setErr(orgError || "No organization assigned to your user.");
      return;
    }
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setErr("First and last name are required.");
      return;
    }
    if (!form.license_number.trim()) {
      setErr("CDL / License number is required.");
      return;
    }

    try {
      setSaving(true);
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id || null;

      const payload = {
        ...form,
        license_expiry: form.license_expiry ? new Date(form.license_expiry).toISOString() : null,
        med_card_expiry: form.med_card_expiry ? new Date(form.med_card_expiry).toISOString() : null,
        org_id: orgId,
        created_by: userId,
      };

      const { error } = await supabase.from("drivers").insert([payload]);
      if (error) throw error;

      onCreated?.();
    } catch (e) {
      setErr(e.message || "Failed to create driver.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Add Driver</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900"
            aria-label="Close"
          >
            <X />
          </button>
        </div>

        {err && <div className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</div>}

        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="First Name *" value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} />
            <Field label="Last Name *" value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />

            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />

            <Field
              label="CDL / License # *"
              value={form.license_number}
              onChange={(v) => setForm({ ...form, license_number: v })}
              className="font-mono"
            />
            <Field
              label="License Class"
              value={form.license_class}
              onChange={(v) => setForm({ ...form, license_class: v })}
              placeholder="A"
              maxLength={2}
            />

            <Field
              label="CDL Expiry"
              type="date"
              value={form.license_expiry}
              onChange={(v) => setForm({ ...form, license_expiry: v })}
            />
            <Field
              label="Med Card Expiry"
              type="date"
              value={form.med_card_expiry}
              onChange={(v) => setForm({ ...form, med_card_expiry: v })}
            />

            <Select
              label="Status"
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={["ACTIVE", "INACTIVE", "SUSPENDED"]}
            />

            <Textarea
              label="Notes"
              value={form.notes}
              onChange={(v) => setForm({ ...form, notes: v })}
              placeholder="Optional notes…"
              className="md:col-span-3"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || orgLoading}
              className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-60 inline-flex items-center gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- tiny UI helpers ---------- */
function Field({ label, value, onChange, type = "text", placeholder = "", maxLength, className = "" }) {
  return (
    <label className={className + " block"}>
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
      />
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
function Textarea({ label, value, onChange, placeholder = "", className = "" }) {
  return (
    <label className={className + " block"}>
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
      />
    </label>
  );
}
