import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useActiveOrg } from "../lib/useActiveOrg";
import { X, Loader2 } from "lucide-react";

export default function AddLoadModal({ open, onClose, onCreated }) {
  const { orgId, loading: orgLoading, error: orgError } = useActiveOrg();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    reference: "",
    customer: "",
    shipper: "",
    broker: "",
    origin_city: "",
    origin_state: "",
    dest_city: "",
    dest_state: "",
    eta: "",
    status: "AVAILABLE",
    problem_flag: false,
    at_risk: false,
  });
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) {
      setForm({
        reference: "",
        customer: "",
        shipper: "",
        broker: "",
        origin_city: "",
        origin_state: "",
        dest_city: "",
        dest_state: "",
        eta: "",
        status: "AVAILABLE",
        problem_flag: false,
        at_risk: false,
      });
      setErr("");
    }
  }, [open]);

  if (!open) return null;

  async function handleSave(e) {
    e.preventDefault();
    setErr("");

    if (orgLoading) return;
    if (!orgId) return setErr(orgError || "No organization assigned to your user.");
    if (!form.reference?.trim()) return setErr("Reference is required.");
    if (!form.origin_city?.trim() || !form.origin_state?.trim())
      return setErr("Origin City and Origin State are required.");
    if (!form.dest_city?.trim() || !form.dest_state?.trim())
      return setErr("Dest City and Dest State are required.");

    try {
      setSaving(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const shipper = (form.shipper || form.customer || "").trim();
      const origin = `${form.origin_city.trim()}, ${form.origin_state.trim()}`;
      const destination = `${form.dest_city.trim()}, ${form.dest_state.trim()}`;

      const payload = {
        ...form,
        shipper, // ✅ ensures NOT NULL for column "shipper"
        origin,  // ✅ derived "City, ST"
        destination,
        eta: form.eta ? new Date(form.eta).toISOString() : null,
        org_id: orgId,
        created_by: user?.id || null,
      };

      const { error } = await supabase.from("loads").insert([payload]);
      if (error) throw error;

      onCreated?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || "Failed to create load.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Add Load</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900"
            aria-label="Close"
          >
            <X />
          </button>
        </div>

        {err && (
          <div className="mb-3 text-sm text-red-600 dark:text-red-400">
            {err}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Reference *"
              value={form.reference}
              onChange={(v) => setForm({ ...form, reference: v })}
              placeholder="AC-123456"
            />
            <Field
              label="Customer"
              value={form.customer}
              onChange={(v) => setForm({ ...form, customer: v })}
            />
            <Field
              label="Shipper"
              value={form.shipper}
              onChange={(v) => setForm({ ...form, shipper: v })}
              placeholder="If blank, will use Customer"
            />
            <Field
              label="Broker"
              value={form.broker}
              onChange={(v) => setForm({ ...form, broker: v })}
            />
            <Field
              label="ETA"
              type="datetime-local"
              value={form.eta}
              onChange={(v) => setForm({ ...form, eta: v })}
            />
            <Field
              label="Origin City"
              value={form.origin_city}
              onChange={(v) => setForm({ ...form, origin_city: v })}
            />
            <Field
              label="Origin State"
              value={form.origin_state}
              onChange={(v) => setForm({ ...form, origin_state: v })}
              placeholder="CA"
              maxLength={2}
            />
            <Field
              label="Dest City"
              value={form.dest_city}
              onChange={(v) => setForm({ ...form, dest_city: v })}
            />
            <Field
              label="Dest State"
              value={form.dest_state}
              onChange={(v) => setForm({ ...form, dest_state: v })}
              placeholder="TX"
              maxLength={2}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={[
                "AVAILABLE",
                "IN_TRANSIT",
                "DELIVERED",
                "CANCELLED",
                "PROBLEM",
              ]}
            />
            <Checkbox
              label="Problem"
              checked={form.problem_flag}
              onChange={(v) => setForm({ ...form, problem_flag: v })}
            />
            <Checkbox
              label="At Risk"
              checked={form.at_risk}
              onChange={(v) => setForm({ ...form, at_risk: v })}
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

function Field({ label, value, onChange, type = "text", placeholder = "", maxLength }) {
  return (
    <label className="block">
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
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 mt-6">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
