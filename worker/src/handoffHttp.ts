/**
 * `POST /api/handoff` — the operator's side of a hand-off (D-250). Signed-in
 * session only; the agent's side is MCP (`mcpHttp.ts`).
 *
 *   { action: "hand",     task_id, connection_id, note? }
 *   { action: "recall",   task_id }
 *   { action: "doorbell", connection_id, url, key? }   // key "" clears it
 *   { action: "ring",     connection_id }              // Settings' test
 */
import type { Context } from "hono";
import { OPEN_CORS, json } from "./cors.ts";
import { handTask, HandoffError, recallTask, setDoorbell, testDoorbell } from "./handoff.ts";
import { readJson } from "./http.ts";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "./maintenance.ts";
import { requireStore, type AppEnv } from "./session.ts";

export async function handleHandoff(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST") return json({ error: "Method not allowed" }, 405, OPEN_CORS);
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  if (writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) {
    return json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS);
  }
  const store = got.store;
  const body = (await readJson<Record<string, unknown>>(c)) ?? {};
  try {
    switch (body.action) {
      case "hand":
        return json(await handTask(store, c.env, body.task_id, body.connection_id, body.note), 200, OPEN_CORS);
      case "recall":
        return json({ task: await recallTask(store, body.task_id) }, 200, OPEN_CORS);
      case "doorbell":
        return json(await setDoorbell(store, c.env, String(body.connection_id ?? ""), body.url, body.key), 200, OPEN_CORS);
      case "ring":
        return json(await testDoorbell(store, c.env, body.connection_id), 200, OPEN_CORS);
      default:
        return json({ error: "Unknown action" }, 400, OPEN_CORS);
    }
  } catch (e) {
    if (e instanceof HandoffError) return json({ error: e.message }, e.status, OPEN_CORS);
    throw e;
  }
}
