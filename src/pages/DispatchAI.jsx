// src/pages/DispatchAI.jsx
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  UserCheck,
  UserX,
  Lightbulb,
  CheckCircle2,
  AlertTriangle,
  Link as LinkIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import DispatchAIBox from "../components/DispatchAIBox";
import { supabase } from "../lib/supabase";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function shortId(id) {
  if (!id) return "â€”";
  return String(id).slice(0, 8);
}

export default function DispatchAI() {
  const [envs, setEnvs] = useState({
    url: "",
    functionsUrl: "",
    anonPresent: false,
  });
  const [loads, setLoads] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  const [actionMsg, setActionMsg] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const [actionRecId, setActionRecId] = useState(null); // ðŸ”— new: created ai_recommendations.id (if any)

  useEffect(() => {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
    const FUNCTIONS_URL =
      import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
      (SUPABASE_URL ? `${new URL(SUPABASE_URL).origin}/functions/v1` : "");
    const ANON = Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

    setEnvs({
      url: SUPABASE_URL,
      functionsUrl: FUNCTIONS_URL,
      anonPresent: ANON,
    });
  }, []);

  async function fetchData() {
    setLoading(true);
    setActionMsg(null);
    setActionErr(null);
    setActionRecId(null);
    try {
      // âœ… Include load_number so we can show it
      const { data: lds, error: lErr } = await supabase
        .from("loads")
        .select("id, reference, load_number, status, created_at")
        .eq("status", "AVAILABLE")
        .order("created_at", { ascending: false })
        .limit(8);
      if (lErr) throw lErr;

      const { data: drs, error: dErr } = await supabase
        .from("drivers")
        .select("id, full_name, status, created_at")
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(8);
      if (dErr) throw dErr;

      setLoads(lds || []);
      setDrivers(drs || []);
    } catch (e) {
      setActionErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  // basic 1:1 suggestions
  const suggestions = useMemo(() => {
    const pairs = [];
    const n = Math.min(loads.length, drivers.length);
    for (let i = 0; i < n; i++) {
      const L = loads[i];
      const D = drivers[i];
      if (L && D) pairs.push({ load: L, driver: D });
    }
    return pairs;
  }, [loads, drivers]);

  async function callFunction(path, body) {
    const { data: s } = await supabase.auth.getSession();
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
    const token = s?.session?.access_token || anonKey;

    const res = await fetch(`${envs.functionsUrl}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }

    return { res, data };
  }

  async function runCommand(text) {
    setActionMsg(null);
    setActionErr(null);
    setActionRecId(null);

    try {
      if (!envs.functionsUrl)
        throw new Error("Missing FUNCTIONS_URL configuration.");

      // primary function
      let { res, data } = await callFunction("dispatch-intent", {
        prompt: text,
        dryRun,
      });

      // fallback name if you kept the old function
      if (res.status === 404) {
        ({ res, data } = await callFunction("dispatch-assign-driver", {
          prompt: text,
          dryRun,
        }));
      }

      if (!res.ok) {
        const msg =
          data?.error || data?.message || `Request failed: ${res.status}`;
        // Even on error, the function may log a recommendation â€” surface it
        if (data?.recommendation?.id) setActionRecId(data.recommendation.id);
        throw new Error(msg);
      }

      // Success
      setActionMsg(dryRun ? `Dry run: ${data?.message || "ok"}` : data?.message || "ok");
      if (data?.recommendation?.id) setActionRecId(data.recommendation.id);
      if (!dryRun) fetchData();
    } catch (e) {
      setActionErr(e?.message || String(e));
    }
  }

  // âœ… Always pass the UUID to the function to satisfy its parser
  async function assign(loadUUID, driverName) {
    await runCommand(`assign load ${loadUUID} to driver ${driverName}`);
  }

  async function unassign(loadUUID) {
    await runCommand(`unassign from load ${loadUUID}`);
  }

  function handleAssigned(payload) {
    // if your DispatchAIBox calls onAssigned with the function result
    if (payload?.ok) {
      setActionMsg(payload?.message || "Action completed.");
      if (payload?.recommendation?.id) setActionRecId(payload.recommendation.id);
      fetchData();
    }
  }

  const statusNote = useMemo(() => {
    if (!envs.functionsUrl)
      return "Missing FUNCTIONS URL â€” set VITE_SUPABASE_FUNCTIONS_URL or VITE_SUPABASE_URL.";
    if (!envs.anonPresent)
      return "Missing ANON KEY â€” set VITE_SUPABASE_ANON_KEY.";
    return "Ready. Requests will use POST to your Supabase Edge Function.";
  }, [envs]);

  return (
    <div className="p-4 sm:p-6">
      {/* status banner */}
      <div
        className={cx(
          "mb-4 rounded-lg border p-3 text-xs",
          envs.functionsUrl && envs.anonPresent
            ? "border-emerald-900/40 bg-emerald-950/30 text-emerald-200"
            : "border-yellow-900/40 bg-yellow-950/30 text-yellow-200"
        )}
      >
        <div className="opacity-90">
          <div className="font-medium">Status</div>
          <div className="mt-1">{statusNote}</div>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <div className="truncate">
              <span className="text-zinc-400">Functions URL:</span>{" "}
              <span className="font-mono">{envs.functionsUrl || "â€”"}</span>
            </div>
            <div>
              <span className="text-zinc-400">Anon key detected:</span>{" "}
              <span className="font-mono">
                {envs.anonPresent ? "true" : "false"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* dry run */}
      <div className="mb-4 flex items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          <span>Dry run (preview only)</span>
        </label>
      </div>

      {/* AI freeform */}
      <DispatchAIBox onAssigned={handleAssigned} />

      {/* results */}
      {actionMsg && (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-emerald-900/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div>{actionMsg}</div>
            {actionRecId && (
              <div className="mt-2">
                <Link
                  to="/ai-recommendations"
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-800/40 bg-emerald-900/30 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-800/30"
                >
                  <LinkIcon size={14} />
                  View in AI Recommendations
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {actionErr && (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div>{actionErr}</div>
            {actionRecId && (
              <div className="mt-2">
                <Link
                  to="/ai-recommendations"
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  <LinkIcon size={14} />
                  View logged recommendation
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* suggestions */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-200">
            <Lightbulb className="h-5 w-5" />
            <h2 className="text-base font-semibold">Quick Suggestions</h2>
          </div>
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>

        {loading && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
            Loading available loads and driversâ€¦
          </div>
        )}

        {!loading && suggestions.length === 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
            No quick suggestions right now. Make sure you have <b>AVAILABLE</b>{" "}
            loads and <b>ACTIVE</b> drivers.
          </div>
        )}

        {!loading && suggestions.length > 0 && (
          <div className="grid gap-3">
            {suggestions.map(({ load, driver }) => {
              // Display-friendly label, but SEND UUID under the hood
              const displayRef =
                load.reference || load.load_number || shortId(load.id);
              const driverLabel = driver.full_name || driver.id;
              return (
                <div
                  key={`${load.id}-${driver.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                >
                  <div className="text-sm">
                    <div className="text-zinc-300">
                      <span className="font-medium">{displayRef}</span>
                      <span className="mx-2 opacity-50">â†’</span>
                      <span className="font-medium">{driverLabel}</span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Suggested: assign driver to this available load.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => assign(load.id, driverLabel)} // âœ… send UUID
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      <UserCheck className="h-4 w-4" />
                      Assign
                    </button>
                    <button
                      onClick={() => unassign(load.id)} // âœ… send UUID
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      <UserX className="h-4 w-4" />
                      Unassign
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

