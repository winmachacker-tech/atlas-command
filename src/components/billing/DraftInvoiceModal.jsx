// src/components/billing/DraftInvoiceModal.jsx
import { useEffect, useMemo, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";

/* ----------------------------- helpers ----------------------------- */
const money = (n) => Number(Number(n || 0).toFixed(2));
const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(money(n));

function computeDefaultAmount(load) {
  // Flexible mapping: we try common fields and add up anything present
  const lh =
    Number(load?.linehaul) ||
    Number(load?.rate) ||
    Number(load?.total_rate) ||
    0;
  const fuel = Number(load?.fuel_surcharge) || 0;

  const accSum = Array.isArray(load?.accessorials)
    ? load.accessorials
        .filter(Boolean)
        .reduce(
          (a, x) =>
            a +
            (Number(x?.amount) ||
              Number(x?.rate) * (Number(x?.quantity) || 1) ||
              0),
          0
        )
    : 0;

  return money(lh + fuel + accSum);
}

function buildDefaultInvoiceNumber(load) {
  const ref = String(load?.reference || "").replace(/\s+/g, "");
  if (ref) return `INV-${ref}`;
  const id = String(load?.id || "").slice(0, 8).toUpperCase();
  return `INV-${id || Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function defaultNotes(load) {
  const parts = [
    load?.po_number ? `PO: ${load.po_number}` : null,
    load?.pro_number ? `PRO: ${load.pro_number}` : null,
    load?.reference ? `Reference: ${load.reference}` : null,
    load?.dispatcher_name ? `Dispatcher: ${load.dispatcher_name}` : null,
    load?.driver_name ? `Driver: ${load.driver_name}` : null,
  ].filter(Boolean);
  return parts.join(" â€¢ ");
}

/* ------------------------------ component ------------------------------ */
export default function DraftInvoiceModal({
  open,
  onClose,
  load,           // required: the selected load object
  onSaved,        // optional: callback(savedRow) after successful save
}) {
  const [me, setMe] = useState(null); // { id, email, full_name, company_name }
  const [saving, setSaving] = useState(false);

  // form state
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [assignee, setAssignee] = useState(""); // email or name
  const [notes, setNotes] = useState("");

  // fetch signed-in user's profile for default "Assigned Biller"
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("users")
          .select("id, email, full_name, company_name")
          .eq("id", user.id)
          .single();
        if (alive) setMe(data || { id: user.id, email: user.email });
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, []);

  // prefill when modal opens or load changes
  useEffect(() => {
    if (!open || !load) return;
    setInvoiceNumber((prev) => prev || buildDefaultInvoiceNumber(load));
    setAmount((prev) => (prev ? prev : String(computeDefaultAmount(load) || "")));
    setAssignee((prev) => prev || me?.email || me?.full_name || "");
    setNotes((prev) => prev || defaultNotes(load));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load, me?.email, me?.full_name]);

  const customerName = useMemo(() => {
    return (
      load?.bill_to?.name ||
      load?.consignee?.name ||
      load?.customer_name ||
      "Customer"
    );
  }, [load]);

  const statusLabel = useMemo(() => {
    // Fallback to Delivered if not provided
    return (load?.status || "Delivered") + " â€”";
  }, [load]);

  async function handleSave() {
    if (!load) return;
    setSaving(true);
    try {
      const payload = {
        load_id: load.id,
        number: invoiceNumber?.trim(),
        amount: money(amount),
        assigned_biller: assignee?.trim() || null,
        notes: notes?.trim() || null,
        status: "DRAFT", // keep drafts in the same table; adjust if you have a separate drafts table
        created_by: me?.id || null,
      };

      // Insert into invoices as DRAFT (adjust table/columns if yours differ)
      const { data, error } = await supabase.from("invoices").insert(payload).select().single();
      if (error) throw error;

      // Optionally, mark load as BILLING queue if that's your flow:
      // await supabase.from("loads").update({ status: "BILLING" }).eq("id", load.id);

      // notify caller
      onSaved?.(data);

      // Simple success toast fallback
      // If you have your own toast system, trigger it where you render this modal.
      alert("Draft invoice saved.");
      onClose?.();
    } catch (e) {
      alert("Failed to save draft: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* dialog */}
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-emerald-500/40 bg-[var(--bg-surface)] text-[var(--text-base)] shadow-2xl">
          {/* header */}
          <div className="flex items-start justify-between gap-3 p-5 pb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Draft Invoice for</div>
              <div className="text-2xl font-semibold leading-tight">
                {customerName}
              </div>
              <div className="text-xs mt-1 text-[var(--text-muted)]">
                {statusLabel}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 p-2 hover:bg-white/5"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* body */}
          <div className="px-5 pb-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[var(--text-muted)]">Invoice #</label>
                <input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-10234"
                  className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="text-sm text-[var(--text-muted)]">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 1450.00"
                  className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
                />
                {amount && (
                  <div className="mt-1 text-xs text-[var(--text-muted)]">= {fmtUSD(amount)}</div>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm text-[var(--text-muted)]">Assigned Biller</label>
              <input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="email or name"
                className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
              />
              {me?.company_name && (
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  Company: <span className="font-medium">{me.company_name}</span>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm text-[var(--text-muted)]">Notes (internal)</label>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any billing notesâ€¦"
                className="mt-1 w-full rounded-xl bg-transparent border border-white/10 px-3 py-2 outline-none focus:border-white/20"
              />
            </div>
          </div>

          {/* footer */}
          <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-xl border border-white/10 px-4 py-2 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-2 hover:bg-emerald-500/10 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />}
              Save Draft
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

