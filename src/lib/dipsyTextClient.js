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
// - Expose a clean helpers the UI can use everywhere.
//
// Exports:
// --------
// 1) sendDipsyTextMessage(message, conversationStateOverride?, orgIdOverride?)
//    - Low-level function used by askDipsy.
//    - If conversationStateOverride is not provided, it auto-loads from storage.
//    - If orgIdOverride is provided, it will use org-specific stored state.
//
// 2) askDipsy(message, conversationStateOverride?, orgIdOverride?)
//    - Preferred helper for the UI.
//    - Just pass the text, and optionally the current conversation_state and orgId.
//    - Handles state loading/saving internally.
//
// 3) loadDipsyConversationState(orgId?)
//    - Optional helper if you want to inspect the saved state in a component.

import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Local storage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY_LAST = "dipsy_text_conversation_state_last";
const STORAGE_KEY_PREFIX_BY_ORG = "dipsy_text_conversation_state_org_";

// Limit how many messages we keep in conversationHistory to avoid huge blobs.
const MAX_HISTORY_MESSAGES = 40;

// ---------------------------------------------------------------------------
// Helpers: trim / load / save conversation_state
// ---------------------------------------------------------------------------

/**
 * Trim conversation_state so it doesn't grow forever.
 * - Keeps only the last MAX_HISTORY_MESSAGES items in conversationHistory.
 */
function trimConversationState(conversationState) {
  if (!conversationState || typeof conversationState !== "object") {
    return conversationState;
  }

  const trimmed = { ...conversationState };

  if (Array.isArray(trimmed.conversationHistory)) {
    const history = trimmed.conversationHistory;
    if (history.length > MAX_HISTORY_MESSAGES) {
      trimmed.conversationHistory = history.slice(-MAX_HISTORY_MESSAGES);
    }
  }

  return trimmed;
}

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
    // If orgId is provided, try org-specific key first.
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

    // Fallback to "last" conversation state.
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
 * Also trims history so it doesn't become huge.
 *
 * @param {Object} conversationState
 * @param {string|null} orgId
 */
function saveDipsyConversationState(conversationState, orgId = null) {
  if (typeof window === "undefined") return;
  if (!conversationState || typeof conversationState !== "object") return;

  try {
    const trimmed = trimConversationState(conversationState);
    const serialized = JSON.stringify(trimmed);
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
 * @param {Object|null|undefined} conversationStateOverride
 *        - Explicit conversation_state to send (e.g. from React state).
 *        - If null/undefined, we will auto-load last known state from localStorage.
 * @param {string|null|undefined} orgIdOverride
 *        - Optional orgId to scope loading/saving state.
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
  conversationStateOverride = null,
  orgIdOverride = null
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
  //    - Otherwise, try to load from localStorage (optionally scoped by org).
  const storedState =
    conversationStateOverride !== null &&
    conversationStateOverride !== undefined
      ? conversationStateOverride
      : loadDipsyConversationState(orgIdOverride || null);

  const supabaseUrl =
    // @ts-ignore - supabase client may not expose supabaseUrl in typings
    supabase.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;

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
      conversationStateSample: storedState
        ? JSON.stringify(storedState).slice(0, 200)
        : null,
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
      saveDipsyConversationState(
        data.conversation_state,
        data.org_id || orgIdOverride || null
      );
    }

    return {
      ok: false,
      error: errorMessage,
      conversation_state: data?.conversation_state || storedState || null,
    };
  }

  const updatedState = data.conversation_state || storedState || null;
  const effectiveOrgId = data.org_id || orgIdOverride || null;

  // Persist updated state (global + org-specific if org_id available)
  saveDipsyConversationState(updatedState, effectiveOrgId);

  if (import.meta.env.DEV) {
    console.info("[dipsyTextClient] ← Dipsy response", {
      used_tool: data.used_tool ?? false,
      org_id: data.org_id || null,
      hasConversationState: !!updatedState,
      conversationStateSample: updatedState
        ? JSON.stringify(updatedState).slice(0, 200)
        : null,
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
 * High-level helper for the UI.
 *
 * Usage options:
 *  - askDipsy("message")
 *      → auto-loads last state from localStorage.
 *
 *  - askDipsy("message", conversationStateFromUI)
 *      → uses your current in-memory state.
 *
 *  - askDipsy("message", conversationStateFromUI, currentOrgId)
 *      → uses your state and saves per-org.
 *
 * @param {string} message
 * @param {Object|null|undefined} conversationStateOverride
 * @param {string|null|undefined} orgIdOverride
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
export async function askDipsy(
  message,
  conversationStateOverride = null,
  orgIdOverride = null
) {
  return sendDipsyTextMessage(message, conversationStateOverride, orgIdOverride);
}
