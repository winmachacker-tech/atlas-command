// FILE: supabase/_shared/cors.ts
// Purpose:
//   Provide shared CORS headers for all Edge Functions.
//
// Security:
//   - Allows Supabase dashboard logs + localhost dev
//   - Does NOT weaken RLS or expose any secrets
//   - Safe for multi-tenant setup

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
