// MCP — Streamable HTTP. Lets a teammate the operator owns (Grok Bot, Cursor,
// another agent) act on their Nuvo through the SAME tools the in-app chat uses.
//
// Auth is the opaque `connections` bearer token minted in Settings → Apps &
// devices with the `account` scope. verify_jwt is OFF (config.toml): the bearer
// is not a Supabase JWT, so the gateway must pass it through. We hash it and
// look it up — same path Capture uses.
//
// This function does not talk to a model. It exposes tools. The teammate is
// the model. Nested brains (Grok Bot → Nuvo chat → tools) is the failure mode.
import { admin } from "../_shared/admin.ts";
import { FALLBACK_TZ } from "../_shared/dayShape.ts";
import {
  hasScope,
  resolveConnection,
  SCOPE_ACCOUNT,
  tokenFrom,
  touchConnection,
} from "../_shared/connections.ts";
import {
  GET_SNAPSHOT_NAME,
  handleMcpMethod,
  mcpToolsFromDefs,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../_shared/mcp.ts";
import { buildContext } from "../agent/context.ts";
import { executeTool } from "../agent/tools.ts";

const TOOLS = mcpToolsFromDefs();
const RATE_LIMIT_PER_MIN = 120;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-nuvo-token, mcp-session-id, last-event-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });
}

function unauthorized(message = "Invalid or revoked token"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="nuvo"',
      ...cors,
    },
  });
}

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

function resolveTz(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return FALLBACK_TZ;
  }
}

function sse(payload: unknown, extra: Record<string, string> = {}): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      ...cors,
      ...extra,
    },
  });
}

function wantsSse(req: Request): boolean {
  const accept = req.headers.get("Accept") ?? "";
  return accept.includes("text/event-stream") && !accept.includes("application/json");
}

function sessionHeaders(req: Request): Record<string, string> {
  const incoming = req.headers.get("mcp-session-id")?.trim();
  return {
    "mcp-protocol-version": req.headers.get("mcp-protocol-version")?.trim() || "2025-03-26",
    "mcp-session-id": incoming || crypto.randomUUID(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const token = tokenFrom(req);
    if (!token) return unauthorized("Missing bearer token");
    const conn = await resolveConnection(token);
    if (!conn) return unauthorized();
    if (!hasScope(conn, SCOPE_ACCOUNT)) {
      return json({ error: "Token lacks account scope — mint a Full account token in Settings → Apps & devices" }, 403);
    }

    const { data: actor } = await admin.auth.admin.getUserById(conn.user_id);
    const operatorEmail = actor?.user?.email ?? null;

    if (req.method === "GET") {
      // Streamable HTTP optional SSE stream. We are request/response; no live stream.
      return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS", ...cors } });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (tooFast(conn.id)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded — slow down" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60", ...cors },
      });
    }

    const raw = await req.json().catch(() => null);
    const extra = sessionHeaders(req);

    const run = async (msg: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
      return await handleMcpMethod(msg, TOOLS, async (name, args) => {
        await touchConnection(conn.id);
        const tz = resolveTz(args.timezone);
        if (name === GET_SNAPSHOT_NAME) {
          const ctx = await buildContext(
            conn.user_id,
            typeof args.range_start === "string" ? args.range_start : undefined,
            typeof args.range_end === "string" ? args.range_end : undefined,
            tz,
          );
          return JSON.stringify({ operator: { email: operatorEmail }, ...ctx });
        }
        const { result } = await executeTool(conn.user_id, name, args, undefined, tz);
        return result;
      }, operatorEmail);
    };

    if (Array.isArray(raw)) {
      const replies: JsonRpcResponse[] = [];
      for (const msg of raw) {
        if (!msg || typeof msg !== "object") continue;
        const reply = await run(msg as JsonRpcRequest);
        if (reply) replies.push(reply);
      }
      if (replies.length === 0) return new Response(null, { status: 202, headers: { ...cors, ...extra } });
      return wantsSse(req) ? sse(replies, extra) : json(replies, 200, extra);
    }

    if (!raw || typeof raw !== "object") return json({ error: "Expected a JSON-RPC object" }, 400);
    const reply = await run(raw as JsonRpcRequest);
    if (!reply) return new Response(null, { status: 202, headers: { ...cors, ...extra } });
    return wantsSse(req) ? sse(reply, extra) : json(reply, 200, extra);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[mcp]", msg);
    return json({ error: msg }, 500);
  }
});
