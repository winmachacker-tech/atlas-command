// src/components/DispatchAIBox.jsx
import { useState } from "react";
import { Loader2, Send, AlertCircle, CheckCircle2, MessageSquareText } from "lucide-react";

function cx(...a) { return a.filter(Boolean).join(" "); }
const isUUID = (s) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

/**
 * Natural-language parser
 * Supports:
 *  - "assign load <LOAD> to driver <DRIVER>"
 *  - "assign driver <DRIVER> to load <LOAD>"
 *  - "unassign driver <DRIVER> from load <LOAD>"
 *  - "unassign from load <LOAD>"
 *  - Also works if <LOAD>/<DRIVER> are UUIDs
 */
function parseCommand(input) {
  const text = (input || "").trim().replace(/\s+/g, " ");
  if (!text) throw new Error("Type a command, e.g. â€œassign load AC-123 to driver Tony Starkâ€");

  // helpers to clean tokens (strip quotes, commas, trailing punctuation)
  const clean = (s) => (s || "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/[.,;:]$/g, "").trim();

  // 1) assign load X to driver Y
  {
    const m = text.match(/^\s*assign\s+(?:the\s+)?load\s+(.+?)\s+(?:to|->)\s+(?:the\s+)?driver\s+(.+)\s*$/i);
    if (m) {
      const loadTok = clean(m[1]);
      const driverTok = clean(m[2]);
      if (!loadTok || !driverTok) throw new Error("Couldnâ€™t find a load or driver in your command.");
      return buildAssignPayload(loadTok, driverTok);
    }
  }

  // 2) assign driver Y to load X
  {
    const m = text.match(/^\s*assign\s+(?:the\s+)?driver\s+(.+?)\s+(?:to|->)\s+(?:the\s+)?load\s+(.+)\s*$/i);
    if (m) {
      const driverTok = clean(m[1]);
      const loadTok = clean(m[2]);
      if (!loadTok || !driverTok) throw new Error("Couldnâ€™t find a load or driver in your command.");
      return buildAssignPayload(loadTok, driverTok);
    }
  }

  // 3) unassign driver Y from load X
  {
    const m = text.match(/^\s*unassign\s+(?:the\s+)?driver\s+(.+?)\s+(?:from|-)\s+(?:the\s+)?load\s+(.+)\s*$/i);
    if (m) {
      const driverTok = clean(m[1]);
      const loadTok = clean(m[2]);
      if (!loadTok) throw new Error("Which load should I unassign from?");
      const payload = buildUnassignPayload(loadTok);
      // If a specific driver was mentioned, weâ€™ll still unassign by load (the load row only stores one driver_id).
      // Optionally, you could verify the driver matches current load assignment here.
      return payload;
    }
  }

  // 4) unassign from load X
  {
    const m = text.match(/^\s*unassign\s+(?:from\s+)?(?:the\s+)?load\s+(.+)\s*$/i);
    if (m) {
      const loadTok = clean(m[1]);
      if (!loadTok) throw new Error("Which load should I unassign from?");
      return buildUnassignPayload(loadTok);
    }
  }

  // 5) simple forms: "assign <LOAD> <DRIVER>" (fallback)
  {
    const m = text.match(/^\s*assign\s+(.+?)\s+to\s+(.+)\s*$/i) || text.match(/^\s*assign\s+(.+?)\s+(.+)\s*$/i);
    if (m) {
      const first = clean(m[1]);
      const second = clean(m[2]);
      // Heuristic: if first token looks like a load keyword, treat as load then driver
      if (/^(load|ld)\b/i.test(first)) {
        const rest = first.replace(/^(load|ld)\b/i, "").trim();
        const loadTok = rest || second; // try to salvage
        const driverTok = rest ? second : null;
        if (!driverTok) throw new Error("I expected a driver after the load. Try: assign load AC-123 to driver Tony Stark.");
        return buildAssignPayload(loadTok, driverTok);
      }
      // Else assume first is load, second is driver
      return buildAssignPayload(first, second);
    }
  }

  throw new Error(`Couldnâ€™t understand: â€œ${text}â€. Try: assign load AC-123 to driver Tony Stark`);
}

function buildAssignPayload(loadToken, driverToken) {
  const payload = {};
  if (isUUID(loadToken)) payload.load_id = loadToken;
  else payload.load_number = loadToken;

  if (isUUID(driverToken)) payload.driver_id = driverToken;
  else payload.driver_name = driverToken;

  // Assigned-by can be set by the caller
  return payload;
}

function buildUnassignPayload(loadToken) {
  const payload = {};
  if (isUUID(loadToken)) payload.load_id = loadToken;
  else payload.load_number = loadToken;
  payload.driver_id = null; // unassign
  return payload;
}

export default function DispatchAIBox({ userId = null, onAssigned }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setBusy(true);
    setError("");
    setOk(false);

    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!SUPABASE_URL) throw new Error("VITE_SUPABASE_URL is missing");
      if (!ANON_KEY)     throw new Error("VITE_SUPABASE_ANON_KEY is missing");

      const base = new URL(SUPABASE_URL).origin;
      const url  = `${base}/functions/v1/dispatch-assign-driver`;

      // Parse NL into payload
      const parsed = parseCommand(input);
      const payload = { ...parsed, assigned_by: userId ?? null };

      // POST
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
          "X-Client-Info": "atlas-command/nl-dispatch",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) throw new Error(data?.error || text || `HTTP ${res.status}`);

      setOk(true);
      if (typeof onAssigned === "function") onAssigned(data);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        <MessageSquareText className="h-4 w-4 text-zinc-400" />
        Natural language dispatch: <span className="text-zinc-400 ml-1">e.g.,</span>
        <span className="ml-1 text-zinc-200 italic">assign load AC-AI_LOAD_TEST to driver Tony Stark</span>
      </div>

      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder='Try: "assign load AC-AI_LOAD_TEST to driver Tony Stark" or "unassign from load AC-AI_LOAD_TEST"'
        className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-zinc-600"
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className={cx(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium",
            "bg-emerald-600 hover:bg-emerald-500 text-white",
            (busy || !input.trim()) && "opacity-60 cursor-not-allowed"
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? "Submitting..." : "Run Command"}
        </button>

        {ok && (
          <span className="inline-flex items-center gap-1 text-emerald-400 text-sm">
            <CheckCircle2 className="h-4 w-4" />
            Done
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}

