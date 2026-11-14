import type { Context } from "hono";
import { contextToPrompt } from "../../supabase/functions/agent/contextShape.ts";
import { createChatClient, runAgentTurn, type ContentPart } from "../../supabase/functions/agent/loop.ts";
import { buildTurnMessages } from "../../supabase/functions/agent/turn.ts";
import { TOOL_DEFINITIONS, buildPointAtTool, type MarqueeTargetSpec } from "../../supabase/functions/agent/toolDefs.ts";
import { readPromptVariant, type NavFocus } from "../../supabase/functions/agent/prompt.ts";
import { buildSnapshot, executeOwnedTool, resolveTz } from "./agentExec.ts";
import { runWorkerOneShot } from "./agentOneShot.ts";
import { OPEN_CORS, json } from "./cors.ts";
import type { Env } from "./env.ts";
import { requireStore, type AppEnv } from "./session.ts";

const NOT_FOUND_RE = /^(project|initiative|task|domain) not found$/i;

function openaiKey(env: Env): string {
  return env.OPENAI_API_KEY?.trim() ?? "";
}

export async function handleAgent(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST" && c.req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, OPEN_CORS);
  }

  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const store = got.store;

  if (c.req.method === "GET") {
    const ctx = await buildSnapshot(store);
    return json(ctx, 200, OPEN_CORS);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.snapshot === true || body.get_snapshot === true) {
    const ctx = await buildSnapshot(
      store,
      typeof body.rangeStart === "string" ? body.rangeStart : undefined,
      typeof body.rangeEnd === "string" ? body.rangeEnd : undefined,
      resolveTz(body.tz),
    );
    return json(ctx, 200, OPEN_CORS);
  }

  if (typeof body.tool === "string" || (body.tool && typeof body.tool === "object")) {
    const name = typeof body.tool === "string" ? body.tool : String((body.tool as { name?: unknown }).name ?? "");
    const args =
      typeof body.tool === "object" && body.tool && "args" in body.tool
        ? ((body.tool as { args?: Record<string, unknown> }).args ?? {})
        : ((body.args as Record<string, unknown> | undefined) ?? {});
    const result = await executeOwnedTool(store, name, args ?? {});
    return json({ result }, 200, OPEN_CORS);
  }

  // The Supabase agent's one-shots, run as-is (agentOneShot.ts): same routing
  // order and checks, and a throw is 500 {error: message}, as that function's
  // outer catch returns.
  try {
    const oneShot = await runWorkerOneShot(store, c.env, body);
    if (oneShot !== undefined) return json(oneShot, 200, OPEN_CORS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent]", msg);
    // Same {error} body as Supabase. A missing or foreign row ("Task not found",
    // "project not found", ...) answers 404 instead of Supabase's 500, so a
    // foreign id and a random id stay indistinguishable and the access gate
    // (accessHttp.check: denied = 403/404) holds. Everything else is Supabase's 500.
    return json({ error: msg }, NOT_FOUND_RE.test(msg) ? 404 : 500, OPEN_CORS);
  }

  const messages = body.messages as { role: "user" | "assistant"; content: string | ContentPart[] }[] | undefined;
  if (!messages?.length) return json({ error: "messages required" }, 400, OPEN_CORS);

  const key = openaiKey(c.env);
  if (!key) return json({ error: "llm unavailable" }, 503, OPEN_CORS);

  const tz = resolveTz(body.tz);
  const manifest: MarqueeTargetSpec[] = Array.isArray(body.marqueeTargets)
    ? (body.marqueeTargets as MarqueeTargetSpec[]).filter((t) => t && typeof t.key === "string" && typeof t.describe === "string")
    : [];
  const ctx = await buildSnapshot(
    store,
    typeof body.rangeStart === "string" ? body.rangeStart : undefined,
    typeof body.rangeEnd === "string" ? body.rangeEnd : undefined,
    tz,
  );
  const oaiMessages = buildTurnMessages({
    ctx,
    tz,
    navFocus: body.navFocus as NavFocus | undefined,
    messages,
    promptVariant: readPromptVariant(undefined),
  });
  void contextToPrompt;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const sse = (data: Record<string, unknown>) => writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

  (async () => {
    try {
      const turn = await runAgentTurn({
        messages: oaiMessages,
        tools: [...TOOL_DEFINITIONS, buildPointAtTool(manifest)],
        llm: createChatClient({
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4.1",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        }),
        execute: async (name, args) => ({ result: await executeOwnedTool(store, name, args) }),
        onText: async (chunk) => {
          await sse({ t: "c", v: chunk });
        },
      });
      await sse({
        t: "d",
        content: turn.content,
        actions: turn.actions,
        suggestions: turn.suggestions,
        ui: turn.ui,
        invite: turn.invite,
        exhausted: turn.exhausted,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await sse({ t: "e", msg });
      } catch {
        /* ignore */
      }
    } finally {
      try {
        await writer.close();
      } catch {
        /* ignore */
      }
    }
  })();

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...OPEN_CORS },
  });
}
