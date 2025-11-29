// FILE: supabase/functions/sales-call-voice-twiml/index.ts
// Purpose:
// - Return TwiML that connects the outbound call to your local
//   Atlas Command Voice Bridge over WebSocket via ngrok.
// - We do NOT use the `track` attribute here, because for
//   <Connect><Stream> Twilio expects only the inbound track,
//   and using `both_tracks` causes error 31941 (Invalid Track configuration).
//
// Important:
// - Your Node bridge is exposed by ngrok at:
//     https://unconcernedly-unlarge-adaline.ngrok-free.dev  ->  http://localhost:8080
// - The WebSocket URL for Twilio must therefore be:
//     wss://unconcernedly-unlarge-adaline.ngrok-free.dev/twilio
//
// Security:
// - This just returns TwiML. No secrets, no DB access, no RLS changes.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async () => {
  try {
    // Hard-coded for now to avoid any env-var confusion.
    const streamUrl = "wss://unconcernedly-unlarge-adaline.ngrok-free.dev/twilio";

    console.log("[sales-call-voice-twiml] Using Stream URL:", streamUrl);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting you to Atlas Command AI Voice.</Say>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

    console.log("[sales-call-voice-twiml] TwiML body:\n", twiml);

    return new Response(twiml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
      },
    });
  } catch (err) {
    console.error("[sales-call-voice-twiml] ERROR:", err);

    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We are unable to connect your call right now. Please try again later.</Say>
</Response>`;

    return new Response(errorTwiml, {
      status: 500,
      headers: {
        "Content-Type": "application/xml",
      },
    });
  }
});
