#!/usr/bin/env node

// FILE: scripts/import_atlas_docs/import_docs.mjs
//
// Purpose:
//   Import all markdown files from ./atlas_docs into the public.atlas_docs table in Supabase.
//   - Uses YAML frontmatter for metadata (title, domain, doc_type, summary, version, last_updated, related_docs).
//   - Uses the markdown body as the `body` column.
//   - Upserts per (org_id, slug) so you can safely re-run after edits.
//
// Usage (from project root: atlas-command):
//   node scripts/scripts/import_atlas_docs/import_docs.mjs
//
// Requirements:
//   - .env in project root with:
//       SUPABASE_URL=...
//       SUPABASE_SERVICE_ROLE_KEY=...
//       (optional) ATLAS_DOCS_ORG_ID=...   # if blank, docs are global (org_id = null)
//   - npm install @supabase/supabase-js gray-matter dotenv

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import matter from "gray-matter";
import { createClient } from "@supabase/supabase-js";

// -------------------------
// Resolve project root & docs dir
// -------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// We assume you run the script from the project root (atlas-command)
const PROJECT_ROOT = process.cwd();
const DOCS_DIR = path.resolve(PROJECT_ROOT, "atlas_docs");

// Load .env from project root
dotenv.config({ path: path.resolve(PROJECT_ROOT, ".env") });

// -------------------------
// Env loader
// -------------------------

function loadEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const orgId = process.env.ATLAS_DOCS_ORG_ID || null;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[import_docs] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  if (!orgId) {
    console.log("[import_docs] ATLAS_DOCS_ORG_ID not set – importing docs as GLOBAL (org_id = NULL).");
  } else {
    console.log(`[import_docs] Using org_id = ${orgId} for all docs.`);
  }

  return { supabaseUrl, serviceRoleKey, orgId };
}

// -------------------------
// Supabase client
// -------------------------

function createSupabaseClient(env) {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey);
  return client;
}

// -------------------------
// Helper: get all .md files in atlas_docs
// -------------------------

async function getMarkdownFiles() {
  let entries;
  try {
    entries = await fs.readdir(DOCS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`[import_docs] Failed to read atlas_docs directory at ${DOCS_DIR}`);
    console.error(err);
    process.exit(1);
  }

  const files = entries
    .filter((ent) => ent.isFile())
    .map((ent) => ent.name)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .filter((name) => name.toLowerCase() !== "readme.md") // don't import README
    .map((name) => path.join(DOCS_DIR, name));

  if (files.length === 0) {
    console.warn("[import_docs] No .md files found in ./atlas_docs (excluding README.md). Nothing to import.");
  }

  return files;
}

// -------------------------
// Helper: normalize related_docs array to slugs
// -------------------------

function normalizeRelatedDocs(value) {
  if (!value) return [];
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item !== "string") return null;

      // Strip .md if present
      let s = item.trim();
      if (s.toLowerCase().endsWith(".md")) {
        s = s.slice(0, -3);
      }

      // Force lowercase and replace spaces/dashes with underscores
      s = s.toLowerCase().replace(/[\s-]+/g, "_");

      // Only allow [a-z0-9_]
      s = s.replace(/[^a-z0-9_]/g, "");

      return s || null;
    })
    .filter((s) => !!s);
}

// -------------------------
// Helper: parse a single .md doc into a row
// -------------------------

async function parseDocFile(filePath) {
  const filename = path.basename(filePath); // e.g. "load.md"
  const slug = filename.replace(/\.md$/i, ""); // "load"

  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);

  const data = parsed.data || {};
  const content = (parsed.content || "").trim();

  if (!content) {
    console.warn(`[import_docs] WARNING: File ${filename} has no body content.`);
  }

  const title = data.title || slug;
  const domain = data.domain || "General";
  const doc_type = data.doc_type || "Definition";
  const summary = data.summary || "";
  const version = data.version || "v1.0";

  let last_updated;
  if (data.last_updated) {
    // Try to use whatever the frontmatter gives, fallback to now on parse failure
    const d = new Date(data.last_updated);
    if (!isNaN(d.getTime())) {
      last_updated = d.toISOString();
    } else {
      console.warn(
        `[import_docs] WARNING: Invalid last_updated value in ${filename}, using now() instead.`
      );
      last_updated = new Date().toISOString();
    }
  } else {
    last_updated = new Date().toISOString();
  }

  const related_docs = normalizeRelatedDocs(data.related_docs);

  return {
    slug,
    title,
    domain,
    doc_type,
    summary,
    body: content,
    version,
    last_updated,
    related_docs,
  };
}

// -------------------------
// Helper: upsert one doc into Supabase
// -------------------------

async function upsertDoc(supabase, env, doc) {
  const row = {
    org_id: env.orgId || null,
    slug: doc.slug,
    title: doc.title,
    domain: doc.domain,
    doc_type: doc.doc_type,
    summary: doc.summary,
    body: doc.body,
    version: doc.version,
    last_updated: doc.last_updated,
    related_docs: doc.related_docs,
  };

  // NOTE: onConflict syntax may depend on your @supabase/supabase-js version.
  // For v2, this is valid. If you're on v1, it's also supported in a similar way.
  const { data, error } = await supabase
    .from("atlas_docs")
    .upsert(row, { onConflict: "org_id,slug" })
    .select("id, slug");

  if (error) {
    console.error(`[import_docs] ERROR upserting doc ${doc.slug}:`, error.message);
    return { ok: false, error };
  }

  return { ok: true, data };
}

// -------------------------
// Process all docs
// -------------------------

async function processMarkdownFiles(supabase, env) {
  const files = await getMarkdownFiles();
  if (files.length === 0) return;

  console.log(`[import_docs] Found ${files.length} markdown file(s) in ./atlas_docs`);

  let successCount = 0;
  let errorCount = 0;

  for (const filePath of files) {
    const filename = path.basename(filePath);
    try {
      const doc = await parseDocFile(filePath);
      const result = await upsertDoc(supabase, env, doc);

      if (result.ok) {
        console.log(`[import_docs] Upserted: ${doc.slug} (${filename})`);
        successCount += 1;
      } else {
        console.error(`[import_docs] Failed to upsert: ${doc.slug} (${filename})`);
        errorCount += 1;
      }
    } catch (err) {
      console.error(`[import_docs] ERROR processing file ${filename}:`, err.message);
      errorCount += 1;
    }
  }

  console.log(
    `[import_docs] Import complete: ${successCount} success, ${errorCount} error(s).`
  );
}

// -------------------------
// Main
// -------------------------

async function main() {
  console.log("[import_docs] Starting Atlas docs import...");
  console.log(`[import_docs] Project root: ${PROJECT_ROOT}`);
  console.log(`[import_docs] Docs directory: ${DOCS_DIR}`);

  const env = loadEnv();
  const supabase = createSupabaseClient(env);

  await processMarkdownFiles(supabase, env);

  console.log("[import_docs] Done.");
}

main().catch((err) => {
  console.error("[import_docs] Fatal error:", err);
  process.exit(1);
});
