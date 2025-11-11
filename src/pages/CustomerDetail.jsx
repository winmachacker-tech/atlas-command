// src/pages/CustomerDetail.jsx
import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  Loader2,
  Edit,
  TrendingUp,
  Package,
  DollarSign,
  Truck,
} from "lucide-react";
import useRealtimeRefetch from "../hooks/useRealtimeRefetch";

/* ---------------- helpers ---------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function fmtCurrency(n) {
  if (!n && n !== 0) return "$—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "—";
  }
}

/* ---------------- main component ---------------- */
export default function CustomerDetail() {
  const { id: customerId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [loads, setLoads] = useState([]);
  const [error, setError] = useState("");

  /* --------------- fetch customer --------------- */
  const fetchCustomer = useCallback(async () => {
    if (!customerId) return;
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();
      if (err) throw err;
      setCustomer(data);
    } catch (err) {
      console.error("fetchCustomer error:", err);
      setError(err?.message || "Failed to load customer.");
    }
  }, [customerId]);

  /* --------------- fetch loads --------------- */
  const fetchLoads = useCallback(async () => {
    if (!customerId) return;
    try {
      const { data, error: err } = await supabase
        .from("loads")
        .select("*")
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (err) throw err;
      setLoads(data || []);
    } catch (err) {
      console.error("fetchLoads error:", err);
    }
  }, [customerId]);

  /* --------------- initial load --------------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await Promise.all([fetchCustomer(), fetchLoads()]);
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [fetchCustomer, fetchLoads]);

  /* --------------- realtime --------------- */
  useRealtimeRefetch({
    table: "customers",
    schema: "public",
    events: ["UPDATE"],
    filter: { column: "id", op: "eq", value: customerId },
    onAny: fetchCustomer,
  });

  useRealtimeRefetch({
    table: "loads",
    schema: "public",
    events: ["INSERT", "UPDATE"],
    filter: { column: "customer_id", op: "eq", value: customerId },
    onAny: fetchLoads,
  });

  /* --------------- stats --------------- */
  const stats = useMemo(() => {
    const totalLoads = loads.length;
    const delivered = loads.filter((l) => l.status === "delivered").length;
    const totalRevenue = loads.reduce((sum, l) => sum + (parseFloat(l.rate) || 0), 0);
    const avgRevenue = totalLoads > 0 ? totalRevenue / totalLoads : 0;

    return { totalLoads, delivered, totalRevenue, avgRevenue };
  }, [loads]);

  /* ---------------- UI ---------------- */
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-zinc-300">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading customer…
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/customers" className="inline-flex items-center gap-2 text-zinc-300 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          Back to Customers
        </Link>
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200">
          {error || "Customer not found"}
        </div>
      </div>
    );
  }

  const statusTone =
    customer.status === "active"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : "bg-zinc-700/40 text-zinc-400 border-zinc-600/60";

  const typeBadge = (() => {
    if (customer.customer_type === "broker")
      return (
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
          Broker
        </span>
      );
    if (customer.customer_type === "both")
      return (
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
          Both
        </span>
      );
    return (
      <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        Customer
      </span>
    );
  })();

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* ------ top nav ------ */}
      <div className="flex items-center justify-between">
        <Link to="/customers" className="inline-flex items-center gap-2 text-zinc-300 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          Back to Customers
        </Link>
        <button
          onClick={() => navigate(`/customers/${customerId}/edit`)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700/60 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-200"
        >
          <Edit className="w-4 h-4" />
          Edit
        </button>
      </div>

      {/* ------ header card ------ */}
      <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4 md:p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-zinc-800/60 border border-zinc-700 p-4">
            <Building2 className="w-8 h-8 text-zinc-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white truncate">
                {customer.company_name}
              </h1>
              <span className={cx("text-[11px] px-2.5 py-1 rounded-full border", statusTone)}>
                {customer.status}
              </span>
              {typeBadge}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-3">
              {customer.contact_name && (
                <div className="flex items-center gap-2 text-zinc-300">
                  <Building2 className="w-4 h-4 text-zinc-400" />
                  <span>{customer.contact_name}</span>
                </div>
              )}
              {customer.contact_phone && (
                <div className="flex items-center gap-2 text-zinc-300">
                  <Phone className="w-4 h-4 text-zinc-400" />
                  <span>{customer.contact_phone}</span>
                </div>
              )}
              {customer.contact_email && (
                <div className="flex items-center gap-2 text-zinc-300">
                  <Mail className="w-4 h-4 text-zinc-400" />
                  <span className="truncate">{customer.contact_email}</span>
                </div>
              )}
              {(customer.city || customer.state) && (
                <div className="flex items-center gap-2 text-zinc-300">
                  <MapPin className="w-4 h-4 text-zinc-400" />
                  <span>{[customer.city, customer.state].filter(Boolean).join(", ")}</span>
                </div>
              )}
            </div>

            {customer.mc_number && (
              <div className="text-xs text-zinc-500">MC# {customer.mc_number}</div>
            )}
            {customer.payment_terms && (
              <div className="text-xs text-zinc-500 mt-0.5">Payment: {customer.payment_terms}</div>
            )}
          </div>
        </div>
      </div>

      {/* ------ stats cards ------ */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Package className="w-5 h-5" />}
          label="Total Loads"
          value={stats.totalLoads}
          tone="sky"
        />
        <StatCard
          icon={<Truck className="w-5 h-5" />}
          label="Delivered"
          value={stats.delivered}
          tone="emerald"
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Total Revenue"
          value={fmtCurrency(stats.totalRevenue)}
          tone="amber"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Avg Revenue"
          value={fmtCurrency(stats.avgRevenue)}
          tone="purple"
        />
      </div>

      {/* ------ details grid ------ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Contact & Address */}
        <div className="xl:col-span-2 rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
          <div className="p-4 md:p-5 border-b border-zinc-700/60">
            <div className="text-sm font-medium text-zinc-200">Contact & Address Information</div>
          </div>
          <div className="p-4 md:p-5 space-y-4">
            {/* Primary Contact */}
            <Section title="Primary Contact">
              <InfoRow label="Name" value={customer.contact_name} />
              <InfoRow label="Phone" value={customer.contact_phone} />
              <InfoRow label="Email" value={customer.contact_email} />
            </Section>

            {/* Address */}
            {(customer.address_line1 || customer.city || customer.state) && (
              <Section title="Address">
                {customer.address_line1 && <div className="text-sm text-zinc-300">{customer.address_line1}</div>}
                {customer.address_line2 && <div className="text-sm text-zinc-300">{customer.address_line2}</div>}
                <div className="text-sm text-zinc-300">
                  {[customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ")}
                </div>
              </Section>
            )}

            {/* Billing Contact */}
            {(customer.billing_contact_name || customer.billing_contact_phone || customer.billing_contact_email) && (
              <Section title="Billing Contact">
                <InfoRow label="Name" value={customer.billing_contact_name} />
                <InfoRow label="Phone" value={customer.billing_contact_phone} />
                <InfoRow label="Email" value={customer.billing_contact_email} />
              </Section>
            )}
          </div>
        </div>

        {/* Business Info */}
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
          <div className="p-4 md:p-5 border-b border-zinc-700/60">
            <div className="text-sm font-medium text-zinc-200">Business Information</div>
          </div>
          <div className="p-4 md:p-5 space-y-3">
            <InfoRow label="Customer Type" value={customer.customer_type} />
            <InfoRow label="Status" value={customer.status} />
            <InfoRow label="MC Number" value={customer.mc_number} />
            <InfoRow label="DOT Number" value={customer.dot_number} />
            <InfoRow label="Payment Terms" value={customer.payment_terms} />
            <InfoRow label="Credit Limit" value={customer.credit_limit ? fmtCurrency(customer.credit_limit) : null} />
            {customer.notes && (
              <div>
                <div className="text-xs text-zinc-500 mb-1">Notes</div>
                <div className="text-sm text-zinc-300 whitespace-pre-wrap">{customer.notes}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------ load history ------ */}
      <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40">
        <div className="p-4 md:p-5 border-b border-zinc-700/60">
          <div className="text-sm font-medium text-zinc-200">Load History</div>
          <div className="text-xs text-zinc-500">Recent loads for this customer</div>
        </div>
        <div className="p-4 md:p-5">
          {loads.length === 0 ? (
            <div className="text-sm text-zinc-400 italic text-center py-8">No loads yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-zinc-800/70">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-400">Load #</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-400">Origin → Dest</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-400">Status</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-400">Rate</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-400">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {loads.slice(0, 20).map((load) => (
                    <tr key={load.id} className="hover:bg-zinc-800/30">
                      <td className="px-3 py-2 text-sm">
                        <Link
                          to={`/loads/${load.id}`}
                          className="text-sky-400 hover:text-sky-300 font-mono"
                        >
                          {load.load_number || load.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-sm text-zinc-300">
                        {load.origin_city || load.origin} → {load.dest_city || load.destination}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700/40 text-zinc-300">
                          {load.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-zinc-200">
                        {fmtCurrency(load.rate)}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">{fmtDate(load.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- sub-components ---------------- */

function StatCard({ icon, label, value, tone = "zinc" }) {
  const tones = {
    sky: "border-sky-700/50 bg-sky-700/10 text-sky-200",
    emerald: "border-emerald-700/50 bg-emerald-700/10 text-emerald-200",
    amber: "border-amber-700/50 bg-amber-700/10 text-amber-200",
    purple: "border-purple-700/50 bg-purple-700/10 text-purple-200",
    zinc: "border-zinc-700/50 bg-zinc-800/20 text-zinc-200",
  };

  return (
    <div className={cx("rounded-2xl border p-4", tones[tone] || tones.zinc)}>
      <div className="flex items-center gap-2 text-sm opacity-80 mb-2">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs font-medium text-zinc-400 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-300 text-right">{value}</span>
    </div>
  );
}