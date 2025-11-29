// FILE: supabase/functions/_shared/cors.ts
// Purpose:
// - Provide a single place for CORS headers for all Edge Functions
// - Handle OPTIONS (preflight) requests cleanly
//
// Notes:
// - This does NOT change or bypass any Supabase Auth or RLS.
// - It just tells the browser it's allowed to call your Edge Functions.
// - You can tighten the allowed origin later to your Atlas domain.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Helper to short-circuit OPTIONS preflight requests.
 *
 * Usage in an Edge Function:
 *   import { handleCors } from "../_shared/cors.ts";
 *
 *   Deno.serve(async (req) => {
 *     const corsResponse = handleCors(req);
 *     if (corsResponse) return corsResponse;
 *     // ...rest of your handler...
 *   });
 */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
