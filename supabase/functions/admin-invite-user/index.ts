// supabase/functions/admin-invite-user/index.ts
// SMTP-free invite generator with optional email sending via Resend.
// - Generates a usable link (invite → signup → magiclink).
// - If RESEND_API_KEY is set and FROM_EMAIL is allowed in Resend, it emails the user.
// - Always returns JSON; never throws unhandled errors.
//
// REQUIRED (run once):
//   supabase secrets set SITE_URL=https://tnpesnohwbwpmakvyzpn.supabase.co \
//     SB_SERVICE_ROLE_KEY=<YOUR_SERVICE_ROLE_KEY> \
//     --project-ref tnpesnohwbwpmakvyzpn
//
// OPTIONAL (recommended to send the email):
//   supabase secrets set RESEND_API_KEY=<YOUR_RESEND_API_KEY> \
//     FROM_EMAIL="Atlas Command <no-reply@yourdomain.com>" \
//     INVITE_REDIRECT_TO=https://atlas-command-iota.vercel.app/auth/callback \
//     --project-ref tnpesnohwbwpmakvyzpn
//
// Deploy:
//   supabase functions deploy admin-invite-user
//
// Notes:
// - In Resend, verify your sending domain (or use an allowed from address).
// - If email fails, the function still returns `invite_link` so you can copy/paste.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Payload = {
  email: string;
  full_name?: string;
  phone?: string;
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

async function sendWithResend(apiKey: string, fromEmail: string, to: string, subject: string, html: string, text: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject,
      html,
      text,
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(`Resend ${r.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return respond({ ok: true });
  if (req.method !== "POST") return respond({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SITE_URL");                // we can't store SUPABASE_URL* secrets
  const SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";  // optional
  const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "";          // optional but required for sending
  const INVITE_REDIRECT_TO =
    Deno.env.get("INVITE_REDIRECT_TO") ??
    "https://atlas-command-iota.vercel.app/auth/callback";

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return respond({
      ok: false,
      error: "Missing required env vars",
      detail: {
        SITE_URL_present: Boolean(SUPABASE_URL),
        SB_SERVICE_ROLE_KEY_present: Boolean(SERVICE_ROLE),
      },
    });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return respond({ ok: false, error: "Invalid JSON body" });
  }

  const email = (payload.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond({ ok: false, error: "Valid 'email' is required" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "admin-invite-user-email" } },
  });

  // Helper: attempt a link type (never throw)
  async function tryLink(type: "invite" | "signup" | "magiclink") {
    const { data, error } = await supabase.auth.admin.generateLink({
      type,
      email,
      options: {
        redirectTo: INVITE_REDIRECT_TO,
        data: {
          full_name: payload.full_name ?? undefined,
          phone: payload.phone ?? undefined,
        },
      },
    });
    if (!error && data?.properties?.action_link) {
      return { ok: true as const, type, link: data.properties.action_link };
    }
    return {
      ok: false as const,
      type,
      error: {
        message: error?.message ?? null,
        name: error?.name ?? null,
        status: (error as any)?.status ?? null,
      },
    };
  }

  // Try invite → signup → magiclink
  const attempts = [];
  const a1 = await tryLink("invite"); attempts.push(a1);
  const winner = a1.ok ? a1 : null;

  const a2 = winner ? null : await tryLink("signup"); if (a2) attempts.push(a2);
  const winner2 = winner ?? (a2 && a2.ok ? a2 : null);

  const a3 = winner2 ? null : await tryLink("magiclink"); if (a3) attempts.push(a3);
  const finalWinner = winner2 ?? (a3 && a3.ok ? a3 : null);

  if (!finalWinner) {
    return respond({
      ok: false,
      error: "Could not generate any link (invite/signup/magiclink).",
      detail: attempts,
      hints: [
        "Verify the service role key is correct (not the anon key).",
        "Check Auth configuration for domain restrictions/disabled email auth.",
      ],
    });
  }

  const inviteLink = finalWinner.link;

  // Optionally send an email via Resend
  let emailSent = false;
  let emailError: string | null = null;

  if (RESEND_API_KEY && FROM_EMAIL) {
    const namePart = payload.full_name ? ` ${payload.full_name}` : "";
    const subject = "You're invited to Atlas Command";
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111">
        <h2 style="margin:0 0 12px">Welcome to Atlas Command</h2>
        <p>Hi${namePart},</p>
        <p>Click the button below to get started. You’ll be redirected to set a password or sign in.</p>
        <p style="margin:24px 0">
          <a href="${inviteLink}" style="background:#000;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block">
            Open Your Invite
          </a>
        </p>
        <p style="margin:0 0 12px">Or copy this link:</p>
        <p style="word-break:break-all"><a href="${inviteLink}">${inviteLink}</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#666">If you didn’t expect this email, you can ignore it.</p>
      </div>
    `;
    const text =
`Welcome to Atlas Command${namePart}
Open your invite:
${inviteLink}

If you didn’t expect this email, you can ignore it.`;

    try {
      await sendWithResend(RESEND_API_KEY, FROM_EMAIL, email, subject, html, text);
      emailSent = true;
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }
  }

  return respond({
    ok: true,
    mode: finalWinner.type,
    email,
    invite_link: inviteLink,
    email_sent_via_resend: emailSent,
    email_error: emailError,
    note: emailSent
      ? "Invite emailed via Resend and link returned."
      : "Email not sent (missing/invalid RESEND_API_KEY or FROM_EMAIL); link returned for manual sharing.",
  }, 201);
});
