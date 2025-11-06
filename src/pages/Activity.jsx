// src/pages/Activity.jsx
import { useEffect, useState } from "react";
import { Clock, AlertTriangle, CheckCircle2, Bug, Eye } from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * Activity
 * - Reads recent events from `activity_log` (adjust table/columns to your schema).
 * - Safe: if table doesn't exist or query fails, shows a friendly message.
 * - No breaking changes elsewhere; only fixes incorrect import path.
 */
export default function Activity() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setBusy(true);
        // Adjust to your actual table/columns as needed
        const { data, error } = await supabase
          .from("activity_log")
          .select("id,event_type,message,created_at,actor,ref_id,severity")
          .order("created_at", { ascending: false })
          .limit(100);

        if (!alive) return;
        if (error) {
          setErr(error.message || "Failed to load activity.");
          setItems([]);
        } else {
          setItems(data || []);
        }
      } catch (e) {
        if (!alive) return;
        setErr(e.message || "Failed to load activity.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Activity</h1>
      </header>

      {busy ? (
        <div className="text-sm opacity-70">Loading recent activity…</div>
      ) : err ? (
        <div className="rounded-xl border border-red-300/40 bg-red-50/40 p-4 text-sm">
          <div className="font-medium mb-1">Couldn’t load activity</div>
          <div className="opacity-80">{err}</div>
          <div className="mt-2 opacity-70">
            Tip: If you haven’t created a log table yet, add one:
            <pre className="mt-2 text-xs bg-white/60 rounded p-2 overflow-auto">
{`create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text,
  event_type text,
  message text,
  ref_id text,
  severity text check (severity in ('INFO','WARN','ERROR')) default 'INFO'
);`}
            </pre>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-6 text-sm opacity-80">
          No activity yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border p-4 bg-white/60 dark:bg-white/5 flex items-start gap-3"
            >
              <SeverityIcon severity={it.severity} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{it.event_type || "Event"}</span>
                  {it.actor && (
                    <span className="text-xs px-2 py-0.5 rounded-full border">
                      {it.actor}
                    </span>
                  )}
                  {it.ref_id && (
                    <span className="text-xs px-2 py-0.5 rounded-full border">
                      {it.ref_id}
                    </span>
                  )}
                </div>
                <div className="text-sm mt-1">{it.message || "—"}</div>
                <div className="text-xs mt-2 flex items-center gap-1 opacity-70">
                  <Clock className="w-3.5 h-3.5" />
                  <time dateTime={it.created_at}>
                    {new Date(it.created_at).toLocaleString()}
                  </time>
                </div>
              </div>
              <button
                className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border hover:bg-black/5 dark:hover:bg-white/10"
                title="View details"
              >
                <Eye className="w-3.5 h-3.5" />
                Details
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityIcon({ severity }) {
  switch (severity) {
    case "ERROR":
      return (
        <div className="mt-0.5">
          <Bug className="w-5 h-5 text-red-500" />
        </div>
      );
    case "WARN":
      return (
        <div className="mt-0.5">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        </div>
      );
    default:
      return (
        <div className="mt-0.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        </div>
      );
  }
}
