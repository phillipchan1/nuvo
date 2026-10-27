import type { Context } from "hono";
import { Hono } from "hono";
import { handleAgent } from "./agentHttp.ts";
import { exposeSignedAuthToken, SessionLookupError, sessionUser } from "./auth.ts";
import { stayOnSupabase } from "./blocked.ts";
import { handleCapture } from "./captureHttp.ts";
import { API_SECURITY, beginAuthCors, json, OPEN_CORS } from "./cors.ts";
import { cutoverFlipped } from "./cron.ts";
import {
  consumeCalendarSyncBatch,
  handleCron,
  handleScheduled,
  handleUserRollover,
  runCronJob,
  type CalendarSyncMessage,
  type QueueBatch,
} from "./cronJobs.ts";
import { closeSql, CONNECT_TIMEOUT_MS, openSql, raceTimeout, type Sql } from "./db.ts";
import type { Env } from "./env.ts";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "./maintenance.ts";
import type { RequestIo } from "./requestIo.ts";
import type { AppEnv } from "./session.ts";
import {
  BadRequestError,
  isDatabaseUnavailable,
  isUnavailableText,
  postgresInputError,
  readJson,
  requireJsonObject,
  requireUuid,
} from "./http.ts";
import {
  EntitlementUnavailableError,
  entitlementResponseBody,
  readEntitlement,
} from "./entitlement.ts";
import { handleDay } from "./dayHttp.ts";
import { handleInboundEmail } from "./inboundHttp.ts";
import { handleMcp } from "./mcpHttp.ts";
import { scheduleClose } from "./requestIo.ts";
import { handleRouteEvents } from "./routeEventsHttp.ts";
import { requestIo, requireStore } from "./session.ts";
import { handleSlotMirror } from "./slotMirror.ts";
import { handleTaskMirror } from "./taskMirror.ts";
import { installPushFetchForTests, workerTestFetch } from "./pushDispatch.ts";
import type { FetchLike } from "./lib/webpush.ts";
import {
  applyPatch,
  claimReminder,
  contacts,
  deleteOwned,
  deleteTaskLabel,
  getOwned,
  insertTaskLabel,
  isPlannerTable,
  listOwned,
  listTaskLabels,
  rotateInboundToken,
  updateOwned,
  upsertOwned,
  type PlannerTable,
} from "./store.ts";

const app = new Hono<AppEnv>();

/** Test-only: mock Google / CalDAV / web-push endpoints. */
export function installWorkerFetchForTests(fn?: FetchLike): () => void {
  return installPushFetchForTests(fn);
}

/** Clone — Workers Response headers are immutable; mutating them becomes a plain-text 500. */
function withClonedHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

app.use("*", async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/functions/v1/")) {
    c.res = withClonedHeaders(c.res, API_SECURITY);
  }
});

/**
 * Open I/O lazily. Close only after `next()` (the handler) and the close
 * itself have finished. Starting `sql.end()` from requireStore used to
 * kill queries still running in the route (CONNECTION_ENDED).
 */
app.use("/api/*", closeIo);
app.use("/functions/v1/*", closeIo);

async function closeIo(c: Context<AppEnv>, next: () => Promise<void>) {
  try {
    await next();
  } finally {
    const io = c.get("io");
    if (!io) return;
    const closing = io.close();
    scheduleClose(c, closing);
    await closing;
  }
}

function missingAsset(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      ...API_SECURITY,
    },
  });
}

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "nuvo",
    runtime: "cloudflare-workers",
    write_freeze: writeFrozen(c.env?.MAINTENANCE_WRITE_FREEZE),
  }),
);

app.get("/api/maintenance", (c) =>
  json(
    {
      write_freeze: writeFrozen(c.env?.MAINTENANCE_WRITE_FREEZE),
      cutover_armed: writeFrozen(c.env?.CUTOVER_ARMED),
      message: writeFrozen(c.env?.MAINTENANCE_WRITE_FREEZE) ? WRITE_FROZEN_MESSAGE : null,
    },
    200,
    OPEN_CORS,
  ),
);
app.options("/api/maintenance", () => new Response("ok", { headers: OPEN_CORS }));

async function sqlUnavailable(sql: Sql): Promise<boolean> {
  try {
    await raceTimeout(Promise.resolve(sql`SELECT 1`), CONNECT_TIMEOUT_MS);
    return false;
  } catch {
    // Probe failed or hung past CONNECT_TIMEOUT_MS. Do not classify by driver text.
    return true;
  }
}

app.all("/api/auth/*", async (c) => {
  const started = beginAuthCors(c.req.header("Origin"), c.env);
  if (!started.ok) return started.response;
  const cors = started.cors;
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let io: RequestIo | undefined;
  try {
    io = await requestIo(c);
    const res = await exposeSignedAuthToken(
      await io.auth.handler(c.req.raw),
      c.env.BETTER_AUTH_SECRET ?? "",
      c.req.header("cookie"),
    );
    return withAuthCors(await sanitizeAuthResponse(res, io.sql), cors);
  } catch (err) {
    // Better Auth often throws `{ message: "connection attempt failed" }`
    // with no code — do not classify by text. Probe the request SQL client.
    let unavailable = isDatabaseUnavailable(err);
    if (!unavailable && io) unavailable = await sqlUnavailable(io.sql);
    return new Response(JSON.stringify({ error: unavailable ? "service unavailable" : "internal error" }), {
      status: unavailable ? 503 : 500,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
});

function withAuthCors(res: Response, cors: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) {
    if (k === "Access-Control-Allow-Origin" || !headers.has(k)) headers.set(k, v);
  }
  headers.delete("Access-Control-Allow-Credentials");
  if (cors["Access-Control-Allow-Credentials"]) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  if (headers.get("Access-Control-Allow-Origin") === "*" && headers.get("Access-Control-Allow-Credentials") === "true") {
    headers.set("Access-Control-Allow-Origin", cors["Access-Control-Allow-Origin"]);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Never forward a 5xx body — adapter errors can name `*.hyperdrive.local`.
 * Better Auth swallows the driver error and returns its own 500, so a
 * generic body is remapped to 503 only after the request's SQL client
 * also cannot reach the database.
 */
async function sanitizeAuthResponse(res: Response, sql?: Sql): Promise<Response> {
  if (res.status < 500) return res;
  const text = await res.text().catch(() => "");
  let unavailable = res.status === 503 || isUnavailableText(text);
  if (!unavailable && sql) unavailable = await sqlUnavailable(sql);
  return new Response(JSON.stringify({ error: unavailable ? "service unavailable" : "internal error" }), {
    status: unavailable ? 503 : 500,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireSession(
  c: Context<AppEnv>,
): Promise<{ error: Response } | { user: { id: string; email?: string | null; emailVerified: boolean }; io: RequestIo }> {
  const io = await requestIo(c);
  let user;
  try {
    user = await sessionUser(io.auth, c.req.raw);
  } catch (err) {
    if (err instanceof SessionLookupError) {
      return { error: json({ error: "service unavailable" }, 503, OPEN_CORS) };
    }
    throw err;
  }
  if (!user) return { error: json({ error: "unauthorized" }, 401, OPEN_CORS) };
  return { user, io };
}

async function requireWritableStore(c: Context<AppEnv>) {
  const got = await requireStore(c);
  if ("error" in got) return got;
  if (writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) {
    return {
      error: json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS),
    };
  }
  return got;
}

app.onError((err, c) => {
  if (err instanceof BadRequestError) return json({ error: "bad request" }, 400, OPEN_CORS);
  if (err instanceof SessionLookupError) return json({ error: "service unavailable" }, 503, OPEN_CORS);
  if (err instanceof EntitlementUnavailableError) return json({ error: "service unavailable" }, 503, OPEN_CORS);
  if (isDatabaseUnavailable(err)) return json({ error: "service unavailable" }, 503, OPEN_CORS);
  if (postgresInputError(err)) return json({ error: "bad request" }, 400, OPEN_CORS);
  return json({ error: "internal error" }, 500, OPEN_CORS);
});

app.options("/api/data/*", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/api/rpc/*", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/api/entitlement", () => new Response("ok", { headers: OPEN_CORS }));

/**
 * Billing stays on Supabase. The session id is the preserved auth.users
 * id — never a client-supplied owner, never an email remap.
 */
app.get("/api/entitlement", async (c) => {
  const got = await requireSession(c);
  if ("error" in got) return got.error;
  try {
    const entitlement = await readEntitlement(c.env, got.user.id);
    return json(entitlementResponseBody(entitlement), 200, OPEN_CORS);
  } catch (err) {
    if (err instanceof EntitlementUnavailableError) {
      return json({ error: "service unavailable" }, 503, OPEN_CORS);
    }
    throw err;
  }
});

function entitlementWriteDenied(): Response {
  return json({ error: "not found" }, 404, OPEN_CORS);
}

app.post("/api/entitlement", async (c) => {
  const got = await requireSession(c);
  if ("error" in got) return got.error;
  return entitlementWriteDenied();
});
app.patch("/api/entitlement", async (c) => {
  const got = await requireSession(c);
  if ("error" in got) return got.error;
  return entitlementWriteDenied();
});
app.delete("/api/entitlement", async (c) => {
  const got = await requireSession(c);
  if ("error" in got) return got.error;
  return entitlementWriteDenied();
});

app.get("/api/data/task_labels", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const taskId = c.req.query("task_id");
  if (!taskId) return json({ error: "task_id required" }, 400, OPEN_CORS);
  requireUuid(taskId, "task_id");
  const rows = await listTaskLabels(got.store, taskId);
  return json({ data: rows }, 200, OPEN_CORS);
});

app.post("/api/data/task_labels", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const body = await readJson<{ task_id?: string; label_id?: string }>(c);
  if (!body.task_id || !body.label_id) return json({ error: "task_id and label_id required" }, 400, OPEN_CORS);
  requireUuid(body.task_id, "task_id");
  requireUuid(body.label_id, "label_id");
  const ok = await insertTaskLabel(got.store, body.task_id, body.label_id);
  return json({ data: ok ? body : null }, ok ? 200 : 404, OPEN_CORS);
});

app.delete("/api/data/task_labels", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const taskId = c.req.query("task_id");
  const labelId = c.req.query("label_id");
  if (!taskId || !labelId) return json({ error: "task_id and label_id required" }, 400, OPEN_CORS);
  requireUuid(taskId, "task_id");
  requireUuid(labelId, "label_id");
  const n = await deleteTaskLabel(got.store, taskId, labelId);
  return json({ deleted: n }, 200, OPEN_CORS);
});

app.get("/api/data/:table", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const rows = await listOwned(got.store, table);
  return json({ data: rows }, 200, OPEN_CORS);
});

app.get("/api/data/:table/:id", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const row = await getOwned(got.store, table, requireUuid(c.req.param("id")));
  if (!row) return json({ error: "not found" }, 404, OPEN_CORS);
  return json({ data: row }, 200, OPEN_CORS);
});

app.post("/api/data/:table", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const body = requireJsonObject(await readJson<unknown>(c));
  const row = await upsertOwned(got.store, table as PlannerTable, body);
  if (!row) return json({ error: "cannot insert" }, 400, OPEN_CORS);
  return json({ data: row }, 200, OPEN_CORS);
});

app.patch("/api/data/:table/:id", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const body = requireJsonObject(await readJson<unknown>(c));
  const row = await updateOwned(got.store, table, requireUuid(c.req.param("id")), body);
  if (!row) return json({ error: "not found" }, 404, OPEN_CORS);
  return json({ data: row }, 200, OPEN_CORS);
});

app.delete("/api/data/:table/:id", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const n = await deleteOwned(got.store, table, requireUuid(c.req.param("id")));
  if (!n) return json({ error: "not found" }, 404, OPEN_CORS);
  return json({ deleted: n }, 200, OPEN_CORS);
});

app.post("/api/rpc/apply_patch", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const body = await readJson<{ p_table?: string; p_match?: Record<string, unknown>; p_patch?: Record<string, unknown> }>(c);
  if (!body.p_table || !body.p_match || !body.p_patch) {
    return json({ error: "p_table, p_match, p_patch required" }, 400, OPEN_CORS);
  }
  try {
    const result = await applyPatch(got.store, body.p_table, body.p_match, body.p_patch);
    return json({ data: result }, 200, OPEN_CORS);
  } catch {
    return json({ error: "request failed" }, 400, OPEN_CORS);
  }
});

app.post("/api/rpc/contacts", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const body = await readJson<{ search?: string }>(c);
  const rows = await contacts(got.store, body.search ?? "");
  return json({ data: rows }, 200, OPEN_CORS);
});

app.post("/api/rpc/rotate_inbound_token", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const token = await rotateInboundToken(got.store);
  return json({ data: token }, 200, OPEN_CORS);
});

app.post("/api/rpc/claim_reminder", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  const body = await readJson<{ reminder_key?: string; fire_at?: string }>(c);
  if (!body.reminder_key || !body.fire_at) {
    return json({ error: "reminder_key and fire_at required" }, 400, OPEN_CORS);
  }
  const ok = await claimReminder(got.store, body.reminder_key, body.fire_at);
  return json({ data: ok }, ok ? 200 : 404, OPEN_CORS);
});

function refuseIfFrozen(c: Context<AppEnv>): Response | null {
  if (!writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) return null;
  return json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS);
}

app.all("/api/cron/:job", (c) => handleCron(c));
app.all("/api/agent", (c) => refuseIfFrozen(c) ?? handleAgent(c));
app.all("/api/mcp", (c) => refuseIfFrozen(c) ?? handleMcp(c));
app.all("/api/day", (c) => handleDay(c));
app.all("/api/capture", (c) => refuseIfFrozen(c) ?? handleCapture(c));
app.all("/api/inbound-email", (c) => handleInboundEmail(c));
app.all("/api/route-events", (c) => handleRouteEvents(c));

app.all("/functions/v1/agent", (c) => refuseIfFrozen(c) ?? handleAgent(c));
app.all("/functions/v1/mcp", (c) => refuseIfFrozen(c) ?? handleMcp(c));
app.all("/functions/v1/day", (c) => handleDay(c));
app.all("/functions/v1/capture", (c) => refuseIfFrozen(c) ?? handleCapture(c));
app.all("/functions/v1/inbound-email", (c) => handleInboundEmail(c));
app.all("/functions/v1/route-events", (c) => handleRouteEvents(c));
app.all("/functions/v1/rollover", (c) => handleUserRollover(c));
app.all("/api/rollover", (c) => handleUserRollover(c));

app.options("/api/slot-mirror", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/api/task-mirror", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/functions/v1/slot-mirror", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/functions/v1/task-mirror", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/api/push-dispatch", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/functions/v1/push-dispatch", () => new Response("ok", { headers: OPEN_CORS }));

app.all("/api/slot-mirror", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  return handleSlotMirror(c, got.store, { env: c.env, fetchImpl: workerTestFetch() });
});
app.all("/functions/v1/slot-mirror", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  return handleSlotMirror(c, got.store, { env: c.env, fetchImpl: workerTestFetch() });
});
app.all("/api/task-mirror", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  return handleTaskMirror(c, got.store, { env: c.env, fetchImpl: workerTestFetch() });
});
app.all("/functions/v1/task-mirror", async (c) => {
  const got = await requireWritableStore(c);
  if ("error" in got) return got.error;
  return handleTaskMirror(c, got.store, { env: c.env, fetchImpl: workerTestFetch() });
});
app.all("/api/push-dispatch", (c) => handleCron(c, "push-dispatch"));
app.all("/functions/v1/push-dispatch", (c) => handleCron(c, "push-dispatch"));

app.all("/functions/v1/:name", (c) => stayOnSupabase(c.req.param("name")));

function hasFileExtension(path: string): boolean {
  return /\.[A-Za-z0-9]{1,16}$/.test(path);
}

async function fromAssets(c: { env: Env; req: { raw: Request; url: string } }): Promise<Response> {
  const assets = c.env.ASSETS;
  if (!assets) return missingAsset();
  const res = await assets.fetch(c.req.raw);
  const path = new URL(c.req.url).pathname;
  const contentType = res.headers.get("content-type") ?? "";
  if (hasFileExtension(path) && (res.status === 404 || contentType.includes("text/html"))) {
    return missingAsset();
  }
  return res;
}

app.all("/assets/*", (c) => fromAssets(c));
app.all("*", (c) => fromAssets(c));

async function scheduled(
  event: { cron: string },
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<void> {
  if (!cutoverFlipped(env.CUTOVER_FLIPPED)) return;
  if (writeFrozen(env.MAINTENANCE_WRITE_FREEZE)) return;
  let sql: Sql | null = null;
  try {
    try {
      sql = openSql(env);
    } catch {
      sql = null;
    }
    await handleScheduled(event, env, (job) => runCronJob(job, env, sql));
  } finally {
    if (sql) ctx.waitUntil(closeSql(sql));
  }
}

function queue(batch: QueueBatch<CalendarSyncMessage>): void {
  consumeCalendarSyncBatch(batch);
}

Object.assign(app, { scheduled, queue });

export default app;
