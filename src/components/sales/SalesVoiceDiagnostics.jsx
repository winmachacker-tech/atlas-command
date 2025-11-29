// FILE: src/components/sales/SalesVoiceDiagnostics.jsx
// Purpose:
// - Small diagnostics widget for the AI caller pipeline
// - Calls the sales-voice-health Edge Function
// - Shows:
//   • Overall health (OK / Degraded / Error)
//   • Key checks: Twilio env, TwiML URL probe, Voice Bridge, Status webhook,
//                 Supabase auth, Org context, DB read
//
// Security:
// - Uses the standard Supabase client (no service role)
// - Relies entirely on RLS + auth enforced by the Edge Function

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function SalesVoiceDiagnostics() {
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null); // raw payload
  const [error, setError] = useState(null);

  async function runHealthCheck() {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase.functions.invoke(
        "sales-voice-health",
        { body: {} }
      );

      if (error) {
        console.error("[SalesVoiceDiagnostics] transport error:", error);
        setError("Unable to reach sales-voice-health. Check function logs.");
        setHealth(null);
        return;
      }

      setHealth(data || null);
    } catch (err) {
      console.error("[SalesVoiceDiagnostics] unexpected error:", err);
      setError("Unexpected error running health check.");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runHealthCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ok = health?.ok === true;
  const checks = health?.checks || {};

  // Helper to summarize a single check
  function renderCheck(name, label, details) {
    if (!details) return null;

    const checkOk = details.ok;
    const severity = details.severity || (checkOk ? "info" : "error");

    const colorClass =
      severity === "warning"
        ? "text-amber-300"
        : severity === "error"
        ? "text-rose-300"
        : "text-emerald-300";

    const borderClass =
      severity === "warning"
        ? "border-amber-400/60"
        : severity === "error"
        ? "border-rose-400/60"
        : "border-emerald-400/50";

    const bgClass =
      severity === "warning"
        ? "bg-amber-950/30"
        : severity === "error"
        ? "bg-rose-950/30"
        : "bg-emerald-950/20";

    // A short line of info if present
    let info = null;
    if (typeof details.status !== "undefined") {
      info = `Status: ${details.status}`;
    } else if (details.user_id) {
      info = `User: ${details.user_id}`;
    } else if (details.org_id) {
      info = `Org: ${details.org_id}`;
    } else if (Array.isArray(details.missing) && details.missing.length > 0) {
      info = `Missing: ${details.missing.join(", ")}`;
    } else if (Array.isArray(details.present) && details.present.length > 0) {
      info = `Present: ${details.present.join(", ")}`;
    } else if (details.note) {
      info = details.note;
    }

    return (
      <div
        key={name}
        className={cx(
          "rounded-md border px-2.5 py-1.5 text-[11px]",
          borderClass,
          bgClass
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-slate-50">{label}</span>
          <span className={cx("text-[10px] font-semibold", colorClass)}>
            {checkOk ? "OK" : severity === "warning" ? "Warning" : "Error"}
          </span>
        </div>
        {info && (
          <div className="mt-0.5 text-[10px] text-slate-300">{info}</div>
        )}
      </div>
    );
  }

  // Decide header status
  let headerIcon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  let headerText = "Checking AI caller pipeline…";
  let headerColor = "text-slate-200";

  if (!loading && error) {
    headerIcon = <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />;
    headerText = "AI caller diagnostics error";
    headerColor = "text-rose-200";
  } else if (!loading && health) {
    if (ok) {
      headerIcon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
      headerText = "AI caller pipeline is healthy";
      headerColor = "text-emerald-200";
    } else {
      headerIcon = <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />;
      headerText = "AI caller pipeline has warnings";
      headerColor = "text-amber-200";
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-[11px] shadow-sm shadow-black/40 max-w-xl">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {headerIcon}
          <div className="flex flex-col">
            <span className={cx("font-semibold", headerColor)}>
              {headerText}
            </span>
            {health?.timestamp && (
              <span className="text-[10px] text-slate-500">
                Last check:{" "}
                {new Date(health.timestamp).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={runHealthCheck}
          disabled={loading}
          className={cx(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-emerald-500 hover:text-emerald-300",
            loading && "opacity-60 cursor-not-allowed"
          )}
        >
          <Loader2
            className={cx("h-3 w-3", loading && "animate-spin")}
          />
          <span>{loading ? "Running…" : "Re-run"}</span>
        </button>
      </div>

      {error && (
        <div className="mt-1 rounded-md border border-rose-500/60 bg-rose-950/40 px-2 py-1 text-[10px] text-rose-100">
          {error}
        </div>
      )}

      {!error && health && (
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {renderCheck("twilio_env", "Twilio env vars", checks.twilio_env)}
          {renderCheck("twiml_url", "TwiML URL probe", checks.twiml_url)}
          {renderCheck("voice_bridge", "Voice bridge", checks.voice_bridge)}
          {renderCheck(
            "status_webhook",
            "Status webhook",
            checks.status_webhook
          )}
          {renderCheck("supabase_auth", "Supabase auth", checks.supabase_auth)}
          {renderCheck("org_context", "Org context", checks.org_context)}
          {renderCheck("db_read", "DB read", checks.db_read)}
        </div>
      )}
    </div>
  );
}

export default SalesVoiceDiagnostics;
