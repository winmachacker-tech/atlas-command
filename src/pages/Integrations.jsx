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
  MessageSquare,
  Mail,
} from "lucide-react";

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
        {kind === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
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
}) {
  const isConnected = status === 'connected';
  const isPremium = status === 'premium';
  const isAvailable = status === 'available';

  return (
    <div className={cx(
      "rounded-2xl border p-6 transition",
      isConnected ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10 bg-[#12151b]",
      isPremium && "opacity-60"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cx(
            "inline-flex h-12 w-12 items-center justify-center rounded-xl",
            isConnected ? "bg-emerald-500/20" : "bg-white/5"
          )}>
            <Icon className={cx("h-6 w-6", isConnected ? "text-emerald-400" : "text-white/70")} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{name}</h3>
              {badge && (
                <span className={cx(
                  "text-xs px-2 py-0.5 rounded-full",
                  badge === "Connected" && "bg-emerald-500/20 text-emerald-300",
                  badge === "Free" && "bg-sky-500/20 text-sky-300",
                  badge === "Premium" && "bg-amber-500/20 text-amber-300"
                )}>
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
            <button
              onClick={onConfigure}
              className="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition"
            >
              Configure
            </button>
            <button
              onClick={onDisconnect}
              className="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 transition"
            >
              Disconnect
            </button>
          </>
        )}
        
        {isAvailable && (
          <button
            onClick={onConnect}
            className="px-4 py-1.5 text-sm rounded-lg bg-amber-500/90 text-black font-medium hover:bg-amber-400 transition"
          >
            Connect
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

  // Load integrations
  useEffect(() => {
    let isMounted = true;

    async function run() {
      setLoading(true);
      setMsg(null);

      const { data: { session }, error: sErr } = await supabase.auth.getSession();
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

      setLoading(false);
    }

    run();
    return () => { isMounted = false; };
  }, []);

  const handleGoogleMapsDisconnect = () => {
    setMsg({ 
      kind: "info", 
      text: "To disconnect Google Maps, remove VITE_GOOGLE_MAPS_API_KEY from your .env file and restart the server." 
    });
  };

  const handleGoogleMapsConfigure = () => {
    setMsg({ 
      kind: "info", 
      text: "API Key is stored in your .env file. Edit VITE_GOOGLE_MAPS_API_KEY to change it." 
    });
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2 text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading integrationsâ€¦</span>
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

          <div className="grid gap-4">
            <IntegrationCard
              icon={MapPin}
              name="Google Maps"
              description="Calculate mileage between pickup and delivery locations"
              status={googleMapsConnected ? "connected" : "available"}
              badge={googleMapsConnected ? "Connected" : "Free"}
              onConfigure={handleGoogleMapsConfigure}
              onDisconnect={handleGoogleMapsDisconnect}
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
            />
            <IntegrationCard
              icon={CreditCard}
              name="Stripe"
              description="Accept credit card payments from customers instantly"
              status="premium"
              badge="Premium"
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
            />
            <IntegrationCard
              icon={Truck}
              name="Motive (KeepTruckin)"
              description="ELD compliance, GPS tracking, and driver safety monitoring"
              status="premium"
              badge="Premium"
            />
          </div>
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
            />
            <IntegrationCard
              icon={Cloud}
              name="Google Drive"
              description="Store and manage BOLs, PODs, and shipping documents"
              status="premium"
              badge="Premium"
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
              onConfigure={() => setMsg({ kind: "info", text: "OpenAI integration is configured and active." })}
              onDisconnect={() => setMsg({ kind: "info", text: "OpenAI integration cannot be disconnected as it's a core feature." })}
            />
            <IntegrationCard
              icon={Mail}
              name="Gmail / Email"
              description="Send automated load confirmations and delivery notifications"
              status="premium"
              badge="Premium"
            />
            <IntegrationCard
              icon={MessageSquare}
              name="Twilio SMS"
              description="Send SMS notifications to drivers and receive status updates"
              status="premium"
              badge="Premium"
            />
          </div>
        </div>

        {/* Info Box */}
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" />
            <div>
              <p className="text-sm text-emerald-200 font-medium">Premium Integrations Coming Soon</p>
              <p className="text-sm text-emerald-200/80 mt-1">
                We're actively working on these integrations. Contact us to be notified when they're ready for your account.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
