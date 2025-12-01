// FILE: supabase/functions/telegram-hook/index.ts
//
// Telegram Bot Webhook Handler for Atlas Command
// 
// This Edge Function:
//   1. Receives inbound Telegram messages (POST from Telegram)
//   2. Looks up sender in whatsapp_contacts by telegram_chat_id
//   3. Retrieves/creates conversation_state for the sender
//   4. Calls dipsy-text with the message and state
//   5. Sends Dipsy's response back via Telegram API
//   6. Logs everything to whatsapp_messages table (reusing for all messaging)
//
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update = await req.json();
    console.log("[telegram-hook] Received update:", JSON.stringify(update, null, 2));

    // Handle message updates
    if (update.message) {
      await handleMessage(update.message);
    }

    // Always return 200 to Telegram
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[telegram-hook] Error:", error);
    return new Response("OK", { status: 200 }); // Still return 200 to avoid retries
  }
});

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

async function handleMessage(message: any) {
  const chatId = message.chat.id;
  const text = message.text || "";
  const firstName = message.from?.first_name || "";
  const lastName = message.from?.last_name || "";
  const username = message.from?.username || "";
  const senderName = `${firstName} ${lastName}`.trim() || username || `User ${chatId}`;

  console.log("[telegram-hook] Message from:", { chatId, senderName, text });

  // Handle /start command
  if (text === "/start") {
    await sendTelegramMessage(
      chatId,
      `👋 Hey ${firstName || "there"}! I'm Dipsy, your AI dispatcher assistant for Atlas Command.\n\n` +
      `You can ask me about:\n` +
      `• Load status and details\n` +
      `• Driver availability\n` +
      `• Route information\n` +
      `• And more!\n\n` +
      `📎 **NEW:** Send me a rate confirmation (photo or PDF) and I'll create the load for you!\n\n` +
      `Your Telegram Chat ID is: \`${chatId}\`\n\n` +
      `⚠️ To get started, ask your dispatcher to add this Chat ID to your WhatsApp contacts in Atlas Command.`
    );
    return;
  }

  // Create Supabase client
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Look up contact by telegram_chat_id (include driver_id for driver contacts)
  const { data: contact, error: contactError } = await supabaseAdmin
    .from("whatsapp_contacts")
    .select("id, org_id, user_id, display_name, contact_type, dipsy_enabled, driver_id")
    .eq("telegram_chat_id", chatId.toString())
    .maybeSingle();

  if (contactError) {
    console.error("[telegram-hook] Error looking up contact:", contactError);
    return;
  }

  // If contact not found
  if (!contact) {
    console.warn("[telegram-hook] Unknown sender:", chatId);
    await sendTelegramMessage(
      chatId,
      `🔒 Your Telegram isn't linked to Atlas Command yet.\n\n` +
      `Your Chat ID is: \`${chatId}\`\n\n` +
      `Please ask your dispatcher to add this Chat ID to your contact in Atlas Command settings.`
    );
    return;
  }

  const orgId = contact.org_id;
  const contactId = contact.id;
  const displayName = contact.display_name || senderName;
  const isDriver = contact.contact_type === "driver" && contact.driver_id;
  const driverId = contact.driver_id;

  console.log("[telegram-hook] Contact found:", { orgId, contactId, displayName, isDriver, driverId });

  // Check if Dipsy is enabled
  if (!contact.dipsy_enabled) {
    await sendTelegramMessage(chatId, "Dipsy access is currently disabled for your account.");
    return;
  }

  // Check for photo or document (could be rate con OR POD)
  if (message.photo || message.document) {
    // If driver and has active load in DELIVERED status, treat as POD
    if (isDriver && driverId) {
      const handled = await handleDriverPODUpload(chatId, message, orgId, driverId, displayName, supabaseAdmin);
      if (handled) return;
    }
    // Otherwise treat as rate con upload
    await handleRateConUpload(chatId, message, orgId, displayName, supabaseAdmin);
    return;
  }

  // Check for issue details follow-up FIRST (after driver reported a problem)
  // This must run before status updates so "Wrong PU#" etc. are captured as details
  if (isDriver && driverId && text) {
    const issueResult = await handleIssueDetails(chatId, text, orgId, driverId, displayName, supabaseAdmin);
    if (issueResult.handled) {
      return;
    }
  }

  // Check for driver status updates (before full Dipsy processing)
  if (isDriver && driverId && text) {
    const statusResult = await handleDriverStatusUpdate(chatId, text, orgId, driverId, displayName, supabaseAdmin);
    if (statusResult.handled) {
      return;
    }
  }

  // Check for load selection (1, 2, 3 or "Assign 1", etc.) after recommendations
  if (isDriver && driverId && text) {
    const selectionResult = await handleLoadSelection(chatId, text, orgId, driverId, displayName, supabaseAdmin);
    if (selectionResult.handled) {
      return;
    }
  }

  // Check for load recommendation requests (drivers asking for next load)
  if (isDriver && driverId && text) {
    const recommendResult = await handleLoadRecommendation(chatId, text, orgId, driverId, displayName, supabaseAdmin);
    if (recommendResult.handled) {
      return;
    }
  }

  // Get or create conversation state
  const { data: stateData } = await supabaseAdmin.rpc("get_or_create_whatsapp_state", {
    p_org_id: orgId,
    p_phone_number: `telegram:${chatId}`, // Use telegram: prefix for state key
    p_contact_id: contactId,
  });

  // The RPC returns the conversation_state JSONB field, or an object with conversation_state
  let conversationState: Record<string, unknown> = {};
  if (stateData) {
    if (typeof stateData === 'object' && stateData.conversation_state) {
      conversationState = stateData.conversation_state;
    } else if (typeof stateData === 'object') {
      conversationState = stateData;
    }
  }
  
  console.log("[telegram-hook] Retrieved conversation state:", JSON.stringify(conversationState));

  // Send typing indicator
  await sendTelegramAction(chatId, "typing");

  // Call dipsy-text
  let dipsyResponse: { answer: string; conversation_state: Record<string, unknown> };

  try {
    dipsyResponse = await callDipsyText(orgId, displayName, text, conversationState);
  } catch (error) {
    console.error("[telegram-hook] Dipsy error:", error);
    dipsyResponse = {
      answer: "I'm having trouble right now. Please try again in a moment.",
      conversation_state: conversationState,
    };
  }

  // Update conversation state
  await supabaseAdmin.rpc("update_whatsapp_state", {
    p_org_id: orgId,
    p_phone_number: `telegram:${chatId}`,
    p_new_state: dipsyResponse.conversation_state,
  });

  // Send response
  await sendTelegramMessage(chatId, dipsyResponse.answer);

  // Log messages
  await supabaseAdmin.from("whatsapp_messages").insert([
    {
      org_id: orgId,
      sender_phone: `telegram:${chatId}`,
      sender_name: displayName,
      contact_id: contactId,
      message_body: text,
      message_type: "text",
      direction: "inbound",
      is_from_dipsy: false,
      status: "processed",
    },
    {
      org_id: orgId,
      sender_phone: "dipsy",
      sender_name: "Dipsy",
      contact_id: contactId,
      message_body: dipsyResponse.answer,
      message_type: "text",
      direction: "outbound",
      is_from_dipsy: true,
      status: "sent",
      conversation_state_after: dipsyResponse.conversation_state,
    },
  ]);
}

// ============================================================================
// DISPATCH NOTIFICATION HELPER
// ============================================================================

async function createDispatchNotification(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  notification: {
    loadId?: string;
    driverId?: string;
    type: 'ISSUE' | 'POD_RECEIVED' | 'LOAD_DELIVERED' | 'STATUS_UPDATE' | 'LOAD_ASSIGNED';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    meta?: Record<string, unknown>;
  }
) {
  try {
    const { error } = await supabase
      .from("dispatch_notifications")
      .insert({
        org_id: orgId,
        load_id: notification.loadId,
        driver_id: notification.driverId,
        type: notification.type,
        severity: notification.severity,
        title: notification.title,
        message: notification.message,
        meta: notification.meta || {}
      });
    
    if (error) {
      console.error("[telegram-hook] Failed to create notification:", error);
    }
  } catch (err) {
    console.error("[telegram-hook] Notification error:", err);
  }
}

// ============================================================================
// EMAIL NOTIFICATION HELPER (for Issues)
// ============================================================================

async function sendIssueEmail(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  issue: {
    loadReference: string;
    driverName: string;
    category: string;
    description: string;
    route: string;
    severity: string;
  }
) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Atlas Command <dispatch@atlascommand.com>";
  
  if (!RESEND_API_KEY) {
    console.log("[telegram-hook] RESEND_API_KEY not set, skipping email");
    return;
  }
  
  // Get dispatcher emails from team_members
  const { data: dispatchers, error: dispatchersError } = await supabase
    .from("team_members")
    .select("email")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin", "dispatcher"]);
  
  if (dispatchersError) {
    console.error("[telegram-hook] Error fetching dispatchers:", dispatchersError);
    return;
  }
  
  if (!dispatchers?.length) {
    console.log("[telegram-hook] No dispatchers found for org:", orgId);
    return;
  }
  
  const emails = dispatchers.map(d => d.email).filter(Boolean);
  if (!emails.length) {
    console.log("[telegram-hook] No valid emails found for dispatchers");
    return;
  }
  
  console.log("[telegram-hook] Sending issue email to:", emails);
  
  const severityEmoji = { low: "🟡", medium: "🟠", high: "🔴", critical: "🚨" }[issue.severity] || "⚠️";
  const categoryDisplay = issue.category.replace(/_/g, " ");
  
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 20px;">${severityEmoji} Driver Issue Reported</h2>
      </div>
      <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 100px;"><strong>Load</strong></td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${issue.loadReference}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Driver</strong></td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb;">${issue.driverName}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Issue</strong></td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb;">${severityEmoji} ${categoryDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Route</strong></td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb;">${issue.route}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; color: #6b7280; vertical-align: top;"><strong>Details</strong></td>
            <td style="padding: 12px 8px;">"${issue.description}"</td>
          </tr>
        </table>
        <div style="margin-top: 24px; text-align: center;">
          <a href="https://app.atlascommand.com/loads" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">View in Atlas Command</a>
        </div>
      </div>
      <div style="padding: 16px; text-align: center; color: #9ca3af; font-size: 12px;">
        Atlas Command • AI-Powered Dispatch
      </div>
    </div>
  `;
  
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${RESEND_API_KEY}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: emails,
        subject: `${severityEmoji} Issue on Load ${issue.loadReference} - ${issue.driverName}`,
        html
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[telegram-hook] Resend API error:", response.status, errorText);
    } else {
      const result = await response.json();
      console.log("[telegram-hook] Issue email sent successfully:", result.id);
    }
  } catch (err) {
    console.error("[telegram-hook] Email send failed:", err);
  }
}

// ============================================================================
// DRIVER STATUS UPDATE HANDLER
// ============================================================================

interface DriverStatusResult {
  handled: boolean;
  status?: string;
  loadReference?: string;
}

// Status phrase patterns
const STATUS_PATTERNS = {
  AT_PICKUP: [
    /^(at|arrived at|here at|pulling into|i'?m at)\s*(pickup|shipper|the shipper)/i,
    /^arrived\s*(for)?\s*pickup/i,
    /^at\s+[A-Z]/i, // "at ABC Company" - will need load context to match
  ],
  IN_TRANSIT: [
    /^(loaded|picked up|got loaded|heading out|leaving|departed|rolling|on my way)/i,
    /^(en route|heading to delivery|left pickup|have the freight)/i,
    /^loaded\s*(and)?\s*(rolling)?/i,
  ],
  AT_DELIVERY: [
    /^(at|arrived at|here at|pulling into|i'?m at)\s*(delivery|receiver|consignee|the receiver)/i,
    /^arrived\s*(for)?\s*delivery/i,
    /^at\s+delivery/i,
    /^at\s+receiver/i,
  ],
  DELIVERED: [
    /^(delivered|unloaded|empty|done|completed|dropped|finished)/i,
    /^delivery\s*complete/i,
    /^(leaving|heading out)\s*empty/i,
    /^all\s*done/i,
  ],
  PROBLEM: [
    /^(problem|issue|breakdown|broke down|flat tire|accident)/i,
    /^(delay|stuck|can'?t make it|running late|traffic|weather delay)/i,
    /^(closed|shipper closed|receiver closed|refused|rejected|turned away)/i,
    /^there'?s\s*(a|an)?\s*(problem|issue)/i,
    /^(i have|got|having)\s*(a|an)?\s*(problem|issue)/i,
    /^(help|need help|sos)/i,
    /^(wrong|incorrect)\s*(address|pu|pickup|po|number)/i,
    /^(they|shipper|receiver)\s*(say|says|said|telling)/i,
  ],
  BREAK: [
    /^(taking a break|stopping for break|30 minute break|taking my 30)/i,
    /^(fuel stop|stopping for fuel|rest stop)/i,
    /^(parking for the night|shutting down|going to sleep|10 hour break)/i,
  ],
};

async function handleDriverStatusUpdate(
  chatId: number,
  text: string,
  orgId: string,
  driverId: string,
  driverName: string,
  supabase: ReturnType<typeof createClient>
): Promise<DriverStatusResult> {
  
  const lowerText = text.toLowerCase().trim();
  
  // Detect which status pattern matches
  let detectedStatus: string | null = null;
  
  for (const [status, patterns] of Object.entries(STATUS_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lowerText)) {
        detectedStatus = status;
        break;
      }
    }
    if (detectedStatus) break;
  }
  
  // If no status pattern detected, let Dipsy handle it
  if (!detectedStatus) {
    return { handled: false };
  }
  
  console.log(`[telegram-hook] Driver status detected: ${detectedStatus} from "${text}"`);
  
  // Get driver's currently assigned load
  // Allowed statuses: AVAILABLE, DISPATCHED, IN_TRANSIT, DELIVERED, CANCELLED, AT_RISK, PROBLEM
  const { data: assignedLoad, error: loadError } = await supabase
    .from("loads")
    .select("id, reference, origin, destination, status, shipper, consignee_name, pickup_date, pickup_time, delivery_date, delivery_time")
    .eq("org_id", orgId)
    .eq("assigned_driver_id", driverId)
    .in("status", ["DISPATCHED", "IN_TRANSIT", "AT_RISK", "PROBLEM"])
    .order("pickup_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  
  if (loadError) {
    console.error("[telegram-hook] Error finding driver's load:", loadError);
    return { handled: false };
  }
  
  // No active load assigned
  if (!assignedLoad) {
    await sendTelegramMessage(
      chatId,
      `🤔 I don't see an active load assigned to you right now.\n\n` +
      `If you just got assigned a load, give it a moment to sync. ` +
      `Otherwise, check with dispatch.`
    );
    return { handled: true };
  }
  
  const loadRef = assignedLoad.reference;
  const now = new Date().toISOString();
  
  // Validate status transition
  const validTransition = validateStatusTransition(assignedLoad.status, detectedStatus);
  if (!validTransition.valid) {
    await sendTelegramMessage(
      chatId,
      `🤔 That doesn't match where I have you.\n\n` +
      `Load ${loadRef} shows: **${assignedLoad.status}**\n\n` +
      `${validTransition.suggestion}`
    );
    return { handled: true };
  }
  
  // Process the status update
  switch (detectedStatus) {
    case "AT_PICKUP":
      await processAtPickup(chatId, supabase, assignedLoad, driverName, now, orgId);
      break;
      
    case "IN_TRANSIT":
      await processInTransit(chatId, supabase, assignedLoad, driverName, now, orgId);
      break;
      
    case "AT_DELIVERY":
      await processAtDelivery(chatId, supabase, assignedLoad, driverName, now, orgId);
      break;
      
    case "DELIVERED":
      await processDelivered(chatId, supabase, assignedLoad, driverName, now, orgId, driverId);
      break;
      
    case "PROBLEM":
      await processProblem(chatId, supabase, assignedLoad, driverName, text, orgId, driverId);
      break;
      
    case "BREAK":
      await processBreak(chatId, assignedLoad, driverName);
      break;
  }
  
  return { handled: true, status: detectedStatus, loadReference: loadRef };
}

function validateStatusTransition(currentStatus: string, newStatus: string): { valid: boolean; suggestion: string } {
  // Allowed DB statuses: AVAILABLE, DISPATCHED, IN_TRANSIT, DELIVERED, CANCELLED, AT_RISK, PROBLEM
  // Map driver actions to valid transitions
  const transitions: Record<string, string[]> = {
    "AVAILABLE": ["AT_PICKUP", "IN_TRANSIT", "PROBLEM", "BREAK"],  // Shouldn't happen if assigned properly
    "DISPATCHED": ["AT_PICKUP", "IN_TRANSIT", "PROBLEM", "BREAK"],  // Driver assigned, can arrive at pickup
    "IN_TRANSIT": ["AT_DELIVERY", "DELIVERED", "PROBLEM", "BREAK"], // Can arrive at delivery or deliver
    "AT_RISK": ["AT_PICKUP", "IN_TRANSIT", "AT_DELIVERY", "DELIVERED", "PROBLEM", "BREAK"],  // Can resume from any point
    "PROBLEM": ["AT_PICKUP", "IN_TRANSIT", "AT_DELIVERY", "DELIVERED", "BREAK"],  // Can resume from any point
  };
  
  const allowed = transitions[currentStatus] || [];
  
  if (allowed.includes(newStatus)) {
    return { valid: true, suggestion: "" };
  }
  
  // Build suggestion based on current status
  let suggestion = "";
  switch (currentStatus) {
    case "AVAILABLE":
    case "DISPATCHED":
    case "AT_RISK":
    case "PROBLEM":
      suggestion = "Did you mean:\n• 'At pickup' — you've arrived at shipper\n• 'Loaded' — you're rolling with freight";
      break;
    case "IN_TRANSIT":
      suggestion = "Did you mean:\n• 'At delivery' — you've arrived at receiver\n• 'Delivered' — you're done";
      break;
  }
  
  return { valid: false, suggestion };
}

async function processAtPickup(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
  load: any,
  driverName: string,
  now: string,
  orgId: string
) {
  // Update load - keep AVAILABLE but log arrival time
  // (DISPATCHED not in allowed statuses, so we track via timestamp)
  await supabase
    .from("loads")
    .update({
      arrived_at_pickup: now,
      updated_at: now,
    })
    .eq("id", load.id);
  
  // Build response - avoid markdown issues with null/special chars
  const shipperName = load.shipper || 'Shipper';
  const appointmentStr = load.pickup_time 
    ? `Appointment: ${load.pickup_date} ${load.pickup_time}` 
    : `Appointment: ${load.pickup_date || 'TBD'}`;
  
  await sendTelegramMessage(
    chatId,
    `📍 Marked you AT PICKUP for load ${load.reference}.\n\n` +
    `${shipperName}\n` +
    `${load.origin}\n` +
    `${appointmentStr}\n\n` +
    `Let me know when you're loaded and rolling! 🚛`
  );
  
  // Announce to dispatch group (if configured)
  await announceToGroup(
    supabase,
    orgId,
    `📍 ${driverName} arrived at pickup for ${load.reference}.\n` +
    `${load.origin} → ${load.destination}`
  );
}

async function processInTransit(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
  load: any,
  driverName: string,
  now: string,
  orgId: string
) {
  // Update load status
  await supabase
    .from("loads")
    .update({
      status: "IN_TRANSIT",
      departed_pickup_at: now,
      status_changed_at: now,
      updated_at: now,
    })
    .eq("id", load.id);
  
  // Build response
  const deliveryStr = load.delivery_time
    ? `${load.delivery_date} ${load.delivery_time}`
    : load.delivery_date || 'TBD';
  const consigneeName = load.consignee_name || 'Receiver';
  
  await sendTelegramMessage(
    chatId,
    `🚛 Load ${load.reference} now IN TRANSIT.\n\n` +
    `Delivery: ${consigneeName}\n` +
    `${load.destination}\n` +
    `Appointment: ${deliveryStr}\n\n` +
    `Safe travels! Let me know when you arrive. 📍`
  );
  
  // Announce to dispatch group
  await announceToGroup(
    supabase,
    orgId,
    `🚛 ${load.reference} now IN TRANSIT.\n` +
    `${driverName} departed ${load.origin}, heading to ${load.destination}.`
  );
}

async function processAtDelivery(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
  load: any,
  driverName: string,
  now: string,
  orgId: string
) {
  // Update load - keep IN_TRANSIT but log arrival time
  // (AT_DELIVERY not in allowed statuses, so we track via timestamp)
  await supabase
    .from("loads")
    .update({
      arrived_at_delivery: now,
      updated_at: now,
    })
    .eq("id", load.id);
  
  const appointmentStr = load.delivery_time
    ? `${load.delivery_date} ${load.delivery_time}`
    : load.delivery_date || 'TBD';
  const consigneeName = load.consignee_name || 'Receiver';
  
  await sendTelegramMessage(
    chatId,
    `📍 Marked you AT DELIVERY for load ${load.reference}.\n\n` +
    `${consigneeName}\n` +
    `${load.destination}\n` +
    `Appointment: ${appointmentStr}\n\n` +
    `Let me know when you're empty, and send me that POD! 📄`
  );
  
  // Announce to dispatch group
  await announceToGroup(
    supabase,
    orgId,
    `📍 ${driverName} arrived at delivery for ${load.reference}.\n` +
    `${load.origin} → ${load.destination}`
  );
}

async function processDelivered(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
  load: any,
  driverName: string,
  now: string,
  orgId: string,
  driverId: string
) {
  // Update load status
  await supabase
    .from("loads")
    .update({
      status: "DELIVERED",
      delivered_at: now,
      pod_status: "PENDING",
      status_changed_at: now,
      updated_at: now,
    })
    .eq("id", load.id);
  
  await sendTelegramMessage(
    chatId,
    `🎉 Nice work! Load ${load.reference} marked DELIVERED.\n\n` +
    `📄 Please send me a photo of the signed POD/BOL.\n\n` +
    `Just snap a pic and send it here — I'll handle the rest!`
  );
  
  // Create dispatch notification for UI
  await createDispatchNotification(supabase, orgId, {
    loadId: load.id,
    driverId: driverId,
    type: 'LOAD_DELIVERED',
    severity: 'info',
    title: `✅ Load Delivered — ${load.reference}`,
    message: `${driverName} delivered ${load.origin} → ${load.destination}. POD pending.`,
    meta: {
      load_reference: load.reference,
      driver_name: driverName,
      route: `${load.origin} → ${load.destination}`,
      rate: load.rate
    }
  });
  
  // Announce to dispatch group
  await announceToGroup(
    supabase,
    orgId,
    `✅ ${load.reference} DELIVERED.\n` +
    `${driverName} completed ${load.origin} → ${load.destination}.\n` +
    `POD: Pending 📄`
  );
}

async function processProblem(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
  load: any,
  driverName: string,
  originalText: string,
  orgId: string,
  driverId: string
) {
  // Store that we're awaiting issue details in conversation state
  await supabase
    .from("whatsapp_state")
    .upsert({
      org_id: orgId,
      phone_number: `telegram:${chatId}`,
      conversation_state: {
        awaiting_issue_details: true,
        issue_load_id: load.id,
        issue_load_reference: load.reference,
        issue_initial_message: originalText,
        issue_started_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'org_id,phone_number'
    });

  await sendTelegramMessage(
    chatId,
    `😟 What's going on with load ${load.reference}?\n\n` +
    `Quick replies:\n` +
    `• 'Wrong address' — PU/DEL address issue\n` +
    `• 'Wrong PU#' — incorrect pickup number\n` +
    `• 'Closed' — shipper/receiver closed\n` +
    `• 'Refused' — load rejected\n` +
    `• 'Detention' — waiting too long\n` +
    `• 'Breakdown' — truck/mechanical issue\n` +
    `• 'Accident' — collision\n` +
    `• 'Weather' — unsafe conditions\n\n` +
    `Or just describe the issue in your own words.`
  );
  
  // Alert dispatch group immediately that an issue is incoming
  await announceToGroup(
    supabase,
    orgId,
    `⚠️ ${driverName} reporting issue on ${load.reference}...\n` +
    `${load.origin} → ${load.destination}\n` +
    `Gathering details...`
  );
}

// ============================================================================
// ISSUE DETAILS HANDLER
// ============================================================================

const ISSUE_CATEGORIES: Record<string, { category: string; emoji: string; severity: 'low' | 'medium' | 'high' | 'critical' }> = {
  'wrong address': { category: 'ADDRESS_ISSUE', emoji: '📍', severity: 'medium' },
  'address wrong': { category: 'ADDRESS_ISSUE', emoji: '📍', severity: 'medium' },
  'bad address': { category: 'ADDRESS_ISSUE', emoji: '📍', severity: 'medium' },
  'wrong pu': { category: 'WRONG_PU_NUMBER', emoji: '🔢', severity: 'medium' },
  'wrong pickup': { category: 'WRONG_PU_NUMBER', emoji: '🔢', severity: 'medium' },
  'pu number': { category: 'WRONG_PU_NUMBER', emoji: '🔢', severity: 'medium' },
  'po number': { category: 'WRONG_PU_NUMBER', emoji: '🔢', severity: 'medium' },
  'closed': { category: 'FACILITY_CLOSED', emoji: '🚫', severity: 'medium' },
  'shipper closed': { category: 'FACILITY_CLOSED', emoji: '🚫', severity: 'medium' },
  'receiver closed': { category: 'FACILITY_CLOSED', emoji: '🚫', severity: 'medium' },
  'refused': { category: 'LOAD_REFUSED', emoji: '❌', severity: 'high' },
  'rejected': { category: 'LOAD_REFUSED', emoji: '❌', severity: 'high' },
  'turned away': { category: 'LOAD_REFUSED', emoji: '❌', severity: 'high' },
  'detention': { category: 'DETENTION', emoji: '⏰', severity: 'low' },
  'waiting': { category: 'DETENTION', emoji: '⏰', severity: 'low' },
  'been here': { category: 'DETENTION', emoji: '⏰', severity: 'low' },
  'breakdown': { category: 'BREAKDOWN', emoji: '🔧', severity: 'high' },
  'broke down': { category: 'BREAKDOWN', emoji: '🔧', severity: 'high' },
  'mechanical': { category: 'BREAKDOWN', emoji: '🔧', severity: 'high' },
  'flat tire': { category: 'BREAKDOWN', emoji: '🔧', severity: 'medium' },
  'accident': { category: 'ACCIDENT', emoji: '🚨', severity: 'critical' },
  'crash': { category: 'ACCIDENT', emoji: '🚨', severity: 'critical' },
  'collision': { category: 'ACCIDENT', emoji: '🚨', severity: 'critical' },
  'weather': { category: 'WEATHER', emoji: '🌧️', severity: 'medium' },
  'storm': { category: 'WEATHER', emoji: '🌧️', severity: 'medium' },
  'snow': { category: 'WEATHER', emoji: '❄️', severity: 'medium' },
  'ice': { category: 'WEATHER', emoji: '❄️', severity: 'medium' },
  'delay': { category: 'DELAY', emoji: '🕐', severity: 'low' },
  'running late': { category: 'DELAY', emoji: '🕐', severity: 'low' },
  'behind schedule': { category: 'DELAY', emoji: '🕐', severity: 'low' },
  'traffic': { category: 'DELAY', emoji: '🚗', severity: 'low' },
};

function categorizeIssue(text: string): { category: string; emoji: string; severity: 'low' | 'medium' | 'high' | 'critical' } {
  const lowerText = text.toLowerCase();
  
  for (const [keyword, info] of Object.entries(ISSUE_CATEGORIES)) {
    if (lowerText.includes(keyword)) {
      return info;
    }
  }
  
  return { category: 'OTHER', emoji: '⚠️', severity: 'medium' };
}

async function handleIssueDetails(
  chatId: number,
  text: string,
  orgId: string,
  driverId: string,
  driverName: string,
  supabase: ReturnType<typeof createClient>
): Promise<{ handled: boolean }> {
  
  // Check if we're awaiting issue details
  const { data: stateData } = await supabase
    .from("whatsapp_state")
    .select("conversation_state")
    .eq("org_id", orgId)
    .eq("phone_number", `telegram:${chatId}`)
    .single();
  
  const state = stateData?.conversation_state;
  
  if (!state?.awaiting_issue_details) {
    return { handled: false };
  }
  
  // Check if issue started recently (within 30 minutes)
  const issueStarted = state.issue_started_at ? new Date(state.issue_started_at).getTime() : 0;
  if (Date.now() - issueStarted > 30 * 60 * 1000) {
    // Stale issue context, clear it
    await supabase
      .from("whatsapp_state")
      .update({
        conversation_state: {},
        updated_at: new Date().toISOString()
      })
      .eq("org_id", orgId)
      .eq("phone_number", `telegram:${chatId}`);
    return { handled: false };
  }
  
  const loadId = state.issue_load_id;
  const loadReference = state.issue_load_reference;
  const initialMessage = state.issue_initial_message || '';
  
  // Get load details
  const { data: load } = await supabase
    .from("loads")
    .select("*")
    .eq("id", loadId)
    .single();
  
  if (!load) {
    await sendTelegramMessage(chatId, "Sorry, I couldn't find that load. Please try again.");
    return { handled: true };
  }
  
  // Categorize the issue
  const fullIssueText = `${initialMessage} ${text}`.trim();
  const issueInfo = categorizeIssue(fullIssueText);
  
  const now = new Date().toISOString();
  
  // Update load status to PROBLEM or AT_RISK based on severity
  const newStatus = issueInfo.severity === 'critical' || issueInfo.severity === 'high' ? 'PROBLEM' : 'AT_RISK';
  
  await supabase
    .from("loads")
    .update({
      status: newStatus,
      status_changed_at: now,
      updated_at: now
    })
    .eq("id", loadId);
  
  // Log to load_activity
  await supabase
    .from("load_activity")
    .insert({
      load_id: loadId,
      actor_id: driverId,
      event_type: 'ISSUE_REPORTED',
      message: text,
      meta: {
        category: issueInfo.category,
        severity: issueInfo.severity,
        initial_message: initialMessage,
        driver_name: driverName,
        load_status_before: load.status,
        reported_at: now
      }
    });
  
  // Clear the awaiting state
  await supabase
    .from("whatsapp_state")
    .update({
      conversation_state: {},
      updated_at: now
    })
    .eq("org_id", orgId)
    .eq("phone_number", `telegram:${chatId}`);
  
  // Confirm to driver
  const categoryDisplay = issueInfo.category.replace(/_/g, ' ').toLowerCase();
  
  await sendTelegramMessage(
    chatId,
    `📝 Got it. I'm alerting dispatch now.\n\n` +
    `${issueInfo.emoji} Issue: ${categoryDisplay}\n` +
    `📦 Load: ${loadReference}\n` +
    `📍 Route: ${load.origin} → ${load.destination}\n\n` +
    `Details: "${text}"\n\n` +
    `Dispatch will reach out shortly. Hang tight! 🚛`
  );
  
  // Format severity indicator
  const severityIndicator = {
    'low': '🟡',
    'medium': '🟠',
    'high': '🔴',
    'critical': '🚨🚨🚨'
  }[issueInfo.severity];
  
  // Create dispatch notification for UI
  await createDispatchNotification(supabase, orgId, {
    loadId: loadId,
    driverId: driverId,
    type: 'ISSUE',
    severity: issueInfo.severity === 'critical' ? 'critical' : issueInfo.severity === 'high' ? 'critical' : 'warning',
    title: `${severityIndicator} Issue: ${categoryDisplay}`,
    message: `${driverName} reported "${text}" on load ${loadReference} (${load.origin} → ${load.destination})`,
    meta: {
      category: issueInfo.category,
      load_reference: loadReference,
      driver_name: driverName,
      route: `${load.origin} → ${load.destination}`
    }
  });
  
  // Send email notification to dispatchers
  await sendIssueEmail(supabase, orgId, {
    loadReference,
    driverName,
    category: issueInfo.category,
    description: text,
    route: `${load.origin} → ${load.destination}`,
    severity: issueInfo.severity
  });
  
  // Alert dispatch group with full details
  await announceToGroup(
    supabase,
    orgId,
    `${severityIndicator} ISSUE REPORTED — Load ${loadReference}\n\n` +
    `👤 Driver: ${driverName}\n` +
    `${issueInfo.emoji} Issue: ${categoryDisplay.toUpperCase()}\n` +
    `📍 Status: ${load.status}\n\n` +
    `"${text}"\n\n` +
    `📦 Route: ${load.origin} → ${load.destination}\n` +
    `💰 Rate: $${Number(load.rate || 0).toLocaleString()}\n\n` +
    `⚡ Please respond to driver`
  );
  
  return { handled: true };
}

async function processBreak(
  chatId: number,
  load: any,
  driverName: string
) {
  // Just acknowledge, don't change load status
  await sendTelegramMessage(
    chatId,
    `👍 Got it. Taking a break.\n\n` +
    `Load ${load.reference} — Delivery: ${load.delivery_date}\n\n` +
    `Rest up! Let me know when you're rolling again. 🚛`
  );
  
  // No group announcement for routine breaks
}

// ============================================================================
// LOAD RECOMMENDATION HANDLER
// ============================================================================

const RECOMMENDATION_PATTERNS = [
  /^(what'?s?\s*(my)?\s*next\s*load)/i,
  /^(where'?s?\s*(my)?\s*next\s*load)/i,
  /^(find\s*(me)?\s*(a|some)?\s*load)/i,
  /^(what\s*loads?\s*(are)?\s*available)/i,
  /^(show\s*(me)?\s*loads)/i,
  /^(need\s*(a)?\s*load)/i,
  /^(any\s*loads?\s*(for me)?)/i,
  /^(where\s*(should|can)\s*i\s*go\s*next)/i,
  /^(recommend\s*(a|some)?\s*loads?)/i,
  /^(best\s*loads?)/i,
  /^(top\s*loads?)/i,
  /^next\s*load/i,
];

interface RecommendationResult {
  handled: boolean;
}

async function handleLoadRecommendation(
  chatId: number,
  text: string,
  orgId: string,
  driverId: string,
  driverName: string,
  supabase: ReturnType<typeof createClient>
): Promise<RecommendationResult> {
  
  const lowerText = text.toLowerCase().trim();
  
  // Check if this is a recommendation request
  const isRecommendRequest = RECOMMENDATION_PATTERNS.some(pattern => pattern.test(lowerText));
  
  if (!isRecommendRequest) {
    return { handled: false };
  }
  
  console.log("[telegram-hook] Load recommendation requested by driver:", driverName);
  
  // Get driver info for context
  const { data: driver } = await supabase
    .from("drivers")
    .select("home_city, home_state, hos_drive_remaining_min")
    .eq("id", driverId)
    .single();
  
  // Get driver's last location from most recent delivered load
  const { data: lastLoad } = await supabase
    .from("loads")
    .select("dest_city, dest_state, delivered_at")
    .eq("assigned_driver_id", driverId)
    .eq("status", "DELIVERED")
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  const lastLocation = lastLoad 
    ? `${lastLoad.dest_city || ''}, ${lastLoad.dest_state || ''}`.trim()
    : driver?.home_city 
      ? `${driver.home_city}, ${driver.home_state}`
      : 'Unknown';
  
  const homeLocation = driver?.home_city 
    ? `${driver.home_city}, ${driver.home_state}`
    : 'Not set';
  
  // Call the recommendation function
  const { data: recommendations, error } = await supabase.rpc(
    "recommend_loads_for_driver",
    {
      p_driver_id: driverId,
      p_org_id: orgId,
      p_limit: 5
    }
  );
  
  if (error) {
    console.error("[telegram-hook] Recommendation error:", error);
    await sendTelegramMessage(
      chatId,
      `Sorry, I had trouble finding loads. Please try again or check with dispatch.`
    );
    return { handled: true };
  }
  
  if (!recommendations || recommendations.length === 0) {
    await sendTelegramMessage(
      chatId,
      `🚛 No available loads found right now.\n\n` +
      `Check back soon or contact dispatch for updates.`
    );
    return { handled: true };
  }
  
  // Format HOS remaining
  const hosMinutes = driver?.hos_drive_remaining_min || 660;
  const hosHours = Math.floor(hosMinutes / 60);
  const hosMins = hosMinutes % 60;
  const hosStr = `${hosHours}h ${hosMins}m`;
  
  // Build response
  let response = `🚛 TOP LOADS FOR YOU\n\n`;
  response += `📍 Location: ${lastLocation}\n`;
  response += `🏠 Home: ${homeLocation}\n`;
  response += `⏱️ HOS: ${hosStr} drive time\n\n`;
  
  recommendations.slice(0, 3).forEach((load: any, index: number) => {
    const emoji = index === 0 ? '1️⃣' : index === 1 ? '2️⃣' : '3️⃣';
    const rpmDisplay = load.rate_per_mile ? `$${load.rate_per_mile}/mi` : '';
    const rateDisplay = load.rate ? `$${Number(load.rate).toLocaleString()}` : '$0';
    const milesDisplay = load.miles ? `${Number(load.miles).toLocaleString()} mi` : '';
    
    // Parse origin/destination for cleaner display
    const originShort = load.origin?.split(',')[0] || load.origin;
    const destShort = load.destination?.split(',')[0] || load.destination;
    
    response += `${emoji} #${load.reference}\n`;
    response += `   ${originShort} → ${destShort}\n`;
    response += `   ${rateDisplay}`;
    if (milesDisplay) response += ` • ${milesDisplay}`;
    if (rpmDisplay) response += ` • ${rpmDisplay}`;
    if (load.rate_per_mile >= 4.0) response += ` 🔥`;
    response += `\n`;
    response += `   Score: ${load.total_score} — ${load.recommendation_reason}\n\n`;
  });
  
  response += `Reply "1", "2", or "3" for details\n`;
  response += `Or "Assign 1" to take a load`;
  
  await sendTelegramMessage(chatId, response);
  
  // Store recommendations in conversation state for follow-up
  await supabase
    .from("whatsapp_state")
    .upsert({
      org_id: orgId,
      phone_number: `telegram:${chatId}`,
      conversation_state: {
        last_recommendations: recommendations.slice(0, 3).map((r: any) => ({
          load_id: r.load_id,
          reference: r.reference,
          origin: r.origin,
          destination: r.destination,
          rate: r.rate,
          miles: r.miles
        })),
        recommendation_time: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'org_id,phone_number'
    });
  
  return { handled: true };
}

// ============================================================================
// LOAD SELECTION HANDLER (for "1", "2", "3", "Assign 1", etc.)
// ============================================================================

const LOAD_SELECTION_PATTERNS = {
  DETAILS: /^([123])$/,
  ASSIGN: /^(assign|take|book|accept)\s*([123])/i,
};

async function handleLoadSelection(
  chatId: number,
  text: string,
  orgId: string,
  driverId: string,
  driverName: string,
  supabase: ReturnType<typeof createClient>
): Promise<{ handled: boolean }> {
  
  const trimmedText = text.trim();
  
  // Check if this looks like a selection
  const detailsMatch = trimmedText.match(LOAD_SELECTION_PATTERNS.DETAILS);
  const assignMatch = trimmedText.match(LOAD_SELECTION_PATTERNS.ASSIGN);
  
  if (!detailsMatch && !assignMatch) {
    return { handled: false };
  }
  
  // Get stored recommendations from state
  const { data: stateData } = await supabase
    .from("whatsapp_state")
    .select("conversation_state")
    .eq("org_id", orgId)
    .eq("phone_number", `telegram:${chatId}`)
    .single();
  
  const recommendations = stateData?.conversation_state?.last_recommendations;
  const recommendationTime = stateData?.conversation_state?.recommendation_time;
  
  // Check if recommendations are recent (within 30 minutes)
  if (!recommendations || !recommendationTime) {
    return { handled: false }; // Let Dipsy handle it
  }
  
  const timeSinceRecommendation = Date.now() - new Date(recommendationTime).getTime();
  if (timeSinceRecommendation > 30 * 60 * 1000) { // 30 minutes
    return { handled: false }; // Stale recommendations
  }
  
  // Get the selected load
  const selectionNum = detailsMatch ? parseInt(detailsMatch[1]) : parseInt(assignMatch![2]);
  const selectedLoad = recommendations[selectionNum - 1];
  
  if (!selectedLoad) {
    await sendTelegramMessage(chatId, `Invalid selection. Please choose 1, 2, or 3.`);
    return { handled: true };
  }
  
  // If just asking for details
  if (detailsMatch) {
    // Get full load details
    const { data: load } = await supabase
      .from("loads")
      .select("*")
      .eq("id", selectedLoad.load_id)
      .single();
    
    if (!load) {
      await sendTelegramMessage(chatId, `Sorry, couldn't find that load. It may have been taken.`);
      return { handled: true };
    }
    
    const rpmDisplay = load.miles > 0 ? `$${(load.rate / load.miles).toFixed(2)}/mi` : '';
    const pickupDate = load.pickup_date || 'TBD';
    const deliveryDate = load.delivery_date || 'TBD';
    
    let details = `📋 LOAD DETAILS: ${load.reference}\n\n`;
    details += `📍 PICKUP\n`;
    details += `${load.shipper || 'Shipper TBD'}\n`;
    details += `${load.origin}\n`;
    details += `Date: ${pickupDate}\n\n`;
    details += `📍 DELIVERY\n`;
    details += `${load.consignee_name || 'Receiver TBD'}\n`;
    details += `${load.destination}\n`;
    details += `Date: ${deliveryDate}\n\n`;
    details += `💰 RATE\n`;
    details += `$${Number(load.rate || 0).toLocaleString()}`;
    if (load.miles) details += ` • ${Number(load.miles).toLocaleString()} miles`;
    if (rpmDisplay) details += ` • ${rpmDisplay}`;
    details += `\n\n`;
    if (load.equipment_type) details += `🚛 Equipment: ${load.equipment_type}\n`;
    if (load.commodity) details += `📦 Commodity: ${load.commodity}\n`;
    if (load.weight) details += `⚖️ Weight: ${Number(load.weight).toLocaleString()} lbs\n`;
    details += `\n`;
    details += `Reply "Assign ${selectionNum}" to take this load`;
    
    await sendTelegramMessage(chatId, details);
    return { handled: true };
  }
  
  // If assigning
  if (assignMatch) {
    // Check if driver already has an active load
    const { data: activeLoad } = await supabase
      .from("loads")
      .select("id, reference")
      .eq("assigned_driver_id", driverId)
      .in("status", ["DISPATCHED", "IN_TRANSIT"])
      .limit(1)
      .maybeSingle();
    
    if (activeLoad) {
      await sendTelegramMessage(
        chatId,
        `⚠️ You already have an active load: ${activeLoad.reference}\n\n` +
        `Complete or unassign that load first before taking a new one.`
      );
      return { handled: true };
    }
    
    // Assign the load
    const now = new Date().toISOString();
    const { error: assignError } = await supabase
      .from("loads")
      .update({
        assigned_driver_id: driverId,
        driver_name: driverName,
        status: "DISPATCHED", // Driver assigned, heading to pickup
        status_changed_at: now,
        updated_at: now
      })
      .eq("id", selectedLoad.load_id)
      .is("assigned_driver_id", null); // Only if not already assigned
    
    if (assignError) {
      console.error("[telegram-hook] Assignment error:", assignError);
      await sendTelegramMessage(chatId, `Sorry, couldn't assign that load. It may have been taken.`);
      return { handled: true };
    }
    
    // Get updated load info
    const { data: assignedLoad } = await supabase
      .from("loads")
      .select("*")
      .eq("id", selectedLoad.load_id)
      .single();
    
    if (!assignedLoad || assignedLoad.assigned_driver_id !== driverId) {
      await sendTelegramMessage(chatId, `Sorry, that load was just taken by another driver.`);
      return { handled: true };
    }
    
    // Create assignment record
    await supabase.from("load_driver_assignments").insert({
      load_id: selectedLoad.load_id,
      driver_id: driverId,
      assigned_at: now,
      org_id: orgId
    });
    
    // Update driver status
    await supabase
      .from("drivers")
      .update({ status: "ASSIGNED" })
      .eq("id", driverId);
    
    const pickupDate = assignedLoad.pickup_date || 'TBD';
    
    let confirmation = `✅ You got it! Load ${assignedLoad.reference} is yours.\n\n`;
    confirmation += `📍 PICKUP\n`;
    confirmation += `${assignedLoad.shipper || assignedLoad.origin}\n`;
    confirmation += `${assignedLoad.origin}\n`;
    confirmation += `Date: ${pickupDate}\n\n`;
    confirmation += `📍 DELIVERY\n`;
    confirmation += `${assignedLoad.destination}\n\n`;
    confirmation += `💰 $${Number(assignedLoad.rate || 0).toLocaleString()}`;
    if (assignedLoad.miles) confirmation += ` • ${Number(assignedLoad.miles).toLocaleString()} mi`;
    confirmation += `\n\n`;
    confirmation += `Let me know when you're "At pickup" 🚛`;
    
    await sendTelegramMessage(chatId, confirmation);
    
    // Announce to dispatch
    await announceToGroup(
      supabase,
      orgId,
      `🚛 ${driverName} accepted load ${assignedLoad.reference}\n` +
      `${assignedLoad.origin} → ${assignedLoad.destination}`
    );
    
    return { handled: true };
  }
  
  return { handled: false };
}

// DRIVER POD UPLOAD HANDLER
// ============================================================================

async function handleDriverPODUpload(
  chatId: number,
  message: any,
  orgId: string,
  driverId: string,
  driverName: string,
  supabase: ReturnType<typeof createClient>
): Promise<boolean> {
  
  // Check if driver has a DELIVERED load waiting for POD
  const { data: deliveredLoad } = await supabase
    .from("loads")
    .select("id, reference, origin, destination, pod_status")
    .eq("org_id", orgId)
    .eq("assigned_driver_id", driverId)
    .eq("status", "DELIVERED")
    .eq("pod_status", "PENDING")
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (!deliveredLoad) {
    // No delivered load waiting for POD, treat as regular upload
    return false;
  }
  
  // This is a POD upload!
  await sendTelegramMessage(chatId, "📄 Got it! Processing your POD...");
  
  try {
    // Get file from Telegram
    let fileId: string;
    let fileName: string = "pod";
    let mimeType: string = "image/jpeg";
    
    if (message.photo) {
      const photo = message.photo[message.photo.length - 1];
      fileId = photo.file_id;
      fileName = "pod.jpg";
      mimeType = "image/jpeg";
    } else if (message.document) {
      fileId = message.document.file_id;
      fileName = message.document.file_name || "pod";
      mimeType = message.document.mime_type || "application/octet-stream";
    } else {
      return false;
    }
    
    // Get file from Telegram
    const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
    const fileInfoRes = await fetch(fileInfoUrl);
    const fileInfo = await fileInfoRes.json();
    
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      throw new Error("Could not get file from Telegram");
    }
    
    const telegramFileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    
    // Download the file
    const fileResponse = await fetch(telegramFileUrl);
    const fileBuffer = await fileResponse.arrayBuffer();
    
    // Upload to Supabase Storage
    const now = new Date().toISOString();
    const timestamp = Date.now();
    const storagePath = `${orgId}/${deliveredLoad.id}/POD_${timestamp}_${fileName}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("load_docs")
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true
      });
    
    if (uploadError) {
      console.error("[telegram-hook] Storage upload error:", uploadError);
      throw new Error("Failed to upload POD to storage");
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from("load_docs")
      .getPublicUrl(storagePath);
    
    const publicUrl = urlData?.publicUrl || telegramFileUrl;
    
    // Update load with POD info
    await supabase
      .from("loads")
      .update({
        pod_status: "RECEIVED",
        pod_uploaded_at: now,
        pod_file_url: publicUrl,
        pod_path: storagePath,
        updated_at: now,
      })
      .eq("id", deliveredLoad.id);
    
    // Free up the driver
    await supabase
      .from("drivers")
      .update({ status: "AVAILABLE" })
      .eq("id", driverId);
    
    // Clear driver from load (optional - depends on your data model)
    await supabase
      .from("loads")
      .update({
        assigned_driver_id: null,
        driver_name: null,
      })
      .eq("id", deliveredLoad.id);
    
    // Close assignment record
    await supabase
      .from("load_driver_assignments")
      .update({ unassigned_at: now })
      .eq("load_id", deliveredLoad.id)
      .is("unassigned_at", null);
    
    await sendTelegramMessage(
      chatId,
      `📄 POD received for load ${deliveredLoad.reference}!\n\n` +
      `✅ Load complete! You're now **AVAILABLE**.\n\n` +
      `Great job on ${deliveredLoad.origin} → ${deliveredLoad.destination}! 🎉`
    );
    
    // Create dispatch notification for UI
    await createDispatchNotification(supabase, orgId, {
      loadId: deliveredLoad.id,
      driverId: driverId,
      type: 'POD_RECEIVED',
      severity: 'info',
      title: `📄 POD Received — ${deliveredLoad.reference}`,
      message: `${driverName} uploaded POD for ${deliveredLoad.origin} → ${deliveredLoad.destination}`,
      meta: {
        load_reference: deliveredLoad.reference,
        driver_name: driverName,
        route: `${deliveredLoad.origin} → ${deliveredLoad.destination}`,
        pod_path: storagePath
      }
    });
    
    // Announce to dispatch group
    await announceToGroup(
      supabase,
      orgId,
      `📄 POD received for ${deliveredLoad.reference}.\n` +
      `**${driverName}** is now AVAILABLE.`
    );
    
    return true;
    
  } catch (error) {
    console.error("[telegram-hook] POD upload error:", error);
    await sendTelegramMessage(
      chatId,
      `❌ Had trouble processing that image. Can you try again?\n\n` +
      `Tips:\n` +
      `• Make sure it's not blurry\n` +
      `• Good lighting helps\n` +
      `• Capture the whole document`
    );
    return true; // We handled it, even if it failed
  }
}

// ============================================================================
// GROUP CHAT ANNOUNCEMENT
// ============================================================================

async function announceToGroup(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  message: string
): Promise<void> {
  try {
    // Look up the org's dispatch group chat ID
    const { data: orgSettings } = await supabase
      .from("org_settings")
      .select("telegram_group_chat_id")
      .eq("org_id", orgId)
      .maybeSingle();
    
    const groupChatId = orgSettings?.telegram_group_chat_id;
    
    if (!groupChatId) {
      console.log("[telegram-hook] No group chat configured for org:", orgId);
      return;
    }
    
    await sendTelegramMessage(parseInt(groupChatId), message);
    
  } catch (error) {
    console.error("[telegram-hook] Failed to announce to group:", error);
    // Don't throw - group announcement is nice-to-have
  }
}

// ============================================================================
// RATE CON OCR UPLOAD HANDLER
// ============================================================================

async function handleRateConUpload(
  chatId: number,
  message: any,
  orgId: string,
  senderName: string,
  supabase: ReturnType<typeof createClient>
) {
  try {
    // Get file ID and check type
    let fileId: string;
    let mimeType = "image/jpeg";
    let fileName = "";

    if (message.photo) {
      // Photos come as array, get largest
      const photo = message.photo[message.photo.length - 1];
      fileId = photo.file_id;
      mimeType = "image/jpeg";
    } else if (message.document) {
      fileId = message.document.file_id;
      mimeType = message.document.mime_type || "application/octet-stream";
      fileName = message.document.file_name || "";
      
      // Check if it's a PDF - we can't process those directly
      if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
        await sendTelegramMessage(
          chatId,
          `📄 I see you sent a PDF!\n\n` +
          `Unfortunately, I can't read PDFs directly yet. Please:\n\n` +
          `1️⃣ **Take a screenshot** of the rate con on your computer\n` +
          `2️⃣ **Or take a photo** of the document with your phone camera\n\n` +
          `Then send me the image and I'll extract the details! 📸`
        );
        return;
      }
      
      // Check if it's an image
      if (!mimeType.startsWith("image/")) {
        await sendTelegramMessage(chatId, "❌ Please send an image (photo or screenshot) of the rate confirmation.");
        return;
      }
    } else {
      await sendTelegramMessage(chatId, "❌ Couldn't process that file. Please send an image.");
      return;
    }

    await sendTelegramMessage(chatId, "📄 Got it! Analyzing your rate confirmation... This may take a moment.");
    await sendTelegramAction(chatId, "typing");

    // Get file path from Telegram
    const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
    const fileInfoRes = await fetch(fileInfoUrl);
    const fileInfo = await fileInfoRes.json();

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      throw new Error("Could not get file from Telegram");
    }

    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    
    if (!fileRes.ok) {
      throw new Error("Could not download file from Telegram");
    }

    // Convert to base64 properly
    const arrayBuffer = await fileRes.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Build base64 string in chunks to avoid stack overflow
    let base64Data = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      base64Data += String.fromCharCode.apply(null, Array.from(chunk));
    }
    base64Data = btoa(base64Data);

    console.log("[telegram-hook] Downloaded file, size:", arrayBuffer.byteLength, "type:", mimeType);

    // Call OpenAI Vision for OCR
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const ocrPrompt = getRateConExtractionPrompt();

    const visionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: ocrPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 2500,
        temperature: 0.1,
      }),
    });

    if (!visionResponse.ok) {
      const err = await visionResponse.text();
      console.error("[telegram-hook] Vision API error:", err);
      throw new Error("OCR processing failed");
    }

    const visionData = await visionResponse.json();
    let content = visionData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const ocrData = JSON.parse(content);

    console.log("[telegram-hook] OCR extracted:", JSON.stringify(ocrData, null, 2));

    // Store pending load in conversation state
    const { data: stateData } = await supabase.rpc("get_or_create_whatsapp_state", {
      p_org_id: orgId,
      p_phone_number: `telegram:${chatId}`,
      p_contact_id: null,
    });

    const conversationState = stateData || {};
    conversationState.pendingRateCon = ocrData;
    conversationState.pendingRateConOrgId = orgId; // Store org_id for load creation

    await supabase.rpc("update_whatsapp_state", {
      p_org_id: orgId,
      p_phone_number: `telegram:${chatId}`,
      p_new_state: conversationState,
    });

    // Build confirmation message
    const origin = ocrData.origin || (ocrData.pickup_address ? `${ocrData.pickup_address.city}, ${ocrData.pickup_address.state}` : null) || "Unknown";
    const destination = ocrData.destination || (ocrData.delivery_address ? `${ocrData.delivery_address.city}, ${ocrData.delivery_address.state}` : null) || "Unknown";
    const rate = ocrData.rate ? `$${ocrData.rate}` : "Not found";
    const pickupDate = ocrData.pickup_date || "Not found";
    const deliveryDate = ocrData.delivery_date || "Not found";
    const reference = ocrData.reference || ocrData.load_number || "Will be generated";
    const commodity = ocrData.commodity || "Not specified";
    const equipment = ocrData.equipment_type || "DRY_VAN";
    const broker = ocrData.broker_name || ocrData.broker?.name || "Unknown";

    const confirmMsg = `📋 **Rate Confirmation Extracted**\n\n` +
      `**Reference:** ${reference}\n` +
      `**Broker:** ${broker}\n` +
      `**Route:** ${origin} → ${destination}\n` +
      `**Rate:** ${rate}\n` +
      `**Pickup:** ${pickupDate}\n` +
      `**Delivery:** ${deliveryDate}\n` +
      `**Commodity:** ${commodity}\n` +
      `**Equipment:** ${equipment}\n\n` +
      `✅ Reply **"Yes"** or **"Create it"** to create this load\n` +
      `❌ Reply **"No"** or **"Cancel"** to discard`;

    await sendTelegramMessage(chatId, confirmMsg);

  } catch (error) {
    console.error("[telegram-hook] Rate con processing error:", error);
    await sendTelegramMessage(
      chatId,
      `❌ Sorry, I couldn't read that rate confirmation.\n\n` +
      `Tips:\n` +
      `• Make sure the image is clear and not blurry\n` +
      `• Try taking a photo with better lighting\n` +
      `• Send a screenshot instead of PDF\n\n` +
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============================================================================
// RATE CON EXTRACTION PROMPT (matches your bolOcrParser.js)
// ============================================================================

function getRateConExtractionPrompt(): string {
  return `You are extracting data from a trucking RATE CONFIRMATION document sent by a freight broker.

Extract all visible information and return ONLY valid JSON with this structure (use null for missing fields):

{
  "reference": "load number or confirmation number",
  "load_number": "same as reference if that's the load number",
  "broker_name": "broker or customer company name",
  "origin": "pickup location as City, ST format",
  "destination": "delivery location as City, ST format",
  
  "pickup_date": "pickup date in YYYY-MM-DD format",
  "pickup_time": "pickup time in HH:MM 24-hour format",
  "delivery_date": "delivery date in YYYY-MM-DD format",
  "delivery_time": "delivery time in HH:MM 24-hour format",
  
  "commodity": "description of freight/cargo",
  "weight": "weight in pounds as number only",
  "pieces": "number of pallets/pieces as number only",
  
  "equipment_type": "DRY_VAN, REEFER, FLATBED, STEP_DECK, or OTHER",
  "temperature": "temperature requirement for reefer loads",
  
  "miles": "distance in miles as number only",
  "rate": "total rate/pay amount as number only (no $ symbol)",
  
  "special_instructions": "special requirements or notes",
  
  "pickup_address": {
    "company_name": "pickup facility name",
    "address": "full street address",
    "city": "pickup city",
    "state": "2-letter state code",
    "zip": "ZIP code"
  },
  
  "delivery_address": {
    "company_name": "delivery facility name", 
    "address": "full street address",
    "city": "delivery city",
    "state": "2-letter state code",
    "zip": "ZIP code"
  },

  "broker": {
    "name": "broker company name",
    "contact": "broker contact person",
    "phone": "broker phone",
    "email": "broker email"
  },

  "stops": [
    {
      "type": "pickup",
      "facility_name": "facility name",
      "address": "street address",
      "city": "city",
      "state": "state code",
      "zip": "ZIP",
      "appointment": "ISO datetime YYYY-MM-DDTHH:MM if available",
      "reference_numbers": ["any reference numbers"],
      "special_instructions": "notes for this stop"
    }
  ]
}

RULES:
- Return ONLY the JSON object, no markdown, no explanations
- Use null for any field not clearly visible
- Convert dates to YYYY-MM-DD format
- Convert times to 24-hour HH:MM format
- All monetary values as numbers only (no $ or commas)
- DO NOT use broker mailing/payment address as pickup/delivery
- Look for actual shipper/receiver facility addresses`;
}

// ============================================================================
// DIPSY TEXT CALL - FULL CAPABILITIES
// ============================================================================

async function callDipsyText(
  orgId: string,
  senderName: string,
  message: string,
  conversationState: Record<string, unknown>
): Promise<{ answer: string; conversation_state: Record<string, unknown> }> {
  
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set");
  }

  // Create Supabase client with service role to query and modify data
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Check if there's a pending rate con to confirm
  const pendingRateCon = conversationState.pendingRateCon as any;
  if (pendingRateCon) {
    const lowerMsg = message.toLowerCase().trim();
    
    // Check for confirmation
    if (lowerMsg === "yes" || lowerMsg === "y" || lowerMsg.includes("create it") || lowerMsg.includes("looks good") || lowerMsg.includes("confirm")) {
      // Get the stored org_id or use the passed one
      const loadOrgId = (conversationState.pendingRateConOrgId as string) || orgId;
      
      console.log("[telegram-hook] Creating load from rate con, orgId:", loadOrgId, "passed orgId:", orgId);
      
      if (!loadOrgId) {
        return {
          answer: "❌ Sorry, I lost track of your organization. Please send the rate confirmation again.",
          conversation_state: {},
        };
      }
      
      // Create the load from OCR data
      const result = await createLoadFromOCR(supabaseAdmin, loadOrgId, pendingRateCon);
      
      // Clear pending state
      delete conversationState.pendingRateCon;
      delete conversationState.pendingRateConOrgId;
      conversationState.lastLoad = result.reference;
      
      return {
        answer: `✅ **Load Created!**\n\n` +
          `**Reference:** ${result.reference}\n` +
          `**Route:** ${result.origin} → ${result.destination}\n` +
          `**Rate:** $${result.rate}\n\n` +
          `Would you like me to recommend a driver for this load?`,
        conversation_state: conversationState,
      };
    }
    
    // Check for cancellation
    if (lowerMsg === "no" || lowerMsg === "n" || lowerMsg.includes("cancel") || lowerMsg.includes("discard")) {
      delete conversationState.pendingRateCon;
      delete conversationState.pendingRateConOrgId;
      return {
        answer: "👍 No problem, I've discarded that rate confirmation. Send another one anytime!",
        conversation_state: conversationState,
      };
    }
    
    // If they said something else, remind them
    return {
      answer: `I have a rate confirmation ready to create.\n\n` +
        `Reply **"Yes"** to create the load, or **"No"** to cancel.\n\n` +
        `Or send a new rate confirmation to replace it.`,
      conversation_state: conversationState,
    };
  }

  // Get context data for Dipsy
  const { data: loads } = await supabaseAdmin
    .from("loads")
    .select("id, reference, origin, destination, status, rate, pickup_date, delivery_date, driver_name, assigned_driver_id, pod_status")
    .eq("org_id", orgId)
    .in("status", ["AVAILABLE", "IN_TRANSIT", "DELIVERED", "PROBLEM"])
    .order("pickup_date", { ascending: true })
    .limit(20);

  const { data: drivers } = await supabaseAdmin
    .from("drivers")
    .select("id, full_name, first_name, last_name, status, hos_status, hos_drive_remaining_min, phone")
    .eq("org_id", orgId)
    .limit(20);

  const loadsContext = loads?.map(l => 
    `${l.reference} (id:${l.id}): ${l.origin} → ${l.destination}, status:${l.status}, $${l.rate}, pickup:${l.pickup_date}${l.driver_name ? `, assigned:${l.driver_name}` : ', unassigned'}, pod:${l.pod_status || 'NONE'}`
  ).join("\n") || "No loads found";

  const driversContext = drivers?.map(d => {
    const name = d.full_name || `${d.first_name || ''} ${d.last_name || ''}`.trim();
    const hos = d.hos_drive_remaining_min ? `${Math.floor(d.hos_drive_remaining_min/60)}h${d.hos_drive_remaining_min%60}m` : 'no HOS';
    return `${name} (id:${d.id}): ${d.status}, ${hos}`;
  }).join("\n") || "No drivers found";

  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `You are Dipsy, a friendly AI dispatcher assistant for Atlas Command TMS.
You're chatting via Telegram with ${senderName}. Today is ${today}.

CURRENT DATA:
=== LOADS ===
${loadsContext}

=== DRIVERS ===
${driversContext}

YOU CAN TAKE THESE ACTIONS by responding with a JSON action block:

1. ASSIGN DRIVER TO LOAD:
{"action":"assign","driver_name":"Tony Stark","load_reference":"LD-2025-0001"}

2. MARK LOAD DELIVERED:
{"action":"deliver","load_reference":"LD-2025-0001"}

3. CONFIRM POD RECEIVED (frees driver):
{"action":"pod_received","load_reference":"LD-2025-0001"}

4. RELEASE DRIVER WITHOUT POD:
{"action":"release_driver","load_reference":"LD-2025-0001"}

5. MARK LOAD AS PROBLEM:
{"action":"problem","load_reference":"LD-2025-0001","reason":"flat tire"}

6. CREATE NEW LOAD:
{"action":"create_load","origin":"Sacramento, CA","destination":"Denver, CO","rate":5300,"pickup_date":"2025-12-01","delivery_date":"2025-12-02"}

RULES:
- Be concise and friendly (mobile chat)
- Use emojis occasionally 📦🚛✅
- When user asks to do something, include the JSON action block at the END of your message
- Put the JSON on its own line, no other text on that line
- Match driver/load names loosely (Tony = Tony Stark, 1234 = LD-2025-1234)
- After actions, confirm what you did
- Use context from conversation for "that load", "that driver", "him", etc.

CONTEXT MEMORY:
${conversationState.lastLoad ? `Last discussed load: ${conversationState.lastLoad}` : 'No recent load context'}
${conversationState.lastDriver ? `Last discussed driver: ${conversationState.lastDriver}` : 'No recent driver context'}`;

  const messages: Array<{role: string, content: string}> = [
    { role: "system", content: systemPrompt }
  ];

  // Add conversation history
  const history = (conversationState.history as Array<{role: string, content: string}>) || [];
  if (history.length > 0) {
    messages.push(...history.slice(-6));
  }
  
  messages.push({ role: "user", content: message });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[telegram-hook] OpenAI error:", error);
    throw new Error(`OpenAI error: ${response.status}`);
  }

  const data = await response.json();
  let answer = data.choices?.[0]?.message?.content || "I couldn't process that request.";

  // Check for action JSON in the response
  const actionMatch = answer.match(/\{[\s]*"action"[\s]*:[\s]*"[^"]+"/);
  if (actionMatch) {
    // Extract the full JSON object
    const jsonStart = answer.indexOf(actionMatch[0]);
    let braceCount = 0;
    let jsonEnd = jsonStart;
    for (let i = jsonStart; i < answer.length; i++) {
      if (answer[i] === '{') braceCount++;
      if (answer[i] === '}') braceCount--;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
    
    const jsonStr = answer.substring(jsonStart, jsonEnd);
    console.log("[telegram-hook] Found action JSON:", jsonStr);
    
    try {
      const actionData = JSON.parse(jsonStr);
      const actionResult = await executeAction(supabaseAdmin, orgId, actionData, loads || [], drivers || []);
      
      // Remove the JSON from the answer and append result
      answer = answer.substring(0, jsonStart).trim();
      if (actionResult.success) {
        answer += `\n\n✅ ${actionResult.message}`;
        
        // Update context
        if (actionResult.load_reference) {
          conversationState.lastLoad = actionResult.load_reference;
        }
        if (actionResult.driver_name) {
          conversationState.lastDriver = actionResult.driver_name;
        }
      } else {
        answer += `\n\n❌ ${actionResult.error}`;
      }
    } catch (e) {
      console.error("[telegram-hook] Failed to parse/execute action:", e);
    }
  }

  // Update context from message content
  const loadMatch = message.match(/LD-\d{4}-\d+/i) || answer.match(/LD-\d{4}-\d+/i);
  if (loadMatch) {
    conversationState.lastLoad = loadMatch[0].toUpperCase();
  }

  // Update conversation history
  const newHistory = [
    ...history,
    { role: "user", content: message },
    { role: "assistant", content: answer }
  ].slice(-10);

  return {
    answer,
    conversation_state: { ...conversationState, history: newHistory },
  };
}

// ============================================================================
// ACTION EXECUTOR
// ============================================================================

async function executeAction(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  action: any,
  loads: any[],
  drivers: any[]
): Promise<{ success: boolean; message?: string; error?: string; load_reference?: string; driver_name?: string }> {
  
  const now = new Date().toISOString();
  
  console.log("[telegram-hook] Executing action:", action);

  switch (action.action) {
    case "assign": {
      // Find driver
      const driverName = action.driver_name?.toLowerCase() || "";
      const driver = drivers.find(d => {
        const name = (d.full_name || `${d.first_name || ''} ${d.last_name || ''}`).toLowerCase();
        return name.includes(driverName) || driverName.includes(name.split(' ')[0]);
      });
      
      if (!driver) {
        return { success: false, error: `Driver "${action.driver_name}" not found` };
      }
      
      if (driver.status === "ASSIGNED") {
        const dName = driver.full_name || `${driver.first_name} ${driver.last_name}`;
        return { success: false, error: `${dName} is already assigned to another load` };
      }

      // Find load
      const loadRef = action.load_reference?.toUpperCase() || "";
      const load = loads.find(l => l.reference.includes(loadRef) || loadRef.includes(l.reference));
      
      if (!load) {
        return { success: false, error: `Load "${action.load_reference}" not found` };
      }

      const fullDriverName = driver.full_name || `${driver.first_name || ''} ${driver.last_name || ''}`.trim();

      // Create assignment record
      await supabase.from("load_driver_assignments").insert({
        load_id: load.id,
        driver_id: driver.id,
        assigned_at: now,
      });

      // Update driver status
      await supabase.from("drivers").update({ status: "ASSIGNED" }).eq("id", driver.id);

      // Update load
      await supabase.from("loads").update({
        assigned_driver_id: driver.id,
        driver_name: fullDriverName,
        status: load.status === "AVAILABLE" ? "IN_TRANSIT" : load.status,
        status_changed_at: load.status === "AVAILABLE" ? now : undefined,
        updated_at: now,
      }).eq("id", load.id);

      return { 
        success: true, 
        message: `Assigned ${fullDriverName} to ${load.reference}`,
        load_reference: load.reference,
        driver_name: fullDriverName
      };
    }

    case "deliver": {
      const loadRef = action.load_reference?.toUpperCase() || "";
      const load = loads.find(l => l.reference.includes(loadRef) || loadRef.includes(l.reference));
      
      if (!load) {
        return { success: false, error: `Load "${action.load_reference}" not found` };
      }

      await supabase.from("loads").update({
        status: "DELIVERED",
        delivered_at: now,
        pod_status: "PENDING",
        updated_at: now,
        status_changed_at: now,
      }).eq("id", load.id);

      return { 
        success: true, 
        message: `Marked ${load.reference} as DELIVERED. POD is pending.${load.driver_name ? ` ${load.driver_name} is still assigned until POD confirmed.` : ''}`,
        load_reference: load.reference
      };
    }

    case "pod_received": {
      const loadRef = action.load_reference?.toUpperCase() || "";
      const load = loads.find(l => l.reference.includes(loadRef) || loadRef.includes(l.reference));
      
      if (!load) {
        return { success: false, error: `Load "${action.load_reference}" not found` };
      }

      // Update load
      await supabase.from("loads").update({
        pod_status: "RECEIVED",
        pod_uploaded_at: now,
        assigned_driver_id: null,
        driver_name: null,
        updated_at: now,
      }).eq("id", load.id);

      // Free driver if assigned
      if (load.assigned_driver_id) {
        await supabase.from("drivers").update({ status: "ACTIVE" }).eq("id", load.assigned_driver_id);
        
        // Close assignment record
        await supabase.from("load_driver_assignments")
          .update({ unassigned_at: now })
          .eq("load_id", load.id)
          .is("unassigned_at", null);
      }

      return { 
        success: true, 
        message: `POD confirmed for ${load.reference}.${load.driver_name ? ` ${load.driver_name} is now AVAILABLE.` : ''}`,
        load_reference: load.reference
      };
    }

    case "release_driver": {
      const loadRef = action.load_reference?.toUpperCase() || "";
      const load = loads.find(l => l.reference.includes(loadRef) || loadRef.includes(l.reference));
      
      if (!load) {
        return { success: false, error: `Load "${action.load_reference}" not found` };
      }

      const driverName = load.driver_name;

      // Clear assignment on load but keep POD pending
      await supabase.from("loads").update({
        assigned_driver_id: null,
        driver_name: null,
        updated_at: now,
      }).eq("id", load.id);

      // Free driver
      if (load.assigned_driver_id) {
        await supabase.from("drivers").update({ status: "ACTIVE" }).eq("id", load.assigned_driver_id);
        
        await supabase.from("load_driver_assignments")
          .update({ unassigned_at: now })
          .eq("load_id", load.id)
          .is("unassigned_at", null);
      }

      return { 
        success: true, 
        message: `Released ${driverName || 'driver'} from ${load.reference}. Note: POD still pending.`,
        load_reference: load.reference
      };
    }

    case "problem": {
      const loadRef = action.load_reference?.toUpperCase() || "";
      const load = loads.find(l => l.reference.includes(loadRef) || loadRef.includes(l.reference));
      
      if (!load) {
        return { success: false, error: `Load "${action.load_reference}" not found` };
      }

      await supabase.from("loads").update({
        status: "PROBLEM",
        problem_flag: true,
        problem_note: action.reason || "Issue reported via Telegram",
        problem_flagged_at: now,
        at_risk: true,
        updated_at: now,
        status_changed_at: now,
      }).eq("id", load.id);

      return { 
        success: true, 
        message: `Flagged ${load.reference} as PROBLEM: ${action.reason || 'Issue reported'}`,
        load_reference: load.reference
      };
    }

    case "create_load": {
      const loadNumber = `LD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;

      const { data: newLoad, error } = await supabase.from("loads").insert({
        org_id: orgId,
        reference: loadNumber,
        load_number: loadNumber,
        origin: action.origin,
        destination: action.destination,
        rate: action.rate,
        pickup_date: action.pickup_date,
        delivery_date: action.delivery_date,
        shipper: action.shipper || "Unknown shipper",
        equipment_type: action.equipment_type || "Dry van",
        status: "AVAILABLE",
        pod_status: "NONE",
        created_at: now,
        updated_at: now,
        status_changed_at: now,
      }).select().single();

      if (error) {
        return { success: false, error: `Failed to create load: ${error.message}` };
      }

      return { 
        success: true, 
        message: `Created ${loadNumber}: ${action.origin} → ${action.destination}, $${action.rate}, pickup ${action.pickup_date}`,
        load_reference: loadNumber
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action.action}` };
  }
}

// ============================================================================
// CREATE LOAD FROM OCR DATA
// ============================================================================

async function createLoadFromOCR(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  ocrData: any
): Promise<{ reference: string; origin: string; destination: string; rate: number }> {
  
  const now = new Date().toISOString();
  
  // Generate load number if not provided
  const loadNumber = ocrData.reference || ocrData.load_number || 
    `LD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;

  // Build origin string
  let origin = ocrData.origin;
  if (!origin && ocrData.pickup_address) {
    const pa = ocrData.pickup_address;
    origin = [pa.company_name, pa.address, `${pa.city}, ${pa.state} ${pa.zip}`]
      .filter(Boolean).join(", ");
  }
  if (!origin && ocrData.stops) {
    const pickup = ocrData.stops.find((s: any) => s.type === "pickup");
    if (pickup) {
      origin = `${pickup.city}, ${pickup.state}`;
    }
  }

  // Build destination string
  let destination = ocrData.destination;
  if (!destination && ocrData.delivery_address) {
    const da = ocrData.delivery_address;
    destination = [da.company_name, da.address, `${da.city}, ${da.state} ${da.zip}`]
      .filter(Boolean).join(", ");
  }
  if (!destination && ocrData.stops) {
    const delivery = ocrData.stops.find((s: any) => s.type === "delivery");
    if (delivery) {
      destination = `${delivery.city}, ${delivery.state}`;
    }
  }

  // Parse pickup/delivery addresses for city/state
  let originCity = ocrData.pickup_address?.city;
  let originState = ocrData.pickup_address?.state;
  let destCity = ocrData.delivery_address?.city;
  let destState = ocrData.delivery_address?.state;

  if (!originCity && ocrData.stops) {
    const pickup = ocrData.stops.find((s: any) => s.type === "pickup");
    if (pickup) {
      originCity = pickup.city;
      originState = pickup.state;
    }
  }

  if (!destCity && ocrData.stops) {
    const delivery = ocrData.stops.find((s: any) => s.type === "delivery");
    if (delivery) {
      destCity = delivery.city;
      destState = delivery.state;
    }
  }

  // Map equipment type
  const equipmentMap: Record<string, string> = {
    "DRY_VAN": "DRY_VAN",
    "REEFER": "REEFER",
    "FLATBED": "FLATBED",
    "STEP_DECK": "STEP_DECK",
    "LOWBOY": "LOWBOY",
    "POWER_ONLY": "POWER_ONLY",
    "BOX_TRUCK": "BOX_TRUCK",
  };
  const equipmentType = equipmentMap[ocrData.equipment_type?.toUpperCase()] || "DRY_VAN";

  // Clean rate
  const rate = typeof ocrData.rate === "string" 
    ? parseFloat(ocrData.rate.replace(/[$,]/g, "")) 
    : (ocrData.rate || 0);

  const loadData = {
    org_id: orgId,
    reference: loadNumber,
    load_number: loadNumber,
    ref_no: loadNumber,
    
    status: "AVAILABLE",
    pod_status: "NONE",
    
    // Broker info
    broker_name: ocrData.broker_name || ocrData.broker?.name || null,
    broker: ocrData.broker_name || ocrData.broker?.name || null,
    customer: ocrData.broker_name || ocrData.broker?.name || null,
    
    // Locations
    origin: origin || "Unknown",
    origin_city: originCity || null,
    origin_state: originState || null,
    destination: destination || "Unknown",
    dest_city: destCity || null,
    dest_state: destState || null,
    
    // Shipper/consignee
    shipper_name: ocrData.pickup_address?.company_name || null,
    shipper: ocrData.pickup_address?.company_name || null,
    consignee_name: ocrData.delivery_address?.company_name || null,
    
    // Dates/times
    pickup_date: ocrData.pickup_date || null,
    pickup_time: ocrData.pickup_time || null,
    delivery_date: ocrData.delivery_date || null,
    delivery_time: ocrData.delivery_time || null,
    
    // Load details
    commodity: ocrData.commodity || null,
    equipment_type: equipmentType,
    weight: ocrData.weight ? parseFloat(String(ocrData.weight).replace(/,/g, "")) : null,
    miles: ocrData.miles ? parseFloat(String(ocrData.miles).replace(/,/g, "")) : null,
    
    // Financial
    rate: rate,
    
    // Special instructions
    special_instructions: ocrData.special_instructions || null,
    notes: ocrData.special_instructions || null,
    
    // Contact info
    shipper_contact_phone: ocrData.broker?.phone || null,
    shipper_contact_email: ocrData.broker?.email || null,
    
    // Timestamps
    created_at: now,
    updated_at: now,
    status_changed_at: now,
  };

  console.log("[telegram-hook] Creating load from OCR:", loadNumber);

  const { data: newLoad, error } = await supabase
    .from("loads")
    .insert(loadData)
    .select()
    .single();

  if (error) {
    console.error("[telegram-hook] Load insert error:", error);
    
    // Check for duplicate
    if (error.code === "23505") {
      // Return existing load reference
      const { data: existing } = await supabase
        .from("loads")
        .select("reference, origin, destination, rate")
        .eq("org_id", orgId)
        .eq("reference", loadNumber)
        .single();
      
      if (existing) {
        return existing;
      }
    }
    
    // Check if it's a trigger error (load might still have been created)
    if (error.message?.includes("ai_prediction_runs") || error.message?.includes("trigger")) {
      // Try to fetch the load we just created
      const { data: createdLoad } = await supabase
        .from("loads")
        .select("reference, origin, destination, rate")
        .eq("org_id", orgId)
        .eq("reference", loadNumber)
        .single();
      
      if (createdLoad) {
        console.log("[telegram-hook] Load created despite trigger error:", loadNumber);
        return createdLoad;
      }
    }
    
    throw new Error(`Failed to create load: ${error.message}`);
  }

  return {
    reference: newLoad.reference,
    origin: newLoad.origin,
    destination: newLoad.destination,
    rate: newLoad.rate,
  };
}

// ============================================================================
// TELEGRAM API HELPERS
// ============================================================================

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      // No parse_mode - plain text avoids markdown parsing errors
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[telegram-hook] Send message error:", error);
  }
}

async function sendTelegramAction(chatId: number, action: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      action: action,
    }),
  });
}