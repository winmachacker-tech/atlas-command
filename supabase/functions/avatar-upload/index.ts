import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "avatars";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function extFromMime(mime: string) {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "bin";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 🔒 Guard: ensure envs are actually loaded into the function runtime
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    return json(500, {
      error: "Missing function environment",
      detail:
        "Expected SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. " +
        "Run `supabase secrets list` and set them with `supabase secrets set ...`, then redeploy.",
    });
  }

  try {
    // 1) Verify caller (user JWT)
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization: Bearer <token>" });
    }

    const userScoped = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: getUserErr } = await userScoped.auth.getUser();
    if (getUserErr || !user) {
      return json(401, { error: "Unauthorized", detail: getUserErr?.message });
    }

    // 2) Parse multipart + validate file
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return json(400, { error: "Expected multipart/form-data" });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json(400, { error: "Missing 'file' field" });
    if (!file.type?.startsWith("image/")) {
      return json(400, { error: "File must be an image", type: file.type });
    }

    // 3) Use SERVICE ROLE for privileged ops (bypasses RLS)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Create bucket if needed (non-fatal if exists)
    try {
      await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
    } catch (_) {}

    // 4) Upload
    const ext = extFromMime(file.type);
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
    if (upErr) return json(500, { error: "Upload failed", detail: upErr.message });

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl;

    // 5) Update app users table (supports id or auth_user_id)
    const tryUpdate = async (col: "id" | "auth_user_id") => {
      const { error } = await admin
        .from("users")
        .update({ avatar_url: publicUrl })
        .eq(col, user.id)
        .select(col)
        .maybeSingle();
      return error;
    };

    let dbUpdated = false;
    let err1 = await tryUpdate("id");
    if (!err1) dbUpdated = true;
    if (!dbUpdated) {
      const err2 = await tryUpdate("auth_user_id");
      if (!err2) dbUpdated = true;
      // If both failed, surface the last error clearly
      if (!dbUpdated && err2) {
        // If you see "new row violates row-level security policy" here,
        // the function is NOT using the service role key.
        return json(500, { error: "DB update failed", detail: err2.message });
      }
    }

    return json(200, { publicUrl, path, userId: user.id, dbUpdated });
  } catch (err) {
    console.error("avatar-upload fatal:", err);
    return json(500, { error: "Internal error", detail: `${err}` });
  }
});
