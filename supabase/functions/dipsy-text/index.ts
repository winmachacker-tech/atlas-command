// FILE: supabase/functions/dipsy-text/index.ts
// Purpose:
// - Text-only Dipsy endpoint for Atlas Command.
// - Uses OpenAI function calling + Supabase (RLS-respecting) tools
//   to answer questions about drivers, loads, trucks, and HOS-aware dispatch.
//
// V2 Updates (Phase 1 - Ground Truth Alignment):
// - Keep using existing tools, BUT:
//   • search_loads now returns real driver assignment fields (assigned_driver_id, driver_name)
//   • assign_driver_to_load writes assignment into BOTH:
//       - load_driver_assignments (history/audit)
//       - loads.assigned_driver_id + loads.driver_name (canonical "current assignment")
//   • confirm_pod_received and release_driver_without_pod:
//       - Free the driver
//       - Clear loads.assigned_driver_id + loads.driver_name
//       - Mark the assignment row as closed via unassigned_at
//   This makes the loads table + load_driver_assignments (with unassigned_at)
//   the single canonical "current assignment" truth.
//
// Phase 1b - Global Board View:
// - New tool: get_load_board_status
//   • Reads from public.dipsy_load_board_status (one row per load)
//   • Lets Dipsy answer board-level questions from canonical truth:
//       - "Which loads currently have a driver assigned?"
//       - "List all drivers assigned to active loads."
//       - "Is Tony Stark assigned to any loads right now?"
//
// Security notes:
// - Uses SUPABASE_ANON_KEY + the caller's Authorization: Bearer <access_token>
//   so all queries are still protected by Row Level Security.
// - We decode the user via supabase.auth.getUser() using the passed token.
// - org_id is derived from user_orgs.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

// Basic CORS headers so the browser can call this from localhost:5173 and prod
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ------------------------------ Types ------------------------------

interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

interface ContextMemory {
  // Last load discussed
  lastLoadReference?: string;
  lastLoadOrigin?: string;
  lastLoadDestination?: string;
  lastLoadRate?: number;
  lastLoadId?: string;

  // Last driver discussed/recommended
  lastDriverName?: string;
  lastDriverId?: string;
  lastDriverHOSMinutes?: number;
  lastDriverStatus?: string;

  // Pending problem (waiting for reason)
  pendingProblemLoadReference?: string;
}

interface ConversationState {
  mode?: string;
  conversationHistory?: ConversationMessage[];
  context?: ContextMemory;
}

// ------------------------------ Main serve ------------------------------

serve(async (req: Request): Promise<Response> => {
  try {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(401, {
        ok: false,
        error: "Missing or invalid Authorization header",
      });
    }

    const accessToken = authHeader.replace(/bearer /i, "").trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const body = await req.json().catch(() => ({} as any));
    const userMessage: string = body.message ?? body.prompt ?? "";
    const conversationState: ConversationState | null =
      body.conversation_state ?? null;

    if (!userMessage || typeof userMessage !== "string") {
      return jsonResponse(400, {
        ok: false,
        error: "Missing 'message' in request body",
      });
    }

    // Resolve current user
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      console.error("[dipsy-text] auth.getUser error:", userErr);
      return jsonResponse(401, {
        ok: false,
        error: "Unable to resolve user from token",
      });
    }

    const userId = user.id;

    // Resolve org_id via user_orgs
    const { data: userOrg, error: orgErr } = await supabase
      .from("user_orgs")
      .select("org_id")
      .eq("user_id", userId)
      .single();

    if (orgErr || !userOrg?.org_id) {
      console.error("[dipsy-text] user_orgs lookup error:", orgErr);
      return jsonResponse(403, {
        ok: false,
        error:
          "You do not belong to an active org, or org context could not be resolved.",
      });
    }

    const orgId = userOrg.org_id as string;

    console.log("[dipsy-text] user:", userId, "org:", orgId);
    console.log("[dipsy-text] incoming message:", userMessage);

    const userContext = { userId, orgId };

    // Initialize or carry forward context memory
    const contextMemory: ContextMemory = conversationState?.context ?? {};

    // Build messages from conversation state
    const { messages, updatedHistory } = buildMessages(
      userMessage,
      conversationState,
      userContext,
      contextMemory
    );

    // Call OpenAI with tools
    const { answer, usedTool, newHistory, updatedContext } =
      await callOpenAIWithTools(
        messages,
        userContext,
        updatedHistory,
        supabase,
        conversationState,
        accessToken,
        contextMemory
      );

    return jsonResponse(200, {
      ok: true,
      org_id: orgId,
      answer,
      used_tool: usedTool,
      conversation_state: {
        ...(conversationState ?? {}),
        conversationHistory: newHistory,
        context: updatedContext,
      },
    });
  } catch (err) {
    console.error("[dipsy-text] Unhandled error:", err);
    return jsonResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ------------------------------ Helpers ------------------------------

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function buildMessages(
  userMessage: string,
  conversationState: ConversationState | null,
  userContext: { userId: string; orgId: string },
  contextMemory: ContextMemory
): {
  messages: ConversationMessage[];
  updatedHistory: ConversationMessage[];
} {
  const messages: ConversationMessage[] = [];

  const systemPrompt = getSystemPrompt(
    conversationState,
    userContext,
    contextMemory
  );
  messages.push({ role: "system", content: systemPrompt });

  let history = conversationState?.conversationHistory ?? [];

  // Only include user + assistant messages to avoid tool message ordering issues
  const recent = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10);

  for (const m of recent) {
    messages.push({ role: m.role, content: m.content });
  }

  const newUserMsg: ConversationMessage = {
    role: "user",
    content: userMessage,
  };
  messages.push(newUserMsg);

  history = [...history, newUserMsg];

  return { messages, updatedHistory: history };
}

function getSystemPrompt(
  conversationState: ConversationState | null,
  userContext: { userId: string; orgId: string },
  contextMemory: ContextMemory
): string {
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const activeTaskLine =
    conversationState && conversationState.mode
      ? `- Active task: ${conversationState.mode}`
      : "";

  // Build context section from memory
  let contextSection = "";

  if (contextMemory.lastLoadReference) {
    contextSection += `\n- LAST DISCUSSED LOAD: ${contextMemory.lastLoadReference}`;
    if (contextMemory.lastLoadOrigin && contextMemory.lastLoadDestination) {
      contextSection += ` (${contextMemory.lastLoadOrigin} → ${contextMemory.lastLoadDestination})`;
    }
    if (contextMemory.lastLoadRate) {
      contextSection += ` at $${contextMemory.lastLoadRate}`;
    }
  }

  if (contextMemory.lastDriverName) {
    contextSection += `\n- LAST DISCUSSED DRIVER: ${contextMemory.lastDriverName}`;
    if (contextMemory.lastDriverHOSMinutes) {
      const hours = Math.floor(contextMemory.lastDriverHOSMinutes / 60);
      const mins = contextMemory.lastDriverHOSMinutes % 60;
      contextSection += ` (${hours}h ${mins}m drive remaining)`;
    }
    if (contextMemory.lastDriverStatus) {
      contextSection += ` - ${contextMemory.lastDriverStatus}`;
    }
  }

  if (contextMemory.pendingProblemLoadReference) {
    contextSection += `\n- PENDING: Waiting for problem reason for load ${contextMemory.pendingProblemLoadReference}`;
  }

  return `You are Dipsy, an intelligent AI dispatch assistant for Atlas Command TMS.

PERSONALITY:
- Friendly, efficient, and action-oriented.
- Use emojis occasionally (📦, 🚛, 💰, 📍, ✅) but not excessively.
- Be concise and practical.
- Celebrate completed tasks with enthusiasm when appropriate.

CURRENT CONTEXT:
- User ID: ${userContext.userId}
- Organization: ${userContext.orgId}
- Today's date: ${today}
- Tomorrow's date: ${tomorrow}
${activeTaskLine}
${contextSection}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: CONTEXT MEMORY - USE THIS FOR "THAT LOAD" / "THAT DRIVER"
═══════════════════════════════════════════════════════════════════════════════

When the user says:
- "that load", "this load", "the load" → Use LAST DISCUSSED LOAD from context above
- "that driver", "this driver", "him", "her" → Use LAST DISCUSSED DRIVER from context above
- "assign him to that load" → Combine LAST DISCUSSED DRIVER + LAST DISCUSSED LOAD

You MUST use the context memory shown above. DO NOT ask "which load?" or "which driver?" 
if the context memory already has this information.

═══════════════════════════════════════════════════════════════════════════════
CORE CAPABILITIES (TOOLS YOU CAN CALL)
═══════════════════════════════════════════════════════════════════════════════

1) search_loads              → Find loads by status, origin, destination
2) search_drivers            → List drivers by status or location
3) search_trucks_all_sources → Locate trucks across Motive, Samsara, Atlas fleets
4) search_drivers_hos_aware  → Find drivers based on HOS for a run duration
5) create_load               → Create a new load
6) update_load               → Update load fields
7) assign_driver_to_load     → Assign driver to load, update statuses
8) get_load_details          → Get full load info including driver assignment
9) mark_load_delivered       → Mark load DELIVERED, set pod_status to PENDING
10) confirm_pod_received     → Confirm POD received, free driver to AVAILABLE
11) release_driver_without_pod → Safety valve: free driver but keep pod_status PENDING
12) mark_load_problem        → Flag load as PROBLEM with reason
13) get_load_board_status    → Read from dipsy_load_board_status to see the entire board:
                               all loads, their drivers (if any), and HOS-aware driver status.

You MUST rely on these tools for real data. Never invent driver, truck, or load data.

Use get_load_board_status when the user asks board-level questions, e.g.:
- "Which loads currently have a driver assigned?"
- "List all drivers who are currently assigned to active loads."
- "Is Tony Stark assigned to any loads right now?"
- "Show me all active loads that don't have a driver yet."
- "Show me the real-time status of every load in my org."

═══════════════════════════════════════════════════════════════════════════════
DISPATCH FLOW A: CREATING LOADS
═══════════════════════════════════════════════════════════════════════════════

User patterns:
- "Make a load for me" / "Create a new load" → Ask for details
- "Picks up in Sacramento tomorrow at 6pm, delivers in Denver next day at 3pm, rate 5300, 45k of wine"
  → Parse and call create_load immediately

Required fields for create_load:
- origin, destination, rate, pickup_date (YYYY-MM-DD), delivery_date (YYYY-MM-DD)

Defaults:
- shipper: "Unknown shipper" if not provided
- equipment_type: "Dry van" if not provided
- customer_reference: use the generated load number if not provided

Date parsing:
- "tomorrow" = ${tomorrow}
- "next day" (after pickup) = pickup_date + 1 day
- "today" = ${today}

MULTI-TURN: If user says "Make a load" then gives details in next message, 
parse ALL fields and call create_load. Do NOT ask again for fields already provided.

AFTER create_load SUCCESS:
- State: "✅ Created load [REFERENCE]: [origin] → [destination], pickup [date], delivery [date], $[rate]"
- Offer: "Need help finding a driver?"

═══════════════════════════════════════════════════════════════════════════════
DISPATCH FLOW B: RECOMMENDING & ASSIGNING DRIVERS (HOS-AWARE)
═══════════════════════════════════════════════════════════════════════════════

User patterns:
- "I have a 5-hour run from Stockton today at 2 PM — who should I send?"
- "Who has the most drive time left?"
- "Recommend a driver for this load"

When to use search_drivers_hos_aware:
- User mentions run duration, hours, HOS, drive time
- You can infer pickup time

HOS BUFFER RULE:
- For runs under 6 hours: add 1 hour buffer (5h run → search for 360 min)
- For runs 6+ hours: add 1.5 hour buffer (8h run → search for 570 min)
- This ensures safety margin for delays

When recommending:
- Provide top pick + 1-2 alternates
- Explain WHY: HOS remaining, current status, any compliance issues

Example response:
"For a 5-hour run from Stockton, I recommend:

🥇 **Black Panther** - 9h 54m drive remaining, RESTING (ideal before a run)
🥈 Pay Driver - 9h 1m drive remaining, ON_DUTY
🥉 Mark Tishkun - 8h 33m drive remaining, RESTING

Should I assign Black Panther to this run?"

ASSIGNING DRIVERS:
- "Assign Black Panther please" → Use LAST DISCUSSED LOAD from context
- "Assign him to that load" → Use LAST DISCUSSED DRIVER + LAST DISCUSSED LOAD
- "Send Pay Driver on the Sacramento to Denver load" → Parse explicitly

Call assign_driver_to_load with driver_name and load_reference.

AFTER assign_driver_to_load SUCCESS:
- State: "✅ Assigned [DRIVER] to [LOAD REFERENCE]"
- Note driver HOS status if relevant

═══════════════════════════════════════════════════════════════════════════════
DISPATCH FLOW C: DELIVERY + POD WORKFLOW
═══════════════════════════════════════════════════════════════════════════════

This is the PROPER delivery workflow for long-term data integrity:

STEP 1 - Mark Delivered:
User says: "Mark that load delivered" / "LD-2025-1234 is delivered"
→ Call mark_load_delivered
→ Sets status=DELIVERED, delivered_at=now, pod_status=PENDING
→ Driver STAYS ASSIGNED (until POD confirmed)
→ Response: "✅ Marked [LOAD] as DELIVERED. Driver [NAME] is still assigned until POD is uploaded. 
   Should I send them a reminder, or say 'POD received' when you have it."

STEP 2 - Confirm POD:
User says: "POD received" / "Got the POD" / "POD is in"
→ Call confirm_pod_received
→ Sets pod_status=RECEIVED, pod_uploaded_at=now
→ Driver status → AVAILABLE
→ ALSO clears loads.assigned_driver_id + loads.driver_name so the load no longer shows a driver.
→ Response: "✅ POD confirmed for [LOAD]. [DRIVER] is now AVAILABLE for new assignments."

SAFETY VALVE - Release Without POD:
User says: "Release the driver anyway" / "Free up [DRIVER] without POD"
→ Call release_driver_without_pod
→ Driver status → AVAILABLE
→ Load keeps pod_status=PENDING (flagged for follow-up)
→ ALSO clears loads.assigned_driver_id + loads.driver_name
→ Response: "✅ Released [DRIVER] - they're now AVAILABLE. Note: [LOAD] still needs POD uploaded."

═══════════════════════════════════════════════════════════════════════════════
DISPATCH FLOW D: PROBLEM LOADS
═══════════════════════════════════════════════════════════════════════════════

User says: "Mark that load as a problem" / "This load has issues" / "Flag LD-2025-1234"
→ FIRST ask: "What's the issue? (e.g., breakdown, detention, refused delivery)"
→ THEN call mark_load_problem with load_reference AND problem_reason

If user provides reason upfront: "That load has a flat tire"
→ Call mark_load_problem immediately with reason "flat tire"

AFTER mark_load_problem SUCCESS:
- State: "🚨 Flagged [LOAD] as PROBLEM: [reason]"
- Note: "I've set problem_flag=true and recorded the issue."

═══════════════════════════════════════════════════════════════════════════════
BOARD-LEVEL GLOBAL VIEW (USE get_load_board_status)
═══════════════════════════════════════════════════════════════════════════════

For questions about the entire board, ALWAYS call get_load_board_status:

Examples:
- "Which loads currently have a driver assigned?"
  → Call get_load_board_status with { assigned_only: true }

- "List all drivers who are currently assigned to active loads."
  → Call get_load_board_status with { status: "IN_TRANSIT", assigned_only: true }

- "Which loads currently have no driver?"
  → Call get_load_board_status with { unassigned_only: true }

- "Is Tony Stark assigned to any loads right now?"
  → Call get_load_board_status with { driver_name: "Tony Stark", assigned_only: true }

- "Show me the real-time status of every load in my org."
  → Call get_load_board_status with no filters or with { limit: 100 }.

You MUST base your answers on the board data returned. Do NOT contradict it.

═══════════════════════════════════════════════════════════════════════════════
DRIVER & HOS RULES
═══════════════════════════════════════════════════════════════════════════════

- A driver is "ready to go" if status is ACTIVE
- search_drivers returns { count, drivers[] }
- If count > 0, you MUST list drivers. NEVER say "no drivers" when count > 0
- Only say "no drivers available" when count === 0

HOS Status meanings:
- DRIVING: Currently driving (clock running)
- ON_DUTY: Working but not driving
- RESTING: Off duty, good for upcoming runs
- OFF_DUTY: Off duty
- SLEEPER_BERTH: In sleeper berth

═══════════════════════════════════════════════════════════════════════════════
TRUCK LOCATION RULES
═══════════════════════════════════════════════════════════════════════════════

When the user asks "Where is truck 2203?":
→ Call search_trucks_all_sources
→ This is the source of truth for Motive/Samsara/Atlas fleets
→ Only say "can't find that truck" if tool returns not found

═══════════════════════════════════════════════════════════════════════════════
CONVERSATION CONTEXT RULES
═══════════════════════════════════════════════════════════════════════════════

- "that load" / "this load" → LAST DISCUSSED LOAD from context memory
- "that driver" / "him" / "her" → LAST DISCUSSED DRIVER from context memory
- A bare number like "2400" → search for load reference containing that fragment

DO NOT ask the user to repeat information that's already in context memory.

═══════════════════════════════════════════════════════════════════════════════
ACTION-FIRST PRINCIPLE
═══════════════════════════════════════════════════════════════════════════════

- If you have enough info to call a tool, CALL IT. Don't ask permission.
- Only ask questions for REAL ambiguity or missing critical data.
- After creating/assigning/marking, confirm what you did clearly.
`;
}

// Ensure content is a string before sending to OpenAI
function sanitizeMessageForOpenAI(msg: ConversationMessage): any {
  const safe: any = { ...msg };
  if (
    safe.content !== undefined &&
    safe.content !== null &&
    typeof safe.content !== "string"
  ) {
    safe.content = String(safe.content);
  }
  return safe;
}

// ------------------------------ OpenAI + Tools ------------------------------

async function callOpenAIWithTools(
  messages: ConversationMessage[],
  userContext: { userId: string; orgId: string },
  history: ConversationMessage[],
  supabase: ReturnType<typeof createClient>,
  conversationState: ConversationState | null,
  accessToken: string,
  contextMemory: ContextMemory,
  maxIterations = 5
): Promise<{
  answer: string;
  usedTool: boolean;
  newHistory: ConversationMessage[];
  updatedContext: ContextMemory;
}> {
  let iteration = 0;
  let currentMessages: any[] = messages.map(sanitizeMessageForOpenAI);
  let usedTool = false;
  let updatedHistory = [...history];
  let updatedContext = { ...contextMemory };

  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[dipsy-text] OpenAI call #${iteration}`);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: currentMessages,
        tools: getToolDefinitions(),
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[dipsy-text] OpenAI error:", res.status, errBody);
      throw new Error(`OpenAI error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const assistantMessage = data.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new Error("OpenAI returned no message");
    }

    if (
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
      // Final assistant answer
      const content = assistantMessage.content ?? "";
      updatedHistory.push({ role: "assistant", content });

      return {
        answer: typeof content === "string" ? content : String(content),
        usedTool,
        newHistory: updatedHistory,
        updatedContext,
      };
    }

    // There ARE tool calls
    currentMessages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      usedTool = true;
      const toolName = toolCall.function.name;
      let args: any = {};
      try {
        args = toolCall.function.arguments
          ? JSON.parse(toolCall.function.arguments)
          : {};
      } catch (e) {
        console.error("[dipsy-text] Failed to parse tool args:", e);
      }

      // Inject context memory for "that load" / "that driver" resolution
      if (!args.load_reference && updatedContext.lastLoadReference) {
        args._contextLoadReference = updatedContext.lastLoadReference;
      }
      if (!args.driver_name && updatedContext.lastDriverName) {
        args._contextDriverName = updatedContext.lastDriverName;
      }

      const result = await executeTool(toolName, {
        ...args,
        ...userContext,
        supabase,
        accessToken,
      });

      // Update context memory based on tool results
      updatedContext = updateContextFromToolResult(
        toolName,
        args,
        result,
        updatedContext
      );

      const toolMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      };

      currentMessages.push(toolMessage as any);
      updatedHistory.push(toolMessage as any);
    }
  }

  const fallback =
    "I've done as much as I can. Let me know what you'd like next.";
  updatedHistory.push({ role: "assistant", content: fallback });

  return {
    answer: fallback,
    usedTool,
    newHistory: updatedHistory,
    updatedContext,
  };
}

/**
 * Update context memory based on tool results
 */
function updateContextFromToolResult(
  toolName: string,
  args: any,
  result: any,
  context: ContextMemory
): ContextMemory {
  const updated = { ...context };

  switch (toolName) {
    case "create_load":
      if (result.success && result.load) {
        updated.lastLoadReference = result.load.reference;
        updated.lastLoadOrigin = result.load.origin;
        updated.lastLoadDestination = result.load.destination;
        updated.lastLoadRate = result.load.rate;
        updated.lastLoadId = result.load.id;
        console.log("[context] Updated lastLoad:", updated.lastLoadReference);
      }
      break;

    case "get_load_details":
    case "update_load":
    case "mark_load_delivered":
    case "confirm_pod_received":
      if (result.success && result.load) {
        updated.lastLoadReference = result.load.reference;
        updated.lastLoadOrigin = result.load.origin;
        updated.lastLoadDestination = result.load.destination;
        updated.lastLoadRate = result.load.rate;
        updated.lastLoadId = result.load.id;
      }
      break;

    case "search_loads":
      // If only one load returned, set it as context
      if (result.success && result.loads?.length === 1) {
        const load = result.loads[0];
        updated.lastLoadReference = load.reference;
        updated.lastLoadOrigin = load.origin;
        updated.lastLoadDestination = load.destination;
        updated.lastLoadRate = load.rate;
        updated.lastLoadId = load.id;
      }
      break;

    case "get_load_board_status":
      // If exactly one board row returned, set both load + driver context
      if (result.success && result.board?.length === 1) {
        const row = result.board[0];
        if (row.load_reference) {
          updated.lastLoadReference = row.load_reference;
          updated.lastLoadOrigin = row.origin;
          updated.lastLoadDestination = row.destination;
          updated.lastLoadRate = row.rate;
          updated.lastLoadId = row.load_id;
        }
        if (row.driver_full_name || row.driver_name) {
          updated.lastDriverName = row.driver_full_name || row.driver_name;
          updated.lastDriverId = row.assigned_driver_id;
          updated.lastDriverHOSMinutes = row.hos_drive_remaining_min;
          updated.lastDriverStatus = row.hos_status || row.driver_status;
          console.log(
            "[context] Updated lastDriver from board:",
            updated.lastDriverName
          );
        }
      }
      break;

    case "search_drivers":
    case "search_drivers_hos_aware":
      // If drivers returned, set top recommendation as context
      if (result.success || result.ok) {
        const drivers = result.drivers || [];
        if (drivers.length > 0) {
          const topDriver = drivers[0];
          updated.lastDriverName =
            topDriver.full_name ||
            `${topDriver.first_name || ""} ${
              topDriver.last_name || ""
            }`.trim();
          updated.lastDriverId = topDriver.id;
          updated.lastDriverHOSMinutes = topDriver.hos_drive_remaining_min;
          updated.lastDriverStatus =
            topDriver.hos_status || topDriver.status;
          console.log("[context] Updated lastDriver:", updated.lastDriverName);
        }
      }
      break;

    case "assign_driver_to_load":
      if (result.success) {
        // Clear pending context after successful assignment
        updated.lastDriverName = result.driver;
        updated.lastLoadReference = result.load_reference;
      }
      break;

    case "mark_load_problem":
      // Clear pending problem after it's been logged
      updated.pendingProblemLoadReference = undefined;
      break;
  }

  return updated;
}

function getToolDefinitions(): any[] {
  return [
    {
      type: "function",
      function: {
        name: "search_loads",
        description: "Search for loads by status or criteria.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["AVAILABLE", "IN_TRANSIT", "DELIVERED", "PROBLEM", "all"],
            },
            destination: { type: "string" },
            origin: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_drivers",
        description:
          "Search for drivers in the current org. Use for general driver queries.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["ACTIVE", "ASSIGNED", "all"],
            },
            location: {
              type: "string",
              description: "Search driver notes for location keywords.",
            },
            limit: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_trucks_all_sources",
        description:
          "Search for a truck's current location across Motive, Samsara, and Atlas dummy fleets.",
        parameters: {
          type: "object",
          properties: {
            truck_query: {
              type: "string",
              description: "Truck identifier (number, code, or name).",
            },
          },
          required: ["truck_query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_drivers_hos_aware",
        description:
          "Search for drivers using HOS constraints for a run duration. Use when user mentions hours, run duration, or HOS.",
        parameters: {
          type: "object",
          properties: {
            origin_city: { type: "string" },
            origin_state: { type: "string" },
            pickup_time: {
              type: "string",
              description: "Pickup time as ISO timestamp.",
            },
            min_drive_remaining_min: {
              type: "number",
              description:
                "Minimum drive minutes required. Add 60 min buffer for runs under 6h, 90 min for longer.",
            },
            max_distance_miles: { type: "number" },
          },
          required: ["pickup_time"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_load",
        description:
          "Create a new load. Requires origin, destination, rate, pickup_date, delivery_date.",
        parameters: {
          type: "object",
          properties: {
            origin: { type: "string" },
            destination: { type: "string" },
            rate: { type: "number" },
            pickup_date: { type: "string", description: "YYYY-MM-DD" },
            delivery_date: { type: "string", description: "YYYY-MM-DD" },
            shipper: { type: "string" },
            equipment_type: { type: "string" },
            customer_reference: { type: "string" },
            weight: { type: "number" },
            commodity: { type: "string" },
            miles: { type: "number" },
          },
          required: [
            "origin",
            "destination",
            "rate",
            "pickup_date",
            "delivery_date",
          ],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_load",
        description: "Update details of an existing load.",
        parameters: {
          type: "object",
          properties: {
            load_reference: { type: "string" },
            updates: {
              type: "object",
              properties: {
                rate: { type: "number" },
                pickup_date: { type: "string" },
                delivery_date: { type: "string" },
                shipper: { type: "string" },
                equipment_type: { type: "string" },
                customer_reference: { type: "string" },
                status: { type: "string" },
              },
            },
          },
          required: ["load_reference", "updates"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "assign_driver_to_load",
        description:
          "Assign a driver to a load. Updates driver to ASSIGNED and load to IN_TRANSIT.",
        parameters: {
          type: "object",
          properties: {
            driver_name: {
              type: "string",
              description:
                "Driver name. If not provided, uses last discussed driver from context.",
            },
            load_reference: {
              type: "string",
              description:
                "Load reference. If not provided, uses last discussed load from context.",
            },
          },
          required: ["driver_name", "load_reference"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_load_details",
        description: "Get full details about a specific load.",
        parameters: {
          type: "object",
          properties: {
            load_reference: { type: "string" },
          },
          required: ["load_reference"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mark_load_delivered",
        description:
          "Mark a load as DELIVERED. Sets delivered_at, pod_status=PENDING. Driver stays ASSIGNED until POD confirmed.",
        parameters: {
          type: "object",
          properties: {
            load_reference: { type: "string" },
          },
          required: ["load_reference"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "confirm_pod_received",
        description:
          "Confirm POD has been received for a delivered load. Sets pod_status=RECEIVED and frees driver to AVAILABLE, clears current assignment, and closes the assignment row.",
        parameters: {
          type: "object",
          properties: {
            load_reference: { type: "string" },
          },
          required: ["load_reference"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "release_driver_without_pod",
        description:
          "Safety valve: Release driver to AVAILABLE without POD. Load keeps pod_status=PENDING for follow-up, clears the current driver assignment, and closes the assignment row.",
        parameters: {
          type: "object",
          properties: {
            load_reference: { type: "string" },
          },
          required: ["load_reference"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mark_load_problem",
        description:
          "Mark a load as PROBLEM with a reason. Sets problem_flag=true and records problem_note.",
        parameters: {
          type: "object",
          properties: {
            load_reference: { type: "string" },
            problem_reason: {
              type: "string",
              description:
                "Reason for the problem (breakdown, detention, refused, etc.)",
            },
          },
          required: ["load_reference", "problem_reason"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_load_board_status",
        description:
          "Board-level snapshot from dipsy_load_board_status. Use for questions about all loads and driver assignments.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["AVAILABLE", "IN_TRANSIT", "DELIVERED", "PROBLEM", "all"],
              description: "Optional filter by load_status.",
            },
            assigned_only: {
              type: "boolean",
              description:
                "If true, only return loads that currently have an assigned driver.",
            },
            unassigned_only: {
              type: "boolean",
              description:
                "If true, only return loads that currently have NO assigned driver.",
            },
            driver_name: {
              type: "string",
              description:
                "Optional fuzzy filter by driver_full_name to see loads for a specific driver.",
            },
            reference_fragment: {
              type: "string",
              description:
                "Optional filter for load_reference containing this fragment.",
            },
            limit: {
              type: "number",
              description: "Maximum rows to return (default 50).",
            },
          },
        },
      },
    },
  ];
}

// ------------------------------ Tool execution ------------------------------

async function executeTool(toolName: string, params: any): Promise<any> {
  console.log("[dipsy-text] Executing tool:", toolName);
  const supabase: ReturnType<typeof createClient> = params.supabase;

  // Use context fallbacks for load_reference and driver_name
  if (params._contextLoadReference && !params.load_reference) {
    params.load_reference = params._contextLoadReference;
    console.log(
      "[dipsy-text] Using context load_reference:",
      params.load_reference
    );
  }
  if (params._contextDriverName && !params.driver_name) {
    params.driver_name = params._contextDriverName;
    console.log(
      "[dipsy-text] Using context driver_name:",
      params.driver_name
    );
  }

  switch (toolName) {
    case "search_loads":
      return await toolSearchLoads(supabase, params);

    case "search_drivers":
      return await toolSearchDrivers(supabase, params);

    case "search_trucks_all_sources":
      return await toolSearchTrucksAllSources(supabase, params);

    case "search_drivers_hos_aware":
      return await toolSearchDriversHosAware(supabase, params);

    case "create_load":
      return await toolCreateLoad(supabase, params);

    case "update_load":
      return await toolUpdateLoad(supabase, params);

    case "assign_driver_to_load":
      return await toolAssignDriverToLoad(supabase, params);

    case "get_load_details":
      return await toolGetLoadDetails(supabase, params);

    case "mark_load_delivered":
      return await toolMarkLoadDelivered(supabase, params);

    case "confirm_pod_received":
      return await toolConfirmPodReceived(supabase, params);

    case "release_driver_without_pod":
      return await toolReleaseDriverWithoutPod(supabase, params);

    case "mark_load_problem":
      return await toolMarkLoadProblem(supabase, params);

    case "get_load_board_status":
      return await toolGetLoadBoardStatus(supabase, params);

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ==================== TOOL IMPLEMENTATIONS ====================

// ---- search_loads ----
async function toolSearchLoads(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  let query = supabase
    .from("loads")
    .select(
      `
      id,
      reference,
      origin,
      destination,
      status,
      rate,
      pickup_date,
      delivery_date,
      pod_status,
      assigned_driver_id,
      driver_name
    `
    )
    .order("created_at", { ascending: false })
    .limit(params.limit || 10);

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }
  if (params.destination) {
    query = query.ilike("destination", `%${params.destination}%`);
  }
  if (params.origin) {
    query = query.ilike("origin", `%${params.origin}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    success: true,
    count: data?.length ?? 0,
    loads: data ?? [],
  };
}

// ---- search_drivers ----
async function toolSearchDrivers(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  let query = supabase
    .from("drivers")
    .select(
      `
      id, org_id, first_name, last_name, email, phone,
      license_number, license_class, license_expiry, med_card_expiry,
      status, notes,
      hos_drive_remaining_min, hos_shift_remaining_min, hos_cycle_remaining_min,
      hos_status, full_name
    `
    )
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(params.limit || 20);

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }
  if (params.location) {
    query = query.ilike("notes", `%${params.location}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const today = new Date();
  const drivers = (data ?? []).map((d: any) => {
    const full_name =
      d.full_name ||
      `${d.first_name || ""} ${d.last_name || ""}`.trim() ||
      null;
    const medExpired =
      d.med_card_expiry && new Date(d.med_card_expiry) < today;
    const cdlExpired = d.license_expiry && new Date(d.license_expiry) < today;

    return { ...d, full_name, medExpired, cdlExpired };
  });

  return {
    success: true,
    count: drivers.length,
    drivers,
  };
}

// ---- search_drivers_hos_aware (calls Edge Function) ----
async function toolSearchDriversHosAware(
  _supabase: ReturnType<typeof createClient>,
  params: any
) {
  try {
    const accessToken: string = params.accessToken;

    const body = {
      origin_city: params.origin_city || null,
      origin_state: params.origin_state || null,
      pickup_time: params.pickup_time || new Date().toISOString(),
      min_drive_remaining_min:
        typeof params.min_drive_remaining_min === "number"
          ? params.min_drive_remaining_min
          : null,
      max_distance_miles:
        typeof params.max_distance_miles === "number"
          ? params.max_distance_miles
          : null,
    };

    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/search-drivers-hos-aware`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      console.error(
        "[toolSearchDriversHosAware] Edge Function error:",
        res.status,
        txt
      );
      return {
        ok: false,
        error: `HOS-aware search failed: HTTP ${res.status}`,
      };
    }

    return await res.json();
  } catch (error) {
    console.error("[toolSearchDriversHosAware] error:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "HOS search failed",
    };
  }
}

// ---- search_trucks_all_sources ----
async function toolSearchTrucksAllSources(
  _supabase: ReturnType<typeof createClient>,
  params: any
) {
  const orgId: string = params.orgId;
  const queryText: string = (params.truck_query ?? "").trim();

  if (!orgId || !queryText) {
    return { success: false, reason: "MISSING_ORG_OR_QUERY" };
  }

  console.log("[toolSearchTrucksAllSources] org:", orgId, "query:", queryText);

  // TODO: Implement Motive/Samsara/Dummy lookups
  return {
    success: false,
    reason: "TRUCK_SEARCH_NOT_YET_IMPLEMENTED",
  };
}

// ---- get_load_board_status ----
async function toolGetLoadBoardStatus(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  let query = supabase
    .from("dipsy_load_board_status")
    .select(
      `
      load_id,
      load_org_id,
      load_reference,
      load_status,
      pod_status,
      origin,
      destination,
      pickup_date,
      delivery_date,
      rate,
      assigned_driver_id,
      driver_name,
      driver_org_id,
      driver_full_name,
      driver_status,
      hos_status,
      hos_drive_remaining_min,
      hos_shift_remaining_min,
      hos_cycle_remaining_min,
      assignment_id,
      assigned_at,
      unassigned_at,
      has_assigned_driver,
      has_active_assignment_row
    `
    )
    .order("load_reference", { ascending: true })
    .limit(params.limit && params.limit > 0 ? params.limit : 50);

  if (params.status && params.status !== "all") {
    query = query.eq("load_status", params.status);
  }

  if (params.assigned_only) {
    query = query.eq("has_assigned_driver", true);
  }

  if (params.unassigned_only) {
    query = query.eq("has_assigned_driver", false);
  }

  if (params.driver_name) {
    query = query.ilike("driver_full_name", `%${params.driver_name}%`);
  }

  if (params.reference_fragment) {
    query = query.ilike("load_reference", `%${params.reference_fragment}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[toolGetLoadBoardStatus] error:", error);
    return {
      success: false,
      error: error.message || "Failed to load board status",
    };
  }

  return {
    success: true,
    count: data?.length ?? 0,
    board: data ?? [],
  };
}

// ---- create_load ----
async function toolCreateLoad(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const loadNumber = `LD-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 10000)
  ).padStart(4, "0")}`;

  const shipper = params.shipper?.trim() || "Unknown shipper";
  const equipmentType = params.equipment_type?.trim() || "Dry van";
  const customerRef = params.customer_reference?.trim() || loadNumber;

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("loads")
    .insert({
      org_id: params.orgId,
      created_by: params.userId,
      reference: loadNumber,
      load_number: loadNumber,
      origin: params.origin,
      destination: params.destination,
      rate: params.rate,
      pickup_date: params.pickup_date,
      delivery_date: params.delivery_date,
      shipper,
      equipment_type: equipmentType,
      customer_reference: customerRef,
      weight: params.weight || null,
      commodity: params.commodity || null,
      miles: params.miles || null,
      status: "AVAILABLE",
      pod_status: "NONE",
      problem_flag: false,
      at_risk: false,
      breach_flag: false,
      fuel_surcharge: 0,
      accessorials: {},
      created_at: nowIso,
      updated_at: nowIso,
      status_changed_at: nowIso,
    })
    .select()
    .single();

  if (error) throw error;

  return {
    success: true,
    load: data,
    message: `Created load ${data.reference}`,
  };
}

// ---- update_load ----
async function toolUpdateLoad(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const load = await findLoadByReference(supabase, params.load_reference);
  if (!load) {
    return { error: `Load ${params.load_reference} not found` };
  }

  const updates = {
    ...params.updates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("loads")
    .update(updates)
    .eq("id", load.id)
    .select()
    .single();

  if (error) throw error;

  return {
    success: true,
    load: data,
    message: `Updated load ${load.reference}`,
  };
}

// ---- assign_driver_to_load ----
async function toolAssignDriverToLoad(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  try {
    console.log(
      "[toolAssignDriverToLoad] driver:",
      params.driver_name,
      "load:",
      params.load_reference
    );

    // Find driver (now uses rpc_search_drivers_by_text under the hood)
    const driver = await findDriverByName(supabase, params.driver_name);
    if (!driver) {
      return { error: `Driver "${params.driver_name}" not found` };
    }

    const driverName =
      driver.full_name ||
      `${driver.first_name || ""} ${driver.last_name || ""}`.trim();

    if (driver.status === "ASSIGNED") {
      return {
        error: `${driverName} is already assigned to another load. Unassign them first.`,
      };
    }

    // Find load
    const load = await findLoadByReference(supabase, params.load_reference);
    if (!load) {
      return { error: `Load "${params.load_reference}" not found` };
    }

    const nowIso = new Date().toISOString();

    // Create assignment history row (unassigned_at defaults to NULL -> active assignment)
    const { error: assignError } = await supabase
      .from("load_driver_assignments")
      .insert({
        load_id: load.id,
        driver_id: driver.id,
        assigned_at: nowIso,
      });

    if (assignError) {
      return { error: `Failed to assign: ${assignError.message}` };
    }

    // Update driver status (kept same as your existing pattern)
    await supabase
      .from("drivers")
      .update({ status: "ASSIGNED" })
      .eq("id", driver.id);

    // Canonical truth: write assignment directly on loads as well.
    await supabase
      .from("loads")
      .update({
        assigned_driver_id: driver.id,
        driver_name: driverName,
        updated_at: nowIso,
      })
      .eq("id", load.id);

    // Update load status if AVAILABLE → IN_TRANSIT
    if (load.status === "AVAILABLE") {
      await supabase
        .from("loads")
        .update({
          status: "IN_TRANSIT",
          status_changed_at: nowIso,
        })
        .eq("id", load.id);
    }

    return {
      success: true,
      message: `Assigned ${driverName} to load ${load.reference}.`,
      driver: driverName,
      load_reference: load.reference,
    };
  } catch (error) {
    console.error("[toolAssignDriverToLoad] error:", error);
    return {
      error: error instanceof Error ? error.message : "Assignment failed",
    };
  }
}

// ---- get_load_details ----
async function toolGetLoadDetails(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const load = await findLoadByReference(supabase, params.load_reference, true);
  if (!load) {
    return { error: `Load ${params.load_reference} not found` };
  }

  return { success: true, load };
}

// ---- mark_load_delivered ----
async function toolMarkLoadDelivered(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const load = await findLoadByReference(supabase, params.load_reference);
  if (!load) {
    return { error: `Load ${params.load_reference} not found` };
  }

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("loads")
    .update({
      status: "DELIVERED",
      delivered_at: nowIso,
      pod_status: "PENDING",
      problem_flag: false,
      at_risk: false,
      updated_at: nowIso,
      status_changed_at: nowIso,
    })
    .eq("id", load.id)
    .select()
    .single();

  if (error) {
    return { error: error.message || "Failed to mark delivered" };
  }

  // Get current assigned driver name for response (only active assignment rows)
  const { data: assignments } = await supabase
    .from("load_driver_assignments")
    .select("driver:drivers(id, full_name, first_name, last_name)")
    .eq("load_id", load.id)
    .is("unassigned_at", null)
    .order("assigned_at", { ascending: false })
    .limit(1);

  let driverName = "the driver";
  if (assignments?.[0]?.driver) {
    const d = assignments[0].driver as any;
    driverName =
      d.full_name || `${d.first_name || ""} ${d.last_name || ""}`.trim();
  }

  return {
    success: true,
    load: data,
    driver_name: driverName,
    message: `Marked ${data.reference} as DELIVERED. POD status is PENDING. ${driverName} is still assigned until POD is confirmed.`,
  };
}

// ---- confirm_pod_received ----
async function toolConfirmPodReceived(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const load = await findLoadByReference(supabase, params.load_reference);
  if (!load) {
    return { error: `Load ${params.load_reference} not found` };
  }

  const nowIso = new Date().toISOString();

  // Update load POD status and clear current assignment on the load itself
  const { data, error } = await supabase
    .from("loads")
    .update({
      pod_status: "RECEIVED",
      pod_uploaded_at: nowIso,
      assigned_driver_id: null,
      driver_name: null,
      updated_at: nowIso,
    })
    .eq("id", load.id)
    .select()
    .single();

  if (error) {
    return { error: error.message || "Failed to confirm POD" };
  }

  // Find latest assigned driver (for messaging + status update)
  const { data: assignments } = await supabase
    .from("load_driver_assignments")
    .select("driver_id, driver:drivers(id, full_name, first_name, last_name)")
    .eq("load_id", load.id)
    .order("assigned_at", { ascending: false })
    .limit(1);

  let driverName = "the driver";
  let driverId: string | null = null;

  if (assignments?.[0]) {
    driverId = assignments[0].driver_id;
    const d = assignments[0].driver as any;
    driverName =
      d?.full_name || `${d?.first_name || ""} ${d?.last_name || ""}`.trim();
  }

  // Set driver back to ACTIVE (AVAILABLE for your UI)
  if (driverId) {
    await supabase
      .from("drivers")
      .update({ status: "ACTIVE" })
      .eq("id", driverId);
  }

  // Close out ANY open assignment history rows for this load
  await supabase
    .from("load_driver_assignments")
    .update({ unassigned_at: nowIso })
    .eq("load_id", load.id)
    .is("unassigned_at", null);

  return {
    success: true,
    load: data,
    driver_name: driverName,
    message: `POD confirmed for ${data.reference}. ${driverName} is now AVAILABLE and the load no longer shows a current driver assignment.`,
  };
}

// ---- release_driver_without_pod ----
async function toolReleaseDriverWithoutPod(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const load = await findLoadByReference(supabase, params.load_reference);
  if (!load) {
    return { error: `Load ${params.load_reference} not found` };
  }

  const nowIso = new Date().toISOString();

  // Find assigned driver from current assignment
  const { data: assignments } = await supabase
    .from("load_driver_assignments")
    .select(
      "id, driver_id, driver:drivers(id, full_name, first_name, last_name)"
    )
    .eq("load_id", load.id)
    .is("unassigned_at", null)
    .order("assigned_at", { ascending: false })
    .limit(1);

  let driverName = "the driver";
  if (assignments?.[0]) {
    const assignmentId = assignments[0].id;
    const driverId = assignments[0].driver_id;
    const d = assignments[0].driver as any;
    driverName =
      d?.full_name || `${d?.first_name || ""} ${d?.last_name || ""}`.trim();

    // Close the assignment row
    await supabase
      .from("load_driver_assignments")
      .update({ unassigned_at: nowIso })
      .eq("id", assignmentId);

    // Set driver to ACTIVE (free for new work)
    await supabase
      .from("drivers")
      .update({ status: "ACTIVE" })
      .eq("id", driverId);
  }

  // Canonical truth: clear current assignment on the load, leave pod_status alone (usually PENDING)
  await supabase
    .from("loads")
    .update({
      assigned_driver_id: null,
      driver_name: null,
      updated_at: nowIso,
    })
    .eq("id", load.id);

  return {
    success: true,
    load_reference: load.reference,
    driver_name: driverName,
    message: `Released ${driverName} - now AVAILABLE. Note: ${load.reference} still needs POD uploaded (pod_status remains ${
      load.pod_status ?? "PENDING"
    }).`,
  };
}

// ---- mark_load_problem ----
async function toolMarkLoadProblem(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const load = await findLoadByReference(supabase, params.load_reference);
  if (!load) {
    return { error: `Load ${params.load_reference} not found` };
  }

  const nowIso = new Date().toISOString();
  const reason = params.problem_reason || "Unspecified issue";

  const { data, error } = await supabase
    .from("loads")
    .update({
      status: "PROBLEM",
      problem_flag: true,
      problem_note: reason,
      problem_flagged_at: nowIso,
      at_risk: true,
      updated_at: nowIso,
      status_changed_at: nowIso,
    })
    .eq("id", load.id)
    .select()
    .single();

  if (error) {
    return { error: error.message || "Failed to mark as problem" };
  }

  return {
    success: true,
    load: data,
    message: `Flagged ${data.reference} as PROBLEM: "${reason}"`,
  };
}

// ==================== HELPER FUNCTIONS ====================

async function findLoadByReference(
  supabase: ReturnType<typeof createClient>,
  reference: string,
  includeAssignments = false
): Promise<any | null> {
  const selectClause = includeAssignments
    ? `*, load_driver_assignments(driver:drivers(id, full_name, first_name, last_name, phone, status))`
    : `
      id,
      reference,
      origin,
      destination,
      status,
      rate,
      pod_status,
      pickup_date,
      delivery_date,
      assigned_driver_id,
      driver_name
    `;

  let { data: loads } = await supabase
    .from("loads")
    .select(selectClause)
    .ilike("reference", `%${reference}%`)
    .limit(1);

  if (!loads || loads.length === 0) {
    const justNumber = reference.replace(/[^0-9]/g, "");
    if (justNumber) {
      const { data: loads2 } = await supabase
        .from("loads")
        .select(selectClause)
        .ilike("reference", `%${justNumber}%`)
        .limit(1);
      loads = loads2;
    }
  }

  return loads?.[0] || null;
}

// 🔎 NEW: driver lookup that **always hits RPC truth first**
async function findDriverByName(
  supabase: ReturnType<typeof createClient>,
  name: string
): Promise<any | null> {
  const searchText = (name || "").trim();
  if (!searchText) return null;

  try {
    const { data, error } = await supabase.rpc(
      "rpc_search_drivers_by_text",
      { search_text: searchText }
    );

    if (error) {
      console.error("[findDriverByName] rpc_search_drivers_by_text error:", error);
    } else if (data && data.length > 0) {
      // Already org-scoped and RLS-safe inside the RPC
      return data[0];
    }
  } catch (e) {
    console.error("[findDriverByName] rpc_search_drivers_by_text threw:", e);
  }

  // Fallback – old direct RLS-safe search on drivers
  let { data: drivers } = await supabase
    .from("drivers")
    .select("id, full_name, first_name, last_name, status")
    .ilike("full_name", `%${searchText}%`)
    .limit(1);

  if (!drivers || drivers.length === 0) {
    const nameParts = searchText.split(" ");
    const first = nameParts[0] ?? "";
    const last = nameParts.slice(1).join(" ");

    const { data: drivers2 } = await supabase
      .from("drivers")
      .select("id, full_name, first_name, last_name, status")
      .ilike("first_name", `%${first}%`)
      .ilike("last_name", last ? `%${last}%` : "%")
      .limit(1);

    drivers = drivers2;
  }

  return drivers?.[0] || null;
}
