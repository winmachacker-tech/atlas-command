// src/pages/DriverDetail.jsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Loader2, ArrowLeft, Truck, Mail, Phone, IdCard } from "lucide-react";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function DriverDetail() {
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let ignore = false;
    async function run() {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase
        .from("drivers")
        .select(
          `
          id, first_name, last_name, email, phone, status,
          license_number, license_state, license_expiry,
          truck_id, truck_number, created_at, updated_at
        `
        )
        .eq("id", id)
        .maybeSingle();
      if (!ignore) {
        if (error) {
          setErr(error.message);
          setRow(null);
        } else {
          setRow(data);
        }
        setLoading(false);
      }
    }
    run();
    return () => {
      ignore = true;
    };
  }, [id]);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/drivers"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-900"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </Link>
          <h1 className="text-2xl font-semibold">Driver</h1>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading…</span>
          </div>
        ) : err ? (
          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-red-700 dark:text-red-200">
            {err}
          </div>
        ) : !row ? (
          <div className="rounded-xl border border-zinc-200 dark:border-neutral-800 p-6">Not found.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="lg:col-span-2 rounded-2xl border border-zinc-200 dark:border-neutral-800 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xl font-medium">
                    {row.first_name} {row.last_name}
                  </div>
                  <div className="text-xs text-zinc-500">ID: {row.id}</div>
                </div>
                <span
                  className={cx(
                    "text-xs px-2 py-1 rounded-lg",
                    row.status === "ACTIVE"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  )}
                >
                  {row.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Info label="Email" icon={<Mail className="w-4 h-4" />}>
                  {row.email || "—"}
                </Info>
                <Info label="Phone" icon={<Phone className="w-4 h-4" />}>
                  {row.phone || "—"}
                </Info>
                <Info label="License #" icon={<IdCard className="w-4 h-4" />}>
                  {row.license_number || "—"}
                </Info>
                <Info label="License State">{row.license_state || "—"}</Info>
                <Info label="License Expiry">
                  {row.license_expiry ? new Date(row.license_expiry).toLocaleDateString() : "—"}
                </Info>
              </div>

              <div className="mt-6">
                <div className="text-sm font-medium mb-2">Timestamps</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="text-zinc-500">
                    Created:{" "}
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {new Date(row.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-zinc-500">
                    Updated:{" "}
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {new Date(row.updated_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 dark:border-neutral-800 p-4">
              <div className="text-sm font-medium mb-3">Current Truck</div>
              {row.truck_id ? (
                <Link
                  to={`/trucks`}
                  className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
                  title="Open Trucks"
                >
                  <Truck className="w-4 h-4" />
                  {row.truck_number || row.truck_id}
                </Link>
              ) : (
                <div className="text-sm text-zinc-500">—</div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, children, icon = null }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-neutral-800 p-3">
      <div className="text-xs text-zinc-500 flex items-center gap-2">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
