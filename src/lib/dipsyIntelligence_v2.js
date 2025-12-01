// FILE: src/lib/dipsyIntelligence_v2.js
// Purpose: Dipsy's AI Brain - Powered by OpenAI function calling
// - Interpret user messages in natural language.
// - Use tools (Supabase + Edge Functions) to act on loads, drivers, and trucks.
// - Stay RLS-safe (no service-role keys; everything uses the logged-in user).

import { supabase } from "/src/lib/supabase.js";
import { getOpenAIApiKey } from "/src/lib/openaiConfig.js";

/**
 * Main entry point - Process any user query with AI
 * @param {string} userMessage - Natural language from user
 * @param {string} userId - Current user ID
 * @param {Object} conversationState - Current conversation state with conversationHistory array
 * @returns {Promise<Object>} - Response with data, actions, and UPDATED conversation state
 */
export async function processDipsyQuery(
  userMessage,
  userId,
  conversationState = null
) {
  console.log("🤖 Dipsy AI Query:", userMessage);
  console.log("🔄 Conversation State:", conversationState);

  try {
    // 1) Get user context (org, etc.)
    const userContext = await getUserContext(userId);

    // 2) Build messages + conversation history for OpenAI
    const { messages, conversationHistory } = buildMessages(
      userMessage,
      conversationState,
      userContext
    );

    // 3) Call OpenAI with tools
    const response = await callOpenAIWithTools(
      messages,
      userContext,
      conversationHistory,
      conversationState
    );

    return response;
  } catch (error) {
    console.error("❌ Dipsy Error:", error);
    return {
      success: false,
      message: `Oops! Something went wrong: ${error.message}`,
      usedAI: false,
      conversationHistory: conversationState?.conversationHistory || [],
    };
  }
}

/**
 * Get user context (org, role, etc.)
 * NOTE: We rely on RLS, so we never inject org filters manually into queries.
 */
async function getUserContext(userId) {
  const { data: userOrg, error } = await supabase
    .from("user_orgs")
    .select("org_id")
    .eq("user_id", userId)
    .single();

  console.log(
    "[Dipsy/getUserContext] userId:",
    userId,
    "userOrg:",
    userOrg,
    "error:",
    error
  );

  return {
    userId,
    orgId: userOrg?.org_id ?? null,
  };
}

/**
 * Build messages array for OpenAI AND return updated conversation history
 */
function buildMessages(userMessage, conversationState, userContext) {
  // Start with system message
  const messages = [
    {
      role: "system",
      content: getSystemPrompt(conversationState, userContext),
    },
  ];

  // Get existing conversation history or start fresh
  let conversationHistory = conversationState?.conversationHistory || [];

  // Only keep user + assistant messages for the model.
  // Tool messages are appended but not fed back in, to avoid "tool/tool_call" shape errors.
  const recentHistory = conversationHistory
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10);

  if (recentHistory.length > 0) {
    messages.push(...recentHistory);
  }

  // Add the new user message
  const newUserMessage = {
    role: "user",
    content: userMessage,
  };
  messages.push(newUserMessage);

  // Update conversation history with the new user message
  conversationHistory = [...conversationHistory, newUserMessage];

  return { messages, conversationHistory };
}

/**
 * System prompt that defines Dipsy's personality and capabilities
 */
function getSystemPrompt(conversationState, userContext) {
  const todayIso = new Date().toISOString().split("T")[0];
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  return `You are Dipsy, an intelligent AI dispatch assistant for Atlas Command TMS.

========================
PERSONALITY & STYLE
========================
- Friendly, efficient, and action-oriented.
- Use emojis occasionally (📦, 🚛, 💰, 📍, ✅) but don't overdo it.
- Be concise and practical, like a sharp dispatcher.
- Celebrate completed tasks with enthusiasm when appropriate.

========================
CONTEXT
========================
- User ID: ${userContext.userId}
- Organization: ${userContext.orgId}
- Today's date: ${todayIso}
${conversationState ? "- Active task: " + conversationState.mode : ""}

You always have access to recent conversation messages (user + assistant).
You MUST use that history to understand what "that load", "this driver", or "assign them" refers to.

========================
CORE CAPABILITIES (TOOLS)
========================
You can use these tools:

1) search_loads
   - Find loads by status, origin, destination.
2) search_drivers
   - Find drivers by status and notes (location text, etc.).
3) search_trucks_all_sources
   - Find truck locations across Motive, Samsara, and Atlas Dummy fleets.
4) search_drivers_hos_aware
   - Ask the HOS-aware Edge Function which drivers are best for a given load window.
5) create_load
   - Create new loads in the system.
6) update_load
   - Update fields on an existing load (status, rate, dates, etc.).
7) assign_driver_to_load
   - Assign a driver to a load (and update driver/load status).
8) get_load_details
   - Get full details for a specific load.
9) mark_load_delivered
   - Mark a load as delivered and clean up flags.
10) mark_load_problem
    - Mark a load as PROBLEM and set problem flags.
11) get_driver_location
    - Get a driver's current GPS location from their assigned truck.
    - USE THIS when recommending loads, finding road service, checking ETAs, or any location-aware task.
12) web_search
    - Generic web search (placeholder).

========================
LOCATION-AWARE DISPATCH (NEW!)
========================

You now have GPS awareness for drivers through get_driver_location.

USE get_driver_location WHEN:
- Recommending loads: "Driver X is near Sacramento, here's a backhaul..."
- Road service needed: "Driver is near Reno on I-80, here are nearby tire shops..."
- ETA questions: "Your driver is 47 miles out, about 50 minutes away"
- Weather alerts: "Driver Mike is approaching a storm cell on I-70"
- Any question about where a driver currently is

The tool returns:
- driver_name, phone, status
- vehicle_name (their assigned truck)
- latitude, longitude, speed_mph, heading
- location_label (city, state if available)
- located_at (timestamp of last GPS ping)

If a driver has no truck assigned, it will tell you - suggest the dispatcher assign one.

========================
DISPATCH FLOW (END-TO-END)
========================

Your job is to behave like a dispatcher who can actually DO the work:

A) When the user describes a new load:
   - Examples:
     - "Make a load for me."
     - "Picks up in Sacramento tomorrow at 6pm, delivers in Salt Lake City next day at 3pm, $5300, 45k lbs of server racks."
   - You MUST extract:
     - origin
     - destination
     - rate (if given)
     - pickup_date
     - delivery_date
     - optional: weight, commodity, miles
   - Date handling:
     - "tomorrow" = ${tomorrowIso}
     - "Friday" = the next upcoming Friday (based on today's date).
   - If the user provides ALL core fields (origin, destination, rate, pickup_date, delivery_date),
     you SHOULD call create_load.
   - Core required fields for create_load:
     - origin
     - destination
     - rate
     - pickup_date (YYYY-MM-DD)
     - delivery_date (YYYY-MM-DD)
   - Helpful but NOT required (you can default them):
     - shipper
     - equipment_type
     - customer_reference

   DEFAULTS WHEN MISSING:
   - If shipper is not specified:
       shipper = "Unknown shipper"
   - If equipment_type is not specified:
       equipment_type = "Dry van"
   - If customer_reference is not specified:
       customer_reference = the generated load number.

   MULTI-TURN BEHAVIOR (IMPORTANT):
   - If the user first says "Make a load for me" and THEN in the next message gives the actual details
     (origin, destination, dates, rate, cargo, etc.), you MUST treat those messages together as ONE
     complete spec and call create_load once you have the core fields.
   - If you summarize the load back:
       "Origin: X, Destination: Y, Pickup: A, Delivery: B, Rate: R, Cargo: C"
     and the user responds with:
       "Yes", "That's it", "That's all", "Build the load", "That's the load"
     you MUST NOT ask for those details again. You MUST call create_load using the details already
     present in the conversation.
   - It is FORBIDDEN to get stuck in a loop asking for origin/destination/dates/rate again when those
     fields are clearly visible in recent conversation history.

   AFTER create_load:
   - Confirm creation with:
     - New load reference (e.g., LD-2025-1234)
     - Short human-readable summary (origin, destination, dates, rate, commodity if known)
     - Example:
       "✅ Created load LD-2025-1234: Sacramento, CA → Salt Lake City, UT, picking up 2025-11-29,
       delivering 2025-11-30, rate $5300, 45k lbs of server racks."

B) Choosing and assigning a driver for that load:
   - For questions like:
     - "Who should I send on a 5-hour run from Stockton today at 2 PM?"
     - "Recommend a driver for a 6-hour load from Sacramento."
   - You MUST:
     1) Use the HOS-aware tool search_drivers_hos_aware whenever:
        - The user mentions hours, HOS, drive time, long run / 5-hour / 6-hour, or timing windows.
        - You have or can infer an approximate pickup_time.
        - Use min_drive_remaining_min that roughly matches the run:
          - 5-hour run → about 300 minutes
          - 6-hour run → about 360 minutes
     2) Use plain search_drivers when the user just wants a list like:
        - "Show me all drivers."
        - "Show me drivers whose status is ACTIVE."
     3) When you recommend a driver, you MUST explain WHY in terms of:
        - HOS drive time remaining
        - Shift/cycle remaining (if relevant)
        - Status (DRIVING, ON_DUTY, OFF_DUTY/RESTING)
        - Any location or notes if present.
     4) ALSO use get_driver_location to check where recommended drivers currently are!
        - "Black Panther is near Fresno and has 9h drive time - perfect for this Sacramento pickup"

   EXAMPLE EXPLANATION:
   - "I recommend Black Panther because they are ACTIVE, currently RESTING, and have 9h 54m of drive
      time left, which is more than enough for a 5-hour run. They're currently near Stockton so pickup is quick."

   WHEN USER SAYS "WHO SHOULD I SEND?":
   - You MUST propose 1–3 best candidates, not just dump a list.
   - You MUST base your answer on the tool result (HOS-aware search if used).
   - BONUS: Include their current location if you can get it!

   WHEN USER SAYS "Assign <NAME> please":
   - Look at the recent conversation:
     - If you just discussed a specific load ("that 5-hour run from Stockton") and gave driver options,
       assume "<NAME>" is a driver and the referenced load is that last discussed load.
   - You MUST call assign_driver_to_load, not just respond with text:
     - driver_name = the name the user gave (e.g., "Black Panther").
     - load_reference = the reference of the most recently discussed load, or the one explicitly named.
   - Only ask for clarification if there is REAL ambiguity:
     - Multiple loads in play with no clear "last discussed".
     - Multiple drivers with the same name.

C) Marking loads delivered or problematic:
   - When user says:
     - "Mark that load delivered."
     - "That Sacramento to Salt Lake City load is delivered."
   → You MUST call mark_load_delivered with the load reference (from recent conversation or explicit).
   - When user says:
     - "Mark that load as a problem."
     - "This load has issues / is at risk."
   → You MUST call mark_load_problem with the load reference (from recent conversation or explicit).
   - After the tool, respond with a short confirmation:
     - "✅ Marked LD-2025-1234 as DELIVERED."
     - "⚠️ Marked LD-2025-5678 as PROBLEM and flagged it for review."

D) Road service and emergencies:
   - When user says:
     - "Driver has a blown tire"
     - "Need road service for Mark"
     - "Truck broke down"
   → FIRST call get_driver_location to find where the driver is
   → THEN you can suggest nearby services or help coordinate

========================
DRIVER & HOS RULES
========================

1) READY-TO-GO DRIVERS:
   - A driver is considered "ready to go today" if:
     - Their status is "ACTIVE".
   - The search_drivers tool always returns:
     - a numeric "count"
     - an array "drivers"
   - You MUST ALWAYS inspect "count".
   - If count > 0, you MUST say that there ARE drivers and list them (at least names + status).
   - It is FORBIDDEN to say "there are no drivers", "no drivers in the system", or "no active drivers"
     when count > 0.
   - Only say "no drivers available" or "no drivers in the system" when count === 0.

2) HOS-AWARE TOOL (search_drivers_hos_aware):
   - Use this when:
     - The question is about who can LEGALLY cover a run based on hours.
     - The user mentions "hours of service", "drive time left", "5-hour run", "6-hour run", etc.
   - You provide:
     - origin_city, origin_state (if known or implied)
     - pickup_time (ISO string)
     - min_drive_remaining_min (minimum drive required for this load)
     - max_distance_miles (optional; can be null for now)
   - The tool will return a structured JSON with drivers, HOS minutes, and sometimes explanations.
   - You MUST base your reasoning on that result.

3) HOS STATUS:
   - When describing a driver, if HOS info is available, include:
     - "He has 6h 20m drive remaining and is currently RESTING."
   - Prefer drivers who:
     - Are ACTIVE.
     - Have enough drive and shift remaining for the asked window.
   - Avoid picking drivers very close to running out of hours for long loads, unless the user insists.

========================
TRUCK LOCATION TRUTH RULES (FLEET MAP PARITY)
========================

- When the user asks where a truck is (e.g.,
  "Where is truck 4812ca12?",
  "Where is Truck 2203?"),
  you MUST call search_trucks_all_sources.
- This tool checks Motive, Samsara, AND Atlas Dummy tables – it is the single source of truth.
- You MUST NOT guess locations. Base your answer ONLY on the tool result.
- You may only say a truck "does not appear in the current data" or "I can't find that truck"
  when success === false and reason === "NOT_FOUND".
- If the tool returns success === true, you MUST treat that as authoritative and answer with:
  - provider,
  - rough location (city/state if you can infer it from coordinates or description),
  - and speed/movement.

========================
DRIVER LOCATION RULES (NEW!)
========================

- When the user asks where a DRIVER is (not a truck):
  "Where is Mark?"
  "Where's Black Panther right now?"
  → Use get_driver_location with their name
- This looks up the driver's assigned truck and returns GPS coordinates
- If driver has no truck assigned, tell the dispatcher and suggest assigning one
- Use this proactively when recommending drivers for loads!

========================
CONVERSATION CONTEXT RULES
========================

You MUST use conversation context intelligently:

- "that load" / "this load" / "the load"
  → The most recently discussed load.
- "that driver" / "this driver" / "him" / "her"
  → The most recently discussed driver.
- First names only (e.g., "John"):
  → Use search_drivers to find a driver with that name in the user's org.
- Load shorthand like "4404":
  → Treat as a reference fragment and search loads with reference ILIKE '%4404%'.

ACTION-FIRST:
- Do NOT ask "Shall I create?" if all required data is available. Just create the load.
- Do NOT ask "Do you want me to assign?" if the user already asked to assign. Just assign.
- Only ask clarifying questions when there is TRUE ambiguity.

Remember: You have recent messages in the conversation. Use them to avoid repeating questions.`;
}

/**
 * Helper to sanitize messages before sending to OpenAI.
 * Ensures content is always a string or an array (as required by the API).
 */
function sanitizeMessageForOpenAI(msg) {
  const safe = { ...msg };

  if (
    safe.content !== undefined &&
    safe.content !== null &&
    typeof safe.content !== "string" &&
    !Array.isArray(safe.content)
  ) {
    try {
      safe.content = JSON.stringify(safe.content);
    } catch {
      safe.content = String(safe.content);
    }
  }

  return safe;
}

/**
 * Call OpenAI with function calling capabilities
 */
async function callOpenAIWithTools(
  messages,
  userContext,
  conversationHistory,
  conversationState = null,
  maxIterations = 5
) {
  let iteration = 0;
  let currentMessages = [...messages];
  let updatedConversationHistory = [...conversationHistory];

  const apiKey = getOpenAIApiKey();

  while (iteration < maxIterations) {
    iteration++;
    console.log(`🔄 OpenAI Call #${iteration}`);

    // Sanitize messages so we never send invalid content shapes
    const safeMessages = currentMessages.map(sanitizeMessageForOpenAI);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: safeMessages,
        tools: getToolDefinitions(),
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      let errorText = "";
      try {
        const errorData = await res.json();
        console.error("[Dipsy/OpenAI] Error body:", errorData);
        errorText =
          errorData?.error?.message ||
          JSON.stringify(errorData, null, 2) ||
          `HTTP ${res.status}`;
      } catch (e) {
        console.error("[Dipsy/OpenAI] Failed to parse error body", e);
        errorText = `HTTP ${res.status}`;
      }

      throw new Error(`OpenAI API error: ${res.status} – ${errorText}`);
    }

    const data = await res.json();
    const assistantMessage = data.choices[0]?.message;

    if (!assistantMessage) {
      throw new Error("OpenAI returned no message.");
    }

    // If no tool calls, return final response with updated conversation history
    if (
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
      console.log("✅ Final response (no tools needed)");

      // Add assistant's final message to conversation history
      updatedConversationHistory.push({
        role: "assistant",
        content: assistantMessage.content,
      });

      const text = assistantMessage.content?.toLowerCase?.() || "";
      const needsMoreInfo =
        text.includes("need") ||
        text.includes("provide") ||
        text.includes("can you");

      if (needsMoreInfo && conversationState?.mode === "creating_load") {
        return {
          success: true,
          message: assistantMessage.content,
          usedAI: true,
          needsMoreInfo: true,
          conversationHistory: updatedConversationHistory,
        };
      }

      return {
        success: true,
        message: assistantMessage.content,
        usedAI: true,
        conversationHistory: updatedConversationHistory,
      };
    }

    // We have tool calls – add assistant message and then execute tools
    currentMessages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      console.log(`🔧 Executing: ${toolCall.function.name}`);

      // Be defensive when parsing arguments
      let functionArgs = {};
      try {
        functionArgs = toolCall.function.arguments
          ? JSON.parse(toolCall.function.arguments)
          : {};
      } catch (e) {
        console.error(
          "[Dipsy] Failed to parse tool arguments:",
          e,
          toolCall.function.arguments
        );
        functionArgs = {};
      }

      const result = await executeTool(toolCall.function.name, {
        ...functionArgs,
        ...userContext,
      });

      console.log("✅ Tool result:", result);

      const toolMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      };

      currentMessages.push(toolMessage);
      updatedConversationHistory.push(toolMessage);
    }
  }

  // Hit max iterations - still return something
  const fallbackMessage =
    "I've completed the task as far as I can. Let me know if you need anything else.";

  updatedConversationHistory.push({
    role: "assistant",
    content: fallbackMessage,
  });

  return {
    success: true,
    message: fallbackMessage,
    usedAI: true,
    conversationHistory: updatedConversationHistory,
  };
}

/**
 * Define all available tools for OpenAI
 */
function getToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "search_loads",
        description: "Search for loads by status or criteria",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["AVAILABLE", "IN_TRANSIT", "DELIVERED", "PROBLEM", "all"],
              description: "Load status to filter by",
            },
            destination: {
              type: "string",
              description: "Filter by destination city/state",
            },
            origin: {
              type: "string",
              description: "Filter by origin city/state",
            },
            limit: {
              type: "number",
              description: "Max number of results (default 10)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_drivers",
        description: "Search for drivers, typically by status or location text",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["ACTIVE", "ASSIGNED", "all"],
              description: "Driver status filter",
            },
            location: {
              type: "string",
              description:
                "Search driver notes for location keywords (e.g., 'Chicago')",
            },
            limit: {
              type: "number",
              description: "Max results (default 10)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_trucks_all_sources",
        description:
          "Search for a truck's current location across Motive, Samsara, and Atlas Dummy fleets. Use for questions like 'Where is truck 4812ca12?'",
        parameters: {
          type: "object",
          properties: {
            truck_query: {
              type: "string",
              description:
                "Truck identifier text. Can be a truck number/code, partial name, or phrase like 'truck 4812ca12'.",
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
          "Search for drivers using Hours of Service (HOS) constraints for a particular load window.",
        parameters: {
          type: "object",
          properties: {
            origin_city: {
              type: "string",
              description:
                "Origin city of the load (used for context; can be null).",
            },
            origin_state: {
              type: "string",
              description:
                "Origin state of the load (used for context; can be null).",
            },
            pickup_time: {
              type: "string",
              description:
                "Pickup time as an ISO timestamp (e.g., 2025-11-29T14:00:00Z).",
            },
            min_drive_remaining_min: {
              type: "number",
              description:
                "Minimum drive minutes remaining the driver must have (e.g., 300 for a ~5 hour run).",
            },
            max_distance_miles: {
              type: "number",
              description:
                "Maximum distance in miles from origin (optional; can be null for now).",
            },
          },
          required: ["pickup_time"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_driver_location",
        description:
          "Get a driver's current GPS location from their assigned truck. Use when dispatcher asks where a driver is, when recommending drivers for loads (to show proximity), when coordinating road service, or for ETA calculations.",
        parameters: {
          type: "object",
          properties: {
            driver_name: {
              type: "string",
              description: "Driver's name (first name, last name, or full name)",
            },
            driver_id: {
              type: "string",
              description: "Driver's UUID if already known from prior tool call",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_load",
        description:
          "Create a new load. Call when you have core details (origin, destination, rate, pickup_date, delivery_date).",
        parameters: {
          type: "object",
          properties: {
            origin: { type: "string", description: "Pickup location" },
            destination: {
              type: "string",
              description: "Delivery location",
            },
            rate: { type: "number", description: "Rate in dollars" },
            pickup_date: {
              type: "string",
              description: "Pickup date (YYYY-MM-DD)",
            },
            delivery_date: {
              type: "string",
              description: "Delivery date (YYYY-MM-DD)",
            },
            shipper: {
              type: "string",
              description: "Shipper/customer name (optional; default if missing)",
            },
            equipment_type: {
              type: "string",
              description:
                "Equipment type (dry van, reefer, flatbed, etc). Optional; defaults to Dry van.",
            },
            customer_reference: {
              type: "string",
              description:
                "Customer PO/reference number. Optional; defaults to the load number.",
            },
            weight: {
              type: "number",
              description: "Weight in pounds",
            },
            commodity: {
              type: "string",
              description: "What is being shipped",
            },
            miles: { type: "number", description: "Distance in miles" },
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
        description: "Update details of an existing load",
        parameters: {
          type: "object",
          properties: {
            load_reference: {
              type: "string",
              description: "Load reference number (e.g., LD-2025-1234)",
            },
            updates: {
              type: "object",
              description: "Fields to update",
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
          "Assign a driver to a load. Use after you've chosen a driver for a specific load.",
        parameters: {
          type: "object",
          properties: {
            driver_name: {
              type: "string",
              description: "Driver full name (e.g., 'Black Panther')",
            },
            load_reference: {
              type: "string",
              description: "Load reference number or fragment (e.g., 'LD-2025-4404' or '4404')",
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
        description: "Get full details about a specific load",
        parameters: {
          type: "object",
          properties: {
            load_reference: {
              type: "string",
              description: "Load reference number or fragment",
            },
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
          "Mark a load as DELIVERED and clear problem/at-risk flags. Use when the user says a load is delivered.",
        parameters: {
          type: "object",
          properties: {
            load_reference: {
              type: "string",
              description:
                "Load reference number or fragment (e.g., 'LD-2025-1234' or '1234').",
            },
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
          "Mark a load as PROBLEM and set problem flags. Use when the user says a load has issues.",
        parameters: {
          type: "object",
          properties: {
            load_reference: {
              type: "string",
              description:
                "Load reference number or fragment (e.g., 'LD-2025-1234' or '1234').",
            },
          },
          required: ["load_reference"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the web for current information (weather, traffic, fuel prices, news, etc.)",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    },
  ];
}

/**
 * Execute a tool function
 */
async function executeTool(toolName, params) {
  console.log(`🔧 Tool: ${toolName}`, params);

  try {
    switch (toolName) {
      case "search_loads":
        return await toolSearchLoads(params);

      case "search_drivers":
        return await toolSearchDrivers(params);

      case "search_trucks_all_sources":
        return await toolSearchTrucksAllSources(params);

      case "search_drivers_hos_aware":
        return await toolSearchDriversHosAware(params);

      case "get_driver_location":
        return await toolGetDriverLocation(params);

      case "create_load":
        return await toolCreateLoad(params);

      case "update_load":
        return await toolUpdateLoad(params);

      case "assign_driver_to_load":
        return await toolAssignDriver(params);

      case "get_load_details":
        return await toolGetLoadDetails(params);

      case "mark_load_delivered":
        return await toolMarkLoadDelivered(params);

      case "mark_load_problem":
        return await toolMarkLoadProblem(params);

      case "web_search":
        return await toolWebSearch(params);

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error("❌ Tool error:", error);
    return { error: error.message };
  }
}

// ========== TOOL IMPLEMENTATIONS ==========

async function toolSearchLoads(params) {
  let query = supabase
    .from("loads")
    .select(
      "id, reference, origin, destination, status, rate, pickup_date, delivery_date"
    );

  // Trust RLS for org isolation; don't force org_id filter here.
  query = query
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

  console.log(
    "[Dipsy/toolSearchLoads] orgId:",
    params.orgId,
    "status:",
    params.status,
    "error:",
    error,
    "rows:",
    data?.length
  );

  if (error) throw error;

  return {
    success: true,
    count: data.length,
    loads: data,
  };
}

async function toolSearchDrivers(params) {
  let query = supabase
    .from("drivers")
    .select("id, full_name, phone, cdl_class, status, med_exp, cdl_exp, notes");

  // 🔑 IMPORTANT: rely on RLS for org isolation, don't filter by org_id here.
  query = query
    .order("full_name", { ascending: true })
    .limit(params.limit || 10);

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }

  if (params.location) {
    query = query.ilike("notes", `%${params.location}%`);
  }

  const { data, error } = await query;

  console.log(
    "[Dipsy/toolSearchDrivers] orgId:",
    params.orgId,
    "status:",
    params.status,
    "error:",
    error,
    "rows:",
    data?.length
  );

  if (error) throw error;

  const today = new Date();
  const driversWithStatus = data.map((d) => ({
    ...d,
    medExpired: d.med_exp && new Date(d.med_exp) < today,
    cdlExpired: d.cdl_exp && new Date(d.cdl_exp) < today,
  }));

  return {
    success: true,
    count: data.length,
    drivers: driversWithStatus,
  };
}

// ---------- GET DRIVER LOCATION (v2 - Proper Architecture) ----------
//
// Chain: Driver → Truck (real equipment) → GPS Vehicle (ELD/dummy)
//
// The proper model is:
//   1. Driver is assigned to a Truck (via trucks.current_driver_id or trucks.driver_id)
//   2. Truck is linked to a GPS source (via trucks.gps_vehicle_id + trucks.gps_provider)
//   3. GPS source has location data (dummy/motive/samsara tables)

async function toolGetDriverLocation(params) {
  const { orgId, driver_name, driver_id } = params;

  console.log("[Dipsy/toolGetDriverLocation] Looking up driver:", {
    driver_name,
    driver_id,
    orgId,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1) Find the driver by ID or name
  // ─────────────────────────────────────────────────────────────────────────
  let driverQuery = supabase
    .from("drivers")
    .select("id, full_name, first_name, last_name, phone, status");

  if (driver_id) {
    driverQuery = driverQuery.eq("id", driver_id);
  } else if (driver_name) {
    // Fuzzy match on name
    driverQuery = driverQuery.or(
      `full_name.ilike.%${driver_name}%,first_name.ilike.%${driver_name}%,last_name.ilike.%${driver_name}%`
    );
  } else {
    return {
      success: false,
      error: "Please provide a driver name or ID.",
    };
  }

  const { data: drivers, error: driverError } = await driverQuery.limit(1);

  if (driverError) {
    console.error("[Dipsy/toolGetDriverLocation] Driver query error:", driverError);
    return { success: false, error: driverError.message };
  }

  if (!drivers || drivers.length === 0) {
    return {
      success: false,
      error: `Driver "${driver_name || driver_id}" not found.`,
    };
  }

  const driver = drivers[0];
  const displayName = driver.full_name || `${driver.first_name} ${driver.last_name}`.trim();

  console.log("[Dipsy/toolGetDriverLocation] Found driver:", driver);

  // ─────────────────────────────────────────────────────────────────────────
  // 2) Find the truck assigned to this driver
  // ─────────────────────────────────────────────────────────────────────────
  const { data: trucks, error: truckError } = await supabase
    .from("trucks")
    .select("id, unit_number, truck_number, make, model, year, gps_vehicle_id, gps_provider")
    .or(`current_driver_id.eq.${driver.id},driver_id.eq.${driver.id}`)
    .limit(1);

  if (truckError) {
    console.error("[Dipsy/toolGetDriverLocation] Truck query error:", truckError);
    return { success: false, error: truckError.message };
  }

  if (!trucks || trucks.length === 0) {
    return {
      success: false,
      driver_id: driver.id,
      driver_name: displayName,
      phone: driver.phone,
      status: driver.status,
      error: `${displayName} is not assigned to any truck. Assign them to a truck on the Trucks page to enable GPS tracking.`,
    };
  }

  const truck = trucks[0];
  const truckDisplayName = truck.unit_number || truck.truck_number || `${truck.make} ${truck.model}`.trim() || "Unknown Truck";

  console.log("[Dipsy/toolGetDriverLocation] Found truck:", truck);

  // ─────────────────────────────────────────────────────────────────────────
  // 3) Check if truck has GPS source linked
  // ─────────────────────────────────────────────────────────────────────────
  if (!truck.gps_vehicle_id) {
    return {
      success: false,
      driver_id: driver.id,
      driver_name: displayName,
      phone: driver.phone,
      status: driver.status,
      truck_id: truck.id,
      truck_name: truckDisplayName,
      error: `${displayName}'s truck (${truckDisplayName}) is not linked to a GPS source. Link it to an ELD vehicle on the Trucks page to enable location tracking.`,
    };
  }

  const gpsProvider = truck.gps_provider || "dummy";
  const gpsVehicleId = truck.gps_vehicle_id;

  console.log("[Dipsy/toolGetDriverLocation] GPS source:", { gpsProvider, gpsVehicleId });

  // ─────────────────────────────────────────────────────────────────────────
  // 4) Get location from the appropriate GPS provider
  // ─────────────────────────────────────────────────────────────────────────
  let location = null;
  let gpsVehicleName = null;

  if (gpsProvider === "dummy") {
    // Get dummy vehicle info
    const { data: veh } = await supabase
      .from("atlas_dummy_vehicles")
      .select("id, name, code, make, model")
      .eq("id", gpsVehicleId)
      .single();

    if (veh) {
      gpsVehicleName = veh.name || veh.code;
    }

    // Get dummy location
    const { data: loc, error: locErr } = await supabase
      .from("atlas_dummy_vehicle_locations_current")
      .select("*")
      .eq("dummy_vehicle_id", gpsVehicleId)
      .order("located_at", { ascending: false })
      .limit(1)
      .single();

    if (locErr) {
      console.error("[Dipsy/toolGetDriverLocation] Dummy location error:", locErr);
    } else {
      location = loc;
    }

  } else if (gpsProvider === "motive") {
    // Motive has a combined view with vehicle + location
    const { data: loc, error: locErr } = await supabase
      .from("motive_vehicle_locations_current")
      .select("*")
      .eq("motive_vehicle_id", gpsVehicleId)
      .order("located_at", { ascending: false })
      .limit(1)
      .single();

    if (locErr) {
      console.error("[Dipsy/toolGetDriverLocation] Motive location error:", locErr);
    } else {
      location = loc;
      gpsVehicleName = loc.name || loc.vehicle_number;
    }

  } else if (gpsProvider === "samsara") {
    // Get samsara vehicle info
    const { data: veh } = await supabase
      .from("samsara_vehicles")
      .select("samsara_vehicle_id, name, make, model")
      .eq("samsara_vehicle_id", gpsVehicleId)
      .single();

    if (veh) {
      gpsVehicleName = veh.name;
    }

    // Get samsara location
    const { data: loc, error: locErr } = await supabase
      .from("samsara_vehicle_locations_current")
      .select("*")
      .eq("samsara_vehicle_id", gpsVehicleId)
      .order("located_at", { ascending: false })
      .limit(1)
      .single();

    if (locErr) {
      console.error("[Dipsy/toolGetDriverLocation] Samsara location error:", locErr);
    } else {
      location = loc;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5) If no location found
  // ─────────────────────────────────────────────────────────────────────────
  if (!location) {
    return {
      success: false,
      driver_id: driver.id,
      driver_name: displayName,
      phone: driver.phone,
      status: driver.status,
      truck_id: truck.id,
      truck_name: truckDisplayName,
      gps_provider: gpsProvider,
      gps_vehicle_name: gpsVehicleName,
      error: `No GPS location available for ${displayName}. The ELD (${gpsProvider}) may be offline or not reporting.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6) Reverse geocode for a friendly location label
  // ─────────────────────────────────────────────────────────────────────────
  let locationLabel = null;
  if (location.latitude && location.longitude) {
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.latitude}&lon=${location.longitude}`;
      const geoRes = await fetch(geoUrl, {
        headers: { Accept: "application/json" },
      });
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        const addr = geoData?.address || {};
        const city =
          addr.city || addr.town || addr.village || addr.hamlet || addr.county;
        const state = addr.state;
        if (city && state) {
          locationLabel = `${city}, ${state}`;
        } else if (city) {
          locationLabel = city;
        } else if (state) {
          locationLabel = state;
        }
      }
    } catch (geoErr) {
      console.warn("[Dipsy/toolGetDriverLocation] Geocode failed:", geoErr);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7) Return the full location info
  // ─────────────────────────────────────────────────────────────────────────
  return {
    success: true,
    driver_id: driver.id,
    driver_name: displayName,
    phone: driver.phone,
    status: driver.status,
    truck_id: truck.id,
    truck_name: truckDisplayName,
    truck_make: truck.make,
    truck_model: truck.model,
    truck_year: truck.year,
    gps_provider: gpsProvider,
    gps_vehicle_id: gpsVehicleId,
    gps_vehicle_name: gpsVehicleName,
    latitude: location.latitude,
    longitude: location.longitude,
    speed_mph: location.speed_mph,
    heading_degrees: location.heading_degrees,
    located_at: location.located_at,
    last_synced_at: location.last_synced_at,
    location_label: locationLabel,
  };
}

// ---------- HOS-AWARE DRIVER SEARCH (Edge Function) ----------

async function toolSearchDriversHosAware(params) {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      console.error(
        "[Dipsy/toolSearchDriversHosAware] getSession error:",
        sessionError
      );
      return {
        ok: false,
        error: sessionError.message || "Failed to get user session.",
      };
    }

    const accessToken = session?.access_token || null;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

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
      `${supabaseUrl}/functions/v1/search-drivers-hos-aware`,
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
        "[Dipsy/toolSearchDriversHosAware] Edge Function error:",
        res.status,
        txt
      );
      return {
        ok: false,
        error: `Edge function search-drivers-hos-aware failed: HTTP ${res.status}`,
      };
    }

    const json = await res.json();

    console.log(
      "[Dipsy/toolSearchDriversHosAware] result for org",
      params.orgId,
      json
    );

    // We just return the Edge Function JSON so the model can interpret it.
    return json;
  } catch (error) {
    console.error("[Dipsy/toolSearchDriversHosAware] error:", error);
    return {
      ok: false,
      error: error.message || "Unexpected error in HOS-aware driver search.",
    };
  }
}

// ---------- TRUCK SEARCH HELPERS & TOOL (Motive + Samsara + Dummy) ----------

function normalizeMotiveTruckRow(row) {
  const {
    motive_vehicle_id,
    vehicle_number,
    name,
    vin,
    license_plate,
    make,
    model,
    year,
    availability_status,
    status,
    latitude,
    longitude,
    heading_degrees,
    speed_mph,
    odometer_miles,
    ignition_on,
    located_at,
    last_synced_at,
  } = row;

  const displayName =
    vehicle_number ||
    name ||
    license_plate ||
    `Motive Vehicle ${motive_vehicle_id}`;

  return {
    provider: "motive",
    providerLabel: "Motive",
    vehicleId: String(motive_vehicle_id),
    displayName,
    licensePlate: license_plate || null,
    vin: vin || null,
    make: make || null,
    model: model || null,
    year: year || null,
    status: status || null,
    availabilityStatus: availability_status || null,
    latitude,
    longitude,
    headingDegrees: heading_degrees ?? null,
    speedMph: speed_mph ?? null,
    odometerMiles: odometer_miles ?? null,
    ignitionOn: ignition_on ?? null,
    locatedAt: located_at,
    lastSyncedAt: last_synced_at,
  };
}

function normalizeSamsaraTruckRow(locationRow, vehicleRow) {
  const {
    samsara_vehicle_id,
    latitude,
    longitude,
    heading_degrees,
    speed_mph,
    odometer_miles,
    ignition_on,
    located_at,
    last_synced_at,
  } = locationRow;

  const {
    name,
    license_plate,
    license_plate_state,
    vin,
    make,
    model,
    model_year,
    status,
    is_active,
  } = vehicleRow || {};

  const displayName =
    name || license_plate || `Samsara Vehicle ${samsara_vehicle_id}`;

  return {
    provider: "samsara",
    providerLabel: "Samsara",
    vehicleId: String(samsara_vehicle_id),
    displayName,
    licensePlate: license_plate || null,
    licensePlateState: license_plate_state || null,
    vin: vin || null,
    make: make || null,
    model: model || null,
    year: model_year || null,
    status: status || null,
    availabilityStatus: is_active ? "active" : "inactive",
    latitude,
    longitude,
    headingDegrees: heading_degrees ?? null,
    speedMph: speed_mph ?? null,
    odometerMiles: odometer_miles ?? null,
    ignitionOn: ignition_on ?? null,
    locatedAt: located_at,
    lastSyncedAt: last_synced_at,
  };
}

function normalizeDummyTruckRow(locationRow, vehicleRow) {
  const {
    dummy_vehicle_id,
    latitude,
    longitude,
    heading_degrees,
    speed_mph,
    odometer_miles,
    ignition_on,
    located_at,
    last_synced_at,
  } = locationRow;

  const { name, code, make, model, year, is_active } = vehicleRow || {};

  const displayName = name || code || `Dummy Vehicle ${dummy_vehicle_id}`;

  return {
    provider: "dummy",
    providerLabel: "Atlas Dummy",
    vehicleId: String(dummy_vehicle_id),
    displayName,
    licensePlate: null,
    licensePlateState: null,
    vin: null,
    make: make || null,
    model: model || null,
    year: year || null,
    status: is_active ? "active" : "inactive",
    availabilityStatus: is_active ? "active" : "inactive",
    latitude,
    longitude,
    headingDegrees: heading_degrees ?? null,
    speedMph: speed_mph ?? null,
    odometerMiles: odometer_miles ?? null,
    ignitionOn: ignition_on ?? null,
    locatedAt: located_at,
    lastSyncedAt: last_synced_at,
  };
}

async function findMotiveTruck(orgId, identifier) {
  if (!identifier) return null;

  const clean = identifier.trim();
  if (!clean) return null;

  const orFilters = [
    `vehicle_number.ilike.%${clean}%`,
    `name.ilike.%${clean}%`,
    `motive_vehicle_id.eq.${clean}`,
    `license_plate.ilike.%${clean}%`,
  ].join(",");

  const { data, error } = await supabase
    .from("motive_vehicle_locations_current")
    .select("*")
    .eq("org_id", orgId)
    .or(orFilters)
    .order("located_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error(
      "[Dipsy/toolSearchTrucksAllSources] Motive query error",
      error
    );
    return null;
  }
  if (!data || data.length === 0) return null;

  return normalizeMotiveTruckRow(data[0]);
}

async function findSamsaraTruck(orgId, identifier) {
  if (!identifier) return null;

  const clean = identifier.trim();
  if (!clean) return null;

  const orFilters = [
    `name.ilike.%${clean}%`,
    `license_plate.ilike.%${clean}%`,
    `samsara_vehicle_id.eq.${clean}`,
  ].join(",");

  const { data: vehicles, error: vehErr } = await supabase
    .from("samsara_vehicles")
    .select("*")
    .eq("org_id", orgId)
    .or(orFilters)
    .limit(3);

  if (vehErr) {
    console.error(
      "[Dipsy/toolSearchTrucksAllSources] Samsara veh query error",
      vehErr
    );
    return null;
  }
  if (!vehicles || vehicles.length === 0) return null;

  const vehicleIds = vehicles.map((v) => v.samsara_vehicle_id);

  const { data: locations, error: locErr } = await supabase
    .from("samsara_vehicle_locations_current")
    .select("*")
    .eq("org_id", orgId)
    .in("samsara_vehicle_id", vehicleIds)
    .order("located_at", { ascending: false })
    .limit(1);

  if (locErr) {
    console.error(
      "[Dipsy/toolSearchTrucksAllSources] Samsara loc query error",
      locErr
    );
    return null;
  }
  if (!locations || locations.length === 0) return null;

  const locationRow = locations[0];
  const vehicleRow = vehicles.find(
    (v) => v.samsara_vehicle_id === locationRow.samsara_vehicle_id
  );

  return normalizeSamsaraTruckRow(locationRow, vehicleRow);
}

async function findDummyTruck(orgId, identifier) {
  if (!identifier) return null;

  const cleanRaw = identifier.trim();
  if (!cleanRaw) return null;

  // Extra cleaning for phrases like "truck 4812ca12"
  const clean = cleanRaw.toLowerCase().replace(/truck/gi, "").trim();

  const orFilters = [
    `name.ilike.%${clean}%`,
    `code.ilike.%${clean}%`,
    `id.eq.${clean}`,
  ].join(",");

  const { data: vehicles, error: vehErr } = await supabase
    .from("atlas_dummy_vehicles")
    .select("*")
    .eq("org_id", orgId)
    .or(orFilters)
    .limit(3);

  if (vehErr) {
    console.error(
      "[Dipsy/toolSearchTrucksAllSources] Dummy veh query error",
      vehErr
    );
    return null;
  }
  if (!vehicles || vehicles.length === 0) return null;

  const vehicleIds = vehicles.map((v) => v.id);

  const { data: locations, error: locErr } = await supabase
    .from("atlas_dummy_vehicle_locations_current")
    .select("*")
    .eq("org_id", orgId)
    .in("dummy_vehicle_id", vehicleIds)
    .order("located_at", { ascending: false })
    .limit(1);

  if (locErr) {
    console.error(
      "[Dipsy/toolSearchTrucksAllSources] Dummy loc query error",
      locErr
    );
    return null;
  }
  if (!locations || locations.length === 0) return null;

  const locationRow = locations[0];
  const vehicleRow = vehicles.find((v) => v.id === locationRow.dummy_vehicle_id);

  return normalizeDummyTruckRow(locationRow, vehicleRow);
}

async function toolSearchTrucksAllSources(params) {
  const { orgId, truck_query } = params;

  if (!orgId) {
    console.warn(
      "[Dipsy/toolSearchTrucksAllSources] Missing orgId – cannot search trucks."
    );
    return { success: false, reason: "MISSING_ORG" };
  }

  const identifier = (truck_query || "").trim();
  if (!identifier) {
    return { success: false, reason: "EMPTY_QUERY" };
  }

  console.log(
    "[Dipsy/toolSearchTrucksAllSources] Searching for truck across providers",
    { orgId, identifier }
  );

  const [motive, samsara, dummy] = await Promise.all([
    findMotiveTruck(orgId, identifier),
    findSamsaraTruck(orgId, identifier),
    findDummyTruck(orgId, identifier),
  ]);

  const candidate = motive || samsara || dummy;
  if (!candidate) {
    console.log(
      "[Dipsy/toolSearchTrucksAllSources] No truck found in Motive/Samsara/Dummy for",
      identifier
    );
    return { success: false, reason: "NOT_FOUND" };
  }

  return {
    success: true,
    provider: candidate.provider,
    provider_label: candidate.providerLabel,
    truck_id: candidate.vehicleId,
    truck_display_name: candidate.displayName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    speed_mph: candidate.speedMph,
    heading_degrees: candidate.headingDegrees,
    located_at: candidate.locatedAt,
    last_synced_at: candidate.lastSyncedAt,
  };
}

async function toolCreateLoad(params) {
  const loadNumber = `LD-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 10000)
  ).padStart(4, "0")}`;

  const shipper =
    params.shipper && String(params.shipper).trim()
      ? String(params.shipper).trim()
      : "Unknown shipper";

  const equipmentType =
    params.equipment_type && String(params.equipment_type).trim()
      ? String(params.equipment_type).trim()
      : "Dry van";

  const customerRef =
    params.customer_reference && String(params.customer_reference).trim()
      ? String(params.customer_reference).trim()
      : loadNumber;

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
      shipper: shipper,
      equipment_type: equipmentType,
      customer_reference: customerRef,
      weight: params.weight || null,
      commodity: params.commodity || null,
      miles: params.miles || null,
      status: "AVAILABLE",
      problem_flag: false,
      at_risk: false,
      breach_flag: false,
      fuel_surcharge: 0,
      accessorials: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status_changed_at: new Date().toISOString(),
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

async function toolUpdateLoad(params) {
  console.log("🔍 Looking for load with reference:", params.load_reference);
  console.log("🔍 Org ID (for logging only):", params.orgId);

  let query = supabase.from("loads").select("id, reference");

  query = query.ilike("reference", `%${params.load_reference}%`);

  const { data: loads, error: searchError } = await query;

  console.log("🔍 Search error:", searchError);
  console.log("🔍 Found loads:", loads);

  let load;

  if (!loads || loads.length === 0) {
    const justNumber = params.load_reference.replace(/[^0-9]/g, "");
    console.log("🔍 Trying with just number:", justNumber);

    let query2 = supabase.from("loads").select("id, reference");

    query2 = query2.ilike("reference", `%${justNumber}%`);

    const { data: loads2 } = await query2;

    console.log("🔍 Second attempt found:", loads2);

    if (!loads2 || loads2.length === 0) {
      return {
        error: `Load ${params.load_reference} not found in your organization`,
      };
    }

    load = loads2[0];
  } else {
    load = loads[0];
  }

  console.log("✅ Using load:", load);

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

  if (error) {
    console.error("❌ Update error:", error);
    throw error;
  }

  return {
    success: true,
    load: data,
    message: `Updated load ${load.reference}`,
  };
}

async function toolAssignDriver(params) {
  try {
    console.log(
      "🔍 Assigning driver:",
      params.driver_name,
      "to load:",
      params.load_reference
    );
    console.log("🔍 Params received:", JSON.stringify(params, null, 2));

    let driverQuery = supabase
      .from("drivers")
      .select("id, full_name, status")
      .ilike("full_name", `%${params.driver_name}%`);

    const { data: driver, error: driverError } = await driverQuery.single();

    console.log("🔍 Driver search result:", driver, driverError);

    if (driverError || !driver) {
      console.error("❌ Driver not found:", driverError);
      return { error: `Driver "${params.driver_name}" not found` };
    }

    console.log("✅ Found driver:", driver);

    let loadQuery = supabase
      .from("loads")
      .select("id, reference, status")
      .ilike("reference", `%${params.load_reference}%`);

    const { data: loads, error: loadError } = await loadQuery;

    console.log("🔍 Load search result:", loads, loadError);

    let load;

    if (loadError || !loads || loads.length === 0) {
      const justNumber = params.load_reference.replace(/[^0-9]/g, "");
      console.log("🔍 Trying with just number:", justNumber);

      let loadQuery2 = supabase
        .from("loads")
        .select("id, reference, status")
        .ilike("reference", `%${justNumber}%`);

      const { data: loads2, error: load2Error } = await loadQuery2;

      console.log("🔍 Second attempt result:", loads2, load2Error);

      if (load2Error || !loads2 || loads2.length === 0) {
        console.error("❌ Load not found:", load2Error);
        return { error: `Load "${params.load_reference}" not found` };
      }

      load = loads2[0];
    } else {
      load = loads[0];
    }

    console.log("✅ Using load:", load);

    if (driver.status === "ASSIGNED") {
      return {
        error: `${driver.full_name} is already assigned to another load. Unassign them first.`,
      };
    }

    console.log("🔧 Creating assignment...");
    const { error: assignError } = await supabase
      .from("load_driver_assignments")
      .insert({
        load_id: load.id,
        driver_id: driver.id,
        assigned_at: new Date().toISOString(),
      });

    if (assignError) {
      console.error("❌ Assignment error:", assignError);
      return { error: `Failed to assign: ${assignError.message}` };
    }

    console.log("✅ Assignment created");

    console.log("🔧 Updating driver status...");
    await supabase
      .from("drivers")
      .update({ status: "ASSIGNED" })
      .eq("id", driver.id);

    if (load.status === "AVAILABLE") {
      console.log("🔧 Updating load status...");
      await supabase
        .from("loads")
        .update({ status: "IN_TRANSIT", status_changed_at: new Date().toISOString() })
        .eq("id", load.id);
    }

    console.log("✅ Assignment complete!");

    return {
      success: true,
      message: `✅ Assigned ${driver.full_name} to load ${load.reference}!`,
    };
  } catch (error) {
    console.error("❌ Unexpected error in toolAssignDriver:", error);
    return { error: `Unexpected error: ${error.message}` };
  }
}

async function toolGetLoadDetails(params) {
  console.log("🔍 Getting details for load:", params.load_reference);

  let query = supabase.from("loads").select(
    `
      *,
      load_driver_assignments (
        driver:drivers (
          id,
          full_name,
          phone,
          status
        )
      )
    `
  );

  query = query.ilike("reference", `%${params.load_reference}%`);

  const { data: loads } = await query;

  if (!loads || loads.length === 0) {
    const justNumber = params.load_reference.replace(/[^0-9]/g, "");

    let query2 = supabase.from("loads").select(
      `
        *,
        load_driver_assignments (
          driver:drivers (
            id,
            full_name,
            phone,
            status
          )
        )
      `
    );

    query2 = query2.ilike("reference", `%${justNumber}%`);

    const { data: loads2 } = await query2;

    if (!loads2 || loads2.length === 0) {
      return { error: `Load ${params.load_reference} not found` };
    }

    return {
      success: true,
      load: loads2[0],
    };
  }

  return {
    success: true,
    load: loads[0],
  };
}

async function toolMarkLoadDelivered(params) {
  console.log("🔧 Marking load delivered:", params.load_reference);

  let query = supabase.from("loads").select("id, reference");

  query = query.ilike("reference", `%${params.load_reference}%`);

  const { data: loads, error: searchError } = await query;

  console.log("[toolMarkLoadDelivered] search error:", searchError);
  console.log("[toolMarkLoadDelivered] found loads:", loads);

  let load;

  if (!loads || loads.length === 0) {
    const justNumber = params.load_reference.replace(/[^0-9]/g, "");
    console.log("[toolMarkLoadDelivered] Trying with just number:", justNumber);

    let query2 = supabase.from("loads").select("id, reference");

    query2 = query2.ilike("reference", `%${justNumber}%`);

    const { data: loads2 } = await query2;

    console.log("[toolMarkLoadDelivered] second attempt:", loads2);

    if (!loads2 || loads2.length === 0) {
      return {
        error: `Load ${params.load_reference} not found in your organization`,
      };
    }

    load = loads2[0];
  } else {
    load = loads[0];
  }

  const nowIso = new Date().toISOString();

  const { data, error: updateError } = await supabase
    .from("loads")
    .update({
      status: "DELIVERED",
      problem_flag: false,
      at_risk: false,
      updated_at: nowIso,
      status_changed_at: nowIso,
    })
    .eq("id", load.id)
    .select()
    .single();

  if (updateError) {
    console.error("[toolMarkLoadDelivered] update error:", updateError);
    return { error: updateError.message || "Failed to mark load delivered." };
  }

  return {
    success: true,
    load: data,
    message: `Marked load ${data.reference} as DELIVERED.`,
  };
}

async function toolMarkLoadProblem(params) {
  console.log("🔧 Marking load as PROBLEM:", params.load_reference);

  let query = supabase.from("loads").select("id, reference");

  query = query.ilike("reference", `%${params.load_reference}%`);

  const { data: loads, error: searchError } = await query;

  console.log("[toolMarkLoadProblem] search error:", searchError);
  console.log("[toolMarkLoadProblem] found loads:", loads);

  let load;

  if (!loads || loads.length === 0) {
    const justNumber = params.load_reference.replace(/[^0-9]/g, "");
    console.log("[toolMarkLoadProblem] Trying with just number:", justNumber);

    let query2 = supabase.from("loads").select("id, reference");

    query2 = query2.ilike("reference", `%${justNumber}%`);

    const { data: loads2 } = await query2;

    console.log("[toolMarkLoadProblem] second attempt:", loads2);

    if (!loads2 || loads2.length === 0) {
      return {
        error: `Load ${params.load_reference} not found in your organization`,
      };
    }

    load = loads2[0];
  } else {
    load = loads[0];
  }

  const nowIso = new Date().toISOString();

  const { data, error: updateError } = await supabase
    .from("loads")
    .update({
      status: "PROBLEM",
      problem_flag: true,
      at_risk: true,
      updated_at: nowIso,
      status_changed_at: nowIso,
    })
    .eq("id", load.id)
    .select()
    .single();

  if (updateError) {
    console.error("[toolMarkLoadProblem] update error:", updateError);
    return { error: updateError.message || "Failed to mark load as PROBLEM." };
  }

  return {
    success: true,
    load: data,
    message: `Marked load ${data.reference} as PROBLEM.`,
  };
}

async function toolWebSearch(params) {
  // Placeholder for future integration with a real search API
  return {
    success: true,
    query: params.query,
    message:
      "Web search capability coming soon! For now, I can help with your loads, drivers, and trucks.",
  };
}