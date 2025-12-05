// FILE: scripts/import_atlas_docs.ts
// Purpose:
// - Import / upsert Atlas documentation into public.atlas_docs
// - Reads from ./supabase/atlas_docs.json
// - Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env
//
// Usage (from repo root):
//   npx ts-node scripts/import_atlas_docs.ts
//
// Requirements:
//   - npm install @supabase/supabase-js ts-node dotenv
//   - .env with:
//       SUPABASE_URL=...
//       SUPABASE_SERVICE_ROLE_KEY=...
//   - atlas_docs table with columns:
//       slug (text, unique)
//       title (text)
//       domain (text)
//       doc_type (text)
//       summary (text)
//       body (text)
//       version (text)
//       related_docs (text[])

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";

type AtlasDocJson = {
  slug: string;
  title: string;
  domain?: string;
  doc_type?: string;
  summary?: string;
  body?: string;
  version?: string;
  related_docs?: string[];
};

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      "[import_atlas_docs] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
    console.error(
      "[import_atlas_docs] Make sure they are defined in your .env file at project root."
    );
    process.exit(1);
  }

  console.log("[import_atlas_docs] Using", SUPABASE_URL);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });

  // Resolve JSON path from repo root
  const jsonPath = path.resolve(process.cwd(), "supabase", "atlas_docs.json");
  console.log("[import_atlas_docs] Loading JSON from:", jsonPath);

  let raw: string;
  try {
    raw = await fs.readFile(jsonPath, "utf8");
  } catch (err) {
    console.error("[import_atlas_docs] Failed to read atlas_docs.json:", err);
    process.exit(1);
  }

  let docs: AtlasDocJson[];
  try {
    docs = JSON.parse(raw);
  } catch (err) {
    console.error("[import_atlas_docs] Failed to parse JSON:", err);
    process.exit(1);
  }

  if (!Array.isArray(docs) || docs.length === 0) {
    console.error("[import_atlas_docs] JSON is empty or not an array.");
    process.exit(1);
  }

  console.log(`[import_atlas_docs] Parsed ${docs.length} docs from JSON.`);

  // Normalize and validate
  // 🔧 FIX: Include org_id: null so upsert can match the unique constraint (slug, org_id)
  const cleaned = docs.map((doc) => ({
    slug: doc.slug.trim(),
    title: doc.title.trim(),
    domain: doc.domain?.trim() ?? "general",
    doc_type: doc.doc_type?.trim() ?? "reference",
    summary: doc.summary?.trim() ?? "",
    body: doc.body ?? "",
    version: doc.version?.trim() ?? "v1",
    related_docs: doc.related_docs ?? [],
    org_id: null, // 🔧 FIX: Explicitly set org_id for the unique constraint match
  }));

  // Sanity check for duplicate slugs in JSON
  const seen = new Set<string>();
  for (const d of cleaned) {
    if (seen.has(d.slug)) {
      console.warn(
        `[import_atlas_docs] WARNING: duplicate slug in JSON: ${d.slug}`
      );
    }
    seen.add(d.slug);
  }

  // 🔧 FIX: PostgreSQL treats NULL != NULL in unique constraints.
  // So upsert won't match existing rows where org_id IS NULL.
  // Solution: Delete existing global docs (org_id IS NULL) first, then insert.
  
  const slugsToUpsert = cleaned.map((d) => d.slug);
  
  console.log("[import_atlas_docs] Deleting existing global docs (org_id IS NULL) with matching slugs...");
  
  const { error: deleteError } = await supabase
    .from("atlas_docs")
    .delete()
    .in("slug", slugsToUpsert)
    .is("org_id", null);

  if (deleteError) {
    console.error("[import_atlas_docs] Delete error:", deleteError.message);
    process.exit(1);
  }

  // Insert in small batches
  const BATCH_SIZE = 50;
  let importedCount = 0;

  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE);
    console.log(
      `[import_atlas_docs] Inserting batch ${i + 1}-${i + batch.length}...`
    );

    const { data, error } = await supabase
      .from("atlas_docs")
      .insert(batch)
      .select("slug");

    if (error) {
      console.error(
        "[import_atlas_docs] Insert error on batch starting at index",
        i,
        "=>",
        error.message
      );
      process.exit(1);
    }

    importedCount += data?.length ?? batch.length;
  }

  console.log(
    `[import_atlas_docs] Successfully upserted ~${importedCount} docs into atlas_docs.`
  );
  console.log("[import_atlas_docs] Done.");
}

main().catch((err) => {
  console.error("[import_atlas_docs] Unhandled error:", err);
  process.exit(1);
});