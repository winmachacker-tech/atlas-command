// FILE: src/lib/dipsyTextClient.js
//
// Purpose:
// --------
// Provides a simple function for the React app to talk to Dipsy:
//
//   sendDipsyTextMessage(message, conversationState?) -> Promise<{ ok, answer, conversation_state, ... }>
//
// Key features:
// - Passes conversation_state to the Edge Function for context memory
// - Returns updated conversation_state to be stored and passed on next call
// - Uses user's JWT for auth (RLS-safe)
//
// How to use:
// -----------
// import { sendDipsyTextMessage } from "../lib/dipsyTextClient";
//
// // First message (no state yet)
// const result1 = await sendDipsyTextMessage("Create a load from Sacramento to Seattle");
// setConversationState(result1.conversation_state);
//
// // Follow-up message (pass previous state)
// const result2 = await sendDipsyTextMessage("Assign Black Panther to that load", conversationState);
// setConversationState(result2.conversation_state);

import { supabase } from "./supabase";

/**
 * Send a text message to Dipsy (text-only, no voice).
 *
 * @param {string} message - What the user typed
 * @param {Object|null} conversationState - Previous conversation state (for context memory)
 * @returns {Promise<{
 *   ok: boolean;
 *   answer?: string;
 *   error?: string;
 *   org_id?: string;
 *   used_tool?: boolean;
 *   conversation_state?: Object;
 * }>}
 */
export async function sendDipsyTextMessage(message, conversationState = null) {
  const cleanMessage = (message ?? "").toString().trim();

  if (!cleanMessage) {
    return {
      ok: false,
      error: "Message cannot be empty.",
    };
  }

  // 1) Get the current Supabase session (user JWT).
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    console.error("[dipsyTextClient] getSession error:", sessionError);
    return {
      ok: false,
      error: "Could not read your login session. Please sign in again.",
    };
  }

  if (!session || !session.access_token) {
    return {
      ok: false,
      error: "You must be signed in to talk to Dipsy.",
    };
  }

  const accessToken = session.access_token;

  // 2) Call the Supabase Edge Function /functions/v1/dipsy-text
  const supabaseUrl = supabase.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;

  if (!supabaseUrl) {
    console.error("[dipsyTextClient] Missing Supabase URL.");
    return {
      ok: false,
      error: "Supabase URL is not configured in the frontend.",
    };
  }

  const functionUrl = `${supabaseUrl}/functions/v1/dipsy-text`;

  // Build request body - include conversation_state if we have it
  const requestBody = {
    message: cleanMessage,
  };

  // IMPORTANT: Pass conversation_state for context memory
  if (conversationState) {
    requestBody.conversation_state = conversationState;
  }

  let response;
  try {
    response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    console.error("[dipsyTextClient] Network error calling dipsy-text:", err);
    return {
      ok: false,
      error:
        "Could not reach Dipsy right now. Check your internet connection and try again.",
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error("[dipsyTextClient] Failed to parse JSON from dipsy-text:", err);
    return {
      ok: false,
      error: "Dipsy returned an invalid response. Please try again.",
    };
  }

  if (!response.ok || !data.ok) {
    const errorMessage =
      data?.error ||
      `Dipsy text function failed with status ${response.status}.`;

    console.error("[dipsyTextClient] Error response from dipsy-text:", data);
    return {
      ok: false,
      error: errorMessage,
      // Still return conversation_state if present, so we don't lose context on errors
      conversation_state: data?.conversation_state || conversationState,
    };
  }

  // Success - return answer AND updated conversation_state
  return {
    ok: true,
    answer: data.answer,
    org_id: data.org_id,
    used_tool: data.used_tool ?? false,
    // CRITICAL: Return the updated conversation_state for the next call
    conversation_state: data.conversation_state || null,
  };
}