import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * WhoAmTest
 * - Fetches your current session token
 * - Calls Edge Function /whoami with Authorization header
 * - Renders exactly what the function sees (user, adminRow, errors)
 */
export default function WhoAmTest() {
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(null);
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  const run = useCallback(async () => {
    setLoading(true);
    setErrMsg("");
    setResult(null);

    try {
      // 1) get access token
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw new Error(`getSession: ${sessErr.message}`);
      const access = sess?.session?.access_token || null;
      setToken(access);

      // 2) call the Edge Function with the token (GET)
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whoami`,
        {
          method: "GET",
          headers: access ? { Authorization: `Bearer ${access}` } : {},
        }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrMsg(
          `HTTP ${res.status} ${res.statusText}` +
            (json?.error ? ` – ${json.error}` : "")
        );
        setResult(json || null);
      } else {
        setResult(json);
      }
    } catch (e) {
      setErrMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        Edge Function Diagnostics — <code>/whoami</code>
      </h1>

      <div className="text-sm text-zinc-600 dark:text-zinc-400">
        Supabase URL:{" "}
        <code className="font-mono">
          {import.meta.env.VITE_SUPABASE_URL || "(missing env)"}
        </code>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Access token present:{" "}
            <span className="font-mono">
              {token ? "YES" : "NO (not signed in)"}
            </span>
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            {loading ? "Running…" : "Run again"}
          </button>
        </div>

        {errMsg ? (
          <div className="text-red-600 dark:text-red-400 text-sm mb-3">
            {errMsg}
          </div>
        ) : null}

        <pre className="text-xs overflow-auto max-h-[60vh] p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
{JSON.stringify(result, null, 2)}
        </pre>

        <p className="text-xs text-zinc-500 mt-2">
          Expect <code>hasToken: true</code>, a populated <code>user</code>, and{" "}
          <code>adminRow.is_admin === true</code>. If <code>hasToken</code> is{" "}
          false, the header isn’t reaching the function. If <code>user</code> is
          null with a token, the token is invalid/expired.
        </p>
      </div>
    </div>
  );
}
