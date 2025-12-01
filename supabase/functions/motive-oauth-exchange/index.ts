// FILE: supabase/functions/motive-oauth-exchange/index.ts
// Purpose:
// - Handle the OAuth redirect back from Motive.
// - Right now, this is a "safe placeholder":
//   • Reads the `code` and `state` query params.
//   • Shows a simple HTML "connection received" page.
//   • Does NOT call Motive or write to the database yet.
// - This keeps the function deployable and ready to be upgraded later
//   without breaking Supabase or RLS.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function htmlResponse(title: string, body: string, status = 200): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      background-color: #020617; /* slate-950 */
      color: #e5e7eb; /* gray-200 */
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background-color: #020617;
      border-radius: 1rem;
      padding: 2rem 2.5rem;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.8);
      border: 1px solid #1e293b;
    }
    .title {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .subtitle {
      font-size: 0.95rem;
      color: #9ca3af;
      margin-bottom: 1.5rem;
    }
    .tag {
      display: inline-block;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.25rem 0.6rem;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.08);
      color: #7dd3fc;
      border: 1px solid rgba(56, 189, 248, 0.3);
      margin-bottom: 1rem;
    }
    .footer {
      margin-top: 1.5rem;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .strong {
      color: #e5e7eb;
      font-weight: 500;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background-color: #0f172a;
      border: 1px solid #1f2937;
      font-size: 0.7rem;
      margin-top: 0.25rem;
    }
    .pill span {
      opacity: 0.8;
    }
    code {
      font-family: Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
        monospace;
      font-size: 0.75rem;
      background-color: #020617;
      padding: 0.25rem 0.4rem;
      border-radius: 0.375rem;
      border: 1px solid #1f2937;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">Atlas Command · Motive</div>
    <div class="title">${title}</div>
    <div class="subtitle">${body}</div>
    <div class="footer">
      You can safely close this tab and return to
      <span class="strong">Atlas Command</span>.<br />
      <div class="pill">
        <span>Integration status: handled by your Atlas backend</span>
      </div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

serve((req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // If Motive returned an error explicitly
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    const message = `We received an error from Motive: <code>${error}</code>${
      errorDescription ? ` – ${errorDescription}` : ""
    }.`;
    return htmlResponse(
      "Motive connection failed",
      `${message}<br /><br />Please contact Atlas support to retry the connection.`,
      400,
    );
  }

  if (!code) {
    return htmlResponse(
      "Missing authorization code",
      "We did not receive an authorization code from Motive. This tab can be closed, but the connection may not be complete.",
      400,
    );
  }

  // At this stage we simply acknowledge the redirect.
  // In a future version, we can:
  // - Validate `state` (CSRF protection).
  // - Exchange `code` for tokens via Motive's OAuth endpoint.
  // - Store tokens in a secure table using a service-role Supabase client.

  const safeState = state ? `<code>${state}</code>` : "not provided";

  const body = `Your Motive connection code was received successfully.<br /><br />
We have captured the authorization response and your Atlas backend can now finish wiring the integration.<br /><br />
State: ${safeState}`;

  return htmlResponse("Motive connection received", body, 200);
});
