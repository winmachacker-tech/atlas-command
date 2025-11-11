// src/components/DiagnosticsOverlay.jsx
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * Atlas DiagnosticsOverlay (v2)
 * - Uses import.meta.env (never `process`)
 * - Probes Supabase Functions reachability and treats 401/403/404/405 as OK
 * - Graceful on errors (never throws)
 */

function Row({ label, value, dim = false }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className={dim ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-700 dark:text-zinc-200"}>
        {label}
      </span>
      <span className="ml-4 tabular-nums text-zinc-900 dark:text-zinc-50">{value}</span>
    </div>
  );
}

function Section({ title, children, right = null }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white/70 backdrop-blur-md p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium text-zinc-900 dark:text-zinc-100">{title}</div>
        {right ? <div className="text-xs text-zinc-500 dark:text-zinc-400">{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

export default function DiagnosticsOverlay() {
  const [open, setOpen] = useState(false);

  // --- Safe ENV access (Vite) ---
  const SUPABASE_URL = useMemo(() => import.meta.env.VITE_SUPABASE_URL ?? "â€”", []);
  const ANON_KEY_STR = useMemo(() => import.meta.env.VITE_SUPABASE_ANON_KEY ?? "", []);
  const ANON_KEY_LOADED = useMemo(() => Boolean(ANON_KEY_STR && ANON_KEY_STR.length > 20), [ANON_KEY_STR]);

  // Derive Functions URL
  const FUNCTIONS_URL = useMemo(() => {
    try {
      if (!SUPABASE_URL || SUPABASE_URL === "â€”") return "â€”";
      const u = new URL(SUPABASE_URL);
      return `${u.origin}/functions/v1`;
    } catch {
      return "â€”";
    }
  }, [SUPABASE_URL]);

  // --- Auth / session state ---
  const [authState, setAuthState] = useState("unknown");
  const [userId, setUserId] = useState("â€”");
  const [email, setEmail] = useState("â€”");
  const [isAdmin, setIsAdmin] = useState("â€”");

  // --- Client probes ---
  const [clientReady, setClientReady] = useState(false);
  const [originUrl, setOriginUrl] = useState("â€”");

  // --- Functions reachability probe ---
  const [fnProbeDone, setFnProbeDone] = useState(false);
  const [fnProbeOk, setFnProbeOk] = useState(null); // null | true | false
  const [fnProbeStatus, setFnProbeStatus] = useState("â€”");

  // Setup on mount
  useEffect(() => {
    setClientReady(!!supabase);
    setOriginUrl(typeof window !== "undefined" ? window.location.origin : "â€”");

    // initial session fetch
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          setAuthState("SIGNED_IN");
          setUserId(data.session.user?.id ?? "â€”");
          setEmail(data.session.user?.email ?? "â€”");
        } else {
          setAuthState("SIGNED_OUT");
        }
      } catch {
        setAuthState("unknown");
      }
    })();

    // subscribe to auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === "SIGNED_IN" || evt === "TOKEN_REFRESHED" || evt === "INITIAL_SESSION") {
        setAuthState("SIGNED_IN");
        setUserId(session?.user?.id ?? "â€”");
        setEmail(session?.user?.email ?? "â€”");
      } else if (evt === "SIGNED_OUT" || evt === "USER_DELETED") {
        setAuthState("SIGNED_OUT");
        setUserId("â€”");
        setEmail("â€”");
        setIsAdmin("â€”");
      } else {
        setAuthState(evt || "unknown");
      }
    });

    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // Probe users.is_admin (RLS-safe)
  useEffect(() => {
    (async () => {
      if (!clientReady) return;
      if (!userId || userId === "â€”") return;
      try {
        const { data, error } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", userId)
          .maybeSingle();

        if (error) {
          setIsAdmin("false");
          return;
        }
        setIsAdmin(String(Boolean(data?.is_admin)));
      } catch {
        setIsAdmin("false");
      }
    })();
  }, [clientReady, userId]);

  // Functions reachability probe
  useEffect(() => {
    (async () => {
      try {
        if (FUNCTIONS_URL === "â€”") {
          setFnProbeStatus("â€”");
          setFnProbeOk(false);
          setFnProbeDone(true);
          return;
        }

        // OPTIONS is less noisy; many gateways reply 204/200/401/403.
        const resp = await fetch(FUNCTIONS_URL, {
          method: "OPTIONS",
          cache: "no-store",
        });

        setFnProbeStatus(String(resp.status));

        // Consider these statuses as "reachable" even if unauthorized:
        // 200â€“399 OK-ish, and 401/403/404/405 mean the gateway is up.
        const okish =
          (resp.status >= 200 && resp.status < 400) ||
          [401, 403, 404, 405].includes(resp.status);

        setFnProbeOk(okish);
      } catch (e) {
        // Some browsers throw on CORS preflight; try HEAD as a fallback.
        try {
          const resp2 = await fetch(FUNCTIONS_URL, { method: "HEAD", cache: "no-store" });
          setFnProbeStatus(String(resp2.status));
          const okish =
            (resp2.status >= 200 && resp2.status < 400) ||
            [401, 403, 404, 405].includes(resp2.status);
          setFnProbeOk(okish);
        } catch {
          setFnProbeStatus("network-error");
          setFnProbeOk(false);
        }
      } finally {
        setFnProbeDone(true);
      }
    })();
  }, [FUNCTIONS_URL]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="mb-2 w-[440px] max-w-[92vw] space-y-3 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-2xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/70">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Atlas Diagnostics
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Non-blocking</span>
          </div>

          <Section title="Auth / Session">
            <Row label="State" value={authState} />
            <Row label="User ID" value={userId} dim />
            <Row label="Email" value={email} dim />
            <Row label="is_admin (users)" value={isAdmin} />
          </Section>

          <Section title="Supabase Client">
            <Row label="Client ready" value={String(clientReady)} />
            <Row label="URL (origin)" value={originUrl} dim />
            <Row label="Anon key loaded" value={String(ANON_KEY_LOADED)} />
          </Section>

          <Section title="Env / Config">
            <Row label="SUPABASE_URL" value={SUPABASE_URL || "â€”"} dim />
            <Row label="FUNCTIONS_URL" value={FUNCTIONS_URL} dim />
            <Row
              label="window.__sb present"
              value={String(Boolean(typeof window !== "undefined" && window.__sb))}
            />
          </Section>

          <Section
            title="Quick Probes"
            right={!fnProbeDone ? "runningâ€¦" : fnProbeOk ? "ok" : "failed"}
          >
            <Row label="functions reachability" value={fnProbeOk === null ? "â€”" : String(fnProbeOk)} />
            <Row label="status" value={fnProbeStatus} dim />
          </Section>

          <Section title="Hints">
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              â€¢ A 401/403 on the functions root is normalâ€”call a specific function URL.<br />
              â€¢ If not signed in, RLS-protected reads will return empty results.<br />
              â€¢ Ensure <span className="font-mono">VITE_SUPABASE_URL</span> and{" "}
              <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> are configured.
            </div>
          </Section>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-zinc-300 bg-white/80 px-4 py-2 text-sm shadow-md backdrop-blur-md hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-50"
        aria-expanded={open}
        aria-label="Diagnostics"
      >
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        Diagnostics
      </button>
    </div>
  );
}

