import { Hono } from "hono";
import { API_SECURITY, beginAuthCors, json, OPEN_CORS } from "./cors.ts";
import { getAuth, sessionUser } from "./auth.ts";
import { getSql } from "./db.ts";
import type { Env } from "./env.ts";
import {
  applyPatch,
  bootstrapUser,
  claimReminder,
  contacts,
  deleteOwned,
  deleteTaskLabel,
  getOwned,
  insertTaskLabel,
  isPlannerTable,
  listOwned,
  listTaskLabels,
  makeStore,
  rotateInboundToken,
  updateOwned,
  upsertOwned,
  type PlannerTable,
} from "./store.ts";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/functions/v1/")) {
    for (const [key, value] of Object.entries(API_SECURITY)) {
      c.res.headers.set(key, value);
    }
  }
});

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
  }),
);

app.all("/api/auth/*", async (c) => {
  const started = beginAuthCors(c.req.header("Origin"), c.env);
  if (!started.ok) return started.response;
  const cors = started.cors;
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = getAuth(c.env);
    const res = await auth.handler(c.req.raw);
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
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
});

async function requireStore(c: { env: Env; req: { raw: Request } }) {
  const user = await sessionUser(c.env, c.req.raw);
  if (!user) return { error: json({ error: "unauthorized" }, 401, OPEN_CORS) };
  const sql = getSql(c.env);
  const store = makeStore(sql, user.id);
  await bootstrapUser(store, user.email ?? null);
  return { store };
}

app.options("/api/data/*", () => new Response("ok", { headers: OPEN_CORS }));
app.options("/api/rpc/*", () => new Response("ok", { headers: OPEN_CORS }));

app.get("/api/data/task_labels", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const taskId = c.req.query("task_id");
  if (!taskId) return json({ error: "task_id required" }, 400, OPEN_CORS);
  const rows = await listTaskLabels(got.store, taskId);
  return json({ data: rows }, 200, OPEN_CORS);
});

app.post("/api/data/task_labels", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const body = await c.req.json<{ task_id?: string; label_id?: string }>();
  if (!body.task_id || !body.label_id) return json({ error: "task_id and label_id required" }, 400, OPEN_CORS);
  const ok = await insertTaskLabel(got.store, body.task_id, body.label_id);
  return json({ data: ok ? body : null }, ok ? 200 : 404, OPEN_CORS);
});

app.delete("/api/data/task_labels", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const taskId = c.req.query("task_id");
  const labelId = c.req.query("label_id");
  if (!taskId || !labelId) return json({ error: "task_id and label_id required" }, 400, OPEN_CORS);
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
  const row = await getOwned(got.store, table, c.req.param("id"));
  if (!row) return json({ error: "not found" }, 404, OPEN_CORS);
  return json({ data: row }, 200, OPEN_CORS);
});

app.post("/api/data/:table", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const body = await c.req.json<Record<string, unknown>>();
  const row = await upsertOwned(got.store, table as PlannerTable, body);
  if (!row) return json({ error: "cannot insert" }, 400, OPEN_CORS);
  return json({ data: row }, 200, OPEN_CORS);
});

app.patch("/api/data/:table/:id", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const body = await c.req.json<Record<string, unknown>>();
  const row = await updateOwned(got.store, table, c.req.param("id"), body);
  if (!row) return json({ error: "not found" }, 404, OPEN_CORS);
  return json({ data: row }, 200, OPEN_CORS);
});

app.delete("/api/data/:table/:id", async (c) => {
  const table = c.req.param("table");
  if (!isPlannerTable(table)) return json({ error: "unknown table" }, 404, OPEN_CORS);
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const n = await deleteOwned(got.store, table, c.req.param("id"));
  if (!n) return json({ error: "not found" }, 404, OPEN_CORS);
  return json({ deleted: n }, 200, OPEN_CORS);
});

app.post("/api/rpc/apply_patch", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const body = await c.req.json<{ p_table?: string; p_match?: Record<string, unknown>; p_patch?: Record<string, unknown> }>();
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
  const body = await c.req.json<{ search?: string }>().catch(() => ({ search: "" }));
  const rows = await contacts(got.store, body.search ?? "");
  return json({ data: rows }, 200, OPEN_CORS);
});

app.post("/api/rpc/rotate_inbound_token", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const token = await rotateInboundToken(got.store);
  return json({ data: token }, 200, OPEN_CORS);
});

app.post("/api/rpc/claim_reminder", async (c) => {
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const body = await c.req.json<{ reminder_key?: string; fire_at?: string }>();
  if (!body.reminder_key || !body.fire_at) {
    return json({ error: "reminder_key and fire_at required" }, 400, OPEN_CORS);
  }
  const ok = await claimReminder(got.store, body.reminder_key, body.fire_at);
  return json({ data: ok }, ok ? 200 : 404, OPEN_CORS);
});

function notPorted(name: string): Response {
  return json(
    {
      error: `${name} is not ported to the Worker yet`,
      stay_on_supabase: true,
    },
    501,
    OPEN_CORS,
  );
}

app.all("/api/agent", () => notPorted("agent"));
app.all("/api/mcp", () => notPorted("mcp"));
app.all("/functions/v1/agent", () => notPorted("agent"));
app.all("/functions/v1/mcp", () => notPorted("mcp"));
app.all("/functions/v1/:name", (c) => notPorted(c.req.param("name")));

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

export default app;
