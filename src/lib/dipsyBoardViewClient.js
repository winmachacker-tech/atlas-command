// FILE: src/lib/dipsyBoardViewClient.js
//
// Purpose
// -------
// Single client for talking to the `dipsy-board-view` Edge Function.
// This returns the *same* truth snapshot that Dipsy uses in dipsy-text.
//
// Responsibilities:
// - Get the current Supabase JWT (RLS-safe).
// - POST { scope } to /functions/v1/dipsy-board-view
// - Return summary + loads + drivers in a clean shape for the UI.
//
// Usage
// -----
//   import { fetchBoardSnapshot } from "../lib/dipsyBoardViewClient";
//
//   const res = await fetchBoardSnapshot("dispatcher");
//   if (res.ok) {
//     console.log(res.summary, res.loads, res.drivers);
//   } else {
//     console.error(res.error);
//
// Scopes
// ------
//  "dispatcher"  → AVAILABLE + IN_TRANSIT + PROBLEM + DELIVERED (POD != RECEIVED)
//  "active_only" → AVAILABLE + IN_TRANSIT + PROBLEM
//  "all"         → all loads for org

import { supabase } from "./supabase";

/**
 * Fetch the board snapshot from the dipsy-board-view Edge Function.
 *
 * @param {"dispatcher" | "active_only" | "all"} scope
 * @returns {Promise<{
 *   ok: boolean;
 *   error?: string;
 *   org_id?: string;
 *   scope?: string;
 *   summary?: any;
 *   loads?: any[];
 *   drivers?: any[];
 * }>}
 */
export async function fetchBoardSnapshot(scope = "dispatcher") {
  // 1) Ensure we have a valid session (for Authorization header).
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    console.error("[dipsyBoardViewClient] getSession error:", sessionError);
    return {
      ok: false,
      error: "Could not read your login session. Please sign in again.",
    };
  }

  if (!session || !session.access_token) {
    return {
      ok: false,
      error: "You must be signed in to view the board snapshot.",
    };
  }

  const accessToken = session.access_token;

  const supabaseUrl = supabase.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("[dipsyBoardViewClient] Missing Supabase URL.");
    return {
      ok: false,
      error: "Supabase URL is not configured in the frontend.",
    };
  }

  const functionUrl = `${supabaseUrl}/functions/v1/dipsy-board-view`;

  const body = { scope };

  if (import.meta.env.DEV) {
    console.info("[dipsyBoardViewClient] → Request", body);
  }

  let response;
  try {
    response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(
      "[dipsyBoardViewClient] Network error calling dipsy-board-view:",
      err
    );
    return {
      ok: false,
      error:
        "Could not reach board snapshot right now. Check your internet connection and try again.",
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error(
      "[dipsyBoardViewClient] Failed to parse JSON from dipsy-board-view:",
      err
    );
    return {
      ok: false,
      error: "Board snapshot returned an invalid response. Please try again.",
    };
  }

  if (!response.ok || !data.ok) {
    const errorMessage =
      data?.error ||
      `dipsy-board-view function failed with status ${response.status}.`;

    console.error(
      "[dipsyBoardViewClient] Error response from dipsy-board-view:",
      data
    );

    return {
      ok: false,
      error: errorMessage,
    };
  }

  if (import.meta.env.DEV) {
    console.info("[dipsyBoardViewClient] ← Response", {
      org_id: data.org_id,
      scope: data.scope,
      summary: data.summary,
    });
  }

  return {
    ok: true,
    org_id: data.org_id,
    scope: data.scope,
    summary: data.summary,
    loads: data.loads || [],
    drivers: data.drivers || [],
  };
}
