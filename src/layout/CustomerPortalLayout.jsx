// FILE: src/layout/CustomerPortalLayout.jsx
// Purpose:
// - Shell layout for the external Customer Portal under /portal/*.
// - Built for shippers/brokers to see ONLY their shipments (once RLS + roles are wired).
// - For now, it:
//    • Checks Supabase auth on the client
//    • If NOT logged in → shows a "Sign in" screen that links to /login
//    • If logged in      → loads shipments from the `loads` table (RLS still fully applies)
// - Contains its own nested routes for:
//    • /portal                  → CustomerShipmentsList
//    • /portal/shipments/:id    → CustomerShipmentDetail
//
// SECURITY NOTES:
// - This file does NOT modify RLS or any backend security.
// - All Supabase queries use the standard client, so RLS is enforced as usual.
// - Later, we will:
//    • Add "customer" users in Supabase Auth (with metadata like customer_id)
//    • Add RLS policies so those users only see loads for their customer_id
//    • Update the queries here to filter by that customer_id where needed.

import React, { useEffect, useState, useMemo } from "react";
import {
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Package,
  MapPin,
  Clock,
  CheckCircle2,
  ArrowLeft,
  LogOut,
  Loader2,
} from "lucide-react";
import { supabase } from "../lib/supabase";

// Small helper for safe className joining
function cx(...a) {
  return a.filter(Boolean).join(" ");
}

// Helper to produce a customer-friendly load display, without exposing raw UUIDs
function getLoadDisplay(shipment) {
  if (!shipment) {
    return {
      title: "Shipment",
      subtitle: "",
      customerRef: "",
      loadNum: "",
    };
  }

  const customerRef = (shipment.customer_reference || "").toString().trim();
  const loadNum =
    shipment.load_number != null
      ? shipment.load_number.toString().trim()
      : "";
  const internalId = shipment.id ? String(shipment.id) : "";

  let title = "";
  let subtitle = "";

  if (customerRef && loadNum) {
    // Customer-facing reference first, Atlas load number as a helper
    title = customerRef;
    subtitle = `Atlas Load #: ${loadNum}`;
  } else if (customerRef) {
    // Only customer reference available
    title = customerRef;
  } else if (loadNum) {
    // Only internal load number available
    title = `Atlas Load #${loadNum}`;
  } else if (internalId) {
    // Fall back to a SHORT, non-ugly internal id (no full UUID)
    const shortId = internalId.replace(/-/g, "").slice(0, 8).toUpperCase();
    title = `Load #${shortId}`;
  } else {
    title = "Shipment";
  }

  return { title, subtitle, customerRef, loadNum };
}

// Classify a status as ACTIVE / COMPLETED / OTHER for filtering
function classifyStatus(statusRaw) {
  const s = (statusRaw || "").toString().toUpperCase();

  if (!s) return "OTHER";

  if (s.includes("DELIVER") || s.includes("DELVD")) {
    return "COMPLETED";
  }
  if (s.includes("CANCEL")) {
    return "COMPLETED";
  }
  if (
    s.includes("TRANSIT") ||
    s.includes("PICK") ||
    s.includes("DISPATCH") ||
    s.includes("ENROUTE") ||
    s.includes("EN ROUTE")
  ) {
    return "ACTIVE";
  }
  return "OTHER";
}

/* ----------------------------- Shell layout ----------------------------- */

export default function CustomerPortalLayout() {
  const [loadingUser, setLoadingUser] = useState(true);
  const [user, setUser] = useState(null);

  // Carrier/org branding
  const [orgName, setOrgName] = useState("");
  const [orgLogoUrl, setOrgLogoUrl] = useState("");
  const [loadingOrg, setLoadingOrg] = useState(true);

  const navigate = useNavigate();

  // Load Supabase auth user (customer or internal)
  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (cancelled) return;

        if (error) {
          console.warn("[CustomerPortal] getUser error:", error.message);
          setUser(null);
        } else {
          setUser(data?.user ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[CustomerPortal] getUser exception:", e);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingUser(false);
        }
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the current org name + logo (for "For {Carrier}" in the header)
  useEffect(() => {
    let cancelled = false;

    async function loadOrg() {
      try {
        const { data, error } = await supabase
          .from("orgs")
          .select("name, logo_url")
          .limit(1)
          .single();

        if (cancelled) return;

        if (error) {
          console.warn("[CustomerPortal] org load error:", error);
          setOrgName("");
          setOrgLogoUrl("");
        } else {
          setOrgName(data?.name || "");
          setOrgLogoUrl(data?.logo_url || "");
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[CustomerPortal] org load exception:", e);
          setOrgName("");
          setOrgLogoUrl("");
        }
      } finally {
        if (!cancelled) {
          setLoadingOrg(false);
        }
      }
    }

    loadOrg();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("[CustomerPortal] signOut error:", e);
    } finally {
      navigate("/login", { replace: true });
    }
  }

  const userEmail = useMemo(
    () => user?.email || user?.user_metadata?.email || "",
    [user]
  );

  // While we don't know if they are logged in, just show a simple full-screen loader
  if (loadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm text-gray-400">Loading your portal…</p>
        </div>
      </div>
    );
  }

  // If not logged in, show a simple "Sign in" screen.
  // For now this sends them to the existing /login page.
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/80 p-6 space-y-4">
          <h1 className="text-xl font-semibold">Atlas Customer Portal</h1>
          <p className="text-sm text-gray-400">
            You need to sign in to view your shipments. Use the secure login
            provided by your carrier.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-2 text-sm transition"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  // Logged-in view: show the customer shell + nested routes
  return (
    <div className="min-h-screen bg-[var(--bg-app,#020617)] text-[var(--text-base,#e5e7eb)]">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Carrier logo or fallback icon */}
            <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/40 grid place-items-center overflow-hidden">
              {orgLogoUrl ? (
                <img
                  src={orgLogoUrl}
                  alt={orgName || "Carrier logo"}
                  className="h-full w-full object-contain"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Package className="h-4 w-4 text-emerald-400" />
              )}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs uppercase tracking-wide text-emerald-400">
                Atlas Command
              </span>
              <span className="text-sm font-semibold">Customer Portal</span>
              <span className="text-[11px] text-gray-400">
                {loadingOrg
                  ? "For your carrier"
                  : orgName
                  ? `For ${orgName}`
                  : "For your carrier"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-xs text-gray-400">Signed in as</span>
              <span className="text-xs font-medium truncate max-w-[200px]">
                {userEmail || "Customer User"}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 transition"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main content area with nested routes */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<CustomerShipmentsList />} />
          <Route path="shipments/:id" element={<CustomerShipmentDetail />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/* ------------------------- Shipments list page ------------------------- */

function CustomerShipmentsList() {
  const [loading, setLoading] = useState(true);
  const [shipments, setShipments] = useState([]);
  const [error, setError] = useState("");

  // Search + status filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE"); // ACTIVE | COMPLETED | ALL

  useEffect(() => {
    let cancelled = false;

    async function loadShipments() {
      setLoading(true);
      setError("");
      try {
        // NOTE:
        // - This uses RLS exactly as configured on `loads`.
        // - For internal org users, this will show their org's loads.
        // - For future "customer" users, RLS will limit rows to their customer_id.
        const { data, error } = await supabase
          .from("loads")
          .select("*")
          .order("pickup_date", { ascending: false })
          .limit(200);

        if (cancelled) return;

        if (error) {
          console.error("[CustomerShipmentsList] load error:", error);
          setError("We couldn't load your shipments. Please try again.");
          setShipments([]);
        } else {
          setShipments(data || []);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[CustomerShipmentsList] exception:", e);
          setError("Something went wrong while loading shipments.");
          setShipments([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadShipments();
    return () => {
      cancelled = true;
    };
  }, []);

  // Derived, filtered list in memory
  const filteredShipments = useMemo(() => {
    let list = shipments || [];
    const q = search.trim().toLowerCase();

    if (statusFilter !== "ALL") {
      list = list.filter((s) => {
        const cls = classifyStatus(s.status);
        if (statusFilter === "ACTIVE") return cls === "ACTIVE";
        if (statusFilter === "COMPLETED") return cls === "COMPLETED";
        return true;
      });
    }

    if (!q) return list;

    return list.filter((s) => {
      const { title, subtitle } = getLoadDisplay(s);
      const origin =
        s.origin_city || s.pickup_city || s.origin || "";
      const dest =
        s.destination_city || s.delivery_city || s.destination || "";
      const haystack = [
        title,
        subtitle,
        s.customer_reference,
        s.load_number,
        origin,
        dest,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [shipments, search, statusFilter]);

  const hasShipments = filteredShipments && filteredShipments.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Your Shipments</h1>
          <p className="text-xs text-gray-400">
            Live status view of the loads your carrier is moving for you.
          </p>
        </div>

        {/* Search + count */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:block text-[11px] text-gray-500">
            {filteredShipments.length} of {shipments.length} shipments
          </div>
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search loads, cities, refs…"
              className="w-48 sm:w-64 rounded-xl bg-black/40 border border-white/15 px-3 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-gray-500 mr-1">Show:</span>
        {["ACTIVE", "COMPLETED", "ALL"].map((f) => {
          const label =
            f === "ACTIVE" ? "Active" : f === "COMPLETED" ? "Completed" : "All";
          const isActive = statusFilter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={cx(
                "px-3 py-1 rounded-full border text-[11px] transition",
                isActive
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-black/20 text-gray-300 hover:bg-white/5"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-sm">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              <p className="text-xs text-gray-400">
                Loading your shipments…
              </p>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="p-6 text-sm text-red-300">{error}</div>
        )}

        {!loading && !error && !hasShipments && (
          <div className="p-6 text-sm text-gray-400">
            No shipments found with your current filters. Try adjusting the
            status filter or clearing your search.
          </div>
        )}

        {!loading && !error && hasShipments && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80 border-b border-white/10">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-xs text-gray-400">
                    Load
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-xs text-gray-400">
                    Origin → Destination
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-xs text-gray-400">
                    Pickup
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-xs text-gray-400">
                    Delivery / ETA
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-xs text-gray-400">
                    Status
                  </th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredShipments.map((s) => (
                  <ShipmentRow key={s.id} shipment={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------- Single shipment row UI ------------------------ */

function ShipmentRow({ shipment }) {
  const { title, subtitle } = getLoadDisplay(shipment);

  const origin =
    shipment.origin_city || shipment.pickup_city || shipment.origin || "";
  const originState =
    shipment.origin_state ||
    shipment.pickup_state ||
    shipment.origin_state_code ||
    "";
  const dest =
    shipment.destination_city ||
    shipment.delivery_city ||
    shipment.destination ||
    "";
  const destState =
    shipment.destination_state ||
    shipment.delivery_state ||
    shipment.destination_state_code ||
    "";

  const pickupDate =
    shipment.pickup_date ||
    shipment.pickup_at ||
    shipment.scheduled_pickup_at ||
    null;
  const deliveryDate =
    shipment.delivery_date ||
    shipment.delivery_at ||
    shipment.scheduled_delivery_at ||
    null;
  const eta = shipment.eta || shipment.eta_at || null;

  const status = (shipment.status || "").toString();

  function formatDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "-";
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  function statusBadge(statusRaw) {
    if (!statusRaw) {
      return (
        <span className="inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-gray-300">
          Unknown
        </span>
      );
    }

    const s = statusRaw.toString().toUpperCase();

    if (s.includes("DELIVER")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 text-[10px]">
          <CheckCircle2 className="h-3 w-3" />
          Delivered
        </span>
      );
    }
    if (s.includes("TRANSIT")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40 px-2 py-0.5 text-[10px]">
          <Clock className="h-3 w-3" />
          In transit
        </span>
      );
    }
    if (s.includes("PICK") || s.includes("AT ORIGIN")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 px-2 py-0.5 text-[10px]">
          <Clock className="h-3 w-3" />
          At pickup
        </span>
      );
    }

    return (
      <span className="inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-gray-300">
        {statusRaw}
      </span>
    );
  }

  return (
    <tr className="border-t border-white/5 hover:bg-white/5 transition">
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-slate-800 grid place-items-center">
            <Package className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold">{title}</span>
            {subtitle && (
              <span className="text-[11px] text-gray-400">{subtitle}</span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-gray-400" />
            <span className="truncate">
              {origin || "Origin"}{" "}
              {originState && (
                <span className="text-gray-400">({originState})</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1 text-gray-400">
            <span className="text-[10px]">→</span>
            <span className="truncate">
              {dest || "Destination"}{" "}
              {destState && (
                <span className="text-gray-400">({destState})</span>
              )}
            </span>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 align-top text-xs text-gray-200">
        {formatDate(pickupDate)}
      </td>
      <td className="px-4 py-3 align-top text-xs text-gray-200">
        <div className="flex flex-col gap-0.5">
          <span>{formatDate(deliveryDate)}</span>
          {eta && (
            <span className="text-[10px] text-gray-400">
              ETA: {formatDate(eta)}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top text-xs">
        {statusBadge(status)}
      </td>
      <td className="px-4 py-3 align-top text-right">
        <Link
          to={`/portal/shipments/${shipment.id}`}
          className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[11px] text-gray-100 hover:bg-white/10 transition"
        >
          View
        </Link>
      </td>
    </tr>
  );
}

/* ---------------------- Shipment detail page UI ----------------------- */

function CustomerShipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [shipment, setShipment] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadShipment() {
      setLoading(true);
      setError("");
      try {
        const { data, error } = await supabase
          .from("loads")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error("[CustomerShipmentDetail] load error:", error);
          setError("We couldn't find that shipment.");
          setShipment(null);
        } else {
          setShipment(data || null);
          if (!data) {
            setError("We couldn't find that shipment.");
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[CustomerShipmentDetail] exception:", e);
          setError("Something went wrong while loading this shipment.");
          setShipment(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (id) {
      loadShipment();
    }

    return () => {
      cancelled = true;
    };
  }, [id]);

  const { title: loadTitle, subtitle: loadSubtitle } = getLoadDisplay(shipment);

  const origin =
    shipment?.origin_city || shipment?.pickup_city || shipment?.origin || "";
  const originState =
    shipment?.origin_state ||
    shipment?.pickup_state ||
    shipment?.origin_state_code ||
    "";
  const dest =
    shipment?.destination_city ||
    shipment?.delivery_city ||
    shipment?.destination ||
    "";
  const destState =
    shipment?.destination_state ||
    shipment?.delivery_state ||
    shipment?.destination_state_code ||
    "";

  const pickupDate =
    shipment?.pickup_date ||
    shipment?.pickup_at ||
    shipment?.scheduled_pickup_at ||
    null;
  const deliveryDate =
    shipment?.delivery_date ||
    shipment?.delivery_at ||
    shipment?.scheduled_delivery_at ||
    null;
  const eta = shipment?.eta || shipment?.eta_at || null;
  const status = (shipment?.status || "").toString();

  function formatDateTime(d) {
    if (!d) return "-";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "-";
    return dt.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Simple timeline booleans
  const statusClass = classifyStatus(status);
  const hasPickup = !!pickupDate;
  const hasDelivery = !!deliveryDate;
  const isCompleted = statusClass === "COMPLETED";

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/10 transition"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/70 backdrop-blur-sm p-5">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              <p className="text-xs text-gray-400">
                Loading shipment details…
              </p>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="py-6 text-sm text-red-300">{error}</div>
        )}

        {!loading && !error && shipment && (
          <div className="space-y-6">
            {/* Top summary */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-slate-800 grid place-items-center">
                  <Package className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs uppercase tracking-wide text-gray-400">
                    Shipment
                  </span>
                  <span className="text-base font-semibold">
                    {loadTitle}
                  </span>
                  {loadSubtitle && (
                    <span className="text-[11px] text-gray-400">
                      {loadSubtitle}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right text-xs text-gray-300">
                <div className="mb-1">
                  <span className="text-gray-400">Status: </span>
                  <span className="font-medium">{status || "Unknown"}</span>
                </div>
                {eta && (
                  <div>
                    <span className="text-gray-400">Current ETA: </span>
                    <span className="font-medium">
                      {formatDateTime(eta)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Route + dates + simple timeline */}
            <div className="grid gap-4 md:grid-cols-3 text-xs">
              {/* Route */}
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                <h2 className="text-[11px] uppercase tracking-wide text-gray-400">
                  Route
                </h2>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-gray-400" />
                    <span>
                      {origin || "Origin"}{" "}
                      {originState && (
                        <span className="text-gray-400">({originState})</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <span className="text-[10px]">→</span>
                    <span>
                      {dest || "Destination"}{" "}
                      {destState && (
                        <span className="text-gray-400">({destState})</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Timing */}
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                <h2 className="text-[11px] uppercase tracking-wide text-gray-400">
                  Timing
                </h2>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    <span>
                      Pickup:&nbsp;
                      <span className="font-medium">
                        {formatDateTime(pickupDate)}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-gray-400" />
                    <span>
                      Delivery:&nbsp;
                      <span className="font-medium">
                        {formatDateTime(deliveryDate)}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Simple status timeline */}
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                <h2 className="text-[11px] uppercase tracking-wide text-gray-400">
                  Status timeline
                </h2>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <div
                      className={cx(
                        "mt-0.5 h-2 w-2 rounded-full",
                        hasPickup ? "bg-emerald-400" : "bg-gray-500"
                      )}
                    />
                    <div>
                      <div className="text-[11px] font-medium">
                        Pickup scheduled
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {formatDateTime(pickupDate)}
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <div
                      className={cx(
                        "mt-0.5 h-2 w-2 rounded-full",
                        statusClass === "ACTIVE"
                          ? "bg-emerald-400"
                          : "bg-gray-500"
                      )}
                    />
                    <div>
                      <div className="text-[11px] font-medium">
                        In transit
                      </div>
                      <div className="text-[11px] text-gray-400">
                        Based on current status and ETA
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <div
                      className={cx(
                        "mt-0.5 h-2 w-2 rounded-full",
                        isCompleted && hasDelivery
                          ? "bg-emerald-400"
                          : "bg-gray-500"
                      )}
                    />
                    <div>
                      <div className="text-[11px] font-medium">Delivered</div>
                      <div className="text-[11px] text-gray-400">
                        {formatDateTime(deliveryDate)}
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            {/* Notes / Documents placeholder */}
            <div className="rounded-xl border border-dashed border-white/15 bg-black/10 p-4 text-xs text-gray-400 space-y-1">
              <div className="font-medium text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                Notes & documents
              </div>
              <p>
                In a future update, this section will show any check call notes,
                updates from your carrier, and links to documents like BOL, POD,
                and invoices that your carrier chooses to share with you.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
