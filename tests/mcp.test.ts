// MCP protocol — the vocabulary Grok Bot (and any other teammate) sees is the
// chat's tool list, not a second API. Pins: no `point_at`, `get_snapshot` is
// first, `account` includes inbox, JSON-RPC methods we actually speak.

import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "../supabase/functions/agent/toolDefs.ts";
import {
  GET_SNAPSHOT_NAME,
  handleMcpMethod,
  mcpToolNames,
  mcpToolsFromDefs,
  stripActorOverrides,
  type JsonRpcRequest,
} from "../supabase/functions/_shared/mcp.ts";
import { hasScope, SCOPE_ACCOUNT, SCOPE_INBOX } from "../supabase/functions/_shared/connectionScopes.ts";

describe("MCP tool list is the chat's vocabulary", () => {
  const tools = mcpToolsFromDefs();
  const names = mcpToolNames(tools);

  it("starts with get_snapshot — the chat gets context injected; a teammate has to ask", () => {
    expect(names[0]).toBe(GET_SNAPSHOT_NAME);
  });

  it("never offers point_at — that drives the operator's screen", () => {
    expect(names).not.toContain("point_at");
  });

  it("every other tool is a chat tool — no second vocabulary", () => {
    const chat = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));
    const extra = names.filter((n) => n !== GET_SNAPSHOT_NAME && !chat.has(n));
    expect(extra).toEqual([]);
    const missing = [...chat].filter((n) => !names.includes(n));
    expect(missing).toEqual([]);
  });

  it("maps OpenAI parameters onto MCP inputSchema", () => {
    const create = tools.find((t) => t.name === "create_task");
    expect(create?.inputSchema).toMatchObject({ type: "object" });
    expect((create?.inputSchema as { properties?: Record<string, unknown> }).properties).toHaveProperty("title");
  });
});

describe("account scope includes inbox", () => {
  it("an inbox token cannot run MCP", () => {
    expect(hasScope({ scopes: [SCOPE_INBOX] }, SCOPE_ACCOUNT)).toBe(false);
  });

  it("a full-account token can capture", () => {
    expect(hasScope({ scopes: [SCOPE_ACCOUNT] }, SCOPE_INBOX)).toBe(true);
    expect(hasScope({ scopes: [SCOPE_ACCOUNT] }, SCOPE_ACCOUNT)).toBe(true);
  });
});

describe("MCP JSON-RPC", () => {
  const tools = mcpToolsFromDefs();
  const call = async (name: string, args: Record<string, unknown>) =>
    JSON.stringify({ name, args });

  it("initialize returns tools capability and instructions", async () => {
    const reply = await handleMcpMethod(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      tools,
      call,
    );
    expect(reply).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nuvo" },
      },
    });
    const result = (reply as { result: { instructions: string } }).result;
    expect(result.instructions).toMatch(/get_snapshot/);
    expect(result.instructions).toMatch(/cannot switch users/);
  });

  it("initialize names the signed-in operator", async () => {
    const reply = await handleMcpMethod(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      tools,
      call,
      "you@example.com",
    );
    const result = (reply as { result: { instructions: string } }).result;
    expect(result.instructions).toMatch(/you@example\.com/);
    expect(result.instructions).toMatch(/only account this token can see/);
  });

  it("initialized notification has no reply", async () => {
    const reply = await handleMcpMethod(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      tools,
      call,
    );
    expect(reply).toBeNull();
  });

  it("tools/list exposes get_snapshot and create_project", async () => {
    const reply = await handleMcpMethod(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      tools,
      call,
    );
    const listed = (reply as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(listed).toContain("get_snapshot");
    expect(listed).toContain("create_project");
    expect(listed).toContain("create_initiative");
    expect(listed).not.toContain("point_at");
  });

  it("tools/call routes arguments to the handler", async () => {
    const reply = await handleMcpMethod(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "create_task", arguments: { title: "Call David" } },
      },
      tools,
      call,
    );
    expect(reply).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: { isError: false, content: [{ type: "text", text: JSON.stringify({ name: "create_task", args: { title: "Call David" } }) }] },
    });
  });

  it("tools/call on an unknown name is a JSON-RPC error, not a throw", async () => {
    const reply = await handleMcpMethod(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "invent_pool" } },
      tools,
      call,
    );
    expect(reply).toMatchObject({ jsonrpc: "2.0", id: 4, error: { code: -32602 } });
  });

  it("a handler throw becomes isError content the model can read", async () => {
    const boom: typeof call = async () => {
      throw new Error("Project not found");
    };
    const reply = await handleMcpMethod(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "update_project", arguments: {} } },
      tools,
      boom,
    );
    expect(reply).toMatchObject({
      result: { isError: true, content: [{ type: "text", text: "Project not found" }] },
    });
  });

  it("unknown method is -32601", async () => {
    const reply = await handleMcpMethod(
      { jsonrpc: "2.0", id: 6, method: "logging/setLevel" } as JsonRpcRequest,
      tools,
      call,
    );
    expect(reply).toMatchObject({ error: { code: -32601 } });
  });

  it("strips client-supplied user ids before the handler runs", async () => {
    let seen: Record<string, unknown> | null = null;
    const spy: typeof call = async (_name, args) => {
      seen = args;
      return "ok";
    };
    await handleMcpMethod(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: { title: "Call David", user_id: "someone-else", actingUserId: "nope" },
        },
      },
      tools,
      spy,
    );
    expect(seen).toEqual({ title: "Call David" });
  });
});

describe("stripActorOverrides", () => {
  it("drops impersonation keys and keeps the rest", () => {
    expect(
      stripActorOverrides({
        title: "Ship",
        user_id: "u-other",
        userId: "u-other",
        actingUserId: "u-other",
        acting_user_id: "u-other",
        project_id: "p1",
      }),
    ).toEqual({ title: "Ship", project_id: "p1" });
  });
});
