import type { Context } from "hono";
import {
  GET_SNAPSHOT_NAME,
  handleMcpMethod,
  mcpToolsFromDefs,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../supabase/functions/_shared/mcp.ts";
import { buildSnapshot, executeOwnedTool, resolveTz } from "./agentExec.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { hasScope, resolveConnection, SCOPE_ACCOUNT, tokenFrom, touchConnection } from "./connections.ts";
import { requestIo, type AppEnv } from "./session.ts";
import { bootstrapUser, makeStore } from "./store.ts";

const TOOLS = mcpToolsFromDefs();
const RATE_LIMIT_PER_MIN = 120;
const MCP_CORS = {
  ...OPEN_CORS,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-nuvo-token, mcp-session-id, last-event-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

const hits = new Map<string, number[]>();
function tooFast(id: string): boolean {
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    hits.set(id, recent);
    return true;
  }
  recent.push(now);
  hits.set(id, recent);
  return false;
}

function unauthorized(message = "Invalid or revoked token"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="nuvo"',
      ...MCP_CORS,
    },
  });
}

function sessionHeaders(req: Request): Record<string, string> {
  const incoming = req.headers.get("mcp-session-id")?.trim();
  return {
    "mcp-protocol-version": req.headers.get("mcp-protocol-version")?.trim() || "2025-03-26",
    "mcp-session-id": incoming || crypto.randomUUID(),
  };
}

export async function handleMcp(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: MCP_CORS });
  const io = await requestIo(c);
  const token = tokenFrom(c.req.raw);
  if (!token) return unauthorized("Missing bearer token");
  const conn = await resolveConnection(io.sql, token);
  if (!conn) return unauthorized();
  if (!hasScope(conn, SCOPE_ACCOUNT)) {
    return json(
      { error: "Token lacks account scope — mint a Full account token in Settings → Apps & devices" },
      403,
      MCP_CORS,
    );
  }

  if (c.req.method === "GET") {
    return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS", ...MCP_CORS } });
  }
  if (c.req.method !== "POST") return json({ error: "Method not allowed" }, 405, MCP_CORS);
  if (tooFast(conn.id)) {
    return json({ error: "Rate limit exceeded — slow down" }, 429, { ...MCP_CORS, "Retry-After": "60" });
  }

  const store = await bootstrapUser(makeStore(io.sql, conn.user_id), null);
  const extra = sessionHeaders(c.req.raw);
  const raw = await c.req.json().catch(() => null);

  const run = async (msg: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    return handleMcpMethod(msg, TOOLS, async (name, args) => {
      await touchConnection(io.sql, conn.id);
      const tz = resolveTz(args.timezone);
      if (name === GET_SNAPSHOT_NAME) {
        const ctx = await buildSnapshot(
          store,
          typeof args.range_start === "string" ? args.range_start : undefined,
          typeof args.range_end === "string" ? args.range_end : undefined,
          tz,
        );
        return JSON.stringify({ operator: { email: null }, ...ctx });
      }
      return executeOwnedTool(store, name, args);
    }, null);
  };

  if (Array.isArray(raw)) {
    const replies: JsonRpcResponse[] = [];
    for (const msg of raw) {
      if (!msg || typeof msg !== "object") continue;
      const reply = await run(msg as JsonRpcRequest);
      if (reply) replies.push(reply);
    }
    if (replies.length === 0) return new Response(null, { status: 202, headers: { ...MCP_CORS, ...extra } });
    return json(replies, 200, { ...MCP_CORS, ...extra });
  }
  if (!raw || typeof raw !== "object") return json({ error: "Expected a JSON-RPC object" }, 400, MCP_CORS);
  const reply = await run(raw as JsonRpcRequest);
  if (!reply) return new Response(null, { status: 202, headers: { ...MCP_CORS, ...extra } });
  return json(reply, 200, { ...MCP_CORS, ...extra });
}
