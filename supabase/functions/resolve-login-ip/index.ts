// FILE: supabase/functions/resolve-login-ip/index.ts
// PURPOSE:
// Safely extract real client IP + Geo (City/Region/Country) from request headers.
// Returns null fields if anything fails.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Simple free geo lookup (ipapi.co)
// No API key required for basic city/region/country lookups.
async function lookupGeo(ip: string) {
  try {
    const resp = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!resp.ok) return { city: null, region: null, country: null };

    const j = await resp.json();
    return {
      city: j.city || null,
      region: j.region || null,
      country: j.country || null,
    };
  } catch (_) {
    return { city: null, region: null, country: null };
  }
}

serve(async (req) => {
  try {
    const headers = req.headers;

    // Behind Supabase / Vercel, correct IP is in x-real-ip or x-forwarded-for
    const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const real = headers.get("x-real-ip");

    const ip = fwd || real || null;

    if (!ip) {
      return new Response(JSON.stringify({
        ip: null,
        city: null,
        region: null,
        country: null
      }), { headers: { "Content-Type": "application/json" }});
    }

    const { city, region, country } = await lookupGeo(ip);

    return new Response(JSON.stringify({
      ip,
      city,
      region,
      country
    }), { headers: { "Content-Type": "application/json" }});

  } catch (err) {
    console.error("resolve-login-ip error:", err);
    return new Response(JSON.stringify({
      ip: null,
      city: null,
      region: null,
      country: null
    }), { headers: { "Content-Type": "application/json" }});
  }
});
