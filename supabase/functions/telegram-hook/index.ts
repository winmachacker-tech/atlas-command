// FILE: supabase/functions/telegram-hook/index.ts
//
// Telegram Bot Webhook Handler for Atlas Command
//
// This Edge Function:
//   1. Receives inbound Telegram messages (POST from Telegram)
//   2. Looks up sender in whatsapp_contacts by telegram_chat_id
//   3. Retrieves/creates conversation_state for the sender
//   4. Routes knowledge questions to questions-brain (RAG)
//   5. Routes operational questions to callDipsyText (actions)
//   6. Sends Dipsy's response back via Telegram API
//   7. Logs everything to whatsapp_messages AND dipsy_interaction_log
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
// KNOWLEDGE QUESTION DETECTION
// ============================================================================

// Patterns that indicate a KNOWLEDGE question (should use RAG)
const KNOWLEDGE_PATTERNS = [
  // "What is X" questions
  /^what\s+(is|are|does|do)\s+(a|an|the)?\s*\w+/i,
  /^what'?s\s+(a|an|the)?\s*\w+/i,
  // "How do I" / "How does" questions
  /^how\s+(do|does|can|should|would)\s+(i|you|we|it|atlas|dipsy)/i,
  /^how\s+to\s+/i,
  // "Can I" / "Can Dipsy" questions
  /^can\s+(i|you|we|dipsy|atlas)\s+/i,
  // "Tell me about" / "Explain"
  /^(tell\s+me\s+about|explain|describe|define)\s+/i,
  // "Why" questions about concepts
  /^why\s+(is|are|does|do|should|would)\s+/i,
  // Help and documentation requests
  /^(help|help\s+me|i\s+need\s+help)\s*(with|understanding|about)?/i,
  /^(what|where)\s+(is|are)\s+(the\s+)?(documentation|docs|help|guide|manual)/i,
  // Feature questions
  /^(does|do)\s+(atlas|dipsy|the\s+system|it)\s+(have|support|allow|offer)/i,
  /^(is|are)\s+there\s+(a|any)\s+(way|feature|option)/i,
  // Terminology questions
  /^what\s+does\s+.+\s+mean/i,
  /^(what|who)\s+is\s+(a|an)\s+(driver|load|truck|bol|pod|rate\s*con|hos|eld)/i,
  // "How does X work"
  /^how\s+does\s+.+\s+work/i,
  // FAQ-style questions
  /^(faq|frequently\s+asked)/i,
  // Policy questions
  /^what\s+(is|are)\s+(the|our|your)\s+(policy|rule|procedure)/i,
];

// Patterns that indicate an OPERATIONAL question (should use callDipsyText)
const OPERATIONAL_PATTERNS = [
  // Load references
  /LD-\d{4}-\d+/i,
  // Action commands
  /^(assign|dispatch|book|pick\s*up|deliver|complete|cancel|update)\s/i,
  // Status updates
  /^(i'?m\s+)?(at\s+pickup|at\s+delivery|picked\s*up|delivered|in\s*transit|on\s+my\s+way)/i,
  // Load queries with action intent
  /^(show|list|find|get)\s+(me\s+)?(my\s+)?(current|active|available|open|next)\s+(load|assignment)/i,
  // Numeric selections (responding to a list)
  /^[1-9]$/,
  /^(select|choose|pick|take)\s+[1-9]/i,
  // Yes/No confirmations
  /^(yes|no|yeah|nope|yep|nah|confirm|cancel|approve|reject)$/i,
  // POD/document uploads
  /^(upload|send|submit|here'?s?)\s+(the\s+)?(pod|bol|document|photo|pic)/i,
  // Issue reporting
  /^(i\s+have\s+a\s+)?(problem|issue|trouble|breakdown|accident|delay)/i,
  // ETA updates
  /^(eta|arrival|arriving)\s/i,
  /^(i'?ll?\s+be\s+there|be\s+there)\s+(in|at|around)/i,
  // Rate con confirmations
  /^(accept|confirm|take|book)\s+(this|the|that)?\s*(load|rate\s*con|shipment)?$/i,
];

function isKnowledgeQuestion(message: string): boolean {
  const text = message.trim();
  
  // First check if it matches operational patterns - those take priority
  for (const pattern of OPERATIONAL_PATTERNS) {
    if (pattern.test(text)) {
      return false;
    }
  }
  
  // Then check if it matches knowledge patterns
  for (const pattern of KNOWLEDGE_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  // Default to operational (callDipsyText handles unknown gracefully)
  return false;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Telegram sends updates in this format
    const message = body.message;
    if (!message) {
      console.log("[telegram-hook] No message in update, ignoring");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const chatId = message.chat?.id;
    const text = message.text?.trim();
    const photo = message.photo;
    const fromUser = message.from;

    if (!chatId) {
      console.log("[telegram-hook] No chat ID, ignoring");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Create admin client
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up the contact by telegram_chat_id
    const { data: contact, error: contactError } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("id, org_id, display_name, driver_id, telegram_chat_id")
      .eq("telegram_chat_id", String(chatId))
      .maybeSingle();

    if (contactError) {
      console.error("[telegram-hook] Contact lookup error:", contactError);
    }

    // If no contact found, send onboarding message
    if (!contact) {
      await sendTelegramMessage(
        chatId,
        "Hi! I'm Dipsy, your AI dispatch assistant. I don't recognize this Telegram account yet.\n\n" +
        "Please ask your dispatcher to link your Telegram account in Atlas Command."
      );
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const orgId = contact.org_id;
    const contactId = contact.id;
    const driverId = contact.driver_id;
    const senderName = contact.display_name || fromUser?.first_name || "Driver";

    // Handle photo messages (POD uploads)
    if (photo && photo.length > 0) {
      await handlePhotoUpload(supabaseAdmin, chatId, photo, orgId, contactId, driverId, senderName);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Handle text messages
    if (text) {
      await handleTextMessage(supabaseAdmin, chatId, text, orgId, contactId, driverId, senderName);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[telegram-hook] Unhandled error:", err);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
});

// ============================================================================
// TEXT MESSAGE HANDLER WITH INTELLIGENT ROUTING
// ============================================================================

async function handleTextMessage(
  supabaseAdmin: ReturnType<typeof createClient>,
  chatId: number,
  text: string,
  orgId: string,
  contactId: string,
  driverId: string | null,
  senderName: string
): Promise<void> {
  // Log inbound message
  await logMessage(supabaseAdmin, orgId, contactId, text, "inbound", "telegram");

  // Send typing indicator
  await sendTelegramAction(chatId, "typing");

  // Get conversation state
  const state = await getConversationState(supabaseAdmin, contactId);

  let response: string;
  let agentType: string;

  // Check if we have a pending rate con confirmation
  if (state?.pending_rate_con) {
    // Always use operational brain for pending confirmations
    response = await callDipsyText(supabaseAdmin, orgId, contactId, driverId, senderName, text, state);
    agentType = "dipsy-text";
  } else if (isKnowledgeQuestion(text)) {
    // Knowledge question -> questions-brain (RAG)
    console.log("[telegram-hook] Routing to questions-brain:", text.substring(0, 50));
    const result = await callQuestionsBrain(orgId, senderName, text);
    response = result.answer;
    agentType = "questions-brain";
    
    // If questions-brain couldn't answer, fallback to operational
    if (response.includes("don't have enough documentation") || 
        response.includes("docs don't cover")) {
      console.log("[telegram-hook] questions-brain fallback to dipsy-text");
      response = await callDipsyText(supabaseAdmin, orgId, contactId, driverId, senderName, text, state);
      agentType = "dipsy-text";
    }
  } else {
    // Operational question -> dipsy-text
    console.log("[telegram-hook] Routing to dipsy-text:", text.substring(0, 50));
    response = await callDipsyText(supabaseAdmin, orgId, contactId, driverId, senderName, text, state);
    agentType = "dipsy-text";
  }

  // Log interaction for evaluation pipeline
  await logInteraction(supabaseAdmin, {
    org_id: orgId,
    user_id: driverId,
    channel: "telegram",
    agent_type: agentType,
    question: text,
    answer: response,
  });

  // Send response
  await sendTelegramMessage(chatId, response);

  // Log outbound message
  await logMessage(supabaseAdmin, orgId, contactId, response, "outbound", "telegram");
}

// ============================================================================
// QUESTIONS-BRAIN CALLER (RAG)
// ============================================================================

interface QuestionsBrainResult {
  ok: boolean;
  answer: string;
  sources?: any;
  meta?: any;
}

async function callQuestionsBrain(
  orgId: string,
  userName: string,
  question: string
): Promise<QuestionsBrainResult> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/questions-brain`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        question,
        org_id: orgId,
        channel: "telegram",
        user_name: userName,
      }),
    });

    if (!response.ok) {
      console.error("[telegram-hook] questions-brain error:", await response.text());
      return {
        ok: false,
        answer: "I'm having trouble accessing my knowledge base right now. Let me try to help another way.",
      };
    }

    const data = await response.json();
    return {
      ok: data.ok ?? true,
      answer: data.answer ?? "I couldn't find an answer to that question.",
      sources: data.sources,
      meta: data.meta,
    };
  } catch (err) {
    console.error("[telegram-hook] questions-brain fetch error:", err);
    return {
      ok: false,
      answer: "I'm having trouble right now. Please try again in a moment.",
    };
  }
}

// ============================================================================
// DIPSY-TEXT CALLER (OPERATIONAL)
// ============================================================================

async function callDipsyText(
  supabaseAdmin: ReturnType<typeof createClient>,
  orgId: string,
  contactId: string,
  driverId: string | null,
  senderName: string,
  message: string,
  state: any
): Promise<string> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/dipsy-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        org_id: orgId,
        contact_id: contactId,
        driver_id: driverId,
        sender_name: senderName,
        message: message,
        channel: "telegram",
        conversation_state: state,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[telegram-hook] dipsy-text error:", errorText);
      return "I'm having trouble processing that right now. Please try again.";
    }

    const data = await response.json();
    
    // Update conversation state if returned
    if (data.conversation_state) {
      await updateConversationState(supabaseAdmin, contactId, orgId, data.conversation_state);
    }

    return data.answer || data.response || data.message || "I couldn't process that request.";
  } catch (err) {
    console.error("[telegram-hook] dipsy-text fetch error:", err);
    return "I'm having trouble right now. Please try again in a moment.";
  }
}

// ============================================================================
// PHOTO UPLOAD HANDLER
// ============================================================================

async function handlePhotoUpload(
  supabaseAdmin: ReturnType<typeof createClient>,
  chatId: number,
  photos: any[],
  orgId: string,
  contactId: string,
  driverId: string | null,
  senderName: string
): Promise<void> {
  await sendTelegramAction(chatId, "typing");

  // Get the largest photo (last in array)
  const photo = photos[photos.length - 1];
  const fileId = photo.file_id;

  try {
    // Get file path from Telegram
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResponse.json();

    if (!fileData.ok) {
      await sendTelegramMessage(chatId, "I couldn't process that photo. Please try again.");
      return;
    }

    const filePath = fileData.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

    // Download the file
    const imageResponse = await fetch(fileUrl);
    const imageBlob = await imageResponse.blob();

    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `telegram_${chatId}_${timestamp}.jpg`;
    const storagePath = `${orgId}/pod/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from("documents")
      .upload(storagePath, imageBlob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("[telegram-hook] Storage upload error:", uploadError);
      await sendTelegramMessage(chatId, "I couldn't save that photo. Please try again.");
      return;
    }

    // Get conversation state to check for pending load
    const state = await getConversationState(supabaseAdmin, contactId);

    if (state?.current_load_id) {
      // Associate POD with the load
      const { error: podError } = await supabaseAdmin
        .from("load_documents")
        .insert({
          load_id: state.current_load_id,
          org_id: orgId,
          document_type: "pod",
          storage_path: storagePath,
          uploaded_by: driverId,
          file_name: fileName,
        });

      if (podError) {
        console.error("[telegram-hook] POD insert error:", podError);
      }

      await sendTelegramMessage(
        chatId,
        `Got it, ${senderName}! I've saved the POD photo for your current load. Is there anything else you need?`
      );
    } else {
      await sendTelegramMessage(
        chatId,
        `Thanks ${senderName}! I've saved the photo. Which load should I attach this to? You can say something like "attach to LD-2025-0001".`
      );
    }

    // Log the interaction
    await logInteraction(supabaseAdmin, {
      org_id: orgId,
      user_id: driverId,
      channel: "telegram",
      agent_type: "telegram-hook",
      question: "[Photo uploaded]",
      answer: "POD photo saved",
    });

  } catch (err) {
    console.error("[telegram-hook] Photo processing error:", err);
    await sendTelegramMessage(chatId, "I had trouble processing that photo. Please try again.");
  }
}

// ============================================================================
// CONVERSATION STATE MANAGEMENT
// ============================================================================

async function getConversationState(
  supabaseAdmin: ReturnType<typeof createClient>,
  contactId: string
): Promise<any> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_conversation_state")
    .select("conversation_state")
    .eq("contact_id", contactId)
    .maybeSingle();

  if (error) {
    console.error("[telegram-hook] Get state error:", error);
    return null;
  }

  return data?.conversation_state || null;
}

async function updateConversationState(
  supabaseAdmin: ReturnType<typeof createClient>,
  contactId: string,
  orgId: string,
  state: any
): Promise<void> {
  // Check if state exists for this contact
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_conversation_state")
    .select("id")
    .eq("contact_id", contactId)
    .maybeSingle();

  if (existing) {
    // Update existing
    const { error } = await supabaseAdmin
      .from("whatsapp_conversation_state")
      .update({
        conversation_state: state,
        updated_at: new Date().toISOString(),
      })
      .eq("contact_id", contactId);

    if (error) {
      console.error("[telegram-hook] Update state error:", error);
    }
  } else {
    // Insert new
    const { error } = await supabaseAdmin
      .from("whatsapp_conversation_state")
      .insert({
        contact_id: contactId,
        org_id: orgId,
        conversation_state: state,
      });

    if (error) {
      console.error("[telegram-hook] Insert state error:", error);
    }
  }
}

// ============================================================================
// LOGGING
// ============================================================================

async function logMessage(
  supabaseAdmin: ReturnType<typeof createClient>,
  orgId: string,
  contactId: string,
  content: string,
  direction: "inbound" | "outbound",
  channel: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("whatsapp_messages")
    .insert({
      org_id: orgId,
      contact_id: contactId,
      sender_phone: channel === "telegram" ? "telegram" : "unknown",
      sender_name: direction === "outbound" ? "Dipsy" : "Driver",
      message_body: content,
      message_type: "text",
      direction: direction,
      is_from_dipsy: direction === "outbound",
      status: direction === "outbound" ? "sent" : "received",
    });

  if (error) {
    console.error("[telegram-hook] Log message error:", error);
  }
}

interface InteractionLog {
  org_id: string;
  user_id: string | null;
  channel: string;
  agent_type: string;
  question: string;
  answer: string;
  tool_calls?: any[];
}

async function logInteraction(
  supabaseAdmin: ReturnType<typeof createClient>,
  log: InteractionLog
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("dipsy_interaction_log")
    .insert({
      org_id: log.org_id,
      user_id: log.user_id,
      channel: log.channel,
      agent_type: log.agent_type,
      question: log.question,
      answer: log.answer,
      tool_calls: log.tool_calls || [],
    });

  if (error) {
    console.error("[telegram-hook] Log interaction error:", error);
  }
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
