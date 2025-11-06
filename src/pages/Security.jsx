// src/pages/Security.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Loader2,
  Shield,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  Monitor,
  MapPin,
  Clock,
  Lock,
  Key,
  Bell,
  Activity,
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

function Card({ icon: Icon, title, subtitle, children, badge }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#12151b] p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
              <Icon className="h-5 w-5 text-amber-400" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold">{title}</div>
              {badge && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <div className="text-sm text-white/60 mt-0.5">{subtitle}</div>}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function getDeviceIcon(userAgent) {
  const ua = userAgent?.toLowerCase() || "";
  if (ua.includes("iphone") || ua.includes("android") || ua.includes("mobile")) {
    return Smartphone;
  }
  return Monitor;
}

function getDeviceName(userAgent) {
  const ua = userAgent?.toLowerCase() || "";
  
  // Mobile
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) return "Android";
  
  // Desktop OS
  let os = "Unknown";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os x")) os = "macOS";
  else if (ua.includes("linux")) os = "Linux";
  
  // Browser
  let browser = "Unknown";
  if (ua.includes("edg")) browser = "Edge";
  else if (ua.includes("chrome")) browser = "Chrome";
  else if (ua.includes("safari")) browser = "Safari";
  else if (ua.includes("firefox")) browser = "Firefox";
  
  return `${browser} on ${os}`;
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  
  return date.toLocaleDateString("en-US", { 
    month: "short", 
    day: "numeric", 
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined 
  });
}

export default function Security() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [activities, setActivities] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function run() {
      setLoading(true);

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
      setCurrentSession(session);

      // Load recent activity
      try {
        const { data: activityData, error: actError } = await supabase
          .from("user_activity")
          .select("*")
          .eq("user_id", u.id)
          .order("created_at", { ascending: false })
          .limit(10);

        if (!isMounted) return;
        if (actError) {
          console.error("Failed to load activity:", actError);
          setActivities([]);
        } else {
          setActivities(activityData || []);
        }
      } catch (e) {
        console.error("Error loading activity:", e);
        setActivities([]);
      }

      setLoading(false);
    }

    run();
    return () => { isMounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2 text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading security settings…</span>
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
            You're not signed in. Please log in to view security settings.
          </InlineAlert>
        </div>
      </div>
    );
  }

  const lastActivity = activities[0];

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page Header */}
        <div className="rounded-2xl border border-white/10 bg-[#0f1318] p-6">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
              <Shield className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Security</h1>
              <p className="text-sm text-white/60">
                Monitor your account activity and manage security settings
              </p>
            </div>
          </div>
        </div>

        {/* Current Session */}
        <Card
          icon={Monitor}
          title="Current Session"
          subtitle="Your active login session"
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-emerald-200">Active Now</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                      This Device
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-emerald-200/80">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4" />
                      <span>{getDeviceName(navigator.userAgent)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span>Last active: {lastActivity ? formatDateTime(lastActivity.created_at) : "Just now"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-xs text-white/60">
              <p>Signed in as: <span className="text-white/80">{user.email}</span></p>
              <p className="mt-1">User ID: <span className="text-white/80 font-mono">{user.id.slice(0, 8)}...</span></p>
            </div>
          </div>
        </Card>

        {/* Two-Factor Authentication */}
        <Card
          icon={Lock}
          title="Two-Factor Authentication"
          subtitle="Add an extra layer of security"
          badge="Coming Soon"
        >
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-white/40 mt-0.5" />
              <div>
                <p className="text-sm text-white/80">
                  Two-factor authentication (2FA) adds an extra layer of security by requiring a second form of verification.
                </p>
                <button
                  disabled
                  className="mt-3 px-4 py-2 text-sm rounded-lg bg-white/5 text-white/40 cursor-not-allowed"
                >
                  Enable 2FA (Coming Soon)
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* Activity Log */}
        <Card
          icon={Activity}
          title="Recent Activity"
          subtitle="Your login history and account activity"
        >
          {activities.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-8 text-center">
              <Activity className="h-8 w-8 text-white/40 mx-auto mb-3" />
              <p className="text-sm text-white/60">No recent activity recorded</p>
              <p className="text-xs text-white/40 mt-1">
                Activity tracking has just been enabled for your account
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activities.map((activity, idx) => {
                const DeviceIcon = getDeviceIcon(activity.user_agent);
                const isRecent = idx === 0;
                
                return (
                  <div
                    key={activity.id}
                    className={cx(
                      "rounded-xl border p-4 transition",
                      isRecent 
                        ? "border-amber-500/40 bg-amber-500/5" 
                        : "border-white/10 bg-black/20"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cx(
                        "inline-flex h-10 w-10 items-center justify-center rounded-lg",
                        isRecent ? "bg-amber-500/20" : "bg-white/5"
                      )}>
                        <DeviceIcon className={cx(
                          "h-5 w-5",
                          isRecent ? "text-amber-400" : "text-white/60"
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize">{activity.activity_type}</span>
                          {isRecent && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="mt-1 space-y-1 text-sm text-white/60">
                          <div className="flex items-center gap-2">
                            <Monitor className="h-3.5 w-3.5" />
                            <span>{activity.device_info || getDeviceName(activity.user_agent)}</span>
                          </div>
                          {activity.location && (
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5" />
                              <span>{activity.location}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatDateTime(activity.created_at)}</span>
                          </div>
                          {activity.ip_address && (
                            <div className="text-xs text-white/40 font-mono">
                              IP: {activity.ip_address}
                            </div>
                          )}
                        </div>
                      </div>
                      {activity.success ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-rose-400" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Security Tips */}
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-sky-400 mt-0.5" />
            <div>
              <p className="text-sm text-sky-200 font-medium">Security Best Practices</p>
              <ul className="text-sm text-sky-200/80 mt-2 space-y-1 list-disc list-inside">
                <li>Use a strong, unique password for your account</li>
                <li>Enable two-factor authentication when available</li>
                <li>Review your activity log regularly for suspicious logins</li>
                <li>Never share your login credentials with anyone</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}