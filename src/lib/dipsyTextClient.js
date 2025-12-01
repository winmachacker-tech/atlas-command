// FILE: src/lib/dipsyTextClient.js
//
// Purpose
// -------
// Single, central client for talking to the Dipsy text Edge Function
// (`supabase/functions/v1/dipsy-text`).
//
// Responsibilities:
// - Get the current Supabase JWT (RLS-safe).
// - Load any saved conversation_state from localStorage.
// - Send `message` + `conversation_state` to the Edge Function.
// - Receive and persist the updated `conversation_state`.
// - Expose a clean `askDipsy(message)` helper the UI can use everywhere.
//
// Exports:
// --------
// 1) sendDipsyTextMessage(message, conversationState?)
//    - Low-level function used by askDipsy.
//    - If conversationState is not provided, it auto-loads from storage.
//
// 2) askDipsy(message)
//    - Preferred helper for the UI.
//    - Just pass the text; it handles state loading/saving internally.
//
// 3) loadDipsyConversationState(orgId?)
//    - Optional helper if you want to inspect the saved state in a component.

import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Local storage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY_LAST = "dipsy_text_conversation_state_last";
const STORAGE_KEY_PREFIX_BY_ORG = "dipsy_text_conversation_state_org_";

// ---------------------------------------------------------------------------
// Helpers: load / save conversation_state
// ---------------------------------------------------------------------------

/**
 * Safely load the last known conversation_state from localStorage.
 * Optionally scoped by orgId.
 *
 * @param {string|null} orgId
 * @returns {Object|null}
 */
export function loadDipsyConversationState(orgId = null) {
  if (typeof window === "undefined") return null;

  try {
    // If orgId is provided, try org-specific key first
    if (orgId) {
      const orgKey = `${STORAGE_KEY_PREFIX_BY_ORG}${orgId}`;
      const orgRaw = window.localStorage.getItem(orgKey);
      if (orgRaw) {
        const parsed = JSON.parse(orgRaw);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      }
    }

    // Fallback to "last" conversation state
    const raw = window.localStorage.getItem(STORAGE_KEY_LAST);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (err) {
    console.warn("[dipsyTextClient] Failed to load conversation_state:", err);
  }

  return null;
}

/**
 * Safely persist conversation_state to localStorage.
 * Saves both:
 *  - last-known (global)
 *  - per-org (if orgId provided)
 *
 * @param {Object} conversationState
 * @param {string|null} orgId
 */
function saveDipsyConversationState(conversationState, orgId = null) {
  if (typeof window === "undefined") return;
  if (!conversationState || typeof conversationState !== "object") return;

  try {
    const serialized = JSON.stringify(conversationState);
    window.localStorage.setItem(STORAGE_KEY_LAST, serialized);

    if (orgId) {
      const orgKey = `${STORAGE_KEY_PREFIX_BY_ORG}${orgId}`;
      window.localStorage.setItem(orgKey, serialized);
    }
  } catch (err) {
    console.warn("[dipsyTextClient] Failed to save conversation_state:", err);
  }
}

// ---------------------------------------------------------------------------
// Core function: send text to Dipsy
// ---------------------------------------------------------------------------

/**
 * Send a text message to Dipsy (text-only, no voice).
 *
 * @param {string} message - What the user typed.
 * @param {Object|null} conversationStateOverride - Optional explicit state to send.
 *        If null/undefined, we will auto-load last known state from localStorage.
 *
 * @returns {Promise<{
 *   ok: boolean;
 *   answer?: string;
 *   error?: string;
 *   org_id?: string;
 *   used_tool?: boolean;
 *   conversation_state?: Object | null;
 * }>}
 */
export async function sendDipsyTextMessage(
  message,
  conversationStateOverride = null
) {
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

  // 2) Determine which conversation_state to send:
  //    - If caller provided one, use that.
  //    - Otherwise, try to load from localStorage.
  const storedState =
    conversationStateOverride !== null && conversationStateOverride !== undefined
      ? conversationStateOverride
      : loadDipsyConversationState(null);

  const supabaseUrl = supabase.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;

  if (!supabaseUrl) {
    console.error("[dipsyTextClient] Missing Supabase URL.");
    return {
      ok: false,
      error: "Supabase URL is not configured in the frontend.",
    };
  }

  const functionUrl = `${supabaseUrl}/functions/v1/dipsy-text`;

  const requestBody = {
    message: cleanMessage,
  };

  if (storedState) {
    requestBody.conversation_state = storedState;
  }

  if (import.meta.env.DEV) {
    console.info("[dipsyTextClient] → Dipsy request", {
      message: cleanMessage,
      hasConversationState: !!storedState,
    });
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
      conversation_state: storedState || null,
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
      conversation_state: storedState || null,
    };
  }

  if (!response.ok || !data.ok) {
    const errorMessage =
      data?.error ||
      `Dipsy text function failed with status ${response.status}.`;

    console.error("[dipsyTextClient] Error response from dipsy-text:", data);

    // Even on error, if we got a new conversation_state, persist it.
    if (data?.conversation_state) {
      saveDipsyConversationState(data.conversation_state, data.org_id || null);
    }

    return {
      ok: false,
      error: errorMessage,
      conversation_state: data?.conversation_state || storedState || null,
    };
  }

  const updatedState = data.conversation_state || storedState || null;

  // Persist updated state (global + org-specific if org_id available)
  saveDipsyConversationState(updatedState, data.org_id || null);

  if (import.meta.env.DEV) {
    console.info("[dipsyTextClient] ← Dipsy response", {
      used_tool: data.used_tool ?? false,
      org_id: data.org_id || null,
      hasConversationState: !!updatedState,
    });
  }

  return {
    ok: true,
    answer: data.answer,
    org_id: data.org_id,
    used_tool: data.used_tool ?? false,
    conversation_state: updatedState,
  };
}

// ---------------------------------------------------------------------------
// High-level helper for the UI
// ---------------------------------------------------------------------------

/**
 * High-level helper for the UI:
 * - You only pass the message.
 * - It automatically loads the last conversation_state from storage,
 *   sends it, and saves the updated state when the response comes back.
 *
 * @param {string} message
 * @returns {Promise<{
 *   ok: boolean;
 *   answer?: string;
 *   error?: string;
 *   org_id?: string;
 *   used_tool?: boolean;
 *   conversation_state?: Object | null;
 * }>}
 */
export async function askDipsy(message) {
  return sendDipsyTextMessage(message, null);
}
