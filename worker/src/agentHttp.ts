import type { Context } from "hono";
import { contextToPrompt } from "../../supabase/functions/agent/contextShape.ts";
import { createChatClient, runAgentTurn, type ContentPart } from "../../supabase/functions/agent/loop.ts";
import { buildTurnMessages } from "../../supabase/functions/agent/turn.ts";
import { TOOL_DEFINITIONS, buildPointAtTool, type MarqueeTargetSpec } from "../../supabase/functions/agent/toolDefs.ts";
import { readPromptVariant, type NavFocus } from "../../supabase/functions/agent/prompt.ts";
import { getOwned } from "./store.ts";
import { buildSnapshot, executeOwnedTool, resolveTz } from "./agentExec.ts";
import { OPEN_CORS, json } from "./cors.ts";
import type { Env } from "./env.ts";
import { requireStore, type AppEnv } from "./session.ts";

function openaiKey(env: Env): string {
  return env.OPENAI_API_KEY?.trim() ?? "";
}

async function ownedOrMissing(
  store: Parameters<typeof getOwned>[0],
  table: "projects" | "domains" | "initiatives" | "tasks",
  id: unknown,
): Promise<Response | null> {
  if (typeof id !== "string" || !id) return json({ error: "not found" }, 404, OPEN_CORS);
  const row = await getOwned(store, table, id);
  if (!row) return json({ error: "not found" }, 404, OPEN_CORS);
  return null;
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

  const oneShotId =
    (body.scaffold as { projectId?: unknown } | undefined)?.projectId ??
    (body.refine as { projectId?: unknown } | undefined)?.projectId ??
    (body.assess as { id?: unknown } | undefined)?.id ??
    (body.draftOutcome as { id?: unknown } | undefined)?.id ??
    (body.verify as { id?: unknown } | undefined)?.id ??
    (body.prepare as { taskId?: unknown } | undefined)?.taskId ??
    (body.enrichDomain as { domainId?: unknown } | undefined)?.domainId ??
    (body.enrichInbox as { taskIds?: unknown } | undefined)?.taskIds;

  if (body.scaffold || body.refine || body.assess || body.draftOutcome || body.verify || body.prepare || body.enrichDomain) {
    const table = body.prepare ? "tasks" : body.enrichDomain ? "domains" : body.assess && (body.assess as { kind?: string }).kind === "initiative" ? "initiatives" : "projects";
    const id = Array.isArray(oneShotId) ? oneShotId[0] : oneShotId;
    const missing = await ownedOrMissing(store, table, id);
    if (missing) return missing;
    if (!openaiKey(c.env)) return json({ error: "llm unavailable" }, 503, OPEN_CORS);
  }

  if (body.enrichInbox && Array.isArray((body.enrichInbox as { taskIds?: unknown }).taskIds)) {
    const ids = ((body.enrichInbox as { taskIds: unknown[] }).taskIds).map(String);
    for (const id of ids) {
      const missing = await ownedOrMissing(store, "tasks", id);
      if (missing) return missing;
    }
    if (!openaiKey(c.env)) return json({ error: "llm unavailable" }, 503, OPEN_CORS);
  }

  const messages = body.messages as { role: "user" | "assistant"; content: string | ContentPart[] }[] | undefined;
  if (!messages?.length) {
    if (body.priorities || body.breakdown || body.clusterInbox || body.nameSlot || body.blueprint || body.scaffoldDraft || body.routeProject || body.narrate || body.reviewFind) {
      if (!openaiKey(c.env)) return json({ error: "llm unavailable" }, 503, OPEN_CORS);
      return json({ error: "llm unavailable" }, 503, OPEN_CORS);
    }
    return json({ error: "messages required" }, 400, OPEN_CORS);
  }

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
