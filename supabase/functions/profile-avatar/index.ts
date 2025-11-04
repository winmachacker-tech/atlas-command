// supabase/functions/profile-avatar/index.ts
// Edge Function: secure avatar upload using service role + proper CORS + correct JWT verify
//
// POST multipart/form-data with field "avatar"
// Auth: Authorization: Bearer <access_token>
// Stores at profiles/<uid>/avatar.<ext>, updates user metadata, returns signed URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const AVATAR_BUCKET = "profiles";
const AVATAR_FILENAME = "avatar";

// Read env (neutral names — you already set these)
const SUPABASE_URL = Deno.env.get("PROJECT_URL");
const SERVICE_KEY  = Deno.env.get("SERVICE_ROLE_KEY");

// Allowed origins (add your prod Vercel domain here)
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://atlas-command-iota.vercel.app",
]);

function corsHeaders(origin: string | null): HeadersInit {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Vary": "Origin",
  };
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin.endsWith(".vercel.app"))) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

function extFromMime(mime: string | null | undefined): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/svg+xml": "svg",
  };
  if (!mime) return "png";
  return map[mime] || "png";
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { error: "Missing PROJECT_URL or SERVICE_ROLE_KEY env" }, origin);
  }
  if (req.method !== "POST") {
    return json(400, { error: 'Use POST with multipart/form-data (field: "avatar")' }, origin);
  }

  // Auth
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(401, { error: "Missing Authorization: Bearer <access_token>" }, origin);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return json(401, { error: "Invalid token" }, origin);

  // Create service-role client
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ✅ Correct way to verify the JWT on the server:
  const { data: userData, error: verifyErr } = await admin.auth.getUser(token);
  if (verifyErr || !userData?.user?.id) {
    return json(401, { error: "Invalid or expired session" }, origin);
  }
  const userId = userData.user.id;

  // Parse multipart
  let file: File;
  try {
    const form = await req.formData();
    const f = form.get("avatar");
    if (!f || !(f instanceof File)) {
      return json(400, { error: 'Expected file field named "avatar"' }, origin);
    }
    file = f;
  } catch {
    return json(400, { error: "Invalid multipart/form-data" }, origin);
  }

  // Validations
  if (file.size <= 0) return json(400, { error: "Empty file" }, origin);
  if (file.size > 2 * 1024 * 1024) return json(400, { error: "File too large (max 2 MB)" }, origin);

  const mime = file.type || "image/png";
  const ext = extFromMime(mime);
  const objectPath = `${userId}/${AVATAR_FILENAME}.${ext}`;

  // Ensure bucket exists
  try {
    await admin.storage.createBucket(AVATAR_BUCKET, { public: false });
  } catch { /* already exists */ }

  // Upload (upsert)
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await admin.storage
    .from(AVATAR_BUCKET)
    .upload(objectPath, new Uint8Array(arrayBuffer), {
      upsert: true,
      contentType: mime,
      cacheControl: "3600",
    });
  if (uploadErr) {
    return json(500, { error: "Upload failed", details: uploadErr.message }, origin);
  }

  // Update auth metadata
  const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { avatar_path: objectPath },
  });
  if (metaErr) {
    return json(500, { error: "Metadata update failed", details: metaErr.message }, origin);
  }

  // Signed URL for immediate display
  const { data: signed, error: signErr } = await admin.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(objectPath, 60 * 60);
  if (signErr) {
    return json(500, { error: "Signing failed", details: signErr.message }, origin);
  }

  return json(200, { avatar_url: signed?.signedUrl || null }, origin);
});
