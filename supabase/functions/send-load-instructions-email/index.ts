// FILE: supabase/functions/send-load-instructions-email/index.ts
// Purpose: Send load instructions via Resend email with a clean HTML layout.
// Expects JSON body: { to, subject, body, loadId, mode }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// CORS headers so your browser (localhost:5173, Vercel, etc.) can call this safely
const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Read env vars safely
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "onboarding@resend.dev";

if (!RESEND_API_KEY) {
  console.error("[send-load-instructions-email] RESEND_API_KEY is not set");
}

/**
 * Very small HTML-escape helper
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turn the plain-text body into a simple, professional HTML email.
 * - First line becomes the heading
 * - Remaining lines are rendered as paragraphs
 */
function buildHtmlEmail(body: string): string {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const heading = escapeHtml(lines[0] || "Load Instructions");
  const rest = lines.slice(1).filter((l) => l.length > 0);

  const paragraphs =
    rest.length > 0
      ? rest
          .map(
            (line) =>
              `<p style="margin: 0 0 4px 0; font-size: 14px; line-height: 1.4;">${escapeHtml(
                line
              )}</p>`
          )
          .join("")
      : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#020617; font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#020617; padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px; background-color:#020617; border-radius:16px; border:1px solid #1f2937; padding:24px;">
            <tr>
              <td style="padding-bottom:16px;">
                <h1 style="margin:0; font-size:18px; color:#e5e7eb;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 16px; border-radius:12px; background:linear-gradient(145deg, rgba(16,185,129,0.08), rgba(30,64,175,0.18)); border:1px solid rgba(16,185,129,0.5);">
                <pre style="margin:0; font-size:13px; line-height:1.4; color:#e5e7eb; white-space:pre-wrap;">${escapeHtml(
                  body
                )}</pre>
              </td>
            </tr>
            <tr>
              <td style="padding-top:16px; font-size:11px; color:#9ca3af;">
                Sent via Atlas Command • Automated load instructions email
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const payload = await req.json().catch(() => ({} as any));
    const { to, subject, body, mode, loadId } = payload as {
      to?: string;
      subject?: string;
      body?: string;
      mode?: string;
      loadId?: string;
    };

    if (!to || !subject || !body) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          details: "to, subject, and body are required",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "Resend API key not configured",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const html = buildHtmlEmail(body);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to,
        subject,
        html,
        text: body,
        headers: {
          "X-Atlas-Mode": mode || "email",
          "X-Atlas-Load-Id": loadId || "",
        },
      }),
    });

    if (!resendRes.ok) {
      const text = await resendRes.text();
      console.error("[send-load-instructions-email] Resend error:", text);
      return new Response(
        JSON.stringify({
          error: "Resend API error",
          details: text,
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const data = await resendRes.json();

    return new Response(
      JSON.stringify({
        ok: true,
        id: data?.id ?? null,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("[send-load-instructions-email] Unhandled error:", err);
    return new Response(
      JSON.stringify({
        error: "Unhandled error",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
