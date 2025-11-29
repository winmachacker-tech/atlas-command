// FILE: voice-server/atlas-tools.js
//
// Purpose:
// - Define the OpenAI Realtime "tool" schemas that Dipsy Voice can use.
// - These are purely JSON schemas describing what each tool does and what
//   parameters it accepts. They do NOT execute anything by themselves.
// - The voice server will:
//     • Register these tools with OpenAI Realtime in session.update.
//     • Listen for tool calls from OpenAI.
//     • Use the user's Supabase JWT (sent via { type: "auth", access_token })
//       to call Supabase REST/RPC and Edge Functions with full RLS protection.
//
// SECURITY:
// - This file contains NO secrets and NO Supabase calls.
// - It is safe to import on the Node server only.
// - All actual data access happens in the voice server using the
//   per-connection userAccessToken, never a service-role key here.

/**
 * Tool: list_active_loads
 *
 * What it means in Atlas terms:
 * - Ask Atlas for a list of loads that are currently "active" for this org.
 * - "Active" typically means anything not fully delivered/cancelled.
 * - Dipsy can use this to answer questions like:
 *     • "What loads are active right now?"
 *     • "How many loads are in transit?"
 *     • "Show me my active loads out of California."
 *
 * Parameters (all optional for now):
 * - status: string
 *     • A high-level status filter ("tendered", "dispatched", "in_transit", etc.).
 *     • The tool handler can map this to your actual status codes in Supabase.
 * - origin_state: string
 *     • 2-letter state code for origin (e.g., "CA", "TX").
 * - destination_state: string
 *     • 2-letter state code for destination.
 * - limit: integer
 *     • Max number of loads to return. Default will be handled server-side.
 */
const listActiveLoadsTool = {
  type: "function",
  name: "list_active_loads",
  description:
    "List active loads for the current Atlas org. Use this to answer questions about what loads are currently moving, tendered, dispatched, or otherwise not completed. Results are scoped to the authenticated user's organization via Supabase RLS.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "Optional high-level status filter (for example: 'tendered', 'dispatched', 'in_transit', 'delivered', 'cancelled'). If omitted, return all active loads.",
      },
      origin_state: {
        type: "string",
        description:
          "Optional 2-letter origin state code (for example: 'CA', 'TX'). Use this if the user asks about loads starting in a specific state or region.",
      },
      destination_state: {
        type: "string",
        description:
          "Optional 2-letter destination state code. Use this if the user asks about loads delivering into a specific state or region.",
      },
      limit: {
        type: "integer",
        description:
          "Optional maximum number of loads to return. If omitted, the server will choose a reasonable default (for example 10 or 20).",
        minimum: 1,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },
};

/**
 * Tool: list_available_drivers
 *
 * What it means in Atlas terms:
 * - Ask Atlas for drivers who are currently free/available to be dispatched.
 * - This will later map onto whatever "available" means in your driver table
 *   (for example: status, not on a load, not on time-off, etc.).
 *
 * Dipsy can use this to answer:
 *   • "Which drivers are available right now?"
 *   • "Do we have any drivers in Texas with dry vans?"
 *   • "Who could cover a load from CA to WA tomorrow?"
 *
 * Parameters (all optional for now):
 * - region: string
 *     • Free-form region filter (state code, city, or description).
 * - equipment_type: string
 *     • "dry_van", "reefer", "flatbed", "power_only", etc.
 * - limit: integer
 *     • Max number of drivers to return.
 */
const listAvailableDriversTool = {
  type: "function",
  name: "list_available_drivers",
  description:
    "List drivers who are currently available for dispatch for the current Atlas org. Use this to answer questions about which drivers are free, where they are, and what equipment they run. Results are scoped to the authenticated user's organization via Supabase RLS.",
  parameters: {
    type: "object",
    properties: {
      region: {
        type: "string",
        description:
          "Optional region filter. This can be a state code like 'CA', a broader region like 'Pacific Northwest', or a city name if the user is specific.",
      },
      equipment_type: {
        type: "string",
        description:
          "Optional equipment type filter. Examples: 'dry_van', 'reefer', 'flatbed', 'step_deck', 'power_only', 'box_truck'.",
      },
      limit: {
        type: "integer",
        description:
          "Optional maximum number of drivers to return. If omitted, the server will choose a reasonable default (for example 10 or 20).",
        minimum: 1,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },
};

/**
 * Tool: search_fleet_latest
 *
 * What it means in Atlas terms:
 * - Ask Atlas for the latest GPS positions of trucks across:
 *     • Motive
 *     • Samsara
 *     • Atlas Dummy fleet
 * - This uses the dipsy-tools-fleet Edge Function on the backend, which
 *   reads from unified fleet tables (motive, samsara, dummy) for the
 *   current org.
 *
 * Dipsy can use this to answer:
 *   • "Where is Dummy Truck 101 right now?"
 *   • "Which trucks are currently moving?"
 *   • "Show me all Samsara trucks with live GPS for my org."
 *
 * Parameters:
 * - provider: string (optional)
 *     • "motive"  => only Motive positions
 *     • "samsara" => only Samsara positions
 *     • "dummy"   => only Atlas Dummy positions
 *     • "all"     => (default) combine all providers
 * - limit: integer (optional)
 *     • Maximum number of trucks per provider to consider.
 */
const searchFleetLatestTool = {
  type: "function",
  name: "search_fleet_latest",
  description:
    "Fetch the latest GPS positions for trucks in the current Atlas org from Motive, Samsara, and the Atlas Dummy fleet. Use this when the user asks where a truck is, which trucks are moving, or to see a quick snapshot of fleet positions. Results are org-scoped via current_org_id() inside the fleet Edge Function.",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        description:
          "Optional fleet provider filter. Use 'motive', 'samsara', 'dummy', or 'all'. If omitted, the server will default to 'all' and combine all providers.",
        enum: ["motive", "samsara", "dummy", "all"],
      },
      limit: {
        type: "integer",
        description:
          "Optional maximum number of trucks per provider to consider. If omitted, the server will choose a reasonable default (for example 50).",
        minimum: 1,
        maximum: 200,
      },
    },
    additionalProperties: false,
  },
};

/**
 * Exported collection of Atlas tools.
 *
 * The voice server will:
 * - Import { atlasTools } from this file.
 * - Send atlasTools into OpenAI Realtime via session.update.
 * - Listen for tool calls matching these names and route them to Supabase / Edge Functions.
 */
const atlasTools = [
  listActiveLoadsTool,
  listAvailableDriversTool,
  searchFleetLatestTool,
];

module.exports = {
  atlasTools,
  listActiveLoadsTool,
  listAvailableDriversTool,
  searchFleetLatestTool,
};
