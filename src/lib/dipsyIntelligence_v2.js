// src/lib/dipsyIntelligence_v2.js
// Dipsy's AI Brain - Powered by OpenAI function calling
// This replaces regex-based parsing with true AI understanding

import { supabase } from "./supabase";
import { getOpenAIApiKey } from "./openaiConfig";

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
    // Get user context
    const userContext = await getUserContext(userId);

    // Build conversation history with state
    const { messages, conversationHistory } = buildMessages(
      userMessage,
      conversationState,
      userContext
    );

    // Call OpenAI with function calling
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
 */
async function getUserContext(userId) {
  const { data: userOrg } = await supabase
    .from("user_orgs")
    .select("org_id")
    .eq("user_id", userId)
    .single();

  return {
    userId,
    orgId: userOrg?.org_id,
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

  // Add recent conversation history for context (last 10 messages)
  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-10);
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
  return `You are Dipsy, an intelligent AI dispatch assistant for Atlas Command TMS - a trucking/logistics company.

**YOUR PERSONALITY:**
- Friendly, efficient, and action-oriented
- Use emojis occasionally (📦, 🚛, 💰, 📍, ✅)
- Be concise and get things done
- Celebrate completed tasks with enthusiasm

**YOUR CAPABILITIES:**
You have access to powerful tools to help dispatchers:
1. Search for loads (available, in-transit, problem loads)
2. Search for drivers (available, assigned, with filters)
3. Create new loads
4. Assign drivers to loads
5. Update load details (rate, dates, shipper, etc.)
6. Mark loads as delivered
7. Get load/driver details
8. Search the web for current info (weather, traffic, fuel prices, etc.)

**CURRENT CONTEXT:**
- User ID: ${userContext.userId}
- Organization: ${userContext.orgId}
- Today's date: ${new Date().toISOString().split("T")[0]}
${conversationState ? `- Active task: ${conversationState.mode}` : ""}

**CRITICAL: USE CONVERSATION CONTEXT!**
- When user says "that load", "this load", "the load" → Look in recent conversation for the load reference
- When user says "assign John" → Look in recent conversation for driver names and load references
- When user says "that driver", "him", "her" → Use the driver mentioned recently
- DO NOT ask for information that was JUST discussed in the previous messages
- If you JUST showed load LD-2025-4404 details, and user says "assign driver to that load", you KNOW which load!

**INSTRUCTIONS:**

1. **WHEN CREATING LOADS:**
   - If the user provides ALL required fields (origin, destination, rate, pickup_date, delivery_date, shipper, equipment_type, customer_reference), IMMEDIATELY call create_load
   - Required fields: origin, destination, rate, pickup_date, delivery_date, shipper, equipment_type, customer_reference
   - Optional: weight, commodity, miles
   - Parse dates naturally: "tomorrow" = ${
     new Date(Date.now() + 86400000).toISOString().split("T")[0]
   }, "Friday" = next Friday

2. **WHEN ASSIGNING DRIVERS:**
   - ALWAYS call the assign_driver_to_load tool - NEVER just respond with text!
   - Check recent conversation for load references and driver names
   - If user says "assign John to that load" and you JUST discussed a specific load, USE IT!
   - Extract the load reference from recent conversation history
   - If the driver doesn't exist, call search_drivers first to find them
   - Only ask for clarification if there's TRUE ambiguity (multiple loads discussed, multiple Johns, etc.)

3. **WHEN UPDATING:**
   - Use context from recent conversation
   - If you just showed load details and user says "update that load", you know which one!

4. **REFERENCES TO UNDERSTAND:**
   - "that load" / "this load" / "the load" = most recently discussed load
   - "that driver" / "this driver" = most recently discussed driver
   - Just a first name (John) = search for driver with that name
   - Just numbers (4404) = load reference like LD-2025-4404

5. **ACTION-FIRST:**
   - Don't ask "shall I create?" - Just create!
   - Don't ask "do you want me to assign?" - Just assign!
   - Only ask if there's REAL ambiguity

Remember: You have conversation history! USE IT! Don't make users repeat themselves!`;
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

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini", // adjust if you change models
        messages: currentMessages,
        tools: getToolDefinitions(),
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status}`);
    }

    const data = await res.json();
    const assistantMessage = data.choices[0]?.message;

    if (!assistantMessage) {
      throw new Error("OpenAI returned no message.");
    }

    // If no tool calls, return final response with updated conversation history
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
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

      const functionArgs = JSON.parse(toolCall.function.arguments || "{}");

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
        description: "Search for available drivers",
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
              description: "Search driver notes for location keywords",
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
        name: "create_load",
        description:
          "Create a new load. Only call when you have ALL required fields.",
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
            shipper: { type: "string", description: "Shipper/customer name" },
            equipment_type: {
              type: "string",
              description:
                "Equipment type (dry van, reefer, flatbed, etc)",
            },
            customer_reference: {
              type: "string",
              description: "Customer PO/reference number",
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
            "shipper",
            "equipment_type",
            "customer_reference",
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
        description: "Assign a driver to a load",
        parameters: {
          type: "object",
          properties: {
            driver_name: {
              type: "string",
              description: "Driver full name",
            },
            load_reference: {
              type: "string",
              description: "Load reference number",
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
              description: "Load reference number",
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

      case "create_load":
        return await toolCreateLoad(params);

      case "update_load":
        return await toolUpdateLoad(params);

      case "assign_driver_to_load":
        return await toolAssignDriver(params);

      case "get_load_details":
        return await toolGetLoadDetails(params);

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
    )
    .eq("org_id", params.orgId)
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
    count: data.length,
    loads: data,
  };
}

async function toolSearchDrivers(params) {
  let query = supabase
    .from("drivers")
    .select("id, full_name, phone, cdl_class, status, med_exp, cdl_exp, notes")
    .eq("org_id", params.orgId)
    .order("full_name", { ascending: true })
    .limit(params.limit || 10);

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }

  if (params.location) {
    query = query.ilike("notes", `%${params.location}%`);
  }

  const { data, error } = await query;

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

async function toolCreateLoad(params) {
  const loadNumber = `LD-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 10000)
  ).padStart(4, "0")}`;

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
      shipper: params.shipper,
      equipment_type: params.equipment_type,
      customer_reference: params.customer_reference,
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
  console.log("🔍 Org ID:", params.orgId);

  const { data: loads, error: searchError } = await supabase
    .from("loads")
    .select("id, reference")
    .eq("org_id", params.orgId)
    .ilike("reference", `%${params.load_reference}%`);

  console.log("🔍 Search error:", searchError);
  console.log("🔍 Found loads:", loads);

  let load;

  if (!loads || loads.length === 0) {
    const justNumber = params.load_reference.replace(/[^0-9]/g, "");
    console.log("🔍 Trying with just number:", justNumber);

    const { data: loads2 } = await supabase
      .from("loads")
      .select("id, reference")
      .eq("org_id", params.orgId)
      .ilike("reference", `%${justNumber}%`);

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

    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id, full_name, status")
      .eq("org_id", params.orgId)
      .ilike("full_name", `%${params.driver_name}%`)
      .single();

    console.log("🔍 Driver search result:", driver, driverError);

    if (driverError || !driver) {
      console.error("❌ Driver not found:", driverError);
      return { error: `Driver "${params.driver_name}" not found` };
    }

    console.log("✅ Found driver:", driver);

    const { data: loads, error: loadError } = await supabase
      .from("loads")
      .select("id, reference, status")
      .eq("org_id", params.orgId)
      .ilike("reference", `%${params.load_reference}%`);

    console.log("🔍 Load search result:", loads, loadError);

    let load;

    if (loadError || !loads || loads.length === 0) {
      const justNumber = params.load_reference.replace(/[^0-9]/g, "");
      console.log("🔍 Trying with just number:", justNumber);

      const { data: loads2, error: load2Error } = await supabase
        .from("loads")
        .select("id, reference, status")
        .eq("org_id", params.orgId)
        .ilike("reference", `%${justNumber}%`);

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
        .update({ status: "IN_TRANSIT" })
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

  const { data: loads } = await supabase
    .from("loads")
    .select(
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
    )
    .eq("org_id", params.orgId)
    .ilike("reference", `%${params.load_reference}%`);

  if (!loads || loads.length === 0) {
    const justNumber = params.load_reference.replace(/[^0-9]/g, "");
    const { data: loads2 } = await supabase
      .from("loads")
      .select(
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
      )
      .eq("org_id", params.orgId)
      .ilike("reference", `%${justNumber}%`);

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

async function toolWebSearch(params) {
  // Placeholder for future integration with a real search API
  return {
    success: true,
    query: params.query,
    message:
      "Web search capability coming soon! For now, I can help with your loads and drivers.",
  };
}
