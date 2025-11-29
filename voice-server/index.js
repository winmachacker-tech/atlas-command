// FILE: voice-server/index.js
/**
 * Dipsy Voice Server (browser <-> OpenAI Realtime)
 *
 * What this file does in plain English:
 * ------------------------------------
 * - Listens for WebSocket connections from your browser (Atlas frontend).
 * - Receives:
 *     • Raw microphone audio (PCM16) from the browser.
 *     • Simple JSON control messages:
 *         - start_user_input
 *         - stop_user_input
 *         - play_script
 *         - reload_brain
 *         - NEW: auth  -> { type: "auth", access_token: "..." }
 * - Opens a separate WebSocket to OpenAI Realtime for each browser client.
 * - Streams your audio up to OpenAI.
 * - Streams Dipsy’s audio replies back down to the browser.
 * - Sends simple JSON events back to the browser:
 *     • dipsy_transcript (final text)
 *     • speaking_started / speaking_stopped
 *     • error
 *
 * NEW: Atlas tools + grounded summaries
 * -------------------------------------
 * - Registers Atlas tools with OpenAI Realtime:
 *     • list_active_loads
 *     • list_available_drivers
 *     • NEW: search_fleet_latest (Motive + Samsara + Dummy)
 * - Listens for OpenAI tool calls (response.output_item.added with item.type = "tool_call").
 * - Executes those tools by:
 *     • For loads/drivers:
 *         - Calling Supabase REST with Authorization: Bearer <userAccessToken>.
 *         - Using helper functions in atlas-supabase.js:
 *             - fetchActiveLoads
 *             - fetchAvailableDrivers
 *     • For fleet:
 *         - Calling Supabase RPC current_org_id via REST (RLS-safe).
 *         - Calling the Edge Function dipsy-tools-fleet with:
 *               { org_id, tool: "search_fleet_latest", params: { ... } }
 *         - dipsy-tools-fleet uses SUPABASE_SERVICE_ROLE_KEY safely on the backend.
 * - Instead of sending raw JSON back, the server:
 *     • Builds a short, accurate English summary starting with "FINAL:".
 *     • Sends that summary as tool.output text.
 * - The session instructions tell Dipsy:
 *     • "If tool.output text starts with 'FINAL:', treat it as ground truth and
 *        speak it almost verbatim. Do not change counts, names, cities, states,
 *        or equipment types."
 *
 * SECURITY:
 * - OPENAI_API_KEY stays ONLY on this backend.
 * - Supabase:
 *     • Uses SUPABASE_URL + SUPABASE_ANON_KEY (public client key).
 *     • Uses ONLY the user's JWT (access_token) for Authorization.
 *     • Never uses the service-role key here.
 * - Fleet data:
 *     • Actual DB queries run ONLY inside the Edge Function dipsy-tools-fleet,
 *       which uses the service-role key on the Supabase side (server-only).
 *     • This server just calls that Edge Function with Authorization: Bearer <userAccessToken>.
 * - userAccessToken:
 *     • Stored only in memory, per WebSocket connection.
 *     • Never logged.
 *     • Never sent to OpenAI.
 * - RLS:
 *     • Still enforced whenever we call Supabase REST directly (loads/drivers).
 *     • Org boundaries are also enforced inside dipsy-tools-fleet by org_id.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

// Atlas tools (schemas only)
const { atlasTools } = require("./atlas-tools");
// Supabase data helpers (RLS-safe via user JWT)
const {
  fetchActiveLoads,
  fetchAvailableDrivers,
} = require("./atlas-supabase");

// === Env vars ===
const PORT = process.env.DIPSY_VOICE_PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL =
  process.env.DIPSY_VOICE_MODEL || "gpt-4o-realtime-preview";
const SYSTEM_PROMPT_FILE = process.env.DIPSY_VOICE_SYSTEM_PROMPT_FILE || "";

// Supabase for REST & Edge Function calls (RLS + tools)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Derived: Functions base URL for this project
// Example: https://<ref>.supabase.co/functions/v1
const SUPABASE_FUNCTIONS_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1`
  : "";

// Edge Function to access unified fleet data (Motive + Samsara + Dummy)
const FLEET_TOOLS_URL = SUPABASE_FUNCTIONS_URL
  ? `${SUPABASE_FUNCTIONS_URL}/dipsy-tools-fleet`
  : "";

// Basic sanity check
if (!OPENAI_API_KEY) {
  console.error("[DipsyVoice:ERROR] OPENAI_API_KEY is not set in .env");
  process.exit(1);
}

/**
 * Load Dipsy’s “brain” from a .txt file, if configured.
 */
function loadSystemPrompt() {
  if (SYSTEM_PROMPT_FILE) {
    const absolutePath = path.resolve(SYSTEM_PROMPT_FILE);
    try {
      const text = fs.readFileSync(absolutePath, "utf8");
      console.log(
        `[DipsyVoice] Loaded system prompt from: ${absolutePath} (length: ${text.length} chars)`
      );
      return text.trim();
    } catch (err) {
      console.warn(
        `[DipsyVoice:WARN] Could not read system prompt file: ${absolutePath}`,
        err.message
      );
    }
  }

  // Fallback prompt if no file or read error
  console.log("[DipsyVoice] Using built-in default system prompt.");
  return (
    "You are Dipsy, the AI dispatch assistant inside Atlas Command. " +
    "You are talking to Mark, the CEO of Atlas Command. " +
    "Stay strictly focused on trucking, dispatch, drivers, loads, and the Atlas Command TMS. " +
    "If the user asks about 'what drivers are available' or 'what loads are active', and you have tools, " +
    "you should call tools to fetch live data instead of guessing. " +
    "If tools are not available or fail, be honest about that and explain what you would normally do in Atlas Command. " +
    "Always answer in English. Never respond in Spanish or any other language. " +
    "Keep answers short and concrete—2 to 4 sentences—avoid rambling, and sound like a confident dispatch pro."
  );
}

// Cache the system prompt in memory
let SYSTEM_PROMPT = loadSystemPrompt();

/**
 * Helper to reload the system prompt at runtime (optional).
 */
function reloadSystemPrompt() {
  SYSTEM_PROMPT = loadSystemPrompt();
}

// ================
// Summary helpers
// ================

function normalizeArray(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.data)) return result.data;
  return [];
}

function summarizeDrivers(result) {
  const drivers = normalizeArray(result);
  const count = drivers.length;

  if (count === 0) {
    return (
      "FINAL: I didn’t find any available drivers in Atlas that match that filter right now. " +
      "Try widening the state or equipment type, or check the Drivers page directly."
    );
  }

  const examples = drivers.slice(0, 2).map((d) => {
    const name = d.name || d.driver_name || "a driver";
    const state = d.home_state || d.state || d.region || null;
    const equip =
      d.equipment_type || d.truck_type || d.equipment || d.trailer_type || null;

    let parts = [name];
    if (state) parts.push(`based in ${state}`);
    if (equip) parts.push(`running ${equip.toString().replace(/_/g, " ")}`);
    return parts.join(" ");
  });

  let summary =
    `FINAL: I see ${count} available drivers in Atlas that match that filter. ` +
    `For example: ${examples.join("; ")}.`;

  if (count > examples.length) {
    summary += ` There are ${count - examples.length} more available as well.`;
  }

  return summary;
}

function summarizeLoads(result) {
  const loads = normalizeArray(result);
  const count = loads.length;

  if (count === 0) {
    return (
      "FINAL: I didn’t find any active loads in Atlas that match that filter right now. " +
      "Try adjusting the status, state filters, or time window, or check the Loads board directly."
    );
  }

  const examples = loads.slice(0, 3).map((l) => {
    const oCity = l.origin_city || l.pickup_city || null;
    const oState = l.origin_state || l.pickup_state || null;
    const dCity = l.destination_city || l.dropoff_city || null;
    const dState = l.destination_state || l.drop_state || null;
    const status = l.status || null;

    let lane = "";
    if (oCity || oState) {
      lane += oCity ? `${oCity}` : "";
      lane += oState ? (oCity ? `, ${oState}` : `${oState}`) : "";
    }
    lane += " → ";
    if (dCity || dState) {
      lane += dCity ? `${dCity}` : "";
      lane += dState ? (dCity ? `, ${dState}` : `${dState}`) : "";
    }

    if (!lane.trim()) lane = "an origin → destination lane";

    if (status) {
      return `${lane} (${status})`;
    }
    return lane;
  });

  let summary =
    `FINAL: I see ${count} active loads in Atlas that match that filter. ` +
    `For example: ${examples.join("; ")}.`;

  return summary;
}

/**
 * Summarize unified fleet positions (Motive + Samsara + Dummy).
 * result: array from dipsy-tools-fleet with objects like:
 *   {
 *     provider: "motive" | "samsara" | "dummy",
 *     provider_label: "Motive" | "Samsara" | "Atlas Dummy",
 *     display_name,
 *     latitude,
 *     longitude,
 *     speed_mph,
 *     located_at,
 *     ...
 *   }
 */
function summarizeFleetPositions(result, requestedProvider) {
  const rows = normalizeArray(result);
  const count = rows.length;

  if (count === 0) {
    let providerText = "any live trucks";
    if (requestedProvider === "dummy") providerText = "any dummy fleet trucks";
    if (requestedProvider === "motive")
      providerText = "any Motive-linked trucks";
    if (requestedProvider === "samsara")
      providerText = "any Samsara-linked trucks";

    return (
      `FINAL: I don’t see ${providerText} with current GPS positions for your org right now. ` +
      "If you just added a provider, give it a minute for positions to sync, or check the Fleet Map page directly."
    );
  }

  const examples = rows.slice(0, 3).map((v) => {
    const name = v.display_name || "a truck";
    const provider = v.provider_label || v.provider || "Fleet";
    const lat = typeof v.latitude === "number" ? v.latitude.toFixed(4) : "N/A";
    const lon =
      typeof v.longitude === "number" ? v.longitude.toFixed(4) : "N/A";
    const speed =
      typeof v.speed_mph === "number" ? `${Math.round(v.speed_mph)} mph` : null;

    let parts = [`${name} (${provider}) at ${lat}, ${lon}`];
    if (speed) parts.push(`going about ${speed}`);
    return parts.join(" ");
  });

  const providerLabel =
    requestedProvider && requestedProvider !== "all"
      ? requestedProvider
      : "your linked fleet providers";

  let summary =
    `FINAL: I see ${count} trucks with live positions from ${providerLabel} for your org. ` +
    `For example: ${examples.join("; ")}.`;

  if (count > examples.length) {
    summary += ` There are ${count - examples.length} more with current GPS data as well.`;
  }

  return summary;
}

/**
 * Get current_org_id() using Supabase REST with the user's JWT.
 * This respects RLS and never uses the service-role key here.
 */
async function fetchCurrentOrgId({ accessToken }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_ANON_KEY is not set for Dipsy voice server."
    );
  }

  const url = `${SUPABASE_URL}/rest/v1/rpc/current_org_id`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `current_org_id RPC failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const orgId = await res.json(); // will be a UUID string or null
  return orgId;
}

/**
 * Call the dipsy-tools-fleet Edge Function to get fleet data.
 * - accessToken: Supabase user JWT (for verify_jwt)
 * - tool: "search_fleet_latest" (for now)
 * - params: { provider?: "motive" | "samsara" | "dummy" | "all", limit?: number }
 */
async function callFleetTools({ accessToken, tool, params }) {
  if (!FLEET_TOOLS_URL) {
    throw new Error("FLEET_TOOLS_URL is not configured.");
  }
  if (!accessToken) {
    throw new Error("Missing access token for fleet tools.");
  }

  const orgId = await fetchCurrentOrgId({ accessToken });
  if (!orgId) {
    throw new Error(
      "current_org_id() returned null. You must be in an org to use fleet tools."
    );
  }

  const res = await fetch(FLEET_TOOLS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`, // satisfies verify_jwt=true
    },
    body: JSON.stringify({
      org_id: orgId,
      tool,
      params,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `dipsy-tools-fleet HTTP error: ${res.status} ${res.statusText} ${text}`
    );
  }

  const json = await res.json();
  if (!json.ok) {
    throw new Error(
      `dipsy-tools-fleet error: ${json.error || "Unknown fleet tools error"}`
    );
  }

  return json.result;
}

// Create HTTP server + WebSocket server for browser
const server = http.createServer();
const wss = new WebSocket.Server({ server });

console.log(
  `[DipsyVoice] Voice server listening on http://localhost:${PORT}`
);
console.log(
  `[DipsyVoice] WebSocket endpoint: ws://localhost:${PORT}`
);

/**
 * When a browser connects:
 * - We create a dedicated connection to OpenAI Realtime.
 * - We bridge messages between browser <-> OpenAI.
 * - We track a per-connection Supabase user access token (userAccessToken).
 */
wss.on("connection", (browserWs) => {
  console.log("[DipsyVoice] New browser client connected");

  let openaiWs = null;
  let openaiReady = false;
  let userInputActive = false;
  let isSpeaking = false;

  // Per-connection Supabase user JWT (RLS-respecting)
  let userAccessToken = null;

  // Connect to OpenAI Realtime for this client
  function connectOpenAI() {
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      return;
    }

    const url = `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`;

    openaiWs = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiWs.on("open", () => {
      openaiReady = true;
      console.log("[DipsyVoice:DEBUG] Connected to OpenAI Realtime");

      // Session configuration + tools + strict tool-output rule
      const extraInstructions =
        "\n\nSTRICT LANGUAGE RULE: Always respond in English only." +
        "\nTOOL OUTPUT RULE: If you receive tool.output text that begins with 'FINAL:', " +
        "treat it as ground truth from Atlas. Speak it almost verbatim and do NOT change any " +
        "numbers, names, cities, states, or equipment types.";

      openaiWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            voice: "alloy",
            instructions: `${SYSTEM_PROMPT}${extraInstructions}`,
            modalities: ["audio", "text"],
            temperature: 0.8,
            max_response_output_tokens: "inf",
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 200,
              idle_timeout_ms: null,
              interrupt_response: true,
              create_response: true,
            },
            // Register Atlas tools with the Realtime session
            tools: atlasTools,
          },
        })
      );
    });

    openaiWs.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString("utf8"));
        handleOpenAIEvent(msg);
      } catch (err) {
        console.warn("[DipsyVoice:WARN] Non-JSON message from OpenAI", err);
      }
    });

    openaiWs.on("close", (code, reason) => {
      openaiReady = false;
      console.log("[DipsyVoice:DEBUG] OpenAI Realtime connection closed", {
        code,
        reason: reason?.toString(),
      });
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(
          JSON.stringify({
            type: "error",
            message: "OpenAI connection closed.",
          })
        );
      }
    });

    openaiWs.on("error", (err) => {
      console.error("[DipsyVoice] OpenAI error:", err);
      openaiReady = false;
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(
          JSON.stringify({
            type: "error",
            message:
              "There was a problem talking to Dipsy’s brain. Please try again.",
          })
        );
      }
    });
  }

  /**
   * Handle OpenAI tool calls.
   */
  async function handleToolCall(item) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    // If we don't have a user token, we can't safely hit Supabase.
    if (!userAccessToken) {
      console.warn(
        "[DipsyVoice:WARN] Tool call received but no user access token is set."
      );

      const errorText =
        "FINAL: I couldn’t access your live Atlas data for that question because your authentication token is missing. " +
        "Try refreshing Atlas and asking again.";

      const errorPayload = {
        type: "tool.output",
        tool_call_id: item.tool_call_id,
        output: [
          {
            role: "tool",
            content: [
              {
                type: "output_text",
                text: errorText,
              },
            ],
          },
        ],
      };

      openaiWs.send(JSON.stringify(errorPayload));
      return;
    }

    let args = {};
    try {
      if (item.arguments && typeof item.arguments === "string") {
        args = JSON.parse(item.arguments);
      } else if (typeof item.arguments === "object" && item.arguments !== null) {
        args = item.arguments;
      }
    } catch (err) {
      console.error("[DipsyVoice:WARN] Failed to parse tool arguments:", err);
      const errorText =
        "FINAL: I tried to use an Atlas tool but the arguments were invalid. " +
        "Please rephrase your request more clearly, like ‘list available drivers in Texas.’";

      const errorPayload = {
        type: "tool.output",
        tool_call_id: item.tool_call_id,
        output: [
          {
            role: "tool",
            content: [
              {
                type: "output_text",
                text: errorText,
              },
            ],
          },
        ],
      };
      openaiWs.send(JSON.stringify(errorPayload));
      return;
    }

    let result = null;
    let error = null;
    let summaryText = "";

    try {
      switch (item.name) {
        case "list_active_loads": {
          result = await fetchActiveLoads({
            accessToken: userAccessToken,
            status: args.status,
            origin_state: args.origin_state,
            destination_state: args.destination_state,
            limit: args.limit,
          });
          summaryText = summarizeLoads(result);
          console.log(
            "[DipsyVoice:ToolResult] list_active_loads count=" +
              normalizeArray(result).length
          );
          break;
        }

        case "list_available_drivers": {
          result = await fetchAvailableDrivers({
            accessToken: userAccessToken,
            region: args.region,
            equipment_type: args.equipment_type,
            limit: args.limit,
          });
          summaryText = summarizeDrivers(result);
          console.log(
            "[DipsyVoice:ToolResult] list_available_drivers count=" +
              normalizeArray(result).length
          );
          break;
        }

        // NEW: Unified fleet tool (Motive + Samsara + Dummy via Edge Function)
        case "search_fleet_latest": {
          const provider =
            args.provider === "motive" ||
            args.provider === "samsara" ||
            args.provider === "dummy" ||
            args.provider === "all"
              ? args.provider
              : "all";

          const limit =
            typeof args.limit === "number" && args.limit > 0
              ? args.limit
              : 50;

          result = await callFleetTools({
            accessToken: userAccessToken,
            tool: "search_fleet_latest",
            params: {
              provider,
              limit,
            },
          });

          summaryText = summarizeFleetPositions(result, provider);
          console.log(
            "[DipsyVoice:ToolResult] search_fleet_latest count=" +
              normalizeArray(result).length +
              " provider=" +
              provider
          );
          break;
        }

        default: {
          error = `Unknown tool name: ${item.name}`;
          break;
        }
      }
    } catch (err) {
      console.error("[DipsyVoice:ToolError]", {
        tool: item.name,
        message: err.message,
      });
      error = err.message || "Tool execution failed.";
    }

    if (error) {
      summaryText =
        "FINAL: I tried to use an Atlas tool for that, but it failed with an error. " +
        "Please try again or check the relevant page directly in Atlas.";
    }

    if (!summaryText || typeof summaryText !== "string") {
      summaryText =
        "FINAL: I couldn’t interpret the tool result safely. Please try again or check the data directly in Atlas.";
    }

    const outputPayload = {
      type: "tool.output",
      tool_call_id: item.tool_call_id,
      output: [
        {
          role: "tool",
          content: [
            {
              type: "output_text",
              text: summaryText,
            },
          ],
        },
      ],
    };

    openaiWs.send(JSON.stringify(outputPayload));
  }

  // Handle events coming from OpenAI Realtime
  function handleOpenAIEvent(msg) {
    if (!browserWs || browserWs.readyState !== WebSocket.OPEN) return;

    switch (msg.type) {
      case "response.audio.delta": {
        if (msg.delta) {
          const audioBuffer = Buffer.from(msg.delta, "base64");

          // Mark speaking started on first audio chunk
          if (!isSpeaking) {
            isSpeaking = true;
            browserWs.send(JSON.stringify({ type: "speaking_started" }));
          }

          // Send raw audio binary down to browser
          browserWs.send(audioBuffer);
        }
        break;
      }

      case "response.audio.done": {
        if (isSpeaking) {
          isSpeaking = false;
          browserWs.send(JSON.stringify({ type: "speaking_stopped" }));
        }
        break;
      }

      case "response.audio_transcript.done": {
        const transcript = msg.transcript || "";
        if (transcript) {
          browserWs.send(
            JSON.stringify({
              type: "dipsy_transcript",
              text: transcript,
            })
          );
        }
        break;
      }

      // Tool calls from Realtime
      case "response.output_item.added": {
        const item = msg.item;
        if (item && item.type === "tool_call") {
          handleToolCall(item).catch((err) => {
            console.error("[DipsyVoice] handleToolCall failed:", err);
          });
        }
        break;
      }

      case "error": {
        console.error("[DipsyVoice] OpenAI error event:", msg.error);
        browserWs.send(
          JSON.stringify({
            type: "error",
            message:
              msg.error?.message ||
              "OpenAI reported an error while generating a response.",
          })
        );
        break;
      }

      default:
        // Other events (rate_limits, session.updated, etc.) can be ignored or logged if needed
        break;
    }
  }

  /**
   * Handle messages FROM browser
   */
  browserWs.on("message", (data, isBinary) => {
    // Binary audio (PCM16 from browser mic)
    if (isBinary) {
      if (
        !openaiReady ||
        !openaiWs ||
        openaiWs.readyState !== WebSocket.OPEN ||
        !userInputActive
      ) {
        // Drop audio if we aren't actively capturing or OpenAI not ready
        return;
      }

      const base64Audio = data.toString("base64");

      openaiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        })
      );

      return;
    }

    // Text JSON control message
    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch (err) {
      console.warn("[DipsyVoice:WARN] Failed to parse browser JSON:", err);
      return;
    }

    switch (msg.type) {
      case "auth": {
        // Store Supabase user JWT per connection (RLS-respecting)
        const token =
          typeof msg.access_token === "string" ? msg.access_token : null;

        if (!token || !token.trim()) {
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(
              JSON.stringify({
                type: "error",
                message:
                  "Auth message missing a valid access_token. Please re-authenticate.",
              })
            );
          }
          return;
        }

        userAccessToken = token.trim();
        // Optional small ack (no token content)
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(
            JSON.stringify({
              type: "auth_ack",
              ok: true,
            })
          );
        }

        // Note: We do NOT send this token to OpenAI, ever.
        return;
      }

      case "start_user_input": {
        connectOpenAI();
        userInputActive = true;

        if (openaiReady && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.clear",
            })
          );
        }
        break;
      }

      case "stop_user_input": {
        userInputActive = false;

        if (
          !openaiReady ||
          !openaiWs ||
          openaiWs.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        openaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.commit",
          })
        );

        openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              // We rely on the session-level SYSTEM_PROMPT + tools here.
            },
          })
        );

        break;
      }

      case "play_script": {
        const text = (msg.text || "").toString().trim();
        if (!text) return;

        connectOpenAI();

        if (!openaiReady || openaiWs.readyState !== WebSocket.OPEN) {
          browserWs.send(
            JSON.stringify({
              type: "error",
              message: "Voice brain not ready yet. Try again in a moment.",
            })
          );
          return;
        }

        const extraInstructions =
          "\n\nSTRICT LANGUAGE RULE: Always respond in English only." +
          "\nTOOL OUTPUT RULE: If you receive tool.output text that begins with 'FINAL:', " +
          "treat it as ground truth from Atlas. Speak it almost verbatim and do NOT change any " +
          "numbers, names, cities, states, or equipment types.";

        openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: `${SYSTEM_PROMPT}${extraInstructions}`,
            },
          })
        );

        break;
      }

      case "reload_brain": {
        reloadSystemPrompt();
        browserWs.send(
          JSON.stringify({
            type: "dipsy_transcript",
            text: "I’ve just reloaded my brain instructions.",
          })
        );
        break;
      }

      default:
        break;
    }
  });

  browserWs.on("close", () => {
    console.log("[DipsyVoice] Browser client disconnected");
    userAccessToken = null;
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  browserWs.on("error", (err) => {
    console.error("[DipsyVoice] Browser WS error:", err);
    userAccessToken = null;
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});

// Start the HTTP/WebSocket server
server.listen(PORT, () => {
  console.log(
    `[DipsyVoice] Ready. Set VITE_DIPSY_VOICE_WS_URL=ws://localhost:${PORT} in your frontend .env.local`
  );
});
