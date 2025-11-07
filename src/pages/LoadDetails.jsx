// src/pages/LoadDetails.jsx
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Truck,
  DollarSign,
  Clock,
  StickyNote,
  UserCheck,
  FileText,
} from "lucide-react";
import LoadDocuments from "../components/LoadDocuments";

function cx(...a) { return a.filter(Boolean).join(" "); }
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleString(); } catch { return String(d); } }

export default function LoadDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [load, setLoad] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      setErr("");
      try {
        // 1) Fetch ONLY the load (no join) so RLS on the view can't break it
        const { data: loadRow, error: loadErr } = await supabase
          .from("loads")
          .select("*")
          .eq("id", id)
          .single();

        if (loadErr) throw loadErr;
        if (!alive) return;

        // 2) If there's a driver_id, fetch the driver separately (from view or table)
        let driver = null;
        if (loadRow?.driver_id) {
          // Try the view first (keeps your active-only semantics)
          const { data: vDriver, error: vErr } = await supabase
            .from("v_drivers_active")
            .select("id, first_name, last_name, phone")
            .eq("id", loadRow.driver_id)
            .maybeSingle();

          if (vDriver) {
            driver = vDriver;
          } else if (vErr?.code !== "PGRST116") {
            // If the view returns nothing but not a permission error, fall back to drivers table
            const { data: tblDriver } = await supabase
              .from("drivers")
              .select("id, first_name, last_name, phone")
              .eq("id", loadRow.driver_id)
              .maybeSingle();
            if (tblDriver) driver = tblDriver;
          }
        }

        // 3) Attach driver (if any) to preserve your existing render code
        const merged = driver ? { ...loadRow, driver } : loadRow;
        if (alive) setLoad(merged);
      } catch (e) {
        if (alive) setErr(e?.message || "Failed to load details.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (busy) {
    return (
      <div className="flex items-center justify-center h-96 text-white/70">
        <Loader2 className="animate-spin w-5 h-5 mr-2" />
        Loading load details…
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6 space-y-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center text-white/70 hover:text-emerald-400"
        >
          <ArrowLeft className="w-5 h-5 mr-2" /> Back
        </button>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
        <Link to="/loads" className="text-emerald-400 hover:underline text-sm">
          ← Return to Loads
        </Link>
      </div>
    );
  }

  if (!load) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center text-white/70 hover:text-emerald-400"
        >
          <ArrowLeft className="w-5 h-5 mr-2" /> Back
        </button>
        <div className="mt-4 text-white/70">Load not found.</div>
        <Link to="/loads" className="mt-2 inline-block text-emerald-400 hover:underline text-sm">
          ← Return to Loads
        </Link>
      </div>
    );
  }

  const {
    reference,
    shipper,
    origin,
    destination,
    pickup_date,
    pickup_time,
    delivery_date,
    delivery_time,
    rate,
    status,
    notes,
    driver,
  } = load;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center text-white/70 hover:text-emerald-400"
        >
          <ArrowLeft className="w-5 h-5 mr-2" /> Back
        </button>

        <span
          className={cx(
            "px-3 py-1 rounded-xl text-xs border",
            status === "DELIVERED" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
            status === "IN_TRANSIT" ? "bg-sky-500/15 text-sky-300 border-sky-500/30" :
            status === "AT_RISK" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
            status === "PROBLEM" ? "bg-red-500/15 text-red-300 border-red-500/30" :
            "bg-white/10 text-white/70 border-white/20"
          )}
        >
          {status || "—"}
        </span>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-xl font-semibold">Load #{reference || id}</h1>
        <p className="text-sm text-white/60">{shipper || "—"}</p>
      </div>

      {/* Overview */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-white/80">
            <MapPin className="w-4 h-4" />
            <span>{origin || "—"}</span>
            <span className="mx-1 opacity-50">→</span>
            <span>{destination || "—"}</span>
          </div>

          <div className="flex items-center gap-2 text-sm text-white/70">
            <Clock className="w-4 h-4" />
            <span>
              Pickup: {pickup_date ? new Date(pickup_date).toLocaleDateString() : "—"}
              {pickup_time ? ` ${pickup_time}` : ""}
            </span>
            <span className="mx-2 opacity-40">|</span>
            <span>
              Delivery: {delivery_date ? new Date(delivery_date).toLocaleDateString() : "—"}
              {delivery_time ? ` ${delivery_time}` : ""}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm text-white/80">
            <DollarSign className="w-4 h-4" />
            <span>
              {rate
                ? `$${parseFloat(rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </span>
          </div>
        </div>

        {/* Driver */}
        <div className="rounded-xl border border-white/10 p-4 bg-white/5">
          <div className="text-sm font-medium mb-2 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-300" />
            Assigned Driver
          </div>
          {driver ? (
            <div className="text-sm">
              <div className="font-medium">
                {driver.last_name}, {driver.first_name}
              </div>
              <div className="text-white/60">{driver.phone || "—"}</div>
            </div>
          ) : (
            <div className="text-sm text-white/60 flex items-center gap-2">
              <Truck className="w-4 h-4" />
              No driver assigned.
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div>
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <StickyNote className="w-5 h-5" /> Notes
        </h3>
        <p className="bg-white/5 p-4 rounded-xl border border-white/10 text-sm text-white/80">
          {notes || "No notes yet."}
        </p>
      </div>

      {/* Documents */}
      <div>
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <FileText className="w-5 h-5" /> Documents
        </h3>
        <LoadDocuments loadId={load.id} />
      </div>

      {/* Secondary links */}
      <div className="pt-2 text-sm">
        <Link to="/loads" className="text-emerald-400 hover:underline">← Back to Loads</Link>
      </div>
    </div>
  );
}
