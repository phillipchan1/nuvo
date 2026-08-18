// MCP protocol helpers — Streamable HTTP JSON-RPC, no transport, no Deno.
// The edge function speaks HTTP; this file is the vocabulary map and the
// method dispatcher, so the battery can pin "what Grok Bot sees" without
// standing up a server.
//
// The tool list is the chat's TOOL_DEFINITIONS, minus screen-driving
// `point_at`, plus `get_snapshot` (the chat gets that injected as context).

import { TOOL_DEFINITIONS } from "../agent/toolDefs.ts";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

export const GET_SNAPSHOT_NAME = "get_snapshot";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const GET_SNAPSHOT_TOOL: McpTool = {
  name: GET_SNAPSHOT_NAME,
  description:
    "Read the operator's Nuvo as it stands right now: domains, initiatives, projects, this week's slate, inbox, today, open windows, writable calendars. Call this before answering questions about the week, the day, or the vertical. Ids in the snapshot are for other tools — never invent them.",
  inputSchema: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA timezone for 'today' and clock math. Defaults to America/Los_Angeles.",
      },
      range_start: {
        type: "string",
        description: "ISO start of the calendar window. Defaults to 7 days ago.",
      },
      range_end: {
        type: "string",
        description: "ISO end of the calendar window. Defaults to 7 days ahead.",
      },
    },
    additionalProperties: false,
  },
};

const HIDDEN = new Set(["point_at"]);

/** OpenAI function-calling defs → MCP tools. `point_at` is UI-only. */
export function mcpToolsFromDefs(
  defs: { function: { name: string; description?: string; parameters?: Record<string, unknown> } }[] = TOOL_DEFINITIONS,
): McpTool[] {
  const mapped = defs
    .filter((d) => !HIDDEN.has(d.function.name))
    .map((d) => ({
      name: d.function.name,
      description: d.function.description ?? "",
      inputSchema: (d.function.parameters as Record<string, unknown> | undefined) ?? {
        type: "object",
        properties: {},
      },
    }));
  return [GET_SNAPSHOT_TOOL, ...mapped];
}

export function mcpToolNames(tools: McpTool[] = mcpToolsFromDefs()): string[] {
  return tools.map((t) => t.name);
}

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export interface JsonRpcResult {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export type JsonRpcResponse = JsonRpcError | JsonRpcResult;

export function isNotification(msg: JsonRpcRequest): boolean {
  return !("id" in msg) || msg.id === undefined;
}

function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: "2.0", id, error: data !== undefined ? { code, message, data } : { code, message } };
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResult {
  return { jsonrpc: "2.0", id, result };
}

const INSTRUCTIONS =
  "You are acting as ONE operator inside Nuvo, their personal planner. " +
  "The bearer token selected that account; you cannot switch users, pass a user id, or see anyone else's funnel. " +
  "Call get_snapshot before answering about the week, the day, or the vertical. " +
  "Writes go through the named tools — never invent ids. " +
  "Cancel, decline, and permanent delete require a confirm_token from a previous call; " +
  "propose first, then spend the token on a later call. " +
  "Staging an invite is not sending it.";

/** Keys a client might send to impersonate. The account is the token, never these. */
const ACTOR_KEYS = new Set(["user_id", "userId", "actingUserId", "acting_user_id"]);

export function stripActorOverrides(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (ACTOR_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<string>;

export async function handleMcpMethod(
  msg: JsonRpcRequest,
  tools: McpTool[],
  call: ToolCaller,
  /** Signed-in operator — stamped into initialize so a teammate can see whose funnel this is. */
  operatorEmail?: string | null,
): Promise<JsonRpcResponse | null> {
  const id = (msg.id ?? null) as JsonRpcId;
  const method = typeof msg.method === "string" ? msg.method : "";

  if (isNotification(msg)) {
    // notifications/initialized (and anything else without an id) — no reply.
    return null;
  }

  switch (method) {
    case "initialize": {
      const params = (msg.params ?? {}) as { protocolVersion?: string };
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_VERSIONS.has(asked) ? asked : MCP_PROTOCOL_VERSION;
      const who = operatorEmail ? ` You are connected as ${operatorEmail}. That is the only account this token can see.` : "";
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nuvo", version: "1.0.0" },
        instructions: INSTRUCTIONS + who,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools });
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return err(id, -32602, "tools/call requires params.name");
      if (!tools.some((t) => t.name === name)) {
        return err(id, -32602, `Unknown tool: ${name}`);
      }
      const rawArgs =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      const args = stripActorOverrides(rawArgs);
      try {
        const text = await call(name, args);
        return ok(id, { content: [{ type: "text", text }], isError: false });
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        return ok(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return err(id, -32601, `Method not found: ${method || "(missing)"}`);
  }
}
