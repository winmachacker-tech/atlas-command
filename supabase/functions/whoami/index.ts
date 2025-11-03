// Minimal CORS-proof diagnostics for Supabase Edge Functions.
// No Supabase client. No env vars. Just echoes headers and token presence.
// This ensures OPTIONS returns 200 OK and GET never crashes due to missing secrets.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // you can tighten to your app origin later
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });
}

function getBearer(req: Request): string | null {
  const raw =
    req.headers.get("Authorization") ||
    req.headers.get("authorization") ||
    "";
  const [scheme, token] = raw.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  return (token || "").trim() || null;
}

serve(async (req: Request) => {
  // ✅ Always succeed on preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const token = getBearer(req);

    // Echo safe details back
    const headersSeen = Object.fromEntries(
      Array.from(req.headers.entries()).map(([k, v]) =>
        k.toLowerCase() === "authorization" ? [k, `${v.split(" ")[0]} <redacted>`] : [k, v]
      )
    );

    return json(200, {
      ok: true,
      note:
        "This minimal endpoint proves CORS ok and shows whether your Authorization header reaches the function.",
      hasToken: Boolean(token),
      tokenSample: token ? `${token.slice(0, 12)}...${token.slice(-6)}` : null, // just a peek
      headersSeen,
    });
  } catch (e) {
    return json(500, { ok: false, error: "whoami crashed", details: String(e) });
  }
});
