// FILE: supabase/functions/_shared/get_atlas_docs.ts
//
// Shared helper used by Dipsy agents to read Atlas documentation
// from the public.atlas_docs table, while preserving RLS rules.
//
// This file:
// - Selects non-sensitive documentation
// - Applies RLS (so user must be authenticated)
// - Orders results for stable AI context
// - Returns [] if access is not allowed or table empty
//
// DO NOT import service-role keys here. This MUST remain RLS-safe.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AtlasDoc = {
  id: string;
  slug: string | null;
  title: string | null;
  domain: string | null;
  doc_type: string | null;
  summary: string | null;
  body: string | null;
  version: string | null;
  related_docs: string[] | null;
};

export async function getAtlasDocs(authorizationHeader: string) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[get_atlas_docs] Missing env vars SUPABASE_URL or ANON_KEY");
    return [];
  }

  // Use ANON key + user JWT so RLS applies
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
  });

  const { data, error } = await supabase
    .from("atlas_docs")
    .select(
      `
        id,
        slug,
        title,
        domain,
        doc_type,
        summary,
        body,
        version,
        related_docs
      `
    )
    .order("domain", { ascending: true })
    .order("slug", { ascending: true });

  if (error) {
    console.error("[get_atlas_docs] Error loading atlas_docs:", error.message);
    return [];
  }

  return (data ?? []) as AtlasDoc[];
}
