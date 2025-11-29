// FILE: supabase/functions/sales-voice-health/index.ts
// Purpose:
//   Health check / diagnostics for the Atlas AI voice calling pipeline.
//
//   This function is called from the frontend (/sales) to determine if it's
//   SAFE or UNSAFE to place AI calls. It DOES NOT weaken or bypass RLS.
//
//   It checks:
//     - Twilio env vars are present
//     - TwiML URL is reachable (soft check / warning only)
//     - Voice Bridge health endpoint is reachable
//     - Twilio status webhook URL is configured and valid
//     - Supabase auth works for the caller (JWT valid)
//     - current_org_id() is resolvable
//     - DB read against sales_calls works under RLS
//
// Security:
//   - Uses ONLY the anon key + caller's Authorization header.
//   - Does NOT use service-role.
//   - Respects RLS and org isolation.
//   - Does NOT return any secret values, only presence/boolean flags.
//

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders } from "../_shared/cors.ts";

// Utility: small timeout wrapper for fetch
async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 5000,
): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(id);
    }
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: {
                ...corsHeaders,
                "Content-Type": "text/plain",
            },
        });
    }

    const healthId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    // Required Twilio env vars
    const twilioEnvVars = [
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "TWILIO_FROM_NUMBER",
        "TWILIO_TWIML_URL",
        "TWILIO_STATUS_CALLBACK_URL",
    ];

    // Optional but recommended: voice bridge health endpoint
    const VOICE_BRIDGE_HEALTH_URL = Deno.env.get("VOICE_BRIDGE_HEALTH_URL") ?? "";

    // Prepare result object
    const result: {
        ok: boolean;
        health_id: string;
        timestamp: string;
        checks: Record<string, any>;
    } = {
        ok: false,
        health_id: healthId,
        timestamp,
        checks: {},
    };

    // 1) Twilio env vars presence (CRITICAL)
    const missingTwilio: string[] = [];
    const presentTwilio: string[] = [];

    for (const key of twilioEnvVars) {
        if (Deno.env.get(key)) {
            presentTwilio.push(key);
        } else {
            missingTwilio.push(key);
        }
    }

    const twilioEnvOk = missingTwilio.length === 0;

    result.checks.twilio_env = {
        ok: twilioEnvOk,
        missing: missingTwilio,
        present: presentTwilio,
    };

    // 2) Check TwiML URL reachability (SOFT / WARNING ONLY)
    // We still probe it for visibility, but we do NOT use this in overallOk.
    let twimlUrlOk = false;
    const twimlUrl = Deno.env.get("TWILIO_TWIML_URL") ?? "";
    if (twimlUrl) {
        try {
            const res = await fetchWithTimeout(twimlUrl, { method: "GET" }, 5000);
            twimlUrlOk = res.ok;
            result.checks.twiml_url = {
                ok: twimlUrlOk,
                status: res.status,
                // Mark this as a soft check so UI can show it as a warning if needed
                severity: "warning",
                note:
                    "This is a soft probe. Twilio may return non-2xx for generic GETs even when calls still work.",
            };
        } catch (err) {
            result.checks.twiml_url = {
                ok: false,
                status: null,
                severity: "warning",
                error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
                note:
                    "This is a soft probe. Investigate if calls fail, but this does not block overall readiness.",
            };
        }
    } else {
        result.checks.twiml_url = {
            ok: false,
            status: null,
            severity: "warning",
            error: "TWILIO_TWIML_URL not set",
            note:
                "TwiML URL missing. Calls may still work if configured directly in Twilio, but this is recommended to fix.",
        };
    }

    // 3) Check Voice Bridge health (CRITICAL)
    let voiceBridgeOk = false;
    if (VOICE_BRIDGE_HEALTH_URL) {
        try {
            const res = await fetchWithTimeout(
                VOICE_BRIDGE_HEALTH_URL,
                { method: "GET" },
                5000,
            );
            const statusOk = res.ok;
            let body: any = null;
            try {
                body = await res.json();
            } catch {
                // ignore JSON parse error; body remains null
            }
            const bodyOk = body && typeof body === "object" && body.ok === true;

            voiceBridgeOk = statusOk && bodyOk;

            result.checks.voice_bridge = {
                ok: voiceBridgeOk,
                status: res.status,
                body_ok_flag: bodyOk,
            };
        } catch (err) {
            result.checks.voice_bridge = {
                ok: false,
                error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    } else {
        result.checks.voice_bridge = {
            ok: false,
            error: "VOICE_BRIDGE_HEALTH_URL not set",
        };
    }

    // 4) Check Twilio Status Webhook URL format (CRITICAL)
    const statusCallbackUrl = Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ?? "";
    let statusWebhookOk = false;
    if (statusCallbackUrl) {
        try {
            // This will throw if the URL is invalid
            new URL(statusCallbackUrl);
            statusWebhookOk = true;
            result.checks.status_webhook = {
                ok: true,
            };
        } catch (err) {
            result.checks.status_webhook = {
                ok: false,
                error: `Invalid URL format: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    } else {
        result.checks.status_webhook = {
            ok: false,
            error: "TWILIO_STATUS_CALLBACK_URL not set",
        };
    }

    // 5) Supabase auth + org context + DB read (CRITICAL)
    let supabaseAuthOk = false;
    let orgContextOk = false;
    let dbReadOk = false;
    let userId: string | null = null;
    let orgId: string | null = null;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        result.checks.supabase_auth = {
            ok: false,
            error: "SUPABASE_URL or SUPABASE_ANON_KEY not set",
        };
        result.checks.org_context = {
            ok: false,
            error: "Supabase env not configured",
        };
        result.checks.db_read = {
            ok: false,
            error: "Supabase env not configured",
        };
    } else {
        const authHeader = req.headers.get("Authorization") ?? "";

        if (!authHeader) {
            result.checks.supabase_auth = {
                ok: false,
                error: "Missing Authorization header (user not signed in?)",
            };
            result.checks.org_context = {
                ok: false,
                error: "Cannot resolve org without user context",
            };
            result.checks.db_read = {
                ok: false,
                error: "Cannot query DB without user context",
            };
        } else {
            const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                global: {
                    headers: {
                        Authorization: authHeader,
                    },
                },
            });

            // 5a) Check user auth via getUser()
            try {
                const { data, error } = await supabase.auth.getUser();
                if (error || !data?.user) {
                    result.checks.supabase_auth = {
                        ok: false,
                        error: error?.message ?? "No user found for provided token",
                    };
                } else {
                    userId = data.user.id;
                    supabaseAuthOk = true;
                    result.checks.supabase_auth = {
                        ok: true,
                        user_id: userId,
                    };
                }
            } catch (err) {
                result.checks.supabase_auth = {
                    ok: false,
                    error: `auth.getUser() failed: ${err instanceof Error ? err.message : String(err)
                        }`,
                };
            }

            // 5b) Resolve current_org_id() via RPC (if auth ok)
            if (supabaseAuthOk) {
                try {
                    const { data, error } = await supabase.rpc("current_org_id");
                    if (error || !data) {
                        result.checks.org_context = {
                            ok: false,
                            error: error?.message ?? "current_org_id() returned null",
                        };
                    } else {
                        orgId = data as string;
                        orgContextOk = true;
                        result.checks.org_context = {
                            ok: true,
                            org_id: orgId,
                        };
                    }
                } catch (err) {
                    result.checks.org_context = {
                        ok: false,
                        error: `rpc('current_org_id') failed: ${err instanceof Error ? err.message : String(err)
                            }`,
                    };
                }
            }

            // 5c) Test DB read from sales_calls with RLS (if auth + org ok)
            if (supabaseAuthOk && orgContextOk) {
                try {
                    const { error } = await supabase
                        .from("sales_calls")
                        .select("id")
                        .limit(1);
                    if (error) {
                        result.checks.db_read = {
                            ok: false,
                            error: error.message,
                        };
                    } else {
                        dbReadOk = true;
                        result.checks.db_read = {
                            ok: true,
                        };
                    }
                } catch (err) {
                    result.checks.db_read = {
                        ok: false,
                        error: `DB read failed: ${err instanceof Error ? err.message : String(err)
                            }`,
                    };
                }
            }
        }
    }

    // Determine overall OK
    // LONG-TERM STRATEGY:
    //   - TwiML URL probe is a SOFT check (warning-only).
    //   - Overall readiness depends ONLY on truly critical checks.
    const overallOk =
        twilioEnvOk &&
        voiceBridgeOk &&
        statusWebhookOk &&
        supabaseAuthOk &&
        orgContextOk &&
        dbReadOk;

    result.ok = overallOk;

    // Log a structured line for debugging (no secrets)
    console.log(
        JSON.stringify({
            source: "sales-voice-health",
            health_id: healthId,
            timestamp,
            overall_ok: overallOk,
            user_id: userId,
            org_id: orgId,
            checks: {
                twilio_env_ok: twilioEnvOk,
                twiml_url_ok: twimlUrlOk,
                voice_bridge_ok: voiceBridgeOk,
                status_webhook_ok: statusWebhookOk,
                supabase_auth_ok: supabaseAuthOk,
                org_context_ok: orgContextOk,
                db_read_ok: dbReadOk,
            },
        }),
    );

    return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
        },
    });
});
