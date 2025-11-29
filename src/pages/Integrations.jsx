// src/pages/Integrations.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plug,
  MapPin,
  ExternalLink,
  DollarSign,
  FileText,
  CreditCard,
  Truck,
  Cloud,
  CloudRain,
  MessageSquare,
  Mail,
  Receipt,
  RefreshCw,
} from "lucide-react";

// Import logos for services without reliable CDN URLs
import resendLogo from "../assets/logos/resend.png";
import motiveLogo from "../assets/logos/motive.png";
import eiaLogo from "../assets/logos/eia.png";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

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
        ) : (
          <AlertCircle className="h-4 w-4" />
        )}
        <span>{children}</span>
      </div>
    </div>
  );
}

function IntegrationCard({
  icon: Icon,
  name,
  description,
  status, // 'connected' | 'available' | 'premium'
  onConnect,
  onConfigure,
  onDisconnect,
  badge,
  logo, // Optional logo URL or path
  connecting, // Optional loading state
}) {
  const isConnected = status === "connected";
  const isPremium = status === "premium";
  const isAvailable = status === "available";

  return (
    <div
      className={cx(
        "rounded-2xl border p-6 transition",
        isConnected
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-white/10 bg-[#12151b]",
        isPremium && "opacity-60"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cx(
              "inline-flex h-12 w-12 items-center justify-center rounded-xl",
              isConnected ? "bg-emerald-500/20" : "bg-white/5"
            )}
          >
            {logo ? (
              <>
                <img
                  src={logo}
                  alt={`${name} logo`}
                  className="h-7 w-7 object-contain"
                  onError={(e) => {
                    // Fallback to icon if logo fails to load
                    e.target.style.display = "none";
                    const sibling = e.target.nextSibling;
                    if (sibling) sibling.style.display = "block";
                  }}
                />
                <Icon
                  className={cx(
                    "h-6 w-6 hidden",
                    isConnected ? "text-emerald-400" : "text-white/70"
                  )}
                />
              </>
            ) : (
              <Icon
                className={cx(
                  "h-6 w-6",
                  isConnected ? "text-emerald-400" : "text-white/70"
                )}
              />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{name}</h3>
              {badge && (
                <span
                  className={cx(
                    "text-xs px-2 py-0.5 rounded-full",
                    badge === "Connected" &&
                      "bg-emerald-500/20 text-emerald-300",
                    badge === "Free" && "bg-sky-500/20 text-sky-300",
                    badge === "Premium" && "bg-amber-500/20 text-amber-300"
                  )}
                >
                  {badge}
                </span>
              )}
            </div>
            <p className="text-sm text-white/60 mt-0.5">{description}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isConnected && (
          <>
            {onConfigure && (
              <button
                onClick={onConfigure}
                className="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition"
              >
                Configure
              </button>
            )}
            {onDisconnect && (
              <button
                onClick={onDisconnect}
                className="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 transition"
              >
                Disconnect
              </button>
            )}
          </>
        )}

        {isAvailable && onConnect && (
          <button
            onClick={onConnect}
            disabled={connecting}
            className={cx(
              "px-4 py-1.5 text-sm rounded-lg font-medium transition flex items-center gap-2",
              connecting
                ? "bg-amber-500/50 text-black/50 cursor-not-allowed"
                : "bg-amber-500/90 text-black hover:bg-amber-400"
            )}
          >
            {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
            {connecting ? "Connecting..." : "Connect"}
          </button>
        )}

        {isPremium && (
          <button
            disabled
            className="px-4 py-1.5 text-sm rounded-lg bg-white/5 text-white/40 cursor-not-allowed"
          >
            Coming Soon
          </button>
        )}
      </div>
    </div>
  );
}

export default function Integrations() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [user, setUser] = useState(null);
  const [googleMapsConnected, setGoogleMapsConnected] = useState(false);
  const [openWeatherConnected, setOpenWeatherConnected] = useState(false);
  const [emailConnected] = useState(true); // Email is now connected!
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [stripeConnecting, setStripeConnecting] = useState(false);

  // Motive integration state
  const [motiveConnected, setMotiveConnected] = useState(false);
  const [motiveConnection, setMotiveConnection] = useState(null);
  const [motiveConnecting, setMotiveConnecting] = useState(false);

  // Motive vehicle sync state
  const [motiveSyncLoading, setMotiveSyncLoading] = useState(false);
  const [motiveSyncLastRun, setMotiveSyncLastRun] = useState(null);
  const [motiveSyncStatus, setMotiveSyncStatus] = useState(null);
  const [motiveSyncVehicleCount, setMotiveSyncVehicleCount] = useState(null);

  // Load integrations
  useEffect(() => {
    let isMounted = true;

    async function run() {
      setLoading(true);
      setMsg(null);

      const {
        data: { session },
        error: sErr,
      } = await supabase.auth.getSession();
      if (sErr || !session?.user) {
        if (!isMounted) return;
        setUser(null);
        setLoading(false);
        return;
      }

      const u = session.user;
      if (!isMounted) return;
      setUser(u);

      // Check if Google Maps API key exists in env
      const hasGoogleMapsKey = !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
      setGoogleMapsConnected(hasGoogleMapsKey);

      // Check if OpenWeather API key exists in env
      const hasOpenWeatherKey = !!import.meta.env.VITE_OPENWEATHER_API_KEY;
      setOpenWeatherConnected(hasOpenWeatherKey);

      // Check if Stripe is configured (publishable key present)
      const hasStripeKey = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      setStripeConfigured(hasStripeKey);

      // Check Motive connection status (let RLS scope by org)
      try {
        const { data: motiveConn, error: motiveErr } = await supabase
          .from("motive_connections")
          .select("*")
          .limit(1)
          .maybeSingle();

        if (motiveErr) {
          console.error(
            "[Integrations] Error checking Motive connection:",
            motiveErr
          );
        } else if (motiveConn) {
          console.log(
            "[Integrations] Motive connection found for org:",
            motiveConn.org_id
          );
          setMotiveConnected(true);
          setMotiveConnection(motiveConn);
        } else {
          console.log(
            "[Integrations] No Motive connection visible for this user/org."
          );
        }
      } catch (err) {
        console.error(
          "[Integrations] Unexpected error checking Motive connection:",
          err
        );
      }

      // Load last Motive vehicle sync run (scoped by RLS to current org)
      try {
        const { data: lastRun, error: runErr } = await supabase
          .from("motive_sync_runs")
          .select("started_at, status, total_vehicles")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (runErr) {
          console.error(
            "[Integrations] Error loading Motive sync status:",
            runErr
          );
        } else if (lastRun) {
          setMotiveSyncLastRun(lastRun.started_at);
          setMotiveSyncStatus(lastRun.status);
          setMotiveSyncVehicleCount(lastRun.total_vehicles);
        }
      } catch (err) {
        console.error(
          "[Integrations] Unexpected error loading Motive sync status:",
          err
        );
      }

      setLoading(false);
    }

    run();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleGoogleMapsDisconnect = () => {
    setMsg({
      kind: "info",
      text:
        "To disconnect Google Maps, remove VITE_GOOGLE_MAPS_API_KEY from your .env file and restart the server.",
    });
  };

  const handleGoogleMapsConfigure = () => {
    setMsg({
      kind: "info",
      text: "API Key is stored in your .env file. Edit VITE_GOOGLE_MAPS_API_KEY to change it.",
    });
  };

  const handleOpenWeatherDisconnect = () => {
    setMsg({
      kind: "info",
      text:
        "To disconnect OpenWeather, remove VITE_OPENWEATHER_API_KEY from your .env file and restart the server.",
    });
  };

  const handleOpenWeatherConfigure = () => {
    setMsg({
      kind: "info",
      text:
        "API Key is stored in your .env file. Edit VITE_OPENWEATHER_API_KEY to change it. Get a free API key at openweathermap.org/api",
    });
  };

  const handleEmailConfigure = () => {
    setMsg({
      kind: "success",
      text:
        "✅ Email notifications are ACTIVE! Emails automatically send when loads change to: ASSIGNED, IN_TRANSIT, or DELIVERED. Powered by Resend.",
    });
  };

  const handleEmailDisconnect = () => {
    setMsg({
      kind: "info",
      text:
        "To disable email notifications, run this in Supabase SQL Editor: DROP TRIGGER on_load_status_change ON loads;",
    });
  };

  // Motive: Connect via OAuth
  const handleMotiveConnect = () => {
    setMotiveConnecting(true);

    const clientId = import.meta.env.VITE_MOTIVE_CLIENT_ID;
    const redirectUri =
      import.meta.env.VITE_MOTIVE_REDIRECT_URI ||
      `${window.location.origin}/integrations/motive/callback`;
    const scope = "companies.read users.read vehicles.read";

    // Build OAuth URL
    const authUrl = new URL("https://gomotive.com/oauth/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);

    // Redirect to Motive OAuth
    window.location.href = authUrl.toString();
  };

  // Motive: Configure - show connection details
  const handleMotiveConfigure = () => {
    if (motiveConnection) {
      const expiresAt = new Date(motiveConnection.expires_at);
      const isExpired = expiresAt < new Date();
      const scope = motiveConnection.scope || "N/A";

      setMsg({
        kind: isExpired ? "error" : "success",
        text: isExpired
          ? `⚠️ Motive token expired on ${expiresAt.toLocaleString()}. Please reconnect.`
          : `✅ Motive connected! Scope: ${scope}. Token expires: ${expiresAt.toLocaleString()}`,
      });
    }
  };

  // Motive: Disconnect (FIXED: add WHERE clause)
  const handleMotiveDisconnect = async () => {
    if (
      !window.confirm(
        "Are you sure you want to disconnect Motive? This will remove the integration."
      )
    ) {
      return;
    }

    if (!motiveConnection || !motiveConnection.id) {
      setMsg({
        kind: "error",
        text:
          "No Motive connection record found to disconnect. Try refreshing the page.",
      });
      return;
    }

    try {
      console.log("[Motive] Disconnecting connection id:", motiveConnection.id);

      const { error } = await supabase
        .from("motive_connections")
        .delete()
        .eq("id", motiveConnection.id);

      if (error) {
        console.error("[Motive] Disconnect error:", error);
        setMsg({
          kind: "error",
          text: "Failed to disconnect Motive: " + error.message,
        });
        return;
      }

      setMotiveConnected(false);
      setMotiveConnection(null);
      setMsg({ kind: "success", text: "Motive has been disconnected." });
    } catch (err) {
      console.error("[Motive] Disconnect error:", err);
      setMsg({ kind: "error", text: "Failed to disconnect Motive." });
    }
  };

  // Motive: Vehicle sync
  const handleMotiveSyncVehicles = async () => {
    setMsg(null);
    setMotiveSyncLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "motive-sync-vehicles",
        {
          body: {},
        }
      );

      if (error) {
        console.error("[Motive] Vehicle sync error:", error);
        setMsg({
          kind: "error",
          text:
            error.message ||
            "Vehicle sync failed. Check Supabase logs for details.",
        });
        return;
      }

      console.log("[Motive] Vehicle sync response:", data);

      if (data?.lastRun) {
        setMotiveSyncLastRun(data.lastRun.started_at);
        setMotiveSyncStatus(data.lastRun.status);
        setMotiveSyncVehicleCount(data.lastRun.total_vehicles);
      }

      setMsg({
        kind: "success",
        text:
          data?.message ||
          "Motive vehicles synced successfully into Atlas Command.",
      });
    } catch (err) {
      console.error("[Motive] Vehicle sync error:", err);
      setMsg({
        kind: "error",
        text: "Vehicle sync failed. Check the console and Supabase logs.",
      });
    } finally {
      setMotiveSyncLoading(false);
    }
  };

  // Stripe: connect = send user to Stripe Checkout via Edge Function
  const handleStripeConnect = async () => {
    try {
      setMsg(null);
      setStripeConnecting(true);

      const successUrl = `${window.location.origin}/billing/success`;
      const cancelUrl = `${window.location.origin}/billing/cancel`;

      const { data, error } = await supabase.functions.invoke(
        "billing-create-checkout-session",
        {
          body: {
            origin: window.location.origin,
            success_url: successUrl,
            cancel_url: cancelUrl,
          },
        }
      );

      if (error) {
        console.error("[Stripe] Checkout session error:", error);
        setMsg({
          kind: "error",
          text:
            error.message ||
            "Unable to start Stripe checkout. Please try again or contact support.",
        });
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      } else {
        console.error("[Stripe] No checkout URL returned:", data);
        setMsg({
          kind: "error",
          text: "Stripe did not return a checkout URL. Please contact support.",
        });
      }
    } catch (err) {
      console.error("[Stripe] Unexpected error:", err);
      setMsg({
        kind: "error",
        text:
          "Unexpected error starting Stripe checkout. Check the console and your Supabase Edge Function logs.",
      });
    } finally {
      setStripeConnecting(false);
    }
  };

  // Stripe: configure = send them to /billing page in-app
  const handleStripeConfigure = () => {
    setMsg({
      kind: "info",
      text:
        "Billing is managed on your Atlas Command billing page. We'll open it in a new tab.",
    });
    window.open("/billing", "_blank", "noopener,noreferrer");
  };

  // Stripe: disconnect = informational only (no secret changes from frontend)
  const handleStripeDisconnect = () => {
    setMsg({
      kind: "info",
      text:
        "To fully disconnect Stripe and cancel your subscription, manage it in the Stripe customer portal or contact Atlas Command support. We don't delete subscriptions directly from the browser.",
    });
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2 text:white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading integrations…</span>
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
            You're not signed in. Please log in to manage integrations.
          </InlineAlert>
        </div>
      </div>
    );
  }

  const motiveLastSyncLabel = motiveSyncLastRun
    ? new Date(motiveSyncLastRun).toLocaleString()
    : "Never";

  const motiveStatusLabel = motiveSyncStatus
    ? motiveSyncStatus.charAt(0).toUpperCase() + motiveSyncStatus.slice(1)
    : "Not started";

  const motiveVehiclesLabel =
    motiveSyncVehicleCount !== null ? motiveSyncVehicleCount : "—";

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page Header */}
        <div className="rounded-2xl border border-white/10 bg-[#0f1318] p-6">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
              <Plug className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Integrations</h1>
              <p className="text-sm text-white/60">
                Connect third-party services to enhance Atlas Command
              </p>
            </div>
          </div>

          {msg && (
            <div className="mt-4">
              <InlineAlert kind={msg.kind}>{msg.text}</InlineAlert>
            </div>
          )}
        </div>

        {/* Email Status Banner */}
        {emailConnected && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-emerald-400" />
              <div className="flex-1">
                <p className="text-sm text-emerald-200 font-medium">
                  Email Notifications Active
                </p>
                <p className="text-sm text-emerald-200/80 mt-0.5">
                  Automatically sending emails to customers when load status
                  changes • Powered by Resend
                </p>
              </div>
              <a
                href="https://resend.com/emails"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-emerald-300 hover:text-emerald-200 flex items-center gap-1 transition"
              >
                View Logs <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        {/* Motive Connected Banner */}
        {motiveConnected && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-3">
              <img
                src={motiveLogo}
                alt="Motive"
                className="h-5 w-5 object-contain"
              />
              <div className="flex-1">
                <p className="text-sm text-emerald-200 font-medium">
                  Motive ELD Connected
                </p>
                <p className="text-sm text-emerald-200/80 mt-0.5">
                  GPS tracking, ELD compliance, and driver data synced • Scope:{" "}
                  {motiveConnection?.scope || "N/A"}
                </p>
              </div>
              <a
                href="https://gomotive.com/fleet-dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-emerald-300 hover:text-emerald-200 flex items-center gap-1 transition"
              >
                Motive Dashboard <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        {/* Mapping & Routing Section */}
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MapPin className="h-5 w-5 text-white/70" />
              Mapping & Routing
            </h2>
            <p className="text-sm text-white/60 mt-1">
              Calculate distances, routes, and ETAs
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationCard
              icon={MapPin}
              name="Google Maps"
              description="Calculate mileage between pickup and delivery locations"
              status={googleMapsConnected ? "connected" : "available"}
              badge={googleMapsConnected ? "Connected" : "Free"}
              onConfigure={handleGoogleMapsConfigure}
              onDisconnect={handleGoogleMapsDisconnect}
              logo="https://www.gstatic.com/images/branding/product/1x/maps_48dp.png"
            />

            <IntegrationCard
              icon={CloudRain}
              name="OpenWeather"
              description="Real-time weather conditions and alerts for pickup and delivery locations"
              status={openWeatherConnected ? "connected" : "available"}
              badge={openWeatherConnected ? "Connected" : "Free"}
              onConfigure={handleOpenWeatherConfigure}
              onDisconnect={handleOpenWeatherDisconnect}
              logo="https://openweathermap.org/themes/openweathermap/assets/img/logo_white_cropped.png"
            />
          </div>
        </div>

        {/* Accounting & Payments Section */}
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-white/70" />
              Accounting & Payments
            </h2>
            <p className="text-sm text-white/60 mt-1">
              Sync invoices, expenses, and payments
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationCard
              icon={FileText}
              name="QuickBooks Online"
              description="Automatically sync invoices, payments, and expense tracking"
              status="premium"
              badge="Premium"
              logo="https://plugin.intuitcdn.net/designsystem/assets/2023/06/14134215/quickbooks-logo.svg"
            />

            <IntegrationCard
              icon={CreditCard}
              name="Stripe"
              description={
                stripeConnecting
                  ? "Starting secure checkout…"
                  : "Accept credit card payments from customers instantly"
              }
              status={stripeConfigured ? "connected" : "available"}
              badge={stripeConfigured ? "Connected" : "Free"}
              logo="https://images.ctfassets.net/fzn2n1nzq965/HTTOloNPhisV9P4hlMPNA/cacf1bb88b9fc492dfad34378d844280/Stripe_icon_-_square.svg"
              onConnect={stripeConfigured ? undefined : handleStripeConnect}
              onConfigure={stripeConfigured ? handleStripeConfigure : undefined}
              onDisconnect={
                stripeConfigured ? handleStripeDisconnect : undefined
              }
              connecting={stripeConnecting}
            />

            <IntegrationCard
              icon={Receipt}
              name="EIA (Electronic Invoicing & Audit)"
              description="Automate freight bill auditing and invoice processing with carrier compliance"
              status="premium"
              badge="Premium"
              logo={eiaLogo}
            />
          </div>
        </div>

        {/* Fleet Tracking Section */}
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Truck className="h-5 w-5 text-white/70" />
              Fleet Tracking & ELD
            </h2>
            <p className="text-sm text-white/60 mt-1">
              Real-time GPS tracking and compliance
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationCard
              icon={Truck}
              name="Samsara"
              description="Real-time GPS tracking, ELD compliance, and fleet management"
              status="premium"
              badge="Premium"
              logo="https://cdn.samsara.com/wp-content/uploads/2021/08/samsara-logo-icon.png"
            />
            <IntegrationCard
              icon={Truck}
              name="Motive (KeepTruckin)"
              description={
                motiveConnecting
                  ? "Redirecting to Motive..."
                  : "ELD compliance, GPS tracking, and driver safety monitoring"
              }
              status={motiveConnected ? "connected" : "available"}
              badge={motiveConnected ? "Connected" : "Free"}
              logo={motiveLogo}
              onConnect={motiveConnected ? undefined : handleMotiveConnect}
              onConfigure={motiveConnected ? handleMotiveConfigure : undefined}
              onDisconnect={
                motiveConnected ? handleMotiveDisconnect : undefined
              }
              connecting={motiveConnecting}
            />
          </div>

          {/* Motive Vehicle Sync Panel */}
          {motiveConnected && (
            <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-[#0b1410] p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-emerald-200">
                  Motive Vehicle Sync
                </h3>
                <p className="text-xs text-emerald-100/80 mt-1 max-w-xl">
                  Mirror Motive vehicles into Atlas for AI dispatch and fleet
                  reporting.
                </p>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-emerald-100/70">
                  <span>
                    <span className="font-semibold">Last sync:</span>{" "}
                    {motiveLastSyncLabel}
                  </span>
                  <span>
                    <span className="font-semibold">Status:</span>{" "}
                    {motiveStatusLabel}
                  </span>
                  <span>
                    <span className="font-semibold">Vehicles:</span>{" "}
                    {motiveVehiclesLabel}
                  </span>
                </div>
              </div>
              <button
                onClick={handleMotiveSyncVehicles}
                disabled={motiveSyncLoading}
                className={cx(
                  "inline-flex items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold transition",
                  motiveSyncLoading
                    ? "bg-emerald-500/40 text-black/60 cursor-not-allowed"
                    : "bg-emerald-500 text-black hover:bg-emerald-400"
                )}
              >
                {motiveSyncLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync Vehicles
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Documents & Signatures Section */}
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-white/70" />
              Documents & E-Signatures
            </h2>
            <p className="text-sm text-white/60 mt-1">
              Digital signatures and document management
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationCard
              icon={FileText}
              name="DocuSign"
              description="E-signatures for rate confirmations, contracts, and BOLs"
              status="premium"
              badge="Premium"
              logo="https://www.docusign.com/themes/custom/basic/images/logo/logo.svg"
            />
            <IntegrationCard
              icon={Cloud}
              name="Google Drive"
              description="Store and manage BOLs, PODs, and shipping documents"
              status="premium"
              badge="Premium"
              logo="https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png"
            />
          </div>
        </div>

        {/* Communication Section */}
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-white/70" />
              Communication & Alerts
            </h2>
            <p className="text-sm text-white/60 mt-1">
              Keep drivers and customers informed
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationCard
              icon={MessageSquare}
              name="OpenAI"
              description="AI-powered dispatch assistant and intelligent load matching"
              status="connected"
              badge="Connected"
              onConfigure={() =>
                setMsg({
                  kind: "info",
                  text: "OpenAI integration is configured and active.",
                })
              }
              onDisconnect={() =>
                setMsg({
                  kind: "info",
                  text:
                    "OpenAI integration cannot be disconnected as it's a core feature.",
                })
              }
              logo="https://openai.com/favicon.ico"
            />

            <IntegrationCard
              icon={Mail}
              name="Gmail / Email"
              description="Send automated load confirmations and delivery notifications"
              status="connected"
              badge="Connected"
              onConfigure={handleEmailConfigure}
              onDisconnect={handleEmailDisconnect}
              logo={resendLogo}
            />

            <IntegrationCard
              icon={MessageSquare}
              name="Twilio SMS"
              description="Send SMS notifications to drivers and receive status updates"
              status="premium"
              badge="Premium"
              logo="https://www.twilio.com/content/dam/twilio-com/global/en/products/twilio-logo-red.svg"
            />
          </div>
        </div>

        {/* Info Box */}
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-sky-400 mt-0.5" />
            <div>
              <p className="text-sm text-sky-200 font-medium">
                Premium Integrations Coming Soon
              </p>
              <p className="text-sm text-sky-200/80 mt-1">
                We're actively working on these integrations. Contact us to be
                notified when they're ready for your account.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
