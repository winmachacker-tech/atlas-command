// src/lib/aiPrompts.js
// Prompt helpers + templates for Dispatch AI (context-aware)

export const SYSTEM_DISPATCH_AI = `
You are Atlas Command's Dispatch AI Assistant for a trucking carrier/brokerage.
Be concise, actionable, and accurate. Ask for only the ONE most critical missing detail.
Priorities: 1) Safety & compliance 2) On-time pickup/delivery 3) Relationships
4) Profit (RPM, deadhead, fuel, detention, layover).
Use short bullets, tiny checklists, and show brief math when relevant.
Status terms: Loads[AVAILABLE, IN_TRANSIT, DELIVERED, CANCELLED, AT_RISK, PROBLEM], Drivers[ACTIVE, ASSIGNED, INACTIVE].
If suggesting DB changes, clearly mark as *suggestion*.
`.trim();

/**
 * Compose extra messages (context) from your app data.
 * Pass this into useAIStream().send({ extraMessages, system: SYSTEM_DISPATCH_AI, ... })
 */
export function composeDispatchContext({ load = null, driver = null } = {}) {
  const msgs = [];

  if (load) {
    const {
      id, load_number, ref_number, status, origin_city, origin_state,
      dest_city, dest_state, pickup_at, delivery_at, rate,
      miles, trailer_type, notes,
    } = load;

    msgs.push({
      role: "system",
      content:
        [
          "Current Load Context:",
          `- id: ${id ?? "—"}`,
          `- load_number: ${load_number ?? "—"} ref: ${ref_number ?? "—"}`,
          `- status: ${status ?? "—"} trailer: ${trailer_type ?? "—"}`,
          `- lane: ${origin_city ?? "?"}, ${origin_state ?? "?"} → ${dest_city ?? "?"}, ${dest_state ?? "?"}`,
          `- pickup_at: ${pickup_at ?? "—"} delivery_at: ${delivery_at ?? "—"}`,
          `- miles: ${miles ?? "—"} rate: ${rate ?? "—"}`,
          `- notes: ${sanitize(notes)}`,
        ].join("\n"),
    });
  }

  if (driver) {
    const {
      id, full_name, status, phone, cdl_class, home_city, home_state,
      equipment, notes,
    } = driver;

    msgs.push({
      role: "system",
      content:
        [
          "Current Driver Context:",
          `- id: ${id ?? "—"} name: ${full_name ?? "—"} status: ${status ?? "—"}`,
          `- phone: ${phone ?? "—"} cdl: ${cdl_class ?? "—"} home: ${home_city ?? "?"}, ${home_state ?? "?"}`,
          `- equipment: ${equipment ?? "—"}`,
          `- notes: ${sanitize(notes)}`,
        ].join("\n"),
    });
  }

  return msgs;
}

/** Built-in prompt templates for common tasks */
export const Prompts = {
  checkCall: `Write a brief check-call script. Ask for live location, trailer status (sealed/temp), ETA, issues. Close with “Text if anything changes.”`,
  delayNotice: (minutes = 30) =>
    `Draft a concise customer update: driver delay of ${minutes} minutes. Provide updated ETA and offer a phone call if needed.`,
  rateMath: ({ miles, rate }) =>
    `Given distance ${miles} miles and all-in rate $${rate}, calculate RPM, then show a 5% fuel surcharge scenario.`,
  triageAtRisk: `Create a fast triage plan for a schedule slip: cause, mitigation steps, who to notify, and a 3-line phone script.`,
  assignNote: ({ loadNum, driverName, pickup, delivery }) =>
    `Draft an internal note for assigning ${driverName} to Load ${loadNum} (PU ${pickup}, DEL ${delivery}). Include a 3-bullet checklist.`,
};

// ——— helpers ———
function sanitize(v) {
  if (!v) return "—";
  return String(v).replace(/\s+/g, " ").slice(0, 500);
}
