// supabase/functions/send-load-instructions-email/index.ts
// Purpose: Send load instructions via Resend email with a clean HTML layout.
// Expects JSON body: { to, subject, body, loadId, mode }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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
 * - Remaining lines appear in a clean block with preserved line breaks
 */
function buildHtmlEmail(subject: string, textBody: string) {
  const lines = textBody.split(/\r?\n/);
  const titleLine = escapeHtml(lines[0] ?? subject);
  const rest = lines.slice(1).join("\n");
  const restEscaped = escapeHtml(rest).replace(/\r?\n/g, "<br />");

  return `
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>${escapeHtml(subject)}</title>
  </head>

  <body style="margin:0; padding:0; background-color:#020617; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#020617; padding:32px 0;">
      <tr>
        <td align="center" style="padding:0 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px; background-color:#020617;">

            <!-- Header -->
            <tr>
              <td style="padding-bottom:20px; text-align:left;">
                <div style="color:#12d6a7; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; font-weight:700;">
                  ATLAS COMMAND
                </div>
                <div style="color:#6b7280; font-size:11px; margin-top:2px;">
                  Load Instructions
                </div>
              </td>
            </tr>

            <!-- Gradient Card -->
            <tr>
              <td style="
                background: linear-gradient(135deg, rgba(18,214,167,0.18), rgba(18,214,167,0.08));
                border-radius:18px;
                padding:28px;
                border:1px solid rgba(18,214,167,0.25);
              ">
                <h1 style="
                  margin:0 0 16px 0;
                  font-size:20px;
                  line-height:1.3;
                  color:#ffffff;
                  font-weight:700;
                ">
                  ${titleLine}
                </h1>

                <div style="font-size:14px; line-height:1.6; color:#e5e7eb;">
                  ${restEscaped}
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding-top:20px;">
                <div style="font-size:11px; line-height:1.6; color:#9ca3af;">
                  This message was generated from <strong style="color:#12d6a7;">Atlas Command</strong> 
                  to provide load instructions to your driver or carrier.  
                  If anything looks incorrect, reply directly to your dispatcher before running the load.
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}


serve(async (req: Request) => {
  // Basic CORS handling
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const { to, subject, body, loadId, mode } = await req.json();

    if (!to || !subject || !body) {
      return json(
        { success: false, error: "Missing to/subject/body" },
        400,
      );
    }

    const textBody = String(body);
    const htmlBody = buildHtmlEmail(String(subject), textBody);

    console.log("[send-load-instructions-email] payload", {
      to,
      subject,
      loadId,
      mode,
    });

    // Call Resend API
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    const resendData = await resendResp.json().catch(
      () => ({} as unknown),
    );

    if (!resendResp.ok) {
      console.error(
        "[send-load-instructions-email] Resend error",
        resendResp.status,
        resendData,
      );
      return json(
        {
          success: false,
          error:
            (resendData as any)?.error?.message ??
            `Resend failed with status ${resendResp.status}`,
        },
        500,
      );
    }

    console.log("[send-load-instructions-email] Resend success", resendData);

    return json({ success: true }, 200);
  } catch (err: any) {
    console.error("[send-load-instructions-email] handler error", err);
    return json(
      { success: false, error: err?.message ?? "Unknown error" },
      500,
    );
  }
});

// Helper to return JSON with CORS
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
