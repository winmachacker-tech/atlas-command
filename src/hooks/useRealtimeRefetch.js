// FILE: src/hooks/useSupabaseRealtime.js
// Purpose: Safe, single-subscription Supabase Realtime hook with strict-mode + duplicate guards.
// Usage example (in a component):
//   useSupabaseRealtime({
//     table: "driver_feedback",
//     schema: "public",
//     events: ["INSERT", "UPDATE", "DELETE"],  // or ["*"]
//     filter: { column: "driver_id", op: "eq", value: driverId }, // optional
//     onInsert: (payload) => { /* refresh or optimistic apply */ },
//     onUpdate: (payload) => { /* refresh or optimistic apply */ },
//     onDelete: (payload) => { /* refresh or optimistic apply */ },
//     onAny:    (payload) => { /* fallback if you prefer one handler */ },
//     onStatus: (status) => { /* "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" */ },
//     autoRefetch: async () => { /* optional: re-run your query after subscribe + on events */ },
//     log: false,
//   });

import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

/** Build a stable channel name so we don't spawn duplicates */
function makeChannelName({ schema, table, events, filter }) {
  const ev = (events && events.length ? events : ["*"]).join("|");
  const fil = filter
    ? `${filter.column || ""}:${filter.op || ""}:${String(filter.value ?? "")}`
    : "nofilter";
  return `realtime:${schema || "public"}:${table}:${ev}:${fil}`;
}

/** Convert a simple filter description to Supabase filter string */
function toFilterString(filter) {
  if (!filter) return undefined;
  const op = filter.op || "eq";
  const col = filter.column;
  if (!col || typeof filter.value === "undefined") return undefined;
  return `${col}=${op}.${filter.value}`;
}

/** Guard to avoid duplicate effect runs in Strict Mode */
function useStrictModeGuard() {
  const ranRef = useRef(false);
  const shouldRun = !ranRef.current;
  useEffect(() => {
    ranRef.current = true;
  }, []);
  return shouldRun;
}

/** Try to remove any pre-existing duplicate channels with the same name */
function removeDuplicateChannels(channelName, log = false) {
  try {
    const channels = supabase.getChannels?.() || [];
    for (const ch of channels) {
      // Topic is the channel's internal name. Match exactly.
      if (ch.topic === channelName) {
        if (log) console.debug("[Realtime] removing duplicate channel", channelName);
        // Prefer removeChannel (v2) if available; fallback to unsubscribe.
        if (typeof supabase.removeChannel === "function") {
          supabase.removeChannel(ch);
        } else if (typeof ch.unsubscribe === "function") {
          ch.unsubscribe();
        }
      }
    }
  } catch (_) {
    // ignore
  }
}

/**
 * Main hook
 */
export default function useSupabaseRealtime({
  schema = "public",
  table,
  events = ["*"], // ["INSERT","UPDATE","DELETE"] or ["*"]
  filter,         // { column, op: "eq"|"neq"|... , value }
  onInsert,
  onUpdate,
  onDelete,
  onAny,           // optional single handler for all events
  onStatus,        // optional status callback
  autoRefetch,     // optional async function to refetch after subscribe and on each event
  log = false,     // set true to console.debug connection details
}) {
  const channelRef = useRef(null);
  const allowFirstRun = useStrictModeGuard();

  useEffect(() => {
    if (!table) return;
    if (!allowFirstRun) {
      // In React Strict Mode dev, effects mount twice; skip the second.
      return;
    }

    const channelName = makeChannelName({ schema, table, events, filter });
    const filterStr = toFilterString(filter);

    // Hard guard: remove any pre-existing duplicate channels with the same name/topic.
    removeDuplicateChannels(channelName, log);

    if (log) {
      // eslint-disable-next-line no-console
      console.debug("[Realtime] subscribing", { channelName, schema, table, events, filterStr });
    }

    const ch = supabase.channel(channelName);
    channelRef.current = ch;

    const chosenEvents = (events && events.length ? events : ["*"]);

    chosenEvents.forEach((evt) => {
      ch.on(
        "postgres_changes",
        {
          event: evt, // "*", "INSERT", "UPDATE", "DELETE"
          schema,
          table,
          filter: filterStr, // e.g. "driver_id=eq.123"
        },
        async (payload) => {
          if (log) {
            // eslint-disable-next-line no-console
            console.debug(`[Realtime] ${table} ${payload.eventType}`, payload);
          }
          if (onAny) onAny(payload);
          switch (payload.eventType) {
            case "INSERT":
              if (onInsert) onInsert(payload);
              break;
            case "UPDATE":
              if (onUpdate) onUpdate(payload);
              break;
            case "DELETE":
              if (onDelete) onDelete(payload);
              break;
            default:
              break;
          }
          if (autoRefetch) {
            try {
              await autoRefetch();
            } catch (e) {
              if (log) console.debug("[Realtime] autoRefetch error:", e?.message || e);
            }
          }
        }
      );
    });

    ch.subscribe((status) => {
      if (log) {
        // eslint-disable-next-line no-console
        console.debug("[Realtime] status:", status, channelName);
      }
      if (onStatus) onStatus(status);

      if (status === "SUBSCRIBED" && autoRefetch) {
        // Optional initial refetch once the channel is live.
        (async () => {
          try {
            await autoRefetch();
          } catch (e) {
            if (log) console.debug("[Realtime] initial autoRefetch error:", e?.message || e);
          }
        })();
      }
    });

    // Optional: re-subscribe when the tab becomes visible again (helps after sleep)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        try {
          if (log) console.debug("[Realtime] visibilitychange -> ensuring channel alive", channelName);
          // If channel was closed for any reason, re-establish it.
          const topic = channelRef.current?.topic;
          if (!topic) {
            // Force a cleanup so the effect can re-run by dependency change
            // (We don't have deps to change here, so do a remove & resubscribe inline)
            removeDuplicateChannels(channelName, log);
            // Re-open the channel
            const re = supabase.channel(channelName);
            channelRef.current = re;
            chosenEvents.forEach((evt) => {
              re.on(
                "postgres_changes",
                { event: evt, schema, table, filter: filterStr },
                async (payload) => {
                  if (onAny) onAny(payload);
                  switch (payload.eventType) {
                    case "INSERT":
                      if (onInsert) onInsert(payload);
                      break;
                    case "UPDATE":
                      if (onUpdate) onUpdate(payload);
                      break;
                    case "DELETE":
                      if (onDelete) onDelete(payload);
                      break;
                    default:
                      break;
                  }
                  if (autoRefetch) {
                    try { await autoRefetch(); } catch (_) {}
                  }
                }
              );
            });
            re.subscribe((status) => {
              if (onStatus) onStatus(status);
              if (status === "SUBSCRIBED" && autoRefetch) {
                (async () => { try { await autoRefetch(); } catch (_) {} })();
              }
            });
          }
        } catch (_) {
          // ignore
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      // Cleanup prevents duplicate event streams
      try {
        if (log) {
          // eslint-disable-next-line no-console
          console.debug("[Realtime] unsubscribing", channelName);
        }
        if (channelRef.current) {
          if (typeof supabase.removeChannel === "function") {
            supabase.removeChannel(channelRef.current);
          } else if (typeof channelRef.current.unsubscribe === "function") {
            channelRef.current.unsubscribe();
          }
        }
      } catch (_) {
        // ignore
      } finally {
        channelRef.current = null;
      }
    };
    // NOTE: Depend only on stable identifiers; do not include callbacks (they change identity).
    // If you need to change callbacks, wrap them with useCallback in the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    schema,
    table,
    JSON.stringify(events || ["*"]),
    JSON.stringify(filter || null),
    allowFirstRun,
    log,
  ]);
}

