// FILE: supabase/functions/dipsy-upload-pod/index.ts
// Purpose:
// - Allow Dipsy (or the UI) to attach a POD document to a load
//   and mark the load as DELIVERED, all under RLS.
// - Input: load_id (uuid), pod_url, file_name, mime_type,
//          optional delivered_at, delivery_notes, receiver_name, receiver_signature.
//
// Security:
// - Uses SUPABASE_ANON_KEY + caller's Authorization: Bearer <access_token>.
// - RLS remains in full effect; no service-role key used.
// - Only loads/documents visible to the caller (org-scoped) can be read/updated.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

if (! SUPABASE_URL || ! SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY for dipsy-upload-pod function.");
}

serve(async (req) => {
  // Basic CORS handling
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: buildCorsHeaders(req),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method not allowed. Use POST." },
      405,
      req,
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(
        { ok: false, error: "Missing or invalid Authorization header." },
        401,
        req,
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // 1) Confirm user (RLS context)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("auth.getUser error:", userError);
      return jsonResponse(
        { ok: false, error: "Unauthorized. Could not resolve user." },
        401,
        req,
      );
    }

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return jsonResponse(
        { ok: false, error: "Invalid JSON body." },
        400,
        req,
      );
    }

    const {
      load_id,
      pod_url,
      file_name,
      mime_type,
      delivered_at,
      delivery_notes,
      receiver_name,
      receiver_signature,
    } = body;

    if (!load_id || typeof load_id !== "string") {
      return jsonResponse(
        { ok: false, error: "load_id (uuid) is required." },
        400,
        req,
      );
    }

    if (!pod_url || typeof pod_url !== "string") {
      return jsonResponse(
        { ok: false, error: "pod_url is required." },
        400,
        req,
      );
    }

    // file_name + mime_type are recommended but we won't hard-fail if missing
    const safeFileName =
      typeof file_name === "string" && file_name.length > 0
        ? file_name
        : "POD";
    const safeMimeType =
      typeof mime_type === "string" && mime_type.length > 0
        ? mime_type
        : "application/octet-stream";

    // 2) Fetch the load (RLS will restrict visibility by org)
    const { data: load, error: loadError } = await supabase
      .from("loads")
      .select("id, org_id, status, delivered_at")
      .eq("id", load_id)
      .single();

    if (loadError || !load) {
      console.error("Error fetching load:", loadError);
      return jsonResponse(
        { ok: false, error: "Load not found or not accessible." },
        404,
        req,
      );
    }

    // 3) Insert load_documents row for this POD
    const podInsertPayload: Record<string, unknown> = {
      org_id: load.org_id,
      load_id: load.id,
      type: "POD",
      url: pod_url,
      file_name: safeFileName,
      mime_type: safeMimeType,
      uploaded_by: user.id,
      // uploaded_at default handled by DB if defined
    };

    if (typeof delivery_notes === "string" && delivery_notes.trim().length > 0) {
      podInsertPayload.delivery_notes = delivery_notes.trim();
    }
    if (typeof receiver_name === "string" && receiver_name.trim().length > 0) {
      podInsertPayload.receiver_name = receiver_name.trim();
    }
    if (
      typeof receiver_signature === "string" &&
      receiver_signature.trim().length > 0
    ) {
      podInsertPayload.receiver_signature = receiver_signature.trim();
    }

    const { data: podDoc, error: podError } = await supabase
      .from("load_documents")
      .insert(podInsertPayload)
      .select("id, load_id, type, url, file_name, mime_type, uploaded_at")
      .single();

    if (podError || !podDoc) {
      console.error("Error inserting POD document:", podError);
      return jsonResponse(
        { ok: false, error: "Failed to save POD document." },
        500,
        req,
      );
    }

    // 4) Update the load status + delivered_at
    //    NOTE: If your loads table doesn't have delivered_at, remove that field from the update.
    const deliveredTimestamp: string =
      typeof delivered_at === "string" && delivered_at.length > 0
        ? delivered_at
        : new Date().toISOString();

    const { error: updateError } = await supabase
      .from("loads")
      .update({
        status: "DELIVERED",
        delivered_at: deliveredTimestamp,
      })
      .eq("id", load.id);

    if (updateError) {
      console.error("Error updating load to DELIVERED:", updateError);
      // Don't fail the whole request; POD document is already saved.
      // Just return a warning.
      return jsonResponse(
        {
          ok: true,
          warning:
            "POD document saved, but failed to update load status to DELIVERED.",
          load_id: load.id,
          pod_document_id: podDoc.id,
        },
        200,
        req,
      );
    }

    // 5) Success
    return jsonResponse(
      {
        ok: true,
        message: "POD attached and load marked as DELIVERED.",
        load_id: load.id,
        pod_document_id: podDoc.id,
        delivered_at: deliveredTimestamp,
      },
      200,
      req,
    );
  } catch (err) {
    console.error("Unexpected error in dipsy-upload-pod:", err);
    return jsonResponse(
      { ok: false, error: "Unexpected error processing POD." },
      500,
      req,
    );
  }
});

// Helper: build CORS headers
function buildCorsHeaders(req: Request): Headers {
  const origin = req.headers.get("Origin") || "*";

  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  });
}

// Helper: JSON response with CORS
function jsonResponse(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(buildCorsHeaders(req).entries()),
    },
  });
}
